#!/usr/bin/env bash
# Pull the latest code from git and restart the service.
# Run from inside the git checkout: sudo ./deploy/update.sh
set -euo pipefail

APP_DIR="/opt/fantasyfrc"
SERVICE_USER="fantasyfrc"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./deploy/update.sh)." >&2
  exit 1
fi

echo "==> Pulling latest code"
git pull --ff-only

echo "==> Syncing to $APP_DIR"
rsync -a --delete \
  --exclude 'data' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude '.git' \
  ./ "$APP_DIR"/

cd "$APP_DIR"
npm ci --omit=dev
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

echo "==> Restarting service"
systemctl restart fantasyfrc
systemctl status fantasyfrc --no-pager
