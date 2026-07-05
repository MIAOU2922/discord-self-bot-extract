# Discord Export

Exporte les conversations complètes (messages envoyés **et** reçus) depuis tes serveurs et DMs Discord vers des fichiers texte, en respectant l'organisation du serveur (catégories, forums, posts).

Utilise [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13) avec ton **user token**.

> **Avertissement** : L'utilisation d'un self-bot viole les CGU Discord. À utiliser uniquement pour usage personnel, à tes propres risques.

---

## Prérequis

- [Node.js](https://nodejs.org/) v16.9 ou supérieur
- Ton user token Discord

---

## Obtenir ton user token

1. Ouvre **Discord dans le navigateur** (discord.com/app)
2. Appuie sur **F12** → onglet **Console**
3. Colle ce code et appuie sur Entrée :

```js
window.webpackChunkdiscord_app.push([
  [Math.random()], {},
  req => {
    for (const k in req.c) {
      const mod = req.c[k];
      // Cherche getToken dans exports.default, exports.Z, exports.__esModule
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
```

4. Copie la valeur affichée (commence par `MT...` ou similaire)

---

## Installation

```cmd
cd c:\Dev\test-extract-discord
npm install
```

---

## Configuration

Définis ton token comme variable d'environnement (recommandé) :

```cmd
set DISCORD_TOKEN=ton_token_ici        (CMD)
$env:DISCORD_TOKEN="ton_token_ici"     (PowerShell)
```

Ou modifie directement en haut de `export_discord.js` :

```js
const TOKEN = 'ton_token_ici';
```

Options disponibles en haut du script :

| Variable          | Défaut             | Description                                  |
|-------------------|--------------------|----------------------------------------------|
| `OUTPUT_DIR`      | `"discord_export"` | Dossier de sortie                            |
| `MESSAGE_LIMIT`   | `null`             | Nb max de messages par salon (`null` = tout) |
| `IGNORE_CHANNELS` | `[]`               | Noms de salons à ignorer                     |

---

## Utilisation

```cmd
# Export complet — tous les serveurs + tous les DMs
node export_discord.js

# Tous les salons d'un serveur précis
node export_discord.js https://discord.com/channels/GUILD_ID

# Un salon précis (texte, vocal, forum…)
node export_discord.js https://discord.com/channels/GUILD_ID/CHANNEL_ID

# Un DM ou groupe DM précis
node export_discord.js https://discord.com/channels/@me/CHANNEL_ID
```

> **Obtenir une URL** : clic droit sur un salon dans Discord → **Copier le lien**.

---

## Ce qui est exporté

| Type de salon       | Résultat                                             |
|---------------------|------------------------------------------------------|
| Texte / Annonces    | `<nom>_<id>.txt`                                     |
| Vocal / Stage       | `<nom>_<id>.txt` (messages texte du salon vocal)     |
| Forum / Media       | Dossier `<nom>_<id>/` + **1 fichier `.txt` par post** (actifs + archivés) |
| DM 1:1              | `<nom>_<id>.txt`                                     |
| Groupe DM           | `<nom>_<id>.txt`                                     |

---

## Structure de sortie

Les fichiers et dossiers sont nommés `<nom>_<id>` pour éviter toute ambiguïté.

```
discord_export/
├── MonServeur_123456789/
│   ├── Général_111111/               ← catégorie
│   │   ├── general_222222.txt        ← salon texte
│   │   ├── annonces_333333.txt
│   │   └── vocal-général_444444.txt  ← salon vocal (messages texte)
│   ├── Forum-Aide_555555/            ← catégorie
│   │   └── aide_666666/              ← forum = dossier
│   │       ├── mon-post_777777.txt   ← 1 fichier par post
│   │       └── autre-sujet_888888.txt
│   └── sans-categorie_999999.txt     ← salon sans catégorie
└── DMs/
    ├── pseudo_111222333.txt          ← DM 1:1
    └── mon-groupe_444555666.txt      ← groupe DM
```

### Format d'un message exporté

```
[2026-03-15 14:32:10] Prénom (@pseudo): Bonjour tout le monde !
[2026-03-15 14:33:05] Autre (@autre): Salut !  ↩ (répond à @pseudo: Bonjour tout le ...)
  [Fichier] image.png → https://cdn.discordapp.com/...
  [Embed] Titre de l'embed | Description courte
```

---

## Sécurité

- **Ne partage jamais ton user token** — il donne accès complet à ton compte Discord
- Utilise la variable d'environnement `DISCORD_TOKEN` plutôt que de coller le token dans le code
- Ajoute une entrée à ton `.gitignore` si tu utilises Git pour ne pas commiter le token
