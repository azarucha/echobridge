#!/bin/sh
# Installs or updates echobridge on Debian / Ubuntu / Raspberry Pi OS (run from the repository: sudo ./deploy/install.sh)
#   /opt/echobridge                  program
#   /etc/echobridge/echobridge.env   configuration (created from .env.example on first install)
#   /var/lib/echobridge              data (Amazon login, skill keys, ADB key), created by systemd
set -eu

[ "$(id -u)" -eq 0 ] || { echo "Please run as root: sudo $0"; exit 1; }
SRC=$(cd "$(dirname "$0")/.." && pwd)
APP=/opt/echobridge

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Node.js 20 or newer is required (e.g. from https://github.com/nodesource/distributions)."
  exit 1
fi

echo "[1/5] System packages"
apt-get install -y shairport-sync avahi-daemon ffmpeg adb gcc libc6-dev curl >/dev/null
# echobridge starts its own shairport-sync instances
systemctl disable --now shairport-sync >/dev/null 2>&1 || true
systemctl enable --now avahi-daemon >/dev/null 2>&1

echo "[2/5] Program files"
id echobridge >/dev/null 2>&1 || useradd --system --home-dir "$APP" --no-create-home --shell /usr/sbin/nologin echobridge
mkdir -p "$APP"
tar -C "$SRC" --exclude=./node_modules --exclude=./data --exclude=./.git -cf - . | tar -C "$APP" -xf - --no-same-owner
cd "$APP"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod 755 airplay/airplay-hook.sh bin/echobridge.js
ln -sf "$APP/bin/echobridge.js" /usr/local/bin/echobridge

echo "[3/5] Port fix for several receivers (airplay/portshim.c)"
gcc -shared -fPIC -O2 -o airplay/portshim.so airplay/portshim.c -ldl
chown -R root:root "$APP" && chmod -R go-w "$APP"

echo "[4/5] Configuration"
mkdir -p /etc/echobridge
if [ ! -f /etc/echobridge/echobridge.env ]; then
  cp .env.example /etc/echobridge/echobridge.env
  FIRST=1
fi
chmod 600 /etc/echobridge/echobridge.env

echo "[5/5] Service"
cp deploy/echobridge.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable echobridge >/dev/null 2>&1
if [ "${FIRST:-0}" = 1 ]; then
  echo
  echo "Installed. Now edit /etc/echobridge/echobridge.env (see docs/setup.md), then:"
  echo "  sudo systemctl start echobridge && sudo echobridge status"
else
  systemctl restart echobridge
  sleep 2
  systemctl is-active echobridge
fi
