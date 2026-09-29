# Fantasy FRC

Predict FRC match winners and scores, pick the playoff bracket, and track a
shared leaderboard with your team. Guest mode works with no setup; Google
sign-in unlocks synced predictions, teams, and admin tools.

## Quick start (WebManager or any Docker host)

The repo has a `Dockerfile` and `webmanager.json`, so deploying is: add the repo
as an app, open its **Variables** page, and fill in three things.

1. **Google sign-in** (`GOOGLE_CLIENT_ID`) - in
   [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create
   an *OAuth client ID* of type **Web application**. Under **Authorized JavaScript
   origins** add your site's address exactly as people type it (for example
   `https://fantasy.example.com`, no trailing slash). Copy the **Client ID** into
   `GOOGLE_CLIENT_ID`. You do **not** need the client secret.
2. **You as admin** (`GLOBAL_ADMIN_EMAILS`) - the email of the Google account you'll
   sign in with. That account gets an **Admin** tab.
3. **Live data** (`TBA_API_KEY`) - a free key from
   [thebluealliance.com/account](https://www.thebluealliance.com/account).

Open the site, sign in, and check **Admin > Setup checklist**: it shows what's
missing and the exact address to authorise in Google's console. People stay signed
in for 30 days; signing out revokes their session.

To run it by hand: `docker build -t fantasyfrc . && docker run -p 8080:8080 -e PORT=8080 -e DATA_DIR=/data -v fantasyfrc-data:/data fantasyfrc`.

## About this project

This is a from-scratch rewrite of the original app, aimed at being simple to
deploy and cheap to maintain in a homelab:

- **Native SQLite** (`better-sqlite3`) instead of a WASM SQLite build - fewer
  moving parts, faster, no `sql.js`.
- **Modular server** (`server/`) - config, db, auth, security, TBA proxy, and
  the state authorization model are each in their own file instead of one
  1,100-line `server.js`.
- **ES module frontend** (`public/js/`) split into `store.js` (state + sync),
  `scoring.js` (pure scoring math, unit-testable), and one file per tab
  (`views/matches.js`, `views/bracket.js`, etc.) instead of one 6,000-line
  `app.js`.
- **One install script** for a Proxmox LXC (or any Debian/Ubuntu box).

## Scoring rules

**Match predictions**
- `+1` for the correct winning alliance
- `+1` if your winner-score guess is within 5 points, `+0.5` if within 25
- Streak bonus: once you get 3 alliance picks in a row correct, each
  additional correct pick in the streak is worth `+0.5` extra

**Playoff bracket** - each correctly picked game is worth points by round:

| Games | Points |
|---|---|
| u1-u4 | 1 |
| l1, l2, u5, u6 | 2 |
| l3, l4 | 3 |
| u7, l5, l6 | 4 |
| f1 | 6 |
| f2 | 7 |
| f3 | 8 |

Predictions and bracket picks lock 10 minutes before the match starts.

## Deploying to a Proxmox LXC

1. Create a Debian 12 or Ubuntu 22.04+ LXC (unprivileged is fine), 1 vCPU /
   512MB RAM is plenty.
2. Inside the container:
   ```bash
   apt-get update && apt-get install -y git
   git clone <your-repo-url> fantasyfrc
   cd fantasyfrc
   sudo ./deploy/install.sh
   ```
3. Edit the config it created:
   ```bash
   nano /opt/fantasyfrc/.env
   ```
   Set at minimum:
   - `TBA_API_KEY` - get one free at https://www.thebluealliance.com/account
   - `GOOGLE_CLIENT_ID` - a Google OAuth web client ID (leave blank to run
     guest-only, no sign-in)
   - `GLOBAL_ADMIN_EMAILS` - your email, comma-separated for more than one
4. Start it:
   ```bash
   systemctl start fantasyfrc
   systemctl status fantasyfrc
   ```
5. Visit `http://<container-ip>:3000`.

Optional: put nginx + a real domain + HTTPS in front using
`deploy/nginx.conf.example`, then set `REQUIRE_HTTPS=true` in `.env`.

### Updating later

```bash
cd fantasyfrc
sudo ./deploy/update.sh
```

Pulls latest git, reinstalls dependencies, restarts the service. Your data
(`/opt/fantasyfrc/data/fantasyfrc.db`) and `.env` are left untouched.

### Backing up

Just copy the database file:
```bash
cp /opt/fantasyfrc/data/fantasyfrc.db ~/fantasyfrc-backup-$(date +%F).db
```

### Logs / troubleshooting

```bash
journalctl -u fantasyfrc -f          # live logs
systemctl restart fantasyfrc         # restart
curl http://127.0.0.1:3000/api/runtime-config   # sanity check, no auth needed
```

If the app won't start, check `journalctl -u fantasyfrc -n 50` - the most
common issues are a missing `.env` file or `/opt/fantasyfrc/data` not being
owned by the `fantasyfrc` user (`chown -R fantasyfrc:fantasyfrc /opt/fantasyfrc`).

## Local development

```bash
npm install
cp .env.example .env   # fill in TBA_API_KEY / GOOGLE_CLIENT_ID
npm run dev
npm test               # server tests; no network or credentials needed
```

Serves on `http://127.0.0.1:3000`.

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) - how it's put together: request
  flow, the shared-state data model, the authorization model, and known
  limitations.
