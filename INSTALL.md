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
| **Nginx Proxy Manager** | You already run it, or you would rather click than edit config files. Same nginx underneath, with a web UI and Let's Encrypt built in. |
| **Cloudflare Tunnel** | You cannot or would rather not open a port: behind CGNAT, on a home connection, or on a machine you do not want reachable from the internet at all. No certificates to manage. |
| **Docker or Podman + Caddy** | You want the app isolated, or you deploy several things to the same box. Podman if you would rather not run a root daemon. |
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
```

Deliberately no `chown` of the checkout. The service only ever *reads* its own directory — the
unit mounts it read-only, and everything it writes goes to `/var/lib/cycling-weather-matrix`
via `StateDirectory=`. Leaving the code owned by root means `sudo git pull` keeps working at
update time; hand the tree to `cwem` and git refuses to touch it as root:

```
fatal: detected dubious ownership in repository at '/opt/cycling-weather-matrix'
```

That check exists because pulling into someone else's repository can execute their hooks. The
answer is not to add an exception — it is to not give a service account write access to the
code it runs.

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

## Option B — Docker or Podman

### Docker

```bash
git clone https://github.com/rnvegter/cycling-weather-matrix.git
cd cycling-weather-matrix
docker build -t cycling-weather-matrix .
docker run -d --name cwem --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v cwem-state:/state -e STATE_DIR=/state cycling-weather-matrix
```

The `cwem-state` volume is where your gear list and ride history live. It has to be outside
the container: updating means replacing the container, so anything written inside one is
thrown away with it. Without the volume the app also cannot write state at all — `/app` is
owned by root and the process runs as `node`, so every save returns a permission error.

Binding to `127.0.0.1:8765` rather than `8765` keeps the container off the public interface;
put Caddy or nginx in front as above. Then point the proxy at `127.0.0.1:8765`.

### Podman

Podman builds the same `Dockerfile` and takes the same arguments, so the commands look almost
identical. What differs is what happens afterwards, and that part is worth reading rather than
copying past.

```bash
sudo apt-get install -y podman          # or: sudo dnf install -y podman
git clone https://github.com/rnvegter/cycling-weather-matrix.git
cd cycling-weather-matrix
podman build -t cycling-weather-matrix .
podman run -d --name cwem -p 127.0.0.1:8765:8765 \
  -v cwem-state:/state -e STATE_DIR=/state cycling-weather-matrix
```

Two differences that matter:

**It runs as you, not as root.** There is no daemon and no socket owned by a privileged group,
which is most of the reason to pick Podman. Port 8765 is above 1024, so a rootless container
binds it with no extra permission — one of the reasons the default port is 8765 and not 80.

**`--restart` is not enough to survive a reboot.** With no daemon there is nothing running at
boot to start the container again. Docker's restart policy works because dockerd starts and
restores its containers; Podman needs systemd for that, and the current way to arrange it is a
Quadlet file rather than the old `podman generate systemd`, which is deprecated as of Podman 5.

### Podman that survives a reboot

Write `~/.config/containers/systemd/cwem.container`:

```ini
[Unit]
Description=Cycling Weather Effect Matrix
After=network-online.target
Wants=network-online.target

[Container]
Image=localhost/cycling-weather-matrix:latest
ContainerName=cwem
PublishPort=127.0.0.1:8765:8765
Volume=cwem-state:/state
Environment=HOST=0.0.0.0
Environment=STATE_DIR=/state
Environment=LOOKUP_RATE=12

[Service]
Restart=on-failure

