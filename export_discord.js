/**
 * Discord Export — discord.js-selfbot-v13
 * ----------------------------------------
 * Exporte les conversations complètes (messages envoyés + reçus).
 *
 * AVERTISSEMENT : L'utilisation d'un self-bot viole les CGU de Discord.
 * À utiliser uniquement pour usage personnel à tes propres risques.
 *
 * Installation :
 *   npm install
 *
 * Utilisation :
 *   # Tout exporter (serveurs + DMs)
 *   node export_discord.js
 *
 *   # Un salon précis (channel d'un serveur ou DM)
 *   node export_discord.js https://discord.com/channels/GUILD_ID/CHANNEL_ID
 *   node export_discord.js https://discord.com/channels/@me/CHANNEL_ID
 *
 *   # Tous les salons d'un serveur
 *   node export_discord.js https://discord.com/channels/GUILD_ID
 *
 * Nommage des fichiers/dossiers : <nom>_<id>
 *
 * Comment obtenir ton user token :
 *   1. Ouvre Discord dans ton navigateur (discord.com/app)
 *   2. F12 → Console → colle :
 *      window.webpackChunkdiscord_app.push([
 *        [Math.random()], {},
 *        req => { window.discord_token = Object.values(req.c)
 *          .find(x => x?.exports?.default?.getToken)
 *          ?.exports?.default?.getToken() }
 *      ]); console.log(window.discord_token);
 *   3. Copie la valeur affichée
 */

'use strict';

const { Client } = require('discord.js-selfbot-v13');
const fs   = require('fs');
const path   = require('path');
const https  = require('https');
const http   = require('http');

// ── Configuration ──────────────────────────────────────────────────────────

const TOKEN      = process.env.DISCORD_TOKEN || 'PASTE_YOUR_USER_TOKEN_HERE';
const OUTPUT_DIR = 'discord_export';

/** null = tout exporter, sinon nb max de messages par salon */
const MESSAGE_LIMIT = null;

/** Noms de salons à ignorer (mode export complet uniquement) */
const IGNORE_CHANNELS = [];

/** Extensions média détectées dans les liens externes */
const MEDIA_EXTS  = /\.(jpg|jpeg|png|gif|webp|svg|bmp|mp4|webm|mov|avi|mkv|gifv)(\?.*)?$/i;
/** Domaines connus d'hébergement média */
const MEDIA_HOSTS = /(tenor\.com|giphy\.com|imgur\.com|gyazo\.com|prnt\.sc|i\.redd\.it)/i;

// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse une URL Discord et retourne { type, guildId, channelId }
 *
 * Types possibles :
 *   'guild'         → https://discord.com/channels/GUILD_ID
 *   'guild_channel' → https://discord.com/channels/GUILD_ID/CHANNEL_ID
 *   'dm'            → https://discord.com/channels/@me/CHANNEL_ID
 *
 * @param {string} url
 * @returns {{ type: string, guildId: string|null, channelId: string|null }|null}
 */
function parseDiscordUrl(url) {
  const m = url.match(/discord\.com\/channels\/(@me|\d+)(?:\/(\d+))?/);
  if (!m) return null;
  const [, first, channelId] = m;
  if (first === '@me') {
    return { type: 'dm', guildId: null, channelId: channelId || null };
  }
  if (channelId) {
    return { type: 'guild_channel', guildId: first, channelId };
  }
  return { type: 'guild', guildId: first, channelId: null };
}

/** Rend une chaîne valide comme nom de fichier/dossier */
function sanitize(str) {
  return (str || 'inconnu').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100);
}

/** Nettoie un nom de fichier pour le système de fichiers */
function sanitizeFilename(str) {
  return (str || 'fichier').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

/** Extrait l'extension d'une URL (jpg, png, mp4, etc.) */
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(\w+)(?:\?|$)/);
    return m ? m[1].toLowerCase() : 'bin';
  } catch { return 'bin'; }
}

/** Nom de fichier/dossier au format <nom>_<id> */
function nameWithId(name, id) {
  return `${sanitize(name)}_${id}`;
}