- [`docs/API.md`](./docs/API.md) - full REST API reference.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) - local setup and what to check before a PR.

## Architecture

```
server/
  index.js       - app entrypoint, wires everything together
  config.js      - all env vars in one place
  db.js          - SQLite open/read/write, corrupt-DB recovery
  auth.js        - Google ID token verification + requireAuth (cookie or bearer)
  sessions.js    - 30-day sign-in sessions (hashed ids, HttpOnly cookie)
  security.js    - rate limits, CSP headers, same-origin check
  tba.js         - The Blue Alliance proxy (keeps API key server-side)
  routes.js      - all /api/* routes
  state/
    schema.js    - shared-state shape, defaults, validation
    authorize.js - who can write which part of shared state
    locks.js     - server-side prediction locking against live TBA data
    redact.js    - what non-admins (and non-members) must not see

test/            - node:test suites; run with `npm test` (no network needed)

public/
  index.html, style.css
  js/
    main.js      - boot sequence, wires up views
    store.js     - client state: guest (localStorage) vs signed-in (synced)
    api.js       - thin fetch wrapper
    runtime.js   - server config + the event on screen
    scoring.js   - pure scoring, bracket mapping and ranking
    constants.js
    ui.js        - DOM helpers, dialogs, toasts
    views/       - matches, bracket, cards, score, leaderboard, profile, admin, guest, auth, help
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TBA_API_KEY` | For live data | - | The Blue Alliance API key |
| `GOOGLE_CLIENT_ID` | For sign-in | - | Google OAuth web client ID |
| `GLOBAL_ADMIN_EMAILS` | No | - | Comma-separated emails bootstrapped as global admin |
| `GLOBAL_ADMIN_IDS` | No | - | Advanced: Google `sub` IDs bootstrapped as global admin (most people just use `GLOBAL_ADMIN_EMAILS`) |
| `HOST` | No | `0.0.0.0` | Bind host |
| `PORT` | No | `3000` | Bind port |
| `FF_DATA_DIR` | No | `./data` | Directory holding `fantasyfrc.db` (self-hosted deploys) |
| `DATA_DIR` | No | - | Same as `FF_DATA_DIR`, takes priority if both are set (used by Docker/WebManager deploys) |
| `REQUIRE_HTTPS` | No | `false` | Reject non-HTTPS requests (except loopback) |
| `TRUST_PROXY` | No | `false` | Only set `true` if a reverse proxy sits in front and sets `X-Forwarded-*` itself - otherwise those headers are client-controlled and this must stay `false` |
| `SESSION_TTL_DAYS` | No | `30` | How long a sign-in lasts (renewed while in use) |
| `PUBLIC_URL` | No | - | The site's public address; also accepted as a same-origin host (set by WebManager) |
| `LOCAL_API_ONLY` | No | `false` | Block non-loopback API access. Leave off behind a reverse proxy or in Docker - every request arrives from the proxy, so it would reject them all |
