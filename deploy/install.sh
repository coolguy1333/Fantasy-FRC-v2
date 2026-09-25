#!/usr/bin/env bash
# Fantasy FRC installer - designed for a fresh Debian/Ubuntu Proxmox LXC.
# Run as root: sudo ./deploy/install.sh
#
# What it does:
#   1. Installs Node.js 20 + build tools (needed to compile better-sqlite3)
#   2. Creates a dedicated system user
#   3. Copies the app to /opt/fantasyfrc and installs production dependencies
#   4. Creates .env from .env.example if missing (won't overwrite yours)
#   5. Installs and enables the systemd service
#
# Re-running this script is safe - it updates the app in place (see update.sh
# for the lighter-weight "just pull new code" path).

set -euo pipefail

APP_DIR="/opt/fantasyfrc"
SERVICE_USER="fantasyfrc"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo ./deploy/install.sh)." >&2
  exit 1
fi

echo "==> Installing Node.js and build tools"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 18 ]]; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg build-essential python3
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y
  apt-get install -y nodejs
else
  apt-get install -y build-essential python3 >/dev/null
fi

echo "==> Creating service user"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$APP_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi

echo "==> Deploying app to $APP_DIR"
mkdir -p "$APP_DIR" "$APP_DIR/data"
rsync -a --delete \
  --exclude 'data' \
  --exclude '.env' \
  --exclude 'node_modules' \
  --exclude '.git' \
  "$SCRIPT_DIR"/ "$APP_DIR"/

if [[ ! -f "$APP_DIR/.env" ]]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  echo "==> Created $APP_DIR/.env from the example - EDIT THIS before starting:"
  echo "    nano $APP_DIR/.env"
fi

echo "==> Installing production dependencies"
cd "$APP_DIR"
npm ci --omit=dev

chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"
chmod 600 "$APP_DIR/.env"

echo "==> Installing systemd service"
cp "$APP_DIR/deploy/fantasyfrc.service" /etc/systemd/system/fantasyfrc.service
systemctl daemon-reload
systemctl enable fantasyfrc.service

echo ""
echo "Install complete."
echo "1) Edit /opt/fantasyfrc/.env with your TBA_API_KEY and GOOGLE_CLIENT_ID"
echo "2) Start it:   systemctl start fantasyfrc"
echo "3) Check it:   systemctl status fantasyfrc"
echo "4) Logs:       journalctl -u fantasyfrc -f"
echo "5) App listens on http://<container-ip>:3000 by default"
