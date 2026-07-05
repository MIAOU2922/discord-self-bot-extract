# Discord Export

Exports complete conversations (sent **and** received messages) from your Discord servers and DMs to text files, preserving server organization (categories, forums, posts).

Uses [discord.js-selfbot-v13](https://github.com/aiko-chan-ai/discord.js-selfbot-v13) with your **user token**.

> **Warning**: Using a self-bot violates Discord's Terms of Service. Use only for personal purposes, at your own risk.

---

## Prerequisites

- [Node.js](https://nodejs.org/) v16.9 or higher
- Your Discord user token

---

## Getting your user token

1. Open **Discord in your browser** (discord.com/app)
2. Press **F12** → **Console** tab
3. Paste this code and press Enter:

```js
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
```

4. Copy the displayed value (starts with `MT...` or similar)

---

## Installation

```cmd
npm install
```

---

## Configuration

The script is **interactive**: it will ask you for the required information at launch.

You can also pre-fill these values:

```cmd
# Token (optional — will be prompted if missing)
set DISCORD_TOKEN=your_token_here        (CMD)
$env:DISCORD_TOKEN="your_token_here"     (PowerShell)
```

Configurable options at the top of `export_discord.js`:

| Variable          | Default            | Description                                 |
|-------------------|--------------------|---------------------------------------------|
| `OUTPUT_DIR`      | `"discord_export"` | Output directory                            |
| `MESSAGE_LIMIT`   | `null`             | Max messages per channel (`null` = all)     |
| `IGNORE_CHANNELS` | `[]`               | Channel names to skip                       |

---

## Usage

Simply run the command and answer the prompts:

```cmd
npm run export
```

The script will ask you, in order:
1. **Your Discord token** (skipped if `DISCORD_TOKEN` is set in the environment)
2. **The Discord URL** to export (leave empty = export everything)
3. **Download media** (Y/n)

You can also pass the URL directly to skip step 2:

```cmd
npm run export -- https://discord.com/channels/GUILD_ID/CHANNEL_ID
```

> **Getting a URL**: right-click a channel in Discord → **Copy Link**.

---

## What is exported

| Channel type        | Result                                                                 |
|---------------------|------------------------------------------------------------------------|
| Text / Announcement | `<name>_<id>.txt` + `<name>_<id>_files/` folder                        |
| Voice / Stage       | `<name>_<id>.txt` (voice channel text messages) + `_files/` folder     |
| Forum / Media       | `<name>_<id>/` folder + **1 `.txt` file per post** (active + archived) + `_files/` folder per post |
| DM (1:1)            | `<name>_<id>/` folder with `<name>_<id>.txt` + `_files/`                    |
| Group DM            | `<name>_<id>/` folder with `<name>_<id>.txt` + `_files/`                    |

> 📁 Each `_files/` folder contains the **downloaded media** (images, videos, GIFs, stickers, external links).

---

## Output structure

Files and folders are named `<name>_<id>` to avoid any ambiguity.
Each channel also produces an adjacent `_files/` folder containing all downloaded media.

```
discord_export/
├── MyServer_123456789/
│   ├── General_111111/               ← category
│   │   ├── general_222222.txt        ← text channel
│   │   ├── general_222222_files/     ← 📁 images, videos, GIFs, stickers
│   │   │   ├── 1234567890_kitten.png
│   │   │   ├── 1234567891_sticker_funny.png
│   │   │   └── 1234567892_link_tenor.gif
│   │   ├── announcements_333333.txt
│   │   ├── announcements_333333_files/
│   │   └── voice-general_444444.txt  ← voice channel (text messages)
│   ├── Forum-Help_555555/            ← category
│   │   └── help_666666/              ← forum = folder
│   │       ├── my-post_777777.txt    ← 1 file per post
│   │       ├── my-post_777777_files/
│   │       ├── another-topic_888888.txt
│   │       └── another-topic_888888_files/
│   └── no-category_999999.txt        ← channel without category
│       └── no-category_999999_files/
└── DMs/
    ├── username_111222333/           ← DM 1:1 folder
    │   ├── dm_111222333.txt
    │   └── dm_111222333_files/
    └── my-group_444555666/           ← group DM folder
        ├── dm_444555666.txt
        └── dm_444555666_files/
```

### Downloaded media

The script automatically detects and downloads:
- **Attachments** from Discord (images, videos, files)
- **Embeds** (images, thumbnails, embedded videos)
- **Stickers**
- **External links** to images/videos/GIFs (Imgur, Tenor, Giphy, Gyazo, etc.)

Duplicates are detected (same URL = no re-download).
Already-downloaded files on disk are skipped (resume on error).

### Exported message format

```
[2026-03-15 14:32:10] DisplayName (@username): Hello everyone!
[2026-03-15 14:33:05] Other (@other): Hey!  ↩ (replying to @username: Hello everyon...)
  [File] image.png → https://cdn.discordapp.com/...
  [Embed] Embed Title | Short description
```

---

## Security

- **Never share your user token** — it grants full access to your Discord account
- Use the `DISCORD_TOKEN` environment variable instead of pasting the token in the code
- Add an entry to your `.gitignore` if using Git to avoid committing the token
