#!/usr/bin/env bash
# Install root-owned as /usr/local/sbin/tfc-replay-maintenance-command.
set -euo pipefail
if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^maintain\ ([A-Za-z0-9_-]{1,64})$ ]]; then
  echo 'Only maintain MATCH_ID is permitted' >&2
  exit 64
fi
match_id="${BASH_REMATCH[1]}"
cd /var/www/tfcbot
maintenance_status=0
# Reserve 73 for lock contention; other failures retain their actual exit status.
flock -n -E 73 /root/tfcbot/game-details-maintenance.lock \
  node api/scripts/maintainGameDetails.js --limit 99 || maintenance_status=$?
if (( maintenance_status == 73 )); then
  echo "Maintenance busy for $match_id; another worker holds the lock" >&2
  exit 73
fi
# Use the same environment/database configuration as the worker.
# Dependencies are installed in api/node_modules, not the repository root.
cd /var/www/tfcbot/api
ready_status=0
node - "$match_id" <<'NODE' || ready_status=$?
require('dotenv').config({ path: require('path').resolve('.env'), quiet: true });
const config = require('./src/config');
const queue = require('./src/pickup/gameDetailsQueue').openGameDetailsQueue(config.GAME_DETAILS_QUEUE_DB, { readonly: true });
try {
  const rows = queue.db.prepare("SELECT round_number,state FROM game_detail_jobs WHERE match_id=? AND round_number IN (1,2)").all(process.argv[2]);
  if (![1,2].every(round => rows.some(row => row.round_number === round && row.state === 'ready'))) {
    console.error(`Details pending for ${process.argv[2]}: ${JSON.stringify(rows)}`);
    process.exitCode = 75;
  } else {
    console.log(`Details ready for ${process.argv[2]} rounds 1 and 2`);
  }
} finally { queue.close(); }
NODE
# An unrelated round can fail the bulk worker even when this match is ready.
if (( ready_status == 0 )); then
  if (( maintenance_status != 0 )); then
    echo "Maintenance exited $maintenance_status, but requested match $match_id is ready" >&2
  fi
  exit 0
fi
if (( maintenance_status != 0 )); then
  echo "Maintenance failed for $match_id (exit $maintenance_status); readiness check exited $ready_status" >&2
  exit "$maintenance_status"
fi
exit "$ready_status"
