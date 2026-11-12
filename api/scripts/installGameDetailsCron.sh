#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root on the web server." >&2
  exit 1
fi

details_node_bin="$(command -v node)"
details_flock_bin="$(command -v flock)"
details_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
details_worker="${details_script_dir}/maintainGameDetails.js"
for details_path in "$details_node_bin" "$details_flock_bin" "$details_worker"; do
  if [[ "$details_path" == *$'\n'* || "$details_path" == *'%'* || "$details_path" == *'"'* ]]; then
    echo "Unsupported character in cron command path." >&2
    exit 1
  fi
done

mkdir -p /root/tfcbot
details_cron_temp="$(mktemp)"
trap 'rm -f -- "$details_cron_temp"' EXIT
{
  printf '%s\n' '# Managed game-details imports; deletion stays gated by api/.env.'
  printf '%s\n' 'SHELL=/bin/bash' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  printf '*/5 * * * * root "%s" -n /root/tfcbot/game-details-maintenance.lock "%s" "%s" --limit 4 --prune >> /root/tfcbot/game-details-maintenance.log 2>&1\n' "$details_flock_bin" "$details_node_bin" "$details_worker"
} > "$details_cron_temp"
install -o root -g root -m 0644 "$details_cron_temp" /etc/cron.d/tfc-game-details
echo "Installed /etc/cron.d/tfc-game-details: every 5 minutes, one maintenance process."
echo "Finish the desktop DB transfer before enabling this live writer; do not replace an actively written database."
echo "Raw archive deletion stays off unless explicitly enabled and the legacy file viewer is disabled."