[Install]
WantedBy=default.target
```

`HOST=0.0.0.0` binds inside the container, which is not the same as being public: `PublishPort`
pins it to the host's loopback, so it is still only reachable through your proxy.

Then, as your own user and **not** with `sudo`:

```bash
systemctl --user daemon-reload
systemctl --user start cwem.service
systemctl --user status cwem.service
```

Quadlet names the service after the file, so `cwem.container` becomes `cwem.service`. There is
no separate `enable` step — the `[Install]` section is handled at `daemon-reload`.

**Then enable lingering, or it will not start until you log in:**

```bash
sudo loginctl enable-linger $USER
```

Without that, a rootless user service only runs while you have a session. The container comes
up when you SSH in and disappears when you log out, which looks exactly like a container that
randomly stops. It is the most common way a rootless Podman deployment appears broken.

On Fedora, RHEL or anything else with SELinux enforcing, bind-mounted volumes need a `:Z`
suffix. This app mounts nothing, so there is nothing to relabel — but if you add a volume
later, that is the error you will hit.

Updating either of these is a rebuild — see [Updating](#updating) below.

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

## Putting it behind something other than Caddy

The app does not care what fronts it. Anything that can forward HTTP to
`127.0.0.1:8765` will do, and the only two requirements are worth stating once:

- **`/api/lookup` is slow on purpose.** It fetches two or three manufacturer pages before it
  answers, so it can take 20–30 seconds. A 10-second proxy timeout will cut it off and the
  gear screen will report the lookup service as unreachable.
- **Do not let the proxy cache `.js` and `.css`.** The app is about 300 KB and the origin
  already sends `Cache-Control: no-cache`. A proxy that caches assets by file extension will
  serve new HTML against old scripts after an update, which breaks in ways that are hard to
  attribute.

### Nginx Proxy Manager

Same nginx underneath, with a web UI and Let's Encrypt wired in. Sensible if you already run
it for other services.

Run it (this is the NPM project's own compose file, not part of this app):

```yaml
services:
  npm:
    image: jc21/nginx-proxy-manager:latest
    restart: unless-stopped
    ports: ["80:80", "443:443", "81:81"]
    volumes:
      - ./data:/data
      - ./letsencrypt:/etc/letsencrypt
```

Log in at `http://<host>:81` — the default credentials are `admin@example.com` / `changeme`,
and it forces a change on first login.

**First, make sure NPM can actually reach the app.** This is where most of the time goes. If
you followed Option A, the app is on the host's loopback and a container cannot see the host's
`127.0.0.1` — that address inside the NPM container is the container itself. Pick one:

| Where the app runs | What to forward to |
|---|---|
| Container, same network as NPM | the container name, e.g. `cwem`, port `8765` — the tidiest |
| systemd on the host | the host's Docker bridge address, usually `172.17.0.1`, port `8765` |
| systemd on the host, Podman | the host's Podman bridge, usually `10.88.0.1` |

For the bridge cases the app has to be listening on more than loopback. Change `HOST` in the
systemd unit from `127.0.0.1` to `0.0.0.0` and firewall port 8765 from the outside world,
because it is now bound on every interface.

Then **Hosts → Proxy Hosts → Add Proxy Host**:

- *Details*: your domain, scheme `http`, the forward host and port from the table above
- *Details*: **leave "Cache Assets" off**, for the reason at the top of this section. "Block
  Common Exploits" and "Websockets Support" are harmless either way — this app uses no
  websockets
- *SSL*: request a new certificate, enable **Force SSL** and HTTP/2
- *Advanced*: paste this, or the lookup will time out —

  ```
  location /api/ {
      proxy_pass http://172.17.0.1:8765;
      proxy_read_timeout 90s;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
  }
  ```

  Use the same forward address you put in *Details*. NPM's default `proxy_read_timeout` is 60
  seconds, which is usually enough but leaves nothing spare on a slow upstream.

### Cloudflare Tunnel

The most interesting alternative, because it inverts the problem: nothing listens on your
public IP at all. `cloudflared` makes an outbound connection to Cloudflare and traffic comes
back down it, so there is no port to forward, no firewall hole, and no certificate to renew.
That makes it the answer on a home connection, behind CGNAT, or on any machine you would
rather not expose.

The trade is real and worth stating: **your traffic goes through Cloudflare**, who terminate
TLS and can therefore see it. For a personal cycling app that is a fair swap for never opening
a port. For something sensitive, weigh it.

You need a domain whose nameservers point at Cloudflare. Then:

```bash
# Debian/Ubuntu
sudo apt-get install -y cloudflared        # or download from Cloudflare's releases

cloudflared tunnel login                   # opens a browser, pick your domain
cloudflared tunnel create kit
cloudflared tunnel route dns kit kit.example.com
```

`create` prints a tunnel UUID and writes a credentials JSON. Put both into
[`deploy/cloudflared-config.yml`](deploy/cloudflared-config.yml), copy it to
`/etc/cloudflared/config.yml`, and run it as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

Two things that catch people out:

- **The catch-all is mandatory.** `- service: http_status:404` has to be the last ingress rule
  or cloudflared refuses to start, and rules are matched in order, so it must come after your
  real hostname.
