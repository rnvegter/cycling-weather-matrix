#!/usr/bin/env bash
# ---------------------------------------------------------------
# Install the Cycling Weather Effect Matrix in a new Proxmox LXC container.
#
# Run on the Proxmox host, as root, from a checkout of this repository:
#
#   git clone https://github.com/rnvegter/cycling-weather-matrix.git
#   cd cycling-weather-matrix
#   ./deploy/proxmox-lxc.sh                       # LAN on DHCP, port 8765
#   ./deploy/proxmox-lxc.sh --domain kit.example.com --ip 192.168.1.50/24 --gw 192.168.1.1
#   ./deploy/proxmox-lxc.sh --backup-dir /tank/cwem-backups
#   ./deploy/proxmox-lxc.sh --dry-run             # print what it would do, change nothing
#
# It does what INSTALL-PROXMOX.md describes, in that order: an unprivileged
# Debian container with nesting on (the systemd unit's sandbox needs it), the
# app under the shipped systemd unit with a root-owned, read-only checkout in
# /opt, state in /var/lib/cycling-weather-matrix, and either Caddy in the same
# container (--domain) or the app listening on the LAN (the default).
#
# Why the code is copied rather than cloned in the container: the repository
# is private, and a brand-new container has no credentials. The checkout this
# script sits in is copied whole, .git included, so `git pull` works later
# once you give the container a deploy key (see INSTALL-PROXMOX.md, Updating).
# state.json, state.prev.json and backups/ are never copied.
#
# Nothing on the host is changed except: the container itself, a template
# download if none is present, and with --backup-dir that folder and its owner.
# ---------------------------------------------------------------
set -euo pipefail

usage(){
  cat <<'EOF'
Usage: deploy/proxmox-lxc.sh [options]

  --ctid N              container ID (default: the next free one)
  --hostname NAME       container hostname (default: cwem)
  --template NAME       a template already in --template-storage, e.g.
                        debian-13-standard_13.1-2_amd64.tar.zst
                        (default: newest debian-13-standard, downloaded if needed)
  --template-storage S  storage holding templates (default: local)
  --storage S           storage for the root disk (default: local-lvm)
  --disk GB             root disk size (default: 4)
  --memory MB           memory (default: 512)
  --bridge BR           network bridge (default: vmbr0)
  --ip CIDR|dhcp        address, e.g. 192.168.1.50/24 (default: dhcp)
  --gw IP               gateway, required with a fixed --ip
  --domain SITE         put Caddy in front, with this site address:
                        kit.example.com (public, HTTPS) or http://kit.lan (LAN only)
                        Without it the app listens on the LAN at port 8765.
  --backup-dir PATH     keep the Backup tab's files in this host folder (bind mount)
  --dry-run             print the commands, change nothing
  -h, --help            this text
EOF
}

CTID="" HOSTNAME_="cwem" TEMPLATE="" TSTORE="local" STORAGE="local-lvm" DISK=4 MEMORY=512
BRIDGE="vmbr0" IP="dhcp" GW="" DOMAIN="" BACKUP_DIR_HOST="" DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --ctid) CTID="$2"; shift 2;;
    --hostname) HOSTNAME_="$2"; shift 2;;
    --template) TEMPLATE="$2"; shift 2;;
    --template-storage) TSTORE="$2"; shift 2;;
    --storage) STORAGE="$2"; shift 2;;
    --disk) DISK="$2"; shift 2;;
    --memory) MEMORY="$2"; shift 2;;
    --bridge) BRIDGE="$2"; shift 2;;
    --ip) IP="$2"; shift 2;;
    --gw) GW="$2"; shift 2;;
    --domain) DOMAIN="$2"; shift 2;;
    --backup-dir) BACKUP_DIR_HOST="$2"; shift 2;;
    --dry-run) DRY=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2;;
  esac
done

say(){ printf '\n==> %s\n' "$*"; }
die(){ printf 'Error: %s\n' "$*" >&2; exit 1; }
# Every command that changes something goes through run, so --dry-run is honest.
run(){
  if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi
}

# --- Checks before anything is changed ----------------------------

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ ! -f "$SRC/server.js" ] || [ ! -f "$SRC/deploy/cycling-weather-matrix.service" ]; then
  die "run this from a checkout of the repository; $SRC has no server.js"
fi

if [ "$DRY" = 0 ]; then
  [ "$(id -u)" = 0 ] || die "run as root on the Proxmox host"
  for c in pct pveam pvesh; do
    command -v "$c" >/dev/null || die "'$c' not found; this must run on a Proxmox VE host"
  done
fi