/** Formate un message Discord en texte lisible */
function formatMessage(msg) {
  const ts = msg.createdAt.toISOString().replace('T', ' ').slice(0, 19);
  const author = msg.author;
  const display = author.globalName || author.username;
  const name = display !== author.username
    ? `${display} (@${author.username})`
    : `@${author.username}`;

  const lines = [];

  // Résolution des mentions
  let content = msg.content || '';
  msg.mentions.users.forEach((u) => {
    const disp = u.globalName || u.username;
    content = content.replace(new RegExp(`<@!?${u.id}>`, 'g'), `@${disp}`);
  });

  if (content) {
    lines.push(`[${ts}] ${name}: ${content}`);
  } else {
    lines.push(`[${ts}] ${name}:`);
  }

  // Pièces jointes
  msg.attachments.forEach((att) => {
    lines.push(`  [Fichier] ${att.name} → ${att.url}`);
  });

  // Embeds
  msg.embeds.forEach((embed) => {
    const parts = [embed.title, embed.description, embed.url].filter(Boolean);
    if (parts.length) {
      lines.push(`  [Embed] ${parts.join(' | ').slice(0, 200)}`);
    }
  });

  // Stickers
  msg.stickers.forEach((sticker) => {
    lines.push(`  [Sticker] ${sticker.name}`);
  });

  // Message cité (réponse)
  if (msg.reference && msg.mentions.repliedUser) {
    const refContent = msg.content?.slice(0, 60) || '[embed/fichier]';
    const refAuthor  = msg.mentions.repliedUser.username;
    lines[0] += `  ↩ (répond à @${refAuthor}: ${refContent})`;
  }

  return lines.join('\n');
}

/**
 * Télécharge un fichier depuis une URL vers un chemin local.
 * Gère les redirections HTTP.
 * @param {string} url
 * @param {string} destPath
 * @returns {Promise<void>}
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const req = proto.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        const loc = res.headers.location;
        if (loc) { downloadFile(loc, destPath).then(resolve).catch(reject); }
        else { reject(new Error('Redirection sans Location')); }
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const file = fs.createWriteStream(destPath);
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', (e) => { fs.unlink(destPath, () => {}); reject(e); });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Télécharge tous les médias d'une liste de messages dans un dossier.
 * Inclut : pièces jointes, embeds (images/vignettes/vidéos), stickers,
 * et liens externes d'image/vidéo/gif dans le contenu des messages.
 * @param {import('discord.js-selfbot-v13').Message[]} messages
 * @param {string} mediaFolder  dossier de destination
 * @returns {Promise<number>} nombre de fichiers téléchargés
 */