- **cloudflared does not reload the config on its own.** Edit the file, then restart the
  service, or you will be debugging a change that was never loaded.

With a tunnel the app should bind the loopback and stay there — there is nothing to reach it
from outside:

```
Environment=HOST=127.0.0.1
```

**The dashboard alternative.** Creating the tunnel under *Zero Trust → Networks → Tunnels*
gives you a token instead, and the ingress rules live in the dashboard rather than a file.
Then the whole connector is one container, which suits the Podman route:

```bash
podman run -d --name cloudflared --network host \
  docker.io/cloudflare/cloudflared:latest tunnel --no-autoupdate run --token <TOKEN>
```

Treat that token as a credential — it is enough on its own to serve traffic as your tunnel.

**Cloudflare Access is the better answer to "public, but only for me".** Rather than the HTTP
basic auth suggested further down, put an Access policy in front of the hostname and log in
with an email one-time PIN or your existing identity provider. Free for a handful of users,
and it happens at Cloudflare's edge, so unauthenticated requests never reach your machine at
all.

**One caching gotcha.** Cloudflare caches common static extensions — `.js` and `.css` among
them — at the edge by default. That is exactly the stale-script problem described at the top
of this section. Add a Cache Rule for the hostname with *Bypass cache*, or purge the cache
after each update.

---

## Updating

### Your gear list and rides

The inventory and the ride history live in your browser's `localStorage`, and — when the server
is running — sync to `state.json` in `STATE_DIR`. **Updating the app touches neither.** The
systemd unit puts that file in `/var/lib/cycling-weather-matrix` via `StateDirectory=`, which
is what lets the app directory stay mounted read-only.

**That file is the one thing here worth backing up**, since the ratings behind the learned
calibration cannot be regenerated:

```bash
sudo cp /var/lib/cycling-weather-matrix/state.json ~/cwem-backup-$(date +%F).json
```

