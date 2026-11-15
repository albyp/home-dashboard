#!/usr/bin/env bash
# Set (or change) a login password. Run on the host from the repo root:
#   ./set-password.sh          admin password (12+ characters)
#   ./set-password.sh kiosk    kiosk password (6+ characters; tailnet-only, read-mostly view)
# Writes the hash (and SESSION_SECRET if missing) into .env, then restarts.
# Changing SESSION_SECRET logs every browser out; delete that line and re-run to force it.
set -euo pipefail
cd "$(dirname "$0")"

role="${1:-admin}"
case "$role" in
  admin) var=DASHBOARD_PASSWORD_HASH; min=12 ;;
  kiosk) var=KIOSK_PASSWORD_HASH; min=6 ;;
  *) echo "Usage: $0 [admin|kiosk]" >&2; exit 1 ;;
esac

read -rsp "New $role password ($min+ chars): " pw1; echo
read -rsp 'Repeat password: ' pw2; echo
[ "$pw1" = "$pw2" ] || { echo 'Passwords do not match.' >&2; exit 1; }

hash=$(printf '%s' "$pw1" | MIN_LENGTH="$min" docker run --rm -i -e MIN_LENGTH --entrypoint node home-dashboard:latest scripts/hash-password.js)
unset pw1 pw2

touch .env
chmod 600 .env
sed -i "/^$var=/d" .env
echo "$var=$hash" >> .env
grep -q '^SESSION_SECRET=' .env || echo "SESSION_SECRET=$(openssl rand -hex 32)" >> .env

docker compose up -d
url=$(sed -n 's/^PUBLIC_URL=//p' .env | tail -1)
[ "$role" = kiosk ] && path=/kiosk || path=
echo "Password set. Log in at ${url:-the dashboard's tailscale serve address}$path"