async function downloadChannelMedia(messages, mediaFolder) {
  const downloaded = new Set();
  fs.mkdirSync(mediaFolder, { recursive: true });
  let count = 0;

  for (const msg of messages) {
    const urls = [];

    // 1. Pièces jointes Discord
    for (const att of msg.attachments.values()) {
      const ext = extFromUrl(att.url);
      urls.push({
        url:  att.url,
        name: `${msg.id}_${sanitizeFilename(att.name || 'attachment')}.${ext}`
      });
    }

    // 2. Embeds : images, vignettes, vidéos
    for (const embed of msg.embeds) {
      if (embed.image?.url) {
        urls.push({
          url:  embed.image.url,
          name: `${msg.id}_embed_image.${extFromUrl(embed.image.url)}`
        });
      }
      if (embed.thumbnail?.url) {
        urls.push({
          url:  embed.thumbnail.url,
          name: `${msg.id}_embed_thumb.${extFromUrl(embed.thumbnail.url)}`
        });
      }
      if (embed.video?.url) {
        urls.push({
          url:  embed.video.url,
          name: `${msg.id}_embed_video.${extFromUrl(embed.video.url)}`
        });
      }
    }

    // 3. Stickers
    for (const sticker of msg.stickers.values()) {
      const stickerUrl = sticker.url
        || `https://media.discordapp.net/stickers/${sticker.id}.png`;
      urls.push({
        url:  stickerUrl,
        name: `${msg.id}_sticker_${sanitizeFilename(sticker.name || sticker.id)}.png`
      });
    }

    // 4. Liens externes image/vidéo/gif dans le contenu
    const content = msg.content || '';
    const linkRegex = /(https?:\/\/[^\s<>"{}|\\^`]+)/gi;
    let match;
    while ((match = linkRegex.exec(content)) !== null) {
      const linkUrl = match[0];
      if (MEDIA_EXTS.test(linkUrl) || MEDIA_HOSTS.test(linkUrl)) {
        const filePart = linkUrl.split('/').pop()?.split('?')[0] || 'media';
        const ext = extFromUrl(linkUrl);
        urls.push({
          url:  linkUrl,
          name: `${msg.id}_link_${sanitizeFilename(filePart)}.${ext}`
        });
      }
    }

    // Téléchargement effectif
    for (const { url, name } of urls) {
      if (downloaded.has(url)) continue;
      downloaded.add(url);
      const filepath = path.join(mediaFolder, name);
      // Évite de re-télécharger un fichier déjà présent
      if (fs.existsSync(filepath)) continue;
      try {
        await downloadFile(url, filepath);
        count++;
      } catch (_err) {
        // échec silencieux pour un média individuel
      }
    }
  }

  return count;
}

/**
 * Récupère TOUS les messages d'un channel par pagination
 * @param {import('discord.js-selfbot-v13').TextChannel | import('discord.js-selfbot-v13').DMChannel} channel
 * @returns {Promise<import('discord.js-selfbot-v13').Message[]>}
 */
async function fetchAllMessages(channel) {
  const messages = [];
  let before = null;

  while (true) {
    const options = { limit: 100 };
    if (before) options.before = before;

    const batch = await channel.messages.fetch(options);
    if (!batch.size) break;

    batch.forEach((m) => messages.push(m));

    if (batch.size < 100) break;
    if (MESSAGE_LIMIT && messages.length >= MESSAGE_LIMIT) break;

    // Le plus ancien ID de ce batch → fetch la page suivante
    before = batch.last().id;
  }

  if (MESSAGE_LIMIT) messages.splice(MESSAGE_LIMIT);

  // Du plus ancien au plus récent
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Écrit les messages d'un channel dans un fichier texte.
 * Le nom du fichier est toujours <nom>_<id>.txt
 * @param {object} channel  objet Channel discord.js
 * @param {string} folder   dossier de destination
 * @returns {Promise<number>} nombre de messages écrits
 */
async function exportChannel(channel, folder) {
  const fileName = nameWithId(channel.name || 'dm', channel.id);
  const filepath  = path.join(folder, `${fileName}.txt`);

  let messages;
  try {
    messages = await fetchAllMessages(channel);
  } catch (err) {
    if (err.code === 50013 || err.status === 403) {
      console.log(`  ✗ #${channel.name || channel.id} → accès refusé`);
      return 0;
    }
    console.log(`  ✗ #${channel.name || channel.id} → erreur : ${err.message}`);
    return 0;
  }

  if (!messages.length) {
    console.log(`  - #${channel.name || channel.id} → vide`);
    return 0;
  }

  fs.mkdirSync(folder, { recursive: true });

  const lines = [];
  lines.push('='.repeat(60));
  if (channel.type === 'DM') {
    const other = channel.recipient;
    lines.push(`DM avec  : ${other.globalName || other.username} (@${other.username})`);
    lines.push(`Channel ID : ${channel.id}`);
  } else if (channel.type === 'GROUP_DM') {
    lines.push(`Groupe DM : ${channel.name || 'Sans nom'}`);
    lines.push(`Channel ID : ${channel.id}`);
    const members = channel.recipients.map((r) => r.username).join(', ');
    lines.push(`Membres   : ${members}`);
  } else {
    lines.push(`Salon    : #${channel.name}  (id: ${channel.id})`);
    if (channel.guild) lines.push(`Serveur  : ${channel.guild.name}  (id: ${channel.guild.id})`);
  }
  lines.push(`Exporté  : ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`Messages : ${messages.length}`);
  lines.push('='.repeat(60));
  lines.push('');

  for (const msg of messages) {
    lines.push(formatMessage(msg));
  }

  fs.writeFileSync(filepath, lines.join('\n'), 'utf8');

  // Téléchargement des médias dans un dossier adjacent
  const mediaFolder = path.join(folder, `${fileName}_files`);
  const mediaCount = await downloadChannelMedia(messages, mediaFolder);

  const mediaInfo = mediaCount > 0 ? ` + ${mediaCount} médias` : '';
  console.log(`  ✓ ${fileName}.txt → ${messages.length} messages${mediaInfo}`);
  return messages.length;
}

// Types de channels de serveur à traiter (hors catégories et hors fils)
const EXPORTABLE_TYPES = new Set([
  'GUILD_TEXT',
  'GUILD_NEWS',
  'GUILD_VOICE',        // vocal avec messages texte
  'GUILD_STAGE_VOICE',  // stage avec messages texte
]);
const FORUM_TYPES = new Set(['GUILD_FORUM', 'GUILD_MEDIA']);

/**
 * Exporte un channel de type Forum ou Media :
 * crée un dossier <forum_nom>_<id>/ et un fichier par post (thread).
 * @param {object} forumCh  channel de type GUILD_FORUM / GUILD_MEDIA
 * @param {string} parentFolder  dossier parent (catégorie ou racine du serveur)
 * @returns {Promise<number>} total de messages
 */
async function exportForumChannel(forumCh, parentFolder) {
  const forumFolder = path.join(parentFolder, nameWithId(forumCh.name, forumCh.id));
  fs.mkdirSync(forumFolder, { recursive: true });

  console.log(`  [Forum] #${forumCh.name}_${forumCh.id}/`);

  // Threads actifs
  const activeResult   = await forumCh.threads.fetchActive().catch(() => null);
  // Threads archivés (jusqu'à 100 par appel — on pagine)
  const allThreads = new Map();
  if (activeResult) activeResult.threads.forEach((t) => allThreads.set(t.id, t));

  let hasMore = true;
  let before  = null;
  while (hasMore) {
    const opts = { limit: 100 };
    if (before) opts.before = before;
    const archived = await forumCh.threads.fetchArchived(opts).catch(() => null);
    if (!archived || !archived.threads.size) break;
    archived.threads.forEach((t) => allThreads.set(t.id, t));
    hasMore  = archived.hasMore ?? false;
    before   = archived.threads.last()?.id ?? null;
  }

  console.log(`    ${allThreads.size} post(s)`);

  let total = 0;
  for (const [, thread] of allThreads) {
    if (IGNORE_CHANNELS.includes(thread.name)) continue;
    total += await exportChannel(thread, forumFolder);
  }
  return total;
}

/**
 * Exporte un serveur entier en respectant son organisation :
 *   discord_export/<serveur>_<id>/
 *     <categorie>_<id>/          ← si le salon a une catégorie
 *       <salon>_<id>.txt         ← salon texte / vocal
 *       <forum>_<id>/            ← forum/media = dossier
 *         <post>_<id>.txt
 *     <salon-sans-categorie>_<id>.txt   ← directement à la racine
 */
async function exportGuildById(client, guildId) {
  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error(`ERREUR : Serveur introuvable (id: ${guildId}).`);
    return;
  }

  await guild.channels.fetch();

  const guildFolder = path.join(OUTPUT_DIR, nameWithId(guild.name, guild.id));
  fs.mkdirSync(guildFolder, { recursive: true });

  console.log(`\n[Serveur] ${guild.name}  (id: ${guild.id})`);
  console.log(`  Dossier : ${guildFolder}`);

  // Carte des catégories id → objet channel
  const categories = new Map();
  guild.channels.cache.forEach((ch) => {
    if (ch.type === 'GUILD_CATEGORY') categories.set(ch.id, ch);
  });

  // Salons à exporter, triés par position dans le serveur
  const toExport = guild.channels.cache
    .filter((c) =>
      (EXPORTABLE_TYPES.has(c.type) || FORUM_TYPES.has(c.type)) &&
      !IGNORE_CHANNELS.includes(c.name)
    )
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  console.log(`  ${toExport.size} salon(s) à exporter\n`);

  let total = 0;
  for (const [, ch] of toExport) {
    // Résolution du dossier parent (catégorie ou racine du serveur)
    let targetFolder = guildFolder;
    if (ch.parentId && categories.has(ch.parentId)) {
      const cat = categories.get(ch.parentId);
      const catLabel = `  [Cat] ${cat.name}_${cat.id}/`;
      targetFolder = path.join(guildFolder, nameWithId(cat.name, cat.id));
      // On affiche la catégorie seulement à la première fois qu'on la rencontre
      if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
        console.log(catLabel);
      }
    }

    if (FORUM_TYPES.has(ch.type)) {
      total += await exportForumChannel(ch, targetFolder);
    } else {
      total += await exportChannel(ch, targetFolder);
    }
  }

  console.log(`\n→ ${total} messages exportés pour ${guild.name}`);
}

/**
 * Exporte un seul salon (serveur ou DM) identifié par son ID.
 * Si c'est un forum, exporte tous ses posts.
 */
async function exportChannelById(client, channelId) {
  const ch = client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    console.error(`ERREUR : Channel introuvable (id: ${channelId}).`);
    return;
  }

  // Dossier de sortie : racine du serveur (sans arborescence catégorie pour export ciblé)
  let baseFolder;
  if (ch.guild) {
    baseFolder = path.join(OUTPUT_DIR, nameWithId(ch.guild.name, ch.guild.id));
  } else {
    baseFolder = path.join(OUTPUT_DIR, 'DMs');
  }
  fs.mkdirSync(baseFolder, { recursive: true });

  console.log(`\n[Channel] #${ch.name || ch.id}  (id: ${ch.id})`);
  if (ch.guild) console.log(`[Serveur] ${ch.guild.name}  (id: ${ch.guild.id})`);
  console.log(`  Dossier : ${baseFolder}\n`);

  let count = 0;
  if (FORUM_TYPES.has(ch.type)) {
    count = await exportForumChannel(ch, baseFolder);
  } else {
    count = await exportChannel(ch, baseFolder);
  }
  console.log(`\n→ ${count} messages exportés`);
}

/** Exporte tous les serveurs accessibles. */
async function exportAllGuilds(client) {
  console.log(`\n── SERVEURS (${client.guilds.cache.size}) ──────────────────────────────────`);
  for (const [, guild] of client.guilds.cache) {
    await exportGuildById(client, guild.id);
  }
}

/** Exporte tous les DMs et groupes DM ouverts. */
async function exportAllDMs(client) {
  console.log('\n── MESSAGES PRIVÉS (DMs) ─────────────────────────────');
  await client.relationships.fetch();
  const dmChannels = client.channels.cache.filter(
    (c) => c.type === 'DM' || c.type === 'GROUP_DM'
  );
  console.log(`${dmChannels.size} conversation(s) DM\n`);

  const folder = path.join(OUTPUT_DIR, 'DMs');
  fs.mkdirSync(folder, { recursive: true });

  let total = 0;
  for (const [, ch] of dmChannels) {
    total += await exportChannel(ch, folder);
  }
  console.log(`\n→ ${total} messages DM exportés`);
}

async function main() {
  if (TOKEN === 'PASTE_YOUR_USER_TOKEN_HERE') {
    console.error('ERREUR : Renseigne ton user token.');
    console.error('\nComment l\'obtenir :');
    console.error('  1. Ouvre Discord dans ton navigateur (discord.com/app)');
    console.error('  2. F12 → Console → colle :');
    console.error(`
  window.webpackChunkdiscord_app.push([
    [Math.random()], {},
    req => { window.discord_token = Object.values(req.c)
      .find(x => x?.exports?.default?.getToken)
      ?.exports?.default?.getToken() }
  ]); console.log(window.discord_token);
`);
    console.error('  3. Copie la valeur affichée');
    console.error('\nPuis lance :');
    console.error('  set DISCORD_TOKEN=ton_token_ici  (CMD)');
    console.error('  node export_discord.js [url_discord]');
    process.exit(1);
  }

  // Lecture de l'URL optionnelle passée en argument
  const urlArg  = process.argv[2] || null;
  const parsed  = urlArg ? parseDiscordUrl(urlArg) : null;

  if (urlArg && !parsed) {
    console.error(`ERREUR : URL Discord non reconnue : ${urlArg}`);
    console.error('Formats acceptés :');
    console.error('  https://discord.com/channels/GUILD_ID');
    console.error('  https://discord.com/channels/GUILD_ID/CHANNEL_ID');
    console.error('  https://discord.com/channels/@me/CHANNEL_ID');
    process.exit(1);
  }

  const client = new Client({ checkUpdate: false });

  client.on('ready', async () => {
    const me = client.user;
    console.log('='.repeat(60));
    console.log(`Connecté : ${me.globalName || me.username} (@${me.username})`);
    console.log(`ID       : ${me.id}`);
    console.log(`Sortie   : ${path.resolve(OUTPUT_DIR)}`);
    if (parsed) {
      console.log(`Mode     : export ciblé (${parsed.type})`);
      if (parsed.guildId)   console.log(`Guild ID  : ${parsed.guildId}`);
      if (parsed.channelId) console.log(`Channel ID: ${parsed.channelId}`);
    } else {
      console.log('Mode     : export complet (serveurs + DMs)');
    }
    console.log('='.repeat(60));

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    try {
      if (!parsed) {
        // Aucune URL → export complet
        await exportAllGuilds(client);
        await exportAllDMs(client);
      } else if (parsed.type === 'guild') {
        // URL de serveur → tous ses salons
        await exportGuildById(client, parsed.guildId);
      } else if (parsed.type === 'guild_channel') {
        // URL d'un salon de serveur précis
        await exportChannelById(client, parsed.channelId);
      } else if (parsed.type === 'dm') {
        // URL d'un DM
        await exportChannelById(client, parsed.channelId);
      }
    } catch (err) {
      console.error('\nErreur inattendue :', err);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Export terminé !');
    console.log(`Fichiers dans : ${path.resolve(OUTPUT_DIR)}`);
    client.destroy();
  });

  client.login(TOKEN).catch((err) => {
    console.error('Impossible de se connecter :', err.message);
    process.exit(1);
  });
}

main();
