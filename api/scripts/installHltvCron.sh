#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root on the web server." >&2
  exit 1
fi

hltv_worker_user="${HLTV_WORKER_USER:-}"
if [[ ! "$hltv_worker_user" =~ ^[a-z_][a-z0-9_-]*$ ]] || ! id "$hltv_worker_user" >/dev/null 2>&1; then
  echo "Set HLTV_WORKER_USER to the account running both bot and API (root for an all-root deployment)." >&2
  exit 1
fi
hltv_worker_group="$(id -gn "$hltv_worker_user")"

hltv_node_bin="$(command -v node)"
hltv_flock_bin="$(command -v flock)"
hltv_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
hltv_worker="${hltv_script_dir}/hltv-worker.js"
for hltv_path in "$hltv_node_bin" "$hltv_flock_bin" "$hltv_worker"; do
  if [[ "$hltv_path" =~ [^a-zA-Z0-9_./+-] ]]; then
    echo "Unsupported character in cron command path." >&2
    exit 1
  fi
done

# In particular, a Node binary inside /root/.nvm cannot be used by another user.
runuser -u "$hltv_worker_user" -- "$hltv_node_bin" --check "$hltv_worker"
runuser -u "$hltv_worker_user" -- "$hltv_flock_bin" --version >/dev/null

# Persistent lock directory survives reboot; the service account owns its lock
# and log so a root installer never forces a non-root SQLite worker to run root.
install -d -o "$hltv_worker_user" -g "$hltv_worker_group" -m 0700 /var/lib/noname-hltv-worker
if [[ -L /var/lib/noname-hltv-worker/worker.lock ]]; then
  echo "Worker lock must not be a symlink." >&2
  exit 1
fi
touch /var/lib/noname-hltv-worker/worker.lock
chown "$hltv_worker_user:$hltv_worker_group" /var/lib/noname-hltv-worker/worker.lock
chmod 0600 /var/lib/noname-hltv-worker/worker.lock
if [[ ! -e /var/log/noname-hltv-worker.log ]]; then
  install -o "$hltv_worker_user" -g "$hltv_worker_group" -m 0600 /dev/null /var/log/noname-hltv-worker.log
fi
chown "$hltv_worker_user:$hltv_worker_group" /var/log/noname-hltv-worker.log
chmod 0600 /var/log/noname-hltv-worker.log

hltv_cron_temp="$(mktemp)"
trap 'rm -f -- "$hltv_cron_temp"' EXIT
{
  printf '%s\n' '# Managed HLTV registry worker; all deletion remains gated by api/.env.'
  printf '%s\n' 'SHELL=/bin/bash' 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
  printf '*/5 * * * * %s "%s" -n /var/lib/noname-hltv-worker/worker.lock "%s" "%s" >> /var/log/noname-hltv-worker.log 2>&1\n' "$hltv_worker_user" "$hltv_flock_bin" "$hltv_node_bin" "$hltv_worker"
} > "$hltv_cron_temp"
install -o root -g root -m 0644 "$hltv_cron_temp" /etc/cron.d/noname-hltv
echo "Installed /etc/cron.d/noname-hltv: every five minutes, one worker."
echo "No environment flags changed. Cleanup stays off/dry-run until configured in api/.env."