The endpoint that writes it has no authentication of its own. On a public deployment anyone who
can reach the app can read and overwrite your gear and rides, so put auth in front of it —
[Cloudflare Access or basic auth](#before-you-expose-it-publicly), or don't expose it at all.

Two caveats to that:

- **An update that changes the shipped gear list will not reach you.** This is the one that
  surprises people, because nothing appears to be wrong. `loadGear()` returns your saved copy
  and only falls back to the seed in `gear.js` when there is nothing saved — so from the first
  time you open the app, the seed is never read again. If a release corrects a garment's
  numbers, renames it, or adds one, a perfectly clean deploy still shows you the old entry.
  **Reset** on the gear screen is what loads the new seed; it also discards any edits you made
  in the UI, so Export first. There is no automatic migration — the gear list is treated as
  yours, not as something an update is entitled to rewrite.
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
docker tag cycling-weather-matrix cycling-weather-matrix:previous   # a way back
docker build -t cycling-weather-matrix .
docker stop cwem && docker rm cwem
docker run -d --name cwem --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v cwem-state:/state -e STATE_DIR=/state cycling-weather-matrix
```

**`docker restart` is not enough, and this is the trap worth knowing about.** A container is
built from an image once, when you `docker run` it, and it keeps that image for life. Building
a new image under the same tag does not touch a container that already exists — `docker restart`
stops and starts the *old* code, reports success, and leaves you looking at the previous
version with nothing in the logs to say so. The container has to be replaced, not restarted.

Rolling back is the same shape: point the tag back and replace the container again.

```bash
docker rmi cycling-weather-matrix
docker tag cycling-weather-matrix:previous cycling-weather-matrix
docker stop cwem && docker rm cwem
docker run -d --name cwem --restart unless-stopped \
  -p 127.0.0.1:8765:8765 \
  -v cwem-state:/state -e STATE_DIR=/state cycling-weather-matrix
```

### Option B — Podman

Same shape, and the same rollback trick:

```bash
cd cycling-weather-matrix
git pull
podman tag cycling-weather-matrix cycling-weather-matrix:previous
podman build -t cycling-weather-matrix .
```

If you started it with `podman run`, replace the container:

```bash
podman stop cwem && podman rm cwem
podman run -d --name cwem -p 127.0.0.1:8765:8765 \
  -v cwem-state:/state -e STATE_DIR=/state cycling-weather-matrix
```

If you used the Quadlet unit, restart the service and let it pick up the rebuilt image instead.
Do not `podman rm` a Quadlet container by hand — systemd owns it and will simply recreate it:

```bash
systemctl --user restart cwem.service
systemctl --user status cwem.service
```

Rolling back means pointing the tag back at the image you kept:

```bash
podman tag cycling-weather-matrix:previous cycling-weather-matrix:latest
systemctl --user restart cwem.service
```

`podman auto-update` is not much use here. It watches a registry for a newer digest, and this
image is built locally from a git checkout, so there is no registry to watch. Rebuilding after
a `git pull` is the equivalent step.

Old images pile up with every rebuild. Once you are satisfied the update is good:

```bash
podman image prune
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

**First, prove the new code is actually being served.** Every update path has a way of
appearing to succeed while changing nothing — a container restarted instead of replaced, a
`git pull` that stopped on a dirty tree, a copy into the wrong directory. Compare what the
server hands out against what you have in the checkout:

```bash
cd /opt/cycling-weather-matrix          # or wherever you cloned it
git rev-parse --short HEAD
shasum model.js | cut -c1-12
curl -s https://kit.example.com/model.js | shasum | cut -c1-12
```

The last two must match. If they don't, the update did not reach the server and nothing else
in this section is worth checking yet. Work backwards: did `git pull` report new commits, is
this the directory the server actually serves, and — on Docker or Podman — did you replace the
container rather than restart it?

Then the service itself:

```bash
curl -sI https://kit.example.com | head -1
curl -s "https://kit.example.com/api/lookup?name=Castelli%20Perfetto%20RoS&slot=shell" | head -c 200
```

Then open the app and run one ride. If the page loads but behaves oddly, the usual cause is a
browser holding old JavaScript against new HTML — hard-reload once (Cmd/Ctrl + Shift + R). The
supplied proxy configs send `Cache-Control: no-cache` on everything precisely so this does not
happen; if you wrote your own and cached scripts aggressively, that is where to look.

**If the code is current but a garment still shows its old numbers, that is not a deploy
problem** — your saved gear list is winning over the updated seed. See
[Your gear list and rides](#your-gear-list-and-rides) above; the fix is Export, then Reset.

---

## Before you expose it publicly

**The lookup endpoint fetches pages on behalf of whoever calls it.** It doesn't take a URL —
it takes a garment name, searches, and follows its own results — so it isn't a general-purpose
proxy. But anyone who can reach it can make your server issue outbound requests, which is
worth bounding on a public host.

Two things bound it. **Every destination is resolved and checked before it is fetched**, and
refused if it lands on loopback, private, link-local, carrier-NAT, multicast or reserved
space — `169.254.169.254`, the cloud metadata address, among them. Redirects are followed by
hand so each hop is checked, not just the first: a public page that answers `302` to
`localhost` gets no further than the check. Non-standard ports are refused too, since that is
how you reach an internal service on a public-looking host. What remains is a DNS rebinding
window — a name that passes the check and then resolves elsewhere for the fetch itself —
which is narrow, needs an attacker-controlled domain ranking for a garment name, and is worth
knowing about rather than claiming is closed.

**The rate limit counts the right end of `X-Forwarded-For`.** That header is a list the client
starts and each proxy appends to, so its first entry is whatever the caller typed. The limit
reads `TRUST_PROXY_HOPS` entries back from the end instead — 1 by default, which is nginx or
Caddy on the same box — and ignores the header entirely on a direct connection. If something
else sits in front of your proxy (Cloudflare, a load balancer), raise it to match, or every
visitor lands in one shared bucket.

- The Node process limits each client to 12 lookups a minute. Change it with `LOOKUP_RATE`.
- `deploy/nginx.conf` adds a second limit at the proxy, so abusive traffic never reaches Node.
- If the server is only for you, the simplest answer is not to expose it at all: leave it on
  the loopback and reach it over Tailscale, a VPN, or an SSH tunnel:

  ```bash
  ssh -L 8765:127.0.0.1:8765 you@your-server
  ```

  Then open `http://localhost:8765`. No TLS to manage, nothing public, no rate limiting to
  think about.
- If you want it public but private to you, Cloudflare Access is the cleaner option — see
  [Cloudflare Tunnel](#cloudflare-tunnel) — because unauthenticated requests never reach your
  machine. Failing that, HTTP basic auth in front. In Caddy:

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
