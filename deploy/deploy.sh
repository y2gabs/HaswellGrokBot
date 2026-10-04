#!/usr/bin/env bash
# Build and install a release on the VPS. Run from a checkout of this repo:
#   ./deploy/deploy.sh
# Layout: /opt/haswell-bots/{releases/<stamp>,current -> releases/<stamp>,.env,data}
set -euo pipefail

ROOT=/opt/haswell-bots
STAMP=$(date +%Y%m%d%H%M%S)
DEST="$ROOT/releases/$STAMP"

npm ci
npm run build

mkdir -p "$DEST" "$ROOT/data"
cp -r .next/standalone/. "$DEST/"
mkdir -p "$DEST/.next"
cp -r .next/static "$DEST/.next/static"
[ -d public ] && cp -r public "$DEST/public"

ln -sfn "$DEST" "$ROOT/current"
chown -R haswellbots:haswellbots "$ROOT"
systemctl restart haswell-bots
echo "Deployed $STAMP"

# Keep the five newest releases.
ls -1dt "$ROOT"/releases/* | tail -n +6 | xargs -r rm -rf
