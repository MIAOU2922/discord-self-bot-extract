/**
 * Discord Export — discord.js-selfbot-v13
 * ----------------------------------------
 * Exports complete conversations (sent + received messages).
 *
 * WARNING: Using a self-bot violates Discord's ToS.
 * Use only for personal use at your own risk.
 *
 * Installation:
 *   npm install
 *
 * Usage:
 *   # Export everything (servers + DMs)
 *   npm run export
 *
 *   # A specific channel (server channel or DM)
 *   npm run export -- https://discord.com/channels/GUILD_ID/CHANNEL_ID
 *   npm run export -- https://discord.com/channels/@me/CHANNEL_ID
 *
 *   # All channels of a server
 *   npm run export -- https://discord.com/channels/GUILD_ID
 *
 * File/folder naming: <name>_<id>
 */

'use strict';

const { Client } = require('discord.js-selfbot-v13');
const fs       = require('fs');
const path     = require('path');
const https    = require('https');
const http     = require('http');
const readline = require('readline');

// ── Configuration ──────────────────────────────────────────────────────────

/** Token: environment variable first, otherwise prompted interactively */
const TOKEN = process.env.DISCORD_TOKEN || null;

const OUTPUT_DIR = 'discord_export';

/** null = export all, otherwise max messages per channel */
const MESSAGE_LIMIT = null;

/** Channel names to skip (full export mode only) */
const IGNORE_CHANNELS = [];

/** Download media — set interactively, default true */
let DOWNLOAD_MEDIA = true;

/** Media extensions detected in external links */
const MEDIA_EXTS  = /\.(jpg|jpeg|png|gif|webp|svg|bmp|mp4|webm|mov|avi|mkv|gifv)(\?.*)?$/i;
/** Known media hosting domains */
const MEDIA_HOSTS = /(tenor\.com|giphy\.com|imgur\.com|gyazo\.com|prnt\.sc|i\.redd\.it)/i;

// ──────────────────────────────────────────────────────────────────────────

/**
 * Parse a Discord URL and return { type, guildId, channelId }
 *
 * Possible types:
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

/** Make a string safe for file/folder names */
function sanitize(str) {
  return (str || 'unknown').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 100);
}

/** Clean a filename for the filesystem */
function sanitizeFilename(str) {
  return (str || 'file').replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 200);
}

/** Extract the extension from a URL (jpg, png, mp4, etc.) */
function extFromUrl(url) {
  try {
    const p = new URL(url).pathname;
    const m = p.match(/\.(\w+)(?:\?|$)/);
    return m ? m[1].toLowerCase() : 'bin';
  } catch { return 'bin'; }
}

/** File/folder name in <name>_<id> format */
function nameWithId(name, id) {
  return `${sanitize(name)}_${id}`;
}

