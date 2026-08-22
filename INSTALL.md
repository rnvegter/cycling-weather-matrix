# Installing on a standalone web server

## What actually has to run

The app is two things, and knowing which you need decides everything else:

| Part | What it is | Needs |
|---|---|---|
| The app | `index.html`, `styles.css`, and five `.js` files | Any static web server |
| The lookup service | `/api/lookup` in `server.js` — reads manufacturer pages for gear data | A Node process, and outbound internet |

The forecast comes straight from the browser to [Open-Meteo](https://open-meteo.com/), so
that needs nothing from your server. **There is no database and no build step.** Nothing is
compiled, bundled or transpiled; the files you clone are the files that get served.

If you skip the Node part, everything works except that the gear lookup falls back to its
built-in inference engine and says so on screen. That is a real option — see
[Static only](#option-c--static-only-no-nodejs) — but you lose the "read it off the maker's
page" behaviour.

## Requirements

- **Node.js 18 or newer** for the lookup service. It uses the built-in `fetch`, which
  doesn't exist before 18. Node 22 LTS is a good default. Check with `node --version`.
- **No npm install.** There are zero dependencies, so there is no `node_modules`, no
  lockfile to audit and nothing to keep patched but Node itself.
- About 300 KB of disk, and very little memory — one process, no workers.
- **Fonts load from Google Fonts.** They fall back to Arial Narrow, the system sans and the
  system monospace, so a blocked or offline request costs you the typeface and nothing else.
  To remove the dependency entirely, download Barlow Condensed, IBM Plex Sans and IBM Plex
  Mono into the app directory, drop the two `<link>` tags from `index.html`, and add
  `@font-face` rules at the top of `styles.css`. Worth doing if the server has no egress, or
  if you'd rather not have every page load reach a third party.

- **Map tiles come from OpenStreetMap** at `tile.openstreetmap.org`, keyless but subject to
  their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/). A ride view
  loads four to nine tiles, which is well within reasonable personal use; if you put this in
  front of many people, switch `TILE_URL` in `map.js` to your own tile source or a commercial
  one. The map degrades to the drawn overlay alone if tiles can't be reached.

## Which server to use

**Use [Caddy](https://caddyserver.com/) unless you already run something else.** It gets and
renews TLS certificates on its own, so there is no certbot, no cron renewal and no expiry
outage at 3am. The whole config is about ten lines, and one of them is your domain.

| | When it's the right pick |
|---|---|
| **Caddy** | Default recommendation. Automatic HTTPS, tiny config, one binary. |
| **nginx** | You already run nginx, or you need its finer-grained rate limiting and caching. Add certbot for TLS. |
| **Docker + Caddy** | You want the app isolated, or you deploy several things to the same box. |
| **Apache** | Only if it's already there. `mod_proxy` will do it, but neither of the above needs as much configuring. |
| **Fly.io / Render / Railway** | You'd rather not run a server at all. A Node app with no dependencies deploys to these almost unchanged. |

Configuration files for the first two are in [`deploy/`](deploy/), along with a systemd unit.

---

## Option A — Caddy and systemd (recommended)

On a fresh Debian or Ubuntu box.

**1. Install Node and Caddy**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs caddy
```

**2. Get the code**

```bash
sudo git clone https://github.com/rnvegter/cycling-weather-matrix.git /opt/cycling-weather-matrix
```

The repository is private, so the clone will ask you to authenticate. On a headless server a
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
is the tidy way — it grants access to this one repository rather than your whole account.

**3. Give it its own user**

Never run a network service as root or as yourself.

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin cwem
sudo chown -R cwem:cwem /opt/cycling-weather-matrix
```

**4. Run it as a service**

```bash
sudo cp /opt/cycling-weather-matrix/deploy/cycling-weather-matrix.service \
        /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cycling-weather-matrix
systemctl status cycling-weather-matrix
```

The unit sets `HOST=127.0.0.1`, so the Node process listens on the loopback only and cannot
be reached from outside except through Caddy. It also restarts on failure and on reboot.

**5. Put Caddy in front**

Edit `deploy/Caddyfile`, replace `kit.example.com` with your domain, then:

```bash
sudo cp /opt/cycling-weather-matrix/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Point the domain's A record at the server **before** reloading, or the certificate request
fails and Caddy will back off before retrying.

**6. Check it**

```bash
curl -sI https://kit.example.com | head -1
curl -s "https://kit.example.com/api/lookup?name=Castelli%20Perfetto%20RoS&slot=shell" | head -c 300
```

The second should come back with `"source":"web"` and a quoted temperature range. If it says
`inference (search unavailable)`, the server has no outbound internet — see
[Troubleshooting](#troubleshooting).

## Option B — Docker

```bash
git clone https://github.com/rnvegter/cycling-weather-matrix.git
cd cycling-weather-matrix
docker build -t cycling-weather-matrix .
docker run -d --name cwem --restart unless-stopped \
  -p 127.0.0.1:8765:8765 cycling-weather-matrix
```

Binding to `127.0.0.1:8765` rather than `8765` keeps the container off the public interface;
put Caddy or nginx in front as above. Then point the proxy at `127.0.0.1:8765`.

Updating is a rebuild — see [Updating](#updating) below.

## Option C — Static only, no Node.js

If you don't want a Node process, serve the directory with anything. The app runs; only the
web lookup is unavailable, and the gear screen falls back to the built-in inference engine
and labels every result accordingly.

```bash
sudo mkdir -p /var/www/cycling-weather-matrix
sudo cp -r index.html styles.css *.js /var/www/cycling-weather-matrix/
```

Then a Caddyfile of:

```
kit.example.com {
	root * /var/www/cycling-weather-matrix
	file_server
	encode zstd gzip
}
```

Do **not** copy `server.js` into a static web root — there is no interpreter behind it, so it
would be served as readable text rather than executed. Harmless here, since the file is public
on GitHub anyway, but it's a bad habit.

## Serving it under a sub-path

Both the lookup endpoint and the client resolve relative to the current path, so mounting the
app at `https://example.com/kit/` works without changes. Proxy `/kit/` to the Node process and
strip the prefix — in Caddy:

```
handle_path /kit/* {
	reverse_proxy 127.0.0.1:8765
}
```

---

## Updating

### Your gear list is not on the server

Worth knowing before anything else: the inventory lives in your browser's `localStorage`, not
on the server. **Updating the app cannot touch it.** Whatever you have edited, switched Out,
or added stays exactly as it was.

Two caveats to that:

- **Reset to defaults reads the new seed.** The button pulls from `gear.js`, which the update
  replaces. Press it after an update and you get the new starting list, not the one you had
  before — which is usually what you want, but it is not an undo.
- **`localStorage` is per browser and per origin.** Moving the app to a different domain, or
  opening it in a different browser, is a fresh empty-handed start.

So before a big update, press **Export** on the gear screen and keep `cycling-gear.json`
somewhere. It takes a second and Import restores it anywhere, including into a different
browser or a rebuilt server.

### See what you are about to get

```bash
cd /opt/cycling-weather-matrix
git fetch
git log --oneline HEAD..origin/main
```

Nothing is applied yet. If that list is empty you are already current. To see which commit is
running right now:

```bash
git -C /opt/cycling-weather-matrix log -1 --oneline
```

### Option A — Caddy and systemd

```bash
cd /opt/cycling-weather-matrix
sudo git pull
sudo systemctl restart cycling-weather-matrix
systemctl status cycling-weather-matrix --no-pager
```

There is nothing to build and nothing to install: no dependencies, no bundler, no migrations.

The restart matters for exactly two files. `server.js` is the running process, and
`insulation.js` is loaded into it at startup for the gear lookup — changes to either need one.
Everything else is read from disk per request, so new HTML, CSS and the browser-side JavaScript
are live the moment they land. Restarting regardless is the simpler habit than remembering
which is which.

Reload Caddy only if you changed the Caddyfile:

```bash
sudo systemctl reload caddy
```

### Option B — Docker

```bash
cd cycling-weather-matrix
git pull
docker build -t cycling-weather-matrix .
docker restart cwem
```

If you want a way back, tag the image you are replacing before you build over it:

```bash
docker tag cycling-weather-matrix cycling-weather-matrix:previous
```

### Option C — Static only

```bash
cd cycling-weather-matrix
git pull
sudo cp index.html styles.css *.js /var/www/cycling-weather-matrix/
```

`cp` will not remove a file that the update deleted, so if a `.js` file is ever dropped from
the project you would be left serving an orphan. `rsync --delete` avoids that — but list what
goes in rather than what stays out:

```bash
sudo rsync -a --delete \
  --exclude server.js \
  --include '*.js' --include index.html --include styles.css --exclude '*' \
  ./ /var/www/cycling-weather-matrix/
```

The `--exclude '*'` at the end is the important part. A deny-list of the things you happen to
think of will sooner or later copy `.git` into your web root, which publishes the entire
repository — every commit, every earlier version of every file — to anyone who asks for
`/.git/config`. Denying everything and naming the ten files the browser actually needs cannot
make that mistake. `server.js` is excluded ahead of the `*.js` include because there is no
interpreter behind it here; `insulation.js` is not, because the browser runs it as the offline
fallback for the gear lookup.

### If you edited the files in place

`git pull` will stop rather than overwrite your changes. Two things in this project invite
local edits, and they are worth handling differently:

- **Runtime settings — port, host, rate limit — are environment variables**, not file edits.
  Set them in the systemd unit or the `docker run` line and updates never touch them.
- **`TILE_URL` in `map.js`**, if you pointed the map at your own tile source, is a real code
  edit and will conflict. So is editing `deploy/Caddyfile` in place rather than editing the
  copy at `/etc/caddy/Caddyfile`.

To get the update and keep your edit:

```bash
git stash          # put your changes aside
git pull
git stash pop      # replay them on top
```

If `stash pop` reports a conflict, the update changed the same lines you did. Open the file,
keep the version you want, then `git add` it. To throw your edit away and take the new file
wholesale, `git checkout -- map.js` before pulling.

### Rolling back

Every version is a commit, so going back is checking one out:

```bash
cd /opt/cycling-weather-matrix
git log --oneline -10                  # find the one that worked
sudo git checkout <commit>
sudo systemctl restart cycling-weather-matrix
```

That leaves you on a detached HEAD, which is fine for running but not for pulling. When you
want to move forward again:

```bash
sudo git checkout main && sudo git pull
```

### After updating

```bash
curl -sI https://kit.example.com | head -1
curl -s "https://kit.example.com/api/lookup?name=Castelli%20Perfetto%20RoS&slot=shell" | head -c 200
```

Then open the app and run one ride. If the page loads but behaves oddly, the usual cause is a
browser holding old JavaScript against new HTML — hard-reload once (Cmd/Ctrl + Shift + R). The
supplied proxy configs send `Cache-Control: no-cache` on everything precisely so this does not
happen; if you wrote your own and cached scripts aggressively, that is where to look.

---

## Before you expose it publicly

**The lookup endpoint fetches pages on behalf of whoever calls it.** It doesn't take a URL —
it takes a garment name, searches, and follows its own results — so it isn't a general-purpose
proxy. But anyone who can reach it can make your server issue outbound requests, which is
worth bounding on a public host.

- The Node process limits each client to 12 lookups a minute. Change it with `LOOKUP_RATE`.
- `deploy/nginx.conf` adds a second limit at the proxy, so abusive traffic never reaches Node.
- If the server is only for you, the simplest answer is not to expose it at all: leave it on
  the loopback and reach it over Tailscale, a VPN, or an SSH tunnel:

  ```bash
  ssh -L 8765:127.0.0.1:8765 you@your-server
  ```

  Then open `http://localhost:8765`. No TLS to manage, nothing public, no rate limiting to
  think about.
- If you want it public but private to you, put HTTP basic auth in front. In Caddy:

  ```
  basic_auth {
  	you $2a$14$...        # caddy hash-password
  }
  ```

**Gear edits are stored per browser.** They live in `localStorage`, so they don't sync between
your phone and your laptop, and clearing site data wipes them. Use Export on the gear screen
to keep a copy of `cycling-gear.json`; Import restores it anywhere. Putting the app on a
server does not make the gear list shared — there is no server-side storage.

## Troubleshooting

**`inference (search unavailable)` on every lookup.** The server can't reach the internet
outbound, or the search endpoint is blocking it. Test directly:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://lite.duckduckgo.com/lite/?q=test
```

A cloud host that blocks egress, or an IP range the search endpoint rate-limits, will both do
this. The app stays usable — results come from the inference engine and are labelled as such.

**Lookups time out through the proxy.** Fetching several upstream pages can take 20–30
seconds. nginx's default `proxy_read_timeout` of 60s is usually enough, but a slow upstream
will exceed it; the supplied config raises it to 90s.

**`EADDRINUSE`.** Something already holds the port. `sudo lsof -i :8765`, or start on another
port with `node server.js 9000`.

**The page loads but the forecast fails.** That request goes from the browser to Open-Meteo,
not through your server, so check the browser console rather than the server logs. A
content-security-policy on your proxy that blocks `api.open-meteo.com` is the usual cause.

**Changes to the JS don't show up.** The Node server sends `Cache-Control: no-cache`, but a
proxy in front may not. The supplied configs cache `.js` and `.css` for a week — bump the
filenames or clear the proxy cache after an update.
