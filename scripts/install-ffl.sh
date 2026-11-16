#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo 'Run: sudo bash install.sh'; exit 1; fi
SOURCE_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$SOURCE_DIR/api/src/ffl"
for command in curl tar xz sha256sum systemctl; do
    if ! command -v "$command" >/dev/null; then echo "Missing $command. Install curl xz-utils ca-certificates first."; exit 1; fi
done
case "$(uname -m)" in
    x86_64) NODE_ARCH=x64 ;;
    aarch64|arm64) NODE_ARCH=arm64 ;;
    *) echo 'This installer supports Linux x64 and arm64.'; exit 1 ;;
esac
if ! getent passwd ffl >/dev/null; then useradd --system --user-group --home-dir /var/lib/ffl --no-create-home --shell /usr/sbin/nologin ffl; fi
install -d -m 0755 /opt/ffl /opt/ffl/lib /opt/ffl/runtime /var/www/tfcbot/ffl
install -d -m 0700 -o ffl -g ffl /var/lib/ffl
# Keep a dedicated Node runtime; never change the pickup bot's Node installation.
NODE_VERSION=v24.22.1
if [ ! -x /opt/ffl/runtime/bin/node ] || [ "$(/opt/ffl/runtime/bin/node --version)" != "$NODE_VERSION" ]; then
    TEMP_DIR="$(mktemp -d)"
    trap 'rm -rf -- "$TEMP_DIR"' EXIT
    ARCHIVE="node-${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/${NODE_VERSION}/${ARCHIVE}" -o "$TEMP_DIR/$ARCHIVE"
    curl --fail --silent --show-error --location "https://nodejs.org/dist/${NODE_VERSION}/SHASUMS256.txt" -o "$TEMP_DIR/SHASUMS256.txt"
    (cd "$TEMP_DIR"; awk -v file="$ARCHIVE" '$2 == file { print }' SHASUMS256.txt > selected.sha256; test -s selected.sha256; sha256sum --check selected.sha256)
    tar -xJf "$TEMP_DIR/$ARCHIVE" -C /opt/ffl/runtime --strip-components=1
fi
install -m 0644 "$APP_DIR/server.mjs" /opt/ffl/server.mjs
install -m 0644 "$APP_DIR/lib/domain.mjs" "$APP_DIR/lib/seed.json" /opt/ffl/lib/
for asset in index.html app.js styles.css favicon.svg; do
    ASSET_SOURCE="$(realpath "$SOURCE_DIR/ffl/$asset")"
    ASSET_TARGET="$(realpath -m "/var/www/tfcbot/ffl/$asset")"
    if [ "$ASSET_SOURCE" != "$ASSET_TARGET" ]; then
        install -m 0644 "$ASSET_SOURCE" "$ASSET_TARGET"
    fi
done
if [ ! -e /etc/ffl.env ]; then
    umask 077
    INITIAL_PASSWORD="$(/opt/ffl/runtime/bin/node --input-type=module -e "import {randomBytes} from 'node:crypto'; process.stdout.write('ricky-'+randomBytes(6).toString('hex'))")"
    printf '%s\n' 'PORT=4010' 'FFL_PUBLIC_ORIGIN=https://nonamepickup.servehalflife.com' 'FFL_PUBLIC_DIRECTORY=/var/www/tfcbot/ffl' 'FFL_DATABASE=/var/lib/ffl/league.sqlite' "FFL_INITIAL_PASSWORD=$INITIAL_PASSWORD" > /etc/ffl.env
    unset INITIAL_PASSWORD
fi
chmod 0600 /etc/ffl.env
install -m 0644 "$SOURCE_DIR/deploy/systemd/ffl.service" /etc/systemd/system/ffl.service
systemctl daemon-reload
systemctl enable ffl
systemctl restart ffl
READY=0
for attempt in 1 2 3 4 5 6 7 8 9 10; do
    if curl --fail --silent http://127.0.0.1:4010/ffl/api/league >/dev/null; then READY=1; break; fi
    sleep 1
done
if [ "$READY" -ne 1 ]; then echo 'FFL did not start. Run: sudo journalctl -u ffl -n 50 --no-pager'; exit 1; fi
echo 'FFL installed and responding locally. Nginx was not changed.'
echo 'Next: add deploy/nginx/ffl.conf inside the existing server block, then nginx -t and reload.'
echo 'First-login password: sudo grep FFL_INITIAL_PASSWORD /etc/ffl.env'
echo 'The password in that file is only the original bootstrap password; later changes are stored in SQLite.'
