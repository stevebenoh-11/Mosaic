# Connect Mosaic to Google Drive (~5 minutes)

Mosaic syncs through **your own Google Drive** using the least-privilege
`drive.file` scope — the app can only see files it created, inside a visible
`Mosaic` folder. To enable this you create a (free) OAuth client ID once.

## 1. Create a Google Cloud project

1. Open <https://console.cloud.google.com/projectcreate>.
2. Name it anything (e.g. `mosaic-sync`) → **Create**, and make sure it's the
   selected project in the top bar.

## 2. Enable the Google Drive API

1. Go to <https://console.cloud.google.com/apis/library/drive.googleapis.com>.
2. Click **Enable**.

## 3. Configure the OAuth consent screen

1. Go to <https://console.cloud.google.com/auth/branding> (APIs & Services →
   OAuth consent screen).
2. Choose **External**, click **Create**.
3. Fill the three required fields: app name (`Mosaic`), your email as user
   support email, your email as developer contact. **Save and continue**
   through the remaining steps — no scopes need to be added here.
4. While the app is in **Testing** mode, add yourself (and any other Google
   accounts you'll sync with) under **Audience → Test users**.

> Staying in Testing mode is fine for personal use. Because Mosaic only uses
> the non-restricted `drive.file` scope, publishing the app later has minimal
> verification requirements.

## 4. Create an OAuth Client ID

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. **Create credentials → OAuth client ID**.
3. Application type: **Web application**.
4. Under **Authorized JavaScript origins** add:
   - `http://localhost:5173` (development)
   - your production URL, if you deploy Mosaic (e.g. `https://mosaic.example.com`)
   No redirect URIs are needed (Mosaic uses the token flow).
5. **Create**, then copy the client ID — it looks like
   `123456789-abcdefg.apps.googleusercontent.com`.

## 5. Give the client ID to Mosaic

Create a file named `.env` next to `package.json`:

```
VITE_GOOGLE_CLIENT_ID=123456789-abcdefg.apps.googleusercontent.com
```

Restart `npm run dev` (or rebuild). The account menu (top right) now offers
**Connect Google Drive** — click it on every device you want to keep in sync.

## Notes

- Tokens are kept in memory only and renewed silently about once an hour. If
  renewal fails you'll see **Sync paused — Reconnect**; your edits keep
  queueing locally and flush after you reconnect.
- **Disconnect** (account menu) revokes the token and forgets the account on
  that device. All local boards stay, and the `Mosaic` folder stays in Drive.
- If the sign-in popup is blocked inside the installed app (especially iOS
  home-screen apps), open Mosaic in the browser, connect there once, then
  return to the app.
