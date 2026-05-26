# LSPD Dienstblatt Template

Node.js/Express Dienstblatt als leeres Showcase-Template mit statischem Frontend und JSON-Speicher.

## Render Deployment

Build Command:

```bash
npm ci --omit=dev
```

Start Command:

```bash
npm start
```

Environment Variables:

```text
NODE_ENV=production
DATA_DIR=/opt/render/project/src/storage
DISCORD_APPLICATION_ID=
DISCORD_CLIENT_SECRET=
DISCORD_PUBLIC_KEY=
DISCORD_BOT_TOKEN=
DISCORD_SERVER_ID=
PUBLIC_BASE_URL=
DISCORD_OAUTH_REDIRECT_URL=
DISCORD_SYNC_CHANNEL_ID=
DISCORD_IT_CHANNEL_ID=
DISCORD_UNSYNCED_ROLE_ID=
DISCORD_INVITE_URL=
TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
```

Persistent Disk:

```text
Mount Path: /opt/render/project/src/storage
Size: 1 GB
```

Die Datei `storage/dienstblatt.json` enthaelt im Template nur den IT-Admin-Account und leere Listen. Fuer Render sollte ein Persistent Disk verwendet werden, damit spaetere Daten dauerhaft gespeichert bleiben.

## Discord Sync

Discord-, Twitch- und Public-URL-Werte koennen im IT-Reiter gepflegt werden. Lokal koennen sensible Werte alternativ in `.env` liegen; diese Datei wird nicht committed. Eine Vorlage liegt in `.env.example`.