/** Format a Discord message as human-readable text */
function formatMessage(msg) {
  const ts = msg.createdAt.toISOString().replace('T', ' ').slice(0, 19);
  const author = msg.author;
  const display = author.globalName || author.username;
  const name = display !== author.username
    ? `${display} (@${author.username})`
    : `@${author.username}`;

  const lines = [];

  // Resolve mentions
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

  // Attachments
  msg.attachments.forEach((att) => {
    lines.push(`  [File] ${att.name} → ${att.url}`);
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

  // Reply reference
  if (msg.reference && msg.mentions.repliedUser) {
    const refContent = msg.content?.slice(0, 60) || '[embed/file]';
    const refAuthor  = msg.mentions.repliedUser.username;
    lines[0] += `  ↩ (replying to @${refAuthor}: ${refContent})`;
  }

  return lines.join('\n');
}

/**
 * Download a file from a URL to a local path.
 * Handles HTTP redirects.
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
        else { reject(new Error('Redirect without Location header')); }
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
 * Download all media from a list of messages into a folder.
 * Includes: attachments, embeds (images/thumbnails/videos), stickers,
 * and external image/video/gif links in message content.
 * @param {import('discord.js-selfbot-v13').Message[]} messages
 * @param {string} mediaFolder  destination folder
 * @returns {Promise<number>} number of files downloaded
 */
async function downloadChannelMedia(messages, mediaFolder) {
  const downloaded = new Set();
  fs.mkdirSync(mediaFolder, { recursive: true });
  let count = 0;

  for (const msg of messages) {
    const urls = [];

    // 1. Discord attachments
    for (const att of msg.attachments.values()) {
      const ext = extFromUrl(att.url);
      urls.push({
        url:  att.url,
        name: `${msg.id}_${sanitizeFilename(att.name || 'attachment')}.${ext}`
      });
    }

    // 2. Embeds: images, thumbnails, videos
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

    // 4. External image/video/gif links in message content
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

    // Actual download
    for (const { url, name } of urls) {
      if (downloaded.has(url)) continue;
      downloaded.add(url);
      const filepath = path.join(mediaFolder, name);
      // Skip already-downloaded files
      if (fs.existsSync(filepath)) continue;
      try {
        await downloadFile(url, filepath);
        count++;
      } catch (_err) {
        // silent fail for individual media
      }
    }
  }

  return count;
}

/**
 * Fetch ALL messages from a channel via pagination
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

    // Oldest ID of this batch → fetch next page
    before = batch.last().id;
  }

  if (MESSAGE_LIMIT) messages.splice(MESSAGE_LIMIT);

  // Oldest to newest
  return messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

/**
 * Write a channel's messages to a text file.
 * The filename is always <name>_<id>.txt
 * @param {object} channel  discord.js Channel object
 * @param {string} folder   destination folder
 * @returns {Promise<number>} number of messages written
 */
async function exportChannel(channel, folder) {
  const fileName = nameWithId(channel.name || 'dm', channel.id);
  const filepath  = path.join(folder, `${fileName}.txt`);

  let messages;
  try {
    messages = await fetchAllMessages(channel);
  } catch (err) {
    if (err.code === 50013 || err.status === 403) {
      console.log(`  ✗ #${channel.name || channel.id} → access denied`);
      return 0;
    }
    console.log(`  ✗ #${channel.name || channel.id} → error: ${err.message}`);
    return 0;
  }

  if (!messages.length) {
    console.log(`  - #${channel.name || channel.id} → empty`);
    return 0;
  }

  fs.mkdirSync(folder, { recursive: true });

  const lines = [];
  lines.push('='.repeat(60));
  if (channel.type === 'DM') {
    const other = channel.recipient;
    lines.push(`DM with  : ${other.globalName || other.username} (@${other.username})`);
    lines.push(`Channel ID : ${channel.id}`);
  } else if (channel.type === 'GROUP_DM') {
    lines.push(`Group DM : ${channel.name || 'Unnamed'}`);
    lines.push(`Channel ID : ${channel.id}`);
    const members = channel.recipients.map((r) => r.username).join(', ');
    lines.push(`Members   : ${members}`);
  } else {
    lines.push(`Channel  : #${channel.name}  (id: ${channel.id})`);
    if (channel.guild) lines.push(`Server   : ${channel.guild.name}  (id: ${channel.guild.id})`);
  }
  lines.push(`Exported : ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
  lines.push(`Messages : ${messages.length}`);
  lines.push('='.repeat(60));
  lines.push('');

  for (const msg of messages) {
    lines.push(formatMessage(msg));
  }

  fs.writeFileSync(filepath, lines.join('\n'), 'utf8');

  // Download media into an adjacent folder (if enabled)
  let mediaCount = 0;
  if (DOWNLOAD_MEDIA) {
    const mediaFolder = path.join(folder, `${fileName}_files`);
    mediaCount = await downloadChannelMedia(messages, mediaFolder);
  }

  const mediaInfo = mediaCount > 0 ? ` + ${mediaCount} media` : '';
  console.log(`  ✓ ${fileName}.txt → ${messages.length} messages${mediaInfo}`);
  return messages.length;
}

// Server channel types to process (excluding categories and threads)
const EXPORTABLE_TYPES = new Set([
  'GUILD_TEXT',
  'GUILD_NEWS',
  'GUILD_VOICE',        // voice channel with text messages
  'GUILD_STAGE_VOICE',  // stage channel with text messages
]);
const FORUM_TYPES = new Set(['GUILD_FORUM', 'GUILD_MEDIA']);

/**
 * Export a Forum or Media channel:
 * creates a <forum_name>_<id>/ folder with one file per post (thread).
 * @param {object} forumCh  GUILD_FORUM / GUILD_MEDIA channel
 * @param {string} parentFolder  parent folder (category or server root)
 * @returns {Promise<number>} total message count
 */
async function exportForumChannel(forumCh, parentFolder) {
  const forumFolder = path.join(parentFolder, nameWithId(forumCh.name, forumCh.id));
  fs.mkdirSync(forumFolder, { recursive: true });

  console.log(`  [Forum] #${forumCh.name}_${forumCh.id}/`);

  // Active threads
  const activeResult   = await forumCh.threads.fetchActive().catch(() => null);
  // Archived threads (up to 100 per call — paginated)
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
 * Export an entire server, preserving its organization:
 *   discord_export/<server>_<id>/
 *     <category>_<id>/          ← if the channel has a category
 *       <channel>_<id>.txt      ← text / voice channel
 *       <forum>_<id>/           ← forum/media = folder
 *         <post>_<id>.txt
 *     <channel-without-category>_<id>.txt   ← directly at root
 */
async function exportGuildById(client, guildId) {
  const guild = client.guilds.cache.get(guildId)
    || await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    console.error(`ERROR: Server not found (id: ${guildId}).`);
    return;
  }

  await guild.channels.fetch();

  const guildFolder = path.join(OUTPUT_DIR, nameWithId(guild.name, guild.id));
  fs.mkdirSync(guildFolder, { recursive: true });

  console.log(`\n[Server] ${guild.name}  (id: ${guild.id})`);
  console.log(`  Folder : ${guildFolder}`);

  // Map of categories id → channel object
  const categories = new Map();
  guild.channels.cache.forEach((ch) => {
    if (ch.type === 'GUILD_CATEGORY') categories.set(ch.id, ch);
  });

  // Channels to export, sorted by server position
  const toExport = guild.channels.cache
    .filter((c) =>
      (EXPORTABLE_TYPES.has(c.type) || FORUM_TYPES.has(c.type)) &&
      !IGNORE_CHANNELS.includes(c.name)
    )
    .sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0));

  console.log(`  ${toExport.size} channel(s) to export\n`);

  let total = 0;
  for (const [, ch] of toExport) {
    // Resolve parent folder (category or server root)
    let targetFolder = guildFolder;
    if (ch.parentId && categories.has(ch.parentId)) {
      const cat = categories.get(ch.parentId);
      const catLabel = `  [Cat] ${cat.name}_${cat.id}/`;
      targetFolder = path.join(guildFolder, nameWithId(cat.name, cat.id));
      // Display category only the first time we encounter it
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

  console.log(`\n→ ${total} messages exported for ${guild.name}`);
}

/**
 * Export a single channel (server or DM) identified by its ID.
 * If it's a forum, exports all its posts.
 */
async function exportChannelById(client, channelId) {
  const ch = client.channels.cache.get(channelId)
    || await client.channels.fetch(channelId).catch(() => null);
  if (!ch) {
    console.error(`ERROR: Channel not found (id: ${channelId}).`);
    return;
  }

  // Output folder: server root or DM subfolder
  let baseFolder;
  if (ch.guild) {
    baseFolder = path.join(OUTPUT_DIR, nameWithId(ch.guild.name, ch.guild.id));
  } else {
    baseFolder = path.join(OUTPUT_DIR, 'DMs', dmFolderName(ch));
  }
  fs.mkdirSync(baseFolder, { recursive: true });

  console.log(`\n[Channel] #${ch.name || ch.id}  (id: ${ch.id})`);
  if (ch.guild) console.log(`[Server] ${ch.guild.name}  (id: ${ch.guild.id})`);
  console.log(`  Folder : ${baseFolder}\n`);

  let count = 0;
  if (FORUM_TYPES.has(ch.type)) {
    count = await exportForumChannel(ch, baseFolder);
  } else {
    count = await exportChannel(ch, baseFolder);
  }
  console.log(`\n→ ${count} messages exported`);
}

/** Export all accessible servers. */
async function exportAllGuilds(client) {
  console.log(`\n── SERVERS (${client.guilds.cache.size}) ──────────────────────────────────`);
  for (const [, guild] of client.guilds.cache) {
    await exportGuildById(client, guild.id);
  }
}

/**
 * Get a safe folder name for a DM channel.
 * Uses the recipient's name for 1:1 DMs, group name for group DMs.
 * @param {object} channel
 * @returns {string}
 */
function dmFolderName(channel) {
  if (channel.type === 'GROUP_DM') {
    return nameWithId(channel.name || 'group', channel.id);
  }
  const recipient = channel.recipient;
  const name = recipient?.username || recipient?.globalName || 'dm';
  return nameWithId(name, channel.id);
}

/** Export all open DMs and group DMs. */
async function exportAllDMs(client) {
  console.log('\n── DIRECT MESSAGES (DMs) ─────────────────────────────');
  await client.relationships.fetch();
  const dmChannels = client.channels.cache.filter(
    (c) => c.type === 'DM' || c.type === 'GROUP_DM'
  );
  console.log(`${dmChannels.size} DM conversation(s)\n`);

  const dmsRoot = path.join(OUTPUT_DIR, 'DMs');
  fs.mkdirSync(dmsRoot, { recursive: true });

  let total = 0;
  for (const [, ch] of dmChannels) {
    const dmFolder = path.join(dmsRoot, dmFolderName(ch));
    total += await exportChannel(ch, dmFolder);
  }
  console.log(`\n→ ${total} DM messages exported`);
}

/**
 * Ask a question in the terminal and return the answer.
 * @param {string} query
 * @returns {Promise<string>}
 */
function askQuestion(query) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(query, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

/**
 * Display instructions for obtaining a Discord token.
 */
function showTokenHelp() {
  console.log('\n🔑  How to get your Discord token:');
  console.log('   1. Open Discord in your browser (discord.com/app)');
  console.log('   2. F12 → Console tab → paste this code:');
  console.log(`
      window.webpackChunkdiscord_app.push([
        [Math.random()], {},
        req => {
          for (const k in req.c) {
            const mod = req.c[k];
            const tokenFn = mod?.exports?.default?.getToken
              || mod?.exports?.Z?.getToken
              || mod?.exports?.getToken;
            if (typeof tokenFn === 'function') {
              const t = tokenFn();
              if (t && typeof t === 'string' && t.length > 20) {
                window.discord_token = t;
                break;
              }
            }
          }
        }
      ]);
      console.log(window.discord_token);
`);
  console.log('   3. Copy the displayed value (starts with "MT..." or similar)\n');
}

/**
 * Interactive prompt: token (if missing), target URL, media download.
 * @returns {Promise<{ token: string, urlArg: string|null, downloadMedia: boolean }>}
 */
async function promptUser() {
  let token = TOKEN;
  let urlArg = process.argv[2] || null;
  let downloadMedia = true;

  console.log('═'.repeat(55));
  console.log('  Discord Export — Interactive');
  console.log('═'.repeat(55));

  // 1. Token
  if (!token) {
    showTokenHelp();
    token = await askQuestion('👉  Paste your Discord token: ');
    if (!token) {
      console.error('❌  Token required. Aborting.');
      process.exit(1);
    }
    console.log('');
  } else {
    console.log('🔑  Token found via DISCORD_TOKEN (environment variable)');
  }

  // 2. Target URL
  if (!urlArg) {
    console.log('');
    console.log('📋  What do you want to export?');
    console.log('   • Leave empty → FULL export (all servers + DMs)');
    console.log('   • https://discord.com/channels/GUILD_ID              → an entire server');
    console.log('   • https://discord.com/channels/GUILD_ID/CHANNEL_ID   → a specific channel');
    console.log('   • https://discord.com/channels/@me/CHANNEL_ID        → a DM');
    console.log('');
    urlArg = await askQuestion('👉  Discord URL (or press Enter for full export): ');
  }

  // 3. Download media
  console.log('');
  const answer = await askQuestion('📁  Download media (images, videos, GIFs, stickers)? [Y/n]: ');
  downloadMedia = !answer.toLowerCase().startsWith('n');
  console.log('');

  // Apply media choice at module level
  DOWNLOAD_MEDIA = downloadMedia;

  return { token, urlArg: urlArg || null, downloadMedia };
}

async function main() {
  const { token, urlArg, downloadMedia } = await promptUser();

  // URL validation
  const parsed = urlArg ? parseDiscordUrl(urlArg) : null;
  if (urlArg && !parsed) {
    console.error(`❌  Unrecognized Discord URL: ${urlArg}`);
    console.error('Accepted formats:');
    console.error('  https://discord.com/channels/GUILD_ID');
    console.error('  https://discord.com/channels/GUILD_ID/CHANNEL_ID');
    console.error('  https://discord.com/channels/@me/CHANNEL_ID');
    process.exit(1);
  }

  const client = new Client({ checkUpdate: false });

  client.on('ready', async () => {
    const me = client.user;
    console.log('='.repeat(60));
    console.log(`Connected: ${me.globalName || me.username} (@${me.username})`);
    console.log(`ID       : ${me.id}`);
    console.log(`Output   : ${path.resolve(OUTPUT_DIR)}`);
    if (parsed) {
      console.log(`Mode     : targeted export (${parsed.type})`);
      if (parsed.guildId)   console.log(`Guild ID  : ${parsed.guildId}`);
      if (parsed.channelId) console.log(`Channel ID: ${parsed.channelId}`);
    } else {
      console.log('Mode     : full export (servers + DMs)');
    }
    console.log('='.repeat(60));

    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    try {
      if (!parsed) {
        // No URL → full export
        await exportAllGuilds(client);
        await exportAllDMs(client);
      } else if (parsed.type === 'guild') {
        // Server URL → all its channels
        await exportGuildById(client, parsed.guildId);
      } else if (parsed.type === 'guild_channel') {
        // Specific server channel URL
        await exportChannelById(client, parsed.channelId);
      } else if (parsed.type === 'dm') {
        // DM URL
        await exportChannelById(client, parsed.channelId);
      }
    } catch (err) {
      console.error('\nUnexpected error:', err);
    }

    console.log('\n' + '='.repeat(60));
    console.log('Export complete!');
    console.log(`Files in: ${path.resolve(OUTPUT_DIR)}`);
    client.destroy();
  });

  client.login(token).catch((err) => {
    console.error('Unable to connect:', err.message);
    process.exit(1);
  });
}

main();
