# home-dashboard

One page that tells you whether the homelab is fine, plus a family touchscreen page.
It runs on any Linux host with Docker (currently `tiny`) and is reached over Tailscale only.
It used to be called `raspi-server`, when it ran on the Pi.

- **Overview** (`/`, admin login). This page is fixed. From top to bottom:
  - What's wrong.
  - Servers.
  - Network and storage.
  - System health (SMART, filesystems, backups, OS updates).
  - Repos (anything not pushed to GitHub).
  - Syncthing folders.
  - The apps and tools, with 24 hours of Gatus checks.
  - Home: humidors and betbot.
  - Today and this week.

  A sidebar lists the **apps** (what the homelab serves people) and the **tools** (what you run it with), each with a status dot. Each one has its own page with details from its API.
- **Kiosk** (`/kiosk`, kiosk login). The family screen has four tabs:
  - **Today:** Google Calendar, Google Tasks (tick them off), bins night, who's home and tonight's dinner.
  - **House:** Home Assistant scenes, lights and climate.
  - **Watch:** Jellyfin "keep watching" and Seerr requests.
  - **System:** a plain-language status.

  The kiosk shows no IPs, hosts, containers or betbot. It goes back to Today after 3 minutes untouched.

## Design rules

- **Read-only.** All source calls go through `server/lib/http.js`, which has `get()` only. There are two exceptions:
  - `login()` is a POST that only fetches a session or token (qBittorrent, the Google token refresh).
  - `write()` is refused unless the exact method and URL were put on the allow-list at startup.

  The allow-list holds only the kiosk actions: Home Assistant `scene.turn_on`, `light.toggle` and `climate.set_temperature`/`turn_off`/`turn_on` for the entities listed in `dashboard.yaml`, and marking a task done in the listed Google Tasks lists. `npm test` checks that no other file calls `fetch()` or asks for a write.
- **Keys never reach the browser.** The server reads each source and sends the page a snapshot. Jellyfin posters are proxied for the same reason.
- **No database.** Sources are read when a page asks and cached for about 30 seconds.
- **Config in YAML.** `dashboard.yaml` says which sources fill the page, not where things go. `${VAR}` values come from `.env`, so the YAML holds no secrets.
- **No checks or alerts of its own.** [Gatus](https://github.com/TwiN/gatus) probes the services, keeps the history and sends Telegram alerts. The dashboard reads its results, so the page and the alerts always agree. Host health (SMART and so on) comes from the host agent.

## Set up on a host

```bash
git clone https://github.com/albyp/home-dashboard.git ~/LocalGit/home-dashboard
cd ~/LocalGit/home-dashboard
cp dashboard.example.yaml dashboard.yaml     # then edit: hosts, apps, tools, kiosk
cp .env.example .env && chmod 600 .env       # then fill in keys
sudo ./host-agent/install.sh                 # SMART, disks, updates → /var/lib/home-dashboard/health.json
docker compose up -d --build
./set-password.sh                            # admin password
./set-password.sh kiosk                      # kiosk password
sudo tailscale serve --bg --https=443 http://127.0.0.1:3001
```

Old `http://<host>:3001/...` links: `sudo tailscale serve --bg --http=3001 http://127.0.0.1:3002` sends them to a redirect listener that returns a 301 to `PUBLIC_URL`.

### Other hosts

- **Host agent:** install it on every host (`sudo ./host-agent/install.sh`). For a host other than the one running the dashboard, publish its file to the tailnet and point `agent:` in `dashboard.yaml` at that URL:
  ```bash
  sudo tailscale serve --bg --https=8443 /var/lib/home-dashboard/health.json
  ```
- **Docker:** run a read-only socket proxy on that host and set `docker:` for it. Only expose the proxy on the tailnet. Add a tailnet grant so that only the dashboard host can reach it.
- **Machines that are often off** (rocky): set `sleeps: true`. While it is offline, its tile says so, its services show as off (grey), and Syncthing folders shared with it read "up to date · rocky asleep". None of it is raised as a problem.

### Gatus

`gatus/config.example.yaml` is a starting point. Endpoint names must match the apps' and tools' `check:` (or `name:`) in `dashboard.yaml`. Keep about 300 results per endpoint at a 5-minute interval, so the 24-hour bars fill.

### Claude usage (optional)

The admin overview can show Claude subscription usage (5-hour and weekly limits) with a "Get busy" nudge when a window is about to reset mostly unused. The numbers come from the endpoint behind Claude Code's `/usage`, which is **not a published API**.

1. On the host, log in to Claude Code with your subscription: `claude`, then `/login`.
2. Install the timer. It renews the Claude Code login when it is close to expiry and writes only the usage numbers to `~/.local/state/claude-usage/usage.json`:
   ```bash
   mkdir -p ~/.local/state/claude-usage
   sudo cp host-agent/claude-usage.service host-agent/claude-usage.timer /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now claude-usage.timer
   ```
3. `sources.claude.file` in `dashboard.yaml` points at the mounted file. The dashboard never holds the Claude login.

### Vault today (optional)

`sources.vault` shows notes new or changed today in an Obsidian vault mounted read-only (`VAULT_DIR`). A note is new when its frontmatter `date:` is today.

### Google (kiosk calendar and tasks)

1. In Google Cloud, create a project. Enable the Calendar API and the Tasks API. Create an OAuth client of type **Desktop app**.
2. On a machine with a browser, run:
   ```bash
   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node server/scripts/google-auth.js
   ```
   Sign in with the family account. The script prints `GOOGLE_REFRESH_TOKEN` and the IDs of your calendars and task lists.
3. Put those values in `.env`. The scopes are `calendar.readonly` and `tasks`.

### The kiosk device

- Join the touchscreen to the tailnet with a `tag:kiosk` auth key. Add a grant that allows it only `tcp:443` on the dashboard host.
- Log in once with the kiosk password. The session lasts a year.
- A kiosk session can open only `/kiosk` and `/api/kiosk*`.

## Development

```bash
cd client && npm install && npm run build
cd ../server && npm install
npm test
npm run demo        # http://127.0.0.1:3001, example data; log in with "admin" or "kiosk"
```

For live reload, run `npm run demo` in `server/` and `npm run dev` in `client/` (Vite on :5173 proxies the API). Demo mode never runs when `NODE_ENV=production`, which the Docker image sets.

## Layout

```
server/
  index.js, auth.js        Express app, admin/kiosk logins
  config.js                dashboard.yaml loader (${VAR} from .env)
  lib/http.js              the only HTTP client: get / login / allow-listed write
  sources/                 one file per source (gatus, agent, docker, syncthing, repos, google, …)
  snapshot/                builds the overview, service and kiosk snapshots; kiosk actions
  demo.js                  example data for DEMO=1
client/src/
  admin/                   overview, service page
  kiosk/                   family screen
host-agent/                health-check.sh + systemd timer
gatus/                     example Gatus config
```
