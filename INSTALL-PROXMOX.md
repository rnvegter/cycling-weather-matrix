# Installing on Proxmox VE

The short version: **one small unprivileged Debian LXC container, running the app under
systemd exactly as [INSTALL.md, Option A](INSTALL.md#option-a--caddy-and-systemd-recommended)
does.** The app is one Node process with no dependencies and no database, which is the case a
container is made for. A full VM works too, but it spends a kernel and a gigabyte of RAM on a
process that idles at under 100 MB (77 MB resident, measured on Debian 13).

What this guide adds to INSTALL.md is the Proxmox part: creating the container, the one
container feature the systemd unit needs, keeping backups on the host, and how to reach the app
from your network.

## How this was checked

Everything inside the container was run in Debian 12 and Debian 13 amd64 LXC containers with
the unit's sandbox active: the Node packages, the stock systemd unit, sync, the static
allow-list, and backups both into the state directory and into a separate mount. The `pct` and
`pveam` commands that run on the Proxmox host itself were not run. They are the standard ones,
but use the template name your host actually prints.

## 1. Get a Debian template

On the Proxmox host, in a shell (*Datacenter → your node → Shell*):

```bash
pveam update
pveam available --section system | grep debian
```

Download the newest `debian-13-standard` (or `debian-12-standard`) it lists, by the exact name
it printed:

```bash
pveam download local debian-13-standard_<version>_amd64.tar.zst
```

Either release works. Debian 12 ships Node 18.20, the oldest the app supports; Debian 13
ships Node 20. Neither needs the NodeSource repository.

## 2. Create the container

```bash
pct create 120 local:vztmpl/debian-13-standard_<version>_amd64.tar.zst \
  --hostname cwem \
  --unprivileged 1 \
  --features nesting=1 \
  --cores 1 --memory 512 --swap 256 \
  --rootfs local-lvm:4 \
  --net0 name=eth0,bridge=vmbr0,ip=dhcp \
  --onboot 1 --start 1
```

Use a free ID instead of `120`, and your own storage and bridge if they are not `local-lvm`
and `vmbr0`. The web UI does the same thing (*Create CT*): keep **Unprivileged container**
ticked, and check that **Nesting** is on under *Options → Features* afterwards.

**Unprivileged, always.** Root inside an unprivileged container is an ordinary user on the
host, so a compromised app cannot reach the host as root. This app needs nothing a privileged
container would give it.

**Nesting matters for this app specifically.** The supplied systemd unit sandboxes the process
with `ProtectSystem=strict`, a read-only app directory and a writable `StateDirectory=`.
systemd builds that sandbox from mount namespaces, which an unprivileged container can only
provide with `nesting=1`. The web UI turns it on for new unprivileged containers; `pct create`
does only when you pass it, as above. Check an older container:

```bash
pct config 120 | grep features      # features: nesting=1
pct set 120 --features nesting=1    # if it is missing, then restart the container
```

A fixed address is worth having, because you will point a proxy or a bookmark at it. Either set
`ip=192.168.1.50/24,gw=192.168.1.1` in `--net0`, or give the container a DHCP reservation on
your router.

## 3. Install the app inside the container

```bash
pct enter 120
```

You are root in the container from here on, and the Debian template has no `sudo`, so the
commands below have none.

```bash
apt-get update
apt-get install -y --no-install-recommends nodejs git ca-certificates curl
node --version                      # v18.x on Debian 12, v20.x on Debian 13

git clone https://github.com/rnvegter/cycling-weather-matrix.git /opt/cycling-weather-matrix
useradd --system --no-create-home --shell /usr/sbin/nologin cwem
cp /opt/cycling-weather-matrix/deploy/cycling-weather-matrix.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now cycling-weather-matrix
systemctl status cycling-weather-matrix --no-pager
```

The repository is private, so the clone asks you to authenticate. A
[deploy key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
in the container is the tidy way to do it.

Leave the checkout owned by root, as INSTALL.md explains: the service only reads it, and a
`cwem`-owned tree stops `git pull` working at update time.

The log should end like this:

```
Cycling Weather Effect Matrix on http://127.0.0.1:8765
Synced state in /var/lib/cycling-weather-matrix/state.json
Backups in /var/lib/cycling-weather-matrix/backups — scheduled backup off; ...
```

## 4. Reach it from your network

The unit binds `127.0.0.1`, so at this point nothing outside the container can reach it. There
are two ways to open it up. Pick one.

### a. Caddy in the same container (recommended)

Caddy runs next to the app and connects to it over loopback, so the unit stays as shipped.
Follow [INSTALL.md step 5](INSTALL.md#option-a--caddy-and-systemd-recommended) inside the
container:

```bash
apt-get install -y caddy
cp /opt/cycling-weather-matrix/deploy/Caddyfile /etc/caddy/Caddyfile   # then set your domain
systemctl reload caddy
```

For a public domain, forward ports 80 and 443 from your router to the container's address.
For a name used only on your LAN, write `http://kit.lan` as the site address in the Caddyfile
instead of a domain, so Caddy does not try to get a public certificate.

This is also the arrangement in which the lookup rate limit works per client. The app only
trusts `X-Forwarded-For` from a loopback peer, so a proxy in the same container is read
correctly and a proxy anywhere else is not (see the next section).

### b. Straight onto the LAN, or behind a proxy you already run

If you only use the app at home, or already run Nginx Proxy Manager or Caddy in another
container, have the app listen on every interface instead. Do it with a drop-in rather than by
editing the shipped unit, so updates never conflict with it:

```bash
mkdir -p /etc/systemd/system/cycling-weather-matrix.service.d
cat > /etc/systemd/system/cycling-weather-matrix.service.d/local.conf <<'EOF'
[Service]
Environment=HOST=0.0.0.0
EOF
systemctl daemon-reload
systemctl restart cycling-weather-matrix
```

Then open `http://<container-ip>:8765`, or forward your existing proxy to that address. The
[proxy notes in INSTALL.md](INSTALL.md#putting-it-behind-something-other-than-caddy) still
apply: allow at least 60 seconds for `/api/lookup`, and do not cache `.js` or `.css`.

Three things to know about this route:

- **The API has no login of its own.** Anyone who can reach port 8765 can read and replace your
  gear and rides. On a home LAN that is usually acceptable. Anywhere else, restrict it. The
  Proxmox firewall can allow the port from your proxy or your subnet only (*CT → Firewall*),
  or see [Before you expose it publicly](INSTALL.md#before-you-expose-it-publicly).
- **A proxy in another container shares one rate-limit bucket.** Its requests do not arrive
  over loopback, so the app ignores their `X-Forwarded-For` and counts every visitor as the
  proxy: twelve gear lookups a minute between all of them. For a personal install that is no
  limit at all. With several users, use route a.
- **The Here button needs HTTPS.** Browsers only allow location lookups on a secure origin, so
  on plain `http://192.168.x.x:8765` that button reports that it could not find you. Searching
  for a place still works. Put HTTPS in front (route a, or your existing proxy) if you want it.

## 5. Keep the backups on the host

By default the Backup tab writes into `/var/lib/cycling-weather-matrix/backups`, on the
container's own disk. A Proxmox backup of the container includes them, but they are buried
inside it. To get them into a folder on the host, or on a ZFS dataset or NAS mount the host
already backs up, bind-mount one in.

**On the host.** The ownership has to be shifted, because in an unprivileged container uid
`N` is uid `100000 + N` on the host. Find the app user's uid inside the container first:

```bash
pct exec 120 -- id -u cwem          # e.g. 500
```

Then create the folder, give it to that shifted uid, and mount it:

```bash
mkdir -p /tank/cwem-backups
chown 100500:100500 /tank/cwem-backups          # 100000 + the uid printed above
pct set 120 -mp0 /tank/cwem-backups,mp=/mnt/cwem-backups
pct reboot 120
```

**In the container**, point the app at it, and tell systemd it may write there:

```bash
cat > /etc/systemd/system/cycling-weather-matrix.service.d/backups.conf <<'EOF'
[Service]
Environment=BACKUP_DIR=/mnt/cwem-backups
ReadWritePaths=/mnt/cwem-backups
EOF
systemctl daemon-reload
systemctl restart cycling-weather-matrix
journalctl -u cycling-weather-matrix -n 3 --no-pager     # Backups in /mnt/cwem-backups — ...
```

**`ReadWritePaths=` is not optional.** The unit runs with `ProtectSystem=strict`, which makes
everything outside `/var/lib/cycling-weather-matrix` read-only to the app, including a mount
you just made writable. Without that line, **Back up now** fails with:

```
EROFS: read-only file system, open '/mnt/cwem-backups/backup-...json.tmp'
```

If it fails with `EACCES` instead, the ownership on the host is wrong; check the shifted uid.

Then press **Back up now** on the Backup tab and check the file appears on the host:

```bash
ls -l /tank/cwem-backups
```

Turn on **Back up automatically** on the same tab if you want scheduled versions. The server
keeps the schedule, so it runs whether or not a browser is open.

## 6. Protect the container itself

The Backup tab protects your gear list and rides; a Proxmox backup protects the whole
container. Use both. The first is how you undo a bad afternoon of gear edits, the second is how
you rebuild after a dead disk.

- Add the container to a backup job under *Datacenter → Backup*, or run one by hand:
  `vzdump 120 --mode snapshot --storage <backup-storage>`.
- A bind mount (`mp0`) is **not** included in a container backup. That is usually what you
  want, since the host already has those files, but make sure something does back the host
  folder up.

## Updating

Inside the container the steps are the same as
[INSTALL.md, Option A](INSTALL.md#option-a--caddy-and-systemd-recommended), minus the `sudo`.
Proxmox adds one thing worth doing first: a snapshot, so a bad update can be undone in seconds.

```bash
# on the host
pct snapshot 120 pre-update

# in the container
cd /opt/cycling-weather-matrix
git fetch && git log --oneline HEAD..origin/main      # what you are about to get
git pull
systemctl restart cycling-weather-matrix
```

Then prove the update landed, as INSTALL.md describes, by comparing the served `model.js`
with the checkout's:

```bash
sha256sum /opt/cycling-weather-matrix/model.js | cut -c1-12
curl -s http://127.0.0.1:8765/model.js | sha256sum | cut -c1-12
```

If the update went wrong, `pct rollback 120 pre-update` on the host puts the whole container
back, state included. That also discards any rides synced since the snapshot. For the code
alone, the `git checkout <commit>` route in INSTALL.md is the gentler way back. Delete the
snapshot once you are happy: `pct delsnapshot 120 pre-update`. Snapshots need storage that
supports them, such as LVM-thin or ZFS; on plain directory storage, take a `vzdump` instead.

The drop-ins under `/etc/systemd/system/cycling-weather-matrix.service.d/` are yours. Neither
`git pull` nor an update of the shipped unit touches them.

## Docker inside the container?

You can, but there is little reason to. Proxmox recommends running Docker in a VM rather than in
an LXC container, and Docker adds a second layer of isolation around one dependency-free Node
process that the container already isolates. If you want the Docker or Podman route from
[INSTALL.md, Option B](INSTALL.md#option-b--docker-or-podman), run it in a small Debian VM;
everything there applies unchanged.

## Troubleshooting

**The service will not start, and the log mentions namespaces** (for example "Failed to set up
mount namespacing"). Nesting is off: see step 2.

**`EROFS` on Back up now.** `ReadWritePaths=` is missing for the backup folder: see step 5.

**`EACCES` on Back up now.** The host folder is not owned by `100000 + uid`: see step 5.

**The page does not load from another machine.** The unit binds the loopback by default. Use
step 4, and check the Proxmox firewall if you turned it on for the container.

Everything else, from the lookup returning `inference (search unavailable)` to stale scripts
after an update, is covered in [INSTALL.md, Troubleshooting](INSTALL.md#troubleshooting).
