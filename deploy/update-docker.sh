#!/usr/bin/env bash
# ---------------------------------------------------------------
# Update a Docker (or Podman) install to the latest code, and prove it landed.
#
#   cd /home/cycling-weather-matrix
#   ./deploy/update-docker.sh              # pull main, rebuild, replace the container
#   ./deploy/update-docker.sh --dry-run    # show what it would do, change nothing
#   ./deploy/update-docker.sh --rollback   # put the previous version back
#
# What it does, in order, and why:
#
#   1. Refuses if the checkout has local changes: `git pull` would fail
#      half-way, or quietly keep an edit you forgot.
#   2. Shows the commits you are about to get, then pulls them.
#   3. Keeps the image the container runs now as :previous, so a bad update
#      is one command away from undone (--rollback).
#   4. Builds the new image. The old container keeps running until the build
#      has succeeded — a failed build costs nothing.
#   5. Replaces the container. Restarting is not enough: a restarted container
#      keeps running the old image (INSTALL.md proved this with a marker file).
#      Your gear, rides and favourites live in the volume, which is kept.
#   6. Waits for the app to answer and compares every file the browser loads —
#      index.html, the scripts, the stylesheet, the manifest — as served with the
#      checkout's. Comparing model.js alone proves nothing when an update did
#      not touch it. If any differs, or the app does not answer in a minute, it
#      puts the previous version back and says so.
#
# The container is created with the same settings each time. They are read
# from the environment, so set the ones that differ from yours once, in
# /etc/cwem-update.conf (sourced when present), for example:
#
#   CWEM_PORT="127.0.0.1:8765:8765"
#   CWEM_EXTRA_ARGS="-v /srv/cwem-backups:/backups:Z -e BACKUP_DIR=/backups"
#
# Before replacing anything it checks that every volume or folder the running
# container has mounted is in the new settings too, so a forgotten backup
# folder stops the update instead of silently going missing.
# ---------------------------------------------------------------
set -euo pipefail

CONF=/etc/cwem-update.conf
# shellcheck source=/dev/null
[ -f "$CONF" ] && . "$CONF"

ENGINE="${CWEM_ENGINE:-docker}"            # or podman
NAME="${CWEM_NAME:-cwem}"
IMAGE="${CWEM_IMAGE:-cycling-weather-matrix}"
PORT="${CWEM_PORT:-8765:8765}"             # as given to -p
VOLUME="${CWEM_VOLUME:-cwem-state}"
ENV_FILE="${CWEM_ENV_FILE:-/root/cwem.env}" # INTERVALS_API_KEY; used when the file exists
BRANCH="${CWEM_BRANCH:-main}"
EXTRA="${CWEM_EXTRA_ARGS:-}"

DRY=0 ROLLBACK=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1;;
    --rollback) ROLLBACK=1;;
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0;;
    *) echo "Unknown option: $a (try --help)" >&2; exit 2;;
  esac
done

say(){ printf '\n==> %s\n' "$*"; }
die(){ printf 'Error: %s\n' "$*" >&2; exit 1; }
run(){ if [ "$DRY" = 1 ]; then printf '  [dry-run] %s\n' "$*"; else "$@"; fi; }

cd "$(dirname "${BASH_SOURCE[0]}")/.."
if [ ! -f server.js ] || [ ! -f Dockerfile ]; then die "run this from the cycling-weather-matrix checkout"; fi
command -v "$ENGINE" >/dev/null || die "$ENGINE not found"

# The host port to check the app on, from the -p value: "8765:8765" or "127.0.0.1:8765:8765".
IFS=: read -r -a P <<<"$PORT"
case ${#P[@]} in
  2) HOSTPORT="${P[0]}";;
  3) HOSTPORT="${P[1]}";;
  *) die "CWEM_PORT should look like 8765:8765 or 127.0.0.1:8765:8765";;
esac
URL="http://127.0.0.1:${HOSTPORT}"

# The arguments the container is created with, every time.
ARGS=(-d --name "$NAME" --restart unless-stopped -p "$PORT" -v "$VOLUME:/state" -e STATE_DIR=/state)
[ -f "$ENV_FILE" ] && ARGS+=(--env-file "$ENV_FILE")
# shellcheck disable=SC2206   # extra arguments are words on purpose
[ -n "$EXTRA" ] && ARGS+=($EXTRA)

# The files the browser loads: the top-level page, scripts, styles and
# manifest the checkout tracks, server.js excepted (it is never served).
browser_files(){ git ls-files '*.js' '*.html' '*.css' '*.webmanifest' | grep -v '/' | grep -vx 'server.js'; }
# Prints the files whose served copy differs from the checkout's; nothing when all match.
served_differs(){
  local f
  for f in $(browser_files); do
    [ "$(curl -fsS --max-time 5 "$URL/$f" 2>/dev/null | sha256sum | cut -c1-12)" = "$(sha256sum "$f" | cut -c1-12)" ] || echo "$f"
  done
}
wait_for_app(){
  for _ in $(seq 1 30); do
    curl -fsS --max-time 2 -o /dev/null "$URL/" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}