[[ "$DISK" =~ ^[0-9]+$ && "$MEMORY" =~ ^[0-9]+$ ]] || die "--disk and --memory take whole numbers"
[[ "$HOSTNAME_" =~ ^[a-zA-Z0-9-]+$ ]] || die "--hostname: letters, digits and hyphens only"
if [ "$IP" = dhcp ]; then
  NET="name=eth0,bridge=$BRIDGE,ip=dhcp"
else
  [[ "$IP" =~ ^[0-9.]+/[0-9]+$ ]] || die "--ip takes an address with a prefix, e.g. 192.168.1.50/24"
  [ -n "$GW" ] || die "--gw is required with a fixed --ip"
  NET="name=eth0,bridge=$BRIDGE,ip=$IP,gw=$GW"
fi
if [ -n "$DOMAIN" ]; then
  [[ "$DOMAIN" =~ ^(https?://)?[a-zA-Z0-9.-]+(:[0-9]+)?$ ]] || die "--domain: a host name such as kit.example.com or http://kit.lan"
fi
if [ -n "$BACKUP_DIR_HOST" ]; then
  [[ "$BACKUP_DIR_HOST" = /* ]] || die "--backup-dir must be an absolute path on the host"
fi

if [ -z "$CTID" ]; then
  if [ "$DRY" = 1 ] && ! command -v pvesh >/dev/null; then CTID=120
  else CTID="$(pvesh get /cluster/nextid)"; fi
fi
[[ "$CTID" =~ ^[0-9]+$ ]] || die "--ctid takes a number"
if [ "$DRY" = 0 ] && pct status "$CTID" >/dev/null 2>&1; then
  die "container $CTID already exists; pick another --ctid"
fi

# --- 1. Template ----------------------------------------------------

say "Template"
if [ -z "$TEMPLATE" ]; then
  # Newest debian-13-standard already on the host, else the newest on offer.
  if command -v pveam >/dev/null; then
    TEMPLATE="$(pveam list "$TSTORE" 2>/dev/null | awk '{print $1}' | sed 's#.*/##' \
                | grep '^debian-13-standard_.*_amd64\.tar\.zst$' | sort -V | tail -n1 || true)"
  fi
  if [ -z "$TEMPLATE" ]; then
    run pveam update
    if command -v pveam >/dev/null; then
      TEMPLATE="$(pveam available --section system | awk '{print $2}' \
                  | grep '^debian-13-standard_.*_amd64\.tar\.zst$' | sort -V | tail -n1 || true)"
    fi
    [ -n "$TEMPLATE" ] || { [ "$DRY" = 1 ] && TEMPLATE="debian-13-standard_<version>_amd64.tar.zst"; } \
      || die "no debian-13-standard template on offer; pass --template"
    run pveam download "$TSTORE" "$TEMPLATE"
  fi
fi
echo "  $TSTORE:vztmpl/$TEMPLATE"

# --- 2. Container -------------------------------------------------

say "Creating container $CTID ($HOSTNAME_)"
# Unprivileged, always; nesting because the unit's sandbox is built from mount
# namespaces, which an unprivileged container only provides with nesting=1.
run pct create "$CTID" "$TSTORE:vztmpl/$TEMPLATE" \
  --hostname "$HOSTNAME_" \
  --unprivileged 1 \
  --features nesting=1 \
  --cores 1 --memory "$MEMORY" --swap 256 \
  --rootfs "$STORAGE:$DISK" \
  --net0 "$NET" \
  --onboot 1 --start 1

if [ "$DRY" = 0 ]; then
  printf '  waiting for the network'
  for _ in $(seq 1 60); do
    if pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1; then echo " — up"; break; fi
    printf '.'; sleep 2
  done
  pct exec "$CTID" -- getent hosts deb.debian.org >/dev/null 2>&1 \
    || die "container $CTID has no working network or DNS after two minutes; check --bridge/--ip/--gw"
fi

# --- 3. Code ------------------------------------------------------

say "Copying $SRC into /opt/cycling-weather-matrix"
# --no-same-owner: the checkout must be root-owned in the container, read-only
# to the service and pullable by root (INSTALL.md explains the dubious-ownership trap).
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] tar -C $SRC -cf - . | pct exec $CTID -- tar -C /opt/cycling-weather-matrix -xf -"
else
  pct exec "$CTID" -- mkdir -p /opt/cycling-weather-matrix
  tar -C "$SRC" --exclude=./state.json --exclude=./state.prev.json --exclude=./state.json.tmp \
      --exclude=./backups --exclude=./node_modules -cf - . \
    | pct exec "$CTID" -- tar -C /opt/cycling-weather-matrix --no-same-owner -xf -
fi

# --- 4. Install inside the container ---------------------------------

ACCESS=lan; [ -n "$DOMAIN" ] && ACCESS=caddy
say "Installing Node and the service in the container (access: $ACCESS)"

# Runs inside the container as root. Values arrive as environment variables,
# never pasted into the script text, hence the single quotes.
# shellcheck disable=SC2016
INNER='set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends nodejs git ca-certificates curl
node -e "process.exit(+process.versions.node.split(\".\")[0] >= 18 ? 0 : 1)" \
  || { echo "Node $(node --version) is older than 18" >&2; exit 1; }
id cwem >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin cwem
chown -R root:root /opt/cycling-weather-matrix
cp /opt/cycling-weather-matrix/deploy/cycling-weather-matrix.service /etc/systemd/system/
mkdir -p /etc/systemd/system/cycling-weather-matrix.service.d
if [ "$ACCESS" = lan ]; then
  # A drop-in rather than an edit, so updates of the shipped unit never conflict.
  printf "[Service]\nEnvironment=HOST=0.0.0.0\n" > /etc/systemd/system/cycling-weather-matrix.service.d/local.conf
fi
systemctl daemon-reload
systemctl enable --now cycling-weather-matrix
if [ "$ACCESS" = caddy ]; then
  apt-get install -y -q caddy
  sed "0,/^kit\.example\.com {/s##${DOMAIN} {#" /opt/cycling-weather-matrix/deploy/Caddyfile > /etc/caddy/Caddyfile
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
  systemctl reload-or-restart caddy
fi'
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] pct exec $CTID -- env ACCESS=$ACCESS DOMAIN=$DOMAIN bash -s   <<the install steps>>"
else
  pct exec "$CTID" -- env ACCESS="$ACCESS" DOMAIN="$DOMAIN" bash -s <<<"$INNER"
fi

# --- 5. Backups on the host ----------------------------------------

if [ -n "$BACKUP_DIR_HOST" ]; then
  say "Backups into $BACKUP_DIR_HOST on the host"
  # In an unprivileged container uid N is uid 100000+N on the host.
  if [ "$DRY" = 1 ]; then HUID="<100000 + uid of cwem>"
  else HUID=$((100000 + $(pct exec "$CTID" -- id -u cwem))); fi
  run mkdir -p "$BACKUP_DIR_HOST"
  run chown "$HUID:$HUID" "$BACKUP_DIR_HOST"
  run pct set "$CTID" -mp0 "$BACKUP_DIR_HOST,mp=/mnt/cwem-backups"
  # ReadWritePaths is not optional: ProtectSystem=strict makes the mount
  # read-only to the app otherwise, and Back up now fails with EROFS.
  BK='printf "[Service]\nEnvironment=BACKUP_DIR=/mnt/cwem-backups\nReadWritePaths=/mnt/cwem-backups\n" > /etc/systemd/system/cycling-weather-matrix.service.d/backups.conf'
  run pct exec "$CTID" -- bash -c "$BK"
  run pct reboot "$CTID"
  if [ "$DRY" = 0 ]; then
    for _ in $(seq 1 30); do
      pct exec "$CTID" -- systemctl is-active --quiet cycling-weather-matrix 2>/dev/null && break
      sleep 2
    done
  fi
fi

# --- 6. Prove it is running the code you have -------------------------

say "Checking"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] compare sha256 of the served model.js with $SRC/model.js"
  exit 0
fi
ok=0
for _ in $(seq 1 15); do
  served="$(pct exec "$CTID" -- sh -c 'curl -fsS http://127.0.0.1:8765/model.js | sha256sum' 2>/dev/null | cut -c1-12 || true)"
  [ -n "$served" ] && { ok=1; break; }
  sleep 2
done
mine="$(sha256sum "$SRC/model.js" | cut -c1-12)"
[ "$ok" = 1 ] || { pct exec "$CTID" -- journalctl -u cycling-weather-matrix -n 20 --no-pager || true
                   die "the app is not answering on 127.0.0.1:8765 in the container (log above)"; }
[ "$served" = "$mine" ] || die "served model.js ($served) differs from the checkout's ($mine)"
echo "  served model.js matches the checkout ($mine)"
pct exec "$CTID" -- journalctl -u cycling-weather-matrix -n 4 --no-pager -o cat || true

ADDR="$(pct exec "$CTID" -- hostname -I 2>/dev/null | awk '{print $1}')"
say "Done: container $CTID"
if [ "$ACCESS" = caddy ]; then
  case "$DOMAIN" in
    http://*) echo "  Open $DOMAIN (point that name at $ADDR on your LAN)";;
    *) echo "  Open https://$DOMAIN once its DNS points at your router and ports 80/443 reach $ADDR";;
  esac
else
  echo "  Open http://$ADDR:8765"
  echo "  The API has no login of its own: anyone who can reach this port can read and"
  echo "  replace your gear and rides. Fine on a home LAN; otherwise see INSTALL-PROXMOX.md, step 4."
fi
echo "  Updating, snapshots and troubleshooting: INSTALL-PROXMOX.md"
