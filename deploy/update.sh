#!/usr/bin/env bash
# Update Haswell Bots on the HestiaCP VPS in one go:
#   pull the latest code → build → swap in the new build → restart → install the
#   WordPress plugin → check the app answers (and roll back if it doesn't).
#
# Run as root:
#   /home/haswell/web/bots.haswell.app/private/src/deploy/update.sh
#
# If the build fails, nothing is changed and the running app keeps going.
# Override any path below with an environment variable of the same name.
set -euo pipefail

BOTS_DIR="${BOTS_DIR:-/home/haswell/web/bots.haswell.app/private}"
WP_PLUGINS="${WP_PLUGINS:-/home/haswell/web/haswell.app/public_html/wp-content/plugins}"
OWNER="${OWNER:-haswell}"
PORT="${PORT:-3200}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-haswell-bots}"
PLUGIN="haswell-bots-companion"

step() { printf '\n\033[1m→ %s\033[0m\n' "$1"; }

[ "$(id -u)" -eq 0 ] || { echo "Please run as root (sudo $0)."; exit 1; }
[ -f "$BOTS_DIR/.env" ] || { echo "Missing $BOTS_DIR/.env — create it first."; exit 1; }

SRC="$BOTS_DIR/src"
cd "$SRC"
# The checkout belongs to $OWNER; let root's git work in it.
git config --global --get-all safe.directory | grep -qx "$SRC" || git config --global --add safe.directory "$SRC"

step "Pulling the latest code ($BRANCH)"
BEFORE="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
git fetch --quiet origin "$BRANCH"
git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
AFTER="$(git rev-parse --short HEAD)"
echo "   $BEFORE → $AFTER"
git log --oneline "$BEFORE..$AFTER" 2>/dev/null | sed 's/^/   /' || true

step "Installing packages"
npm ci --no-audit --no-fund --loglevel=error

step "Building (the running app is untouched until this succeeds)"
npm run build

step "Swapping in the new build"
NEW="$BOTS_DIR/app.new"
rm -rf "$NEW" && mkdir -p "$NEW/.next"
cp -r .next/standalone/. "$NEW/"
cp -r .next/static "$NEW/.next/static"
[ -d public ] && cp -r public "$NEW/public"
rm -rf "$BOTS_DIR/app.old"
[ -d "$BOTS_DIR/app" ] && mv "$BOTS_DIR/app" "$BOTS_DIR/app.old"
mv "$NEW" "$BOTS_DIR/app"
mkdir -p "$BOTS_DIR/data"
chown -R "$OWNER:$OWNER" "$BOTS_DIR"
chmod 600 "$BOTS_DIR/.env"
systemctl restart "$SERVICE"

step "Checking the app answers on port $PORT"
ok=""
for _ in $(seq 1 20); do
  if curl -fsS -o /dev/null "http://127.0.0.1:$PORT/"; then ok=1; break; fi
  sleep 1
done
if [ -z "$ok" ]; then
  echo "   The new version didn't start. Recent log:"
  journalctl -u "$SERVICE" -n 30 --no-pager | sed 's/^/   /'
  if [ -d "$BOTS_DIR/app.old" ]; then
    echo "   Rolling back to the previous version."
    rm -rf "$BOTS_DIR/app" && mv "$BOTS_DIR/app.old" "$BOTS_DIR/app"
    systemctl restart "$SERVICE"
  fi
  exit 1
fi
echo "   OK"

step "Installing the WordPress plugin"
if [ -d "$WP_PLUGINS" ]; then
  rm -rf "$WP_PLUGINS/$PLUGIN.new"
  cp -r "wordpress/$PLUGIN" "$WP_PLUGINS/$PLUGIN.new"
  chown -R "$(stat -c %U:%G "$WP_PLUGINS")" "$WP_PLUGINS/$PLUGIN.new"
  rm -rf "$WP_PLUGINS/$PLUGIN.old"
  [ -d "$WP_PLUGINS/$PLUGIN" ] && mv "$WP_PLUGINS/$PLUGIN" "$WP_PLUGINS/$PLUGIN.old"
  mv "$WP_PLUGINS/$PLUGIN.new" "$WP_PLUGINS/$PLUGIN"
  rm -rf "$WP_PLUGINS/$PLUGIN.old"
  echo "   $(grep -m1 'Version:' "$WP_PLUGINS/$PLUGIN/$PLUGIN.php" | sed 's/^[ *]*//')"
else
  echo "   Skipped: $WP_PLUGINS not found (set WP_PLUGINS=… to install it)."
fi

rm -rf "$BOTS_DIR/app.old"
step "Done — Haswell Bots is running version $AFTER"