replace_container(){   # $1 = image to run
  if "$ENGINE" container inspect "$NAME" >/dev/null 2>&1; then
    run "$ENGINE" stop "$NAME" >/dev/null
    run "$ENGINE" rm "$NAME" >/dev/null
  fi
  run "$ENGINE" run "${ARGS[@]}" "$1" >/dev/null
}

# --- Rollback ------------------------------------------------------

if [ "$ROLLBACK" = 1 ]; then
  "$ENGINE" image inspect "$IMAGE:previous" >/dev/null 2>&1 || die "there is no previous version kept ($IMAGE:previous)"
  say "Putting the previous version back"
  replace_container "$IMAGE:previous"
  [ "$DRY" = 1 ] && exit 0
  wait_for_app || die "the previous version does not answer on $URL either; see: $ENGINE logs $NAME"
  echo "  Running $IMAGE:previous. The code checkout is unchanged; 'git log -1' shows what it holds."
  exit 0
fi

# Every mount the running container has must be in the new settings too —
# checked before anything changes, the code included.
if "$ENGINE" container inspect "$NAME" >/dev/null 2>&1; then
  for dest in $("$ENGINE" container inspect -f '{{range .Mounts}}{{.Destination}} {{end}}' "$NAME"); do
    case " ${ARGS[*]} " in
      *":$dest "*|*":$dest:"*) ;;
      *) die "the running container mounts something at $dest, and the new settings do not. Add it to CWEM_EXTRA_ARGS in $CONF so it is not lost.";;
    esac
  done
fi

# --- 1-2. The code ---------------------------------------------------

say "Checking the checkout"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || die "the checkout has local changes (git status). Commit, stash or discard them first."
git fetch -q origin "$BRANCH"
NEW=$(git rev-list --count "HEAD..origin/$BRANCH")
if [ "$NEW" = 0 ] && [ "$(git rev-parse --abbrev-ref HEAD)" = "$BRANCH" ]; then
  echo "  The code is already up to date ($(git log -1 --format='%h %s'))."
else
  echo "  $NEW new commit(s) on $BRANCH:"
  git log --format='    %h %s' "HEAD..origin/$BRANCH" | head -20
fi
run git checkout -q "$BRANCH"
run git pull -q --ff-only origin "$BRANCH"

# --- 3-4. The image --------------------------------------------------

say "Building"
# :previous is what runs now — not whatever :latest happens to name, which
# after a rollback or a failed update is not the same image.
if "$ENGINE" container inspect "$NAME" >/dev/null 2>&1; then
  run "$ENGINE" tag "$("$ENGINE" container inspect -f '{{.Image}}' "$NAME")" "$IMAGE:previous"
elif "$ENGINE" image inspect "$IMAGE:latest" >/dev/null 2>&1; then
  run "$ENGINE" tag "$IMAGE:latest" "$IMAGE:previous"
fi
run "$ENGINE" build -q -t "$IMAGE:latest" . >/dev/null

# --- 5-6. The container, and the proof -------------------------------

say "Replacing the container"
replace_container "$IMAGE:latest"
[ "$DRY" = 1 ] && { echo; echo "Dry run: nothing was changed."; exit 0; }

diff=""
if wait_for_app; then diff=$(served_differs); else diff="(no answer on $URL)"; fi
if [ -n "$diff" ]; then
  echo "  The new version did not come up as expected. Not as in the checkout: $(echo "$diff" | tr '\n' ' ')" >&2
  "$ENGINE" logs --tail 20 "$NAME" >&2 || true
  if "$ENGINE" image inspect "$IMAGE:previous" >/dev/null 2>&1; then
    say "Putting the previous version back"
    replace_container "$IMAGE:previous"
    wait_for_app && echo "  The previous version is running again." >&2
    # :latest is the one that failed. Point it back at what runs, so the next
    # update keeps a working image as :previous rather than this one.
    "$ENGINE" tag "$IMAGE:previous" "$IMAGE:latest"
  fi
  echo "  The checkout already holds the new code ($(git log -1 --format='%h')); the container does not." >&2
  echo "  Look at the log above, fix or wait for a fix, and run this again." >&2
  die "update not applied"
fi

say "Done"
echo "  Serving $(git log -1 --format='%h %s')"
echo "  All $(browser_files | wc -l | tr -d ' ') files the browser loads match the checkout byte for byte"
if [ -f "$ENV_FILE" ]; then
  echo "  intervals.icu: $(curl -fsS --max-time 5 "$URL/api/intervals/status" 2>/dev/null || echo 'no answer')"
fi
echo "  Reload the app once in the browser to pick up the new files."
