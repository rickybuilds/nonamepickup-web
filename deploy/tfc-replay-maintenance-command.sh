#!/usr/bin/env bash
# Install root-owned as /usr/local/sbin/tfc-replay-maintenance-command.
set -euo pipefail
if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^maintain\ ([A-Za-z0-9_-]{1,64})$ ]]; then
  echo 'Only maintain MATCH_ID is permitted' >&2
  exit 64
fi
match_id="${BASH_REMATCH[1]}"
cd /var/www/tfcbot
flock -n /root/tfcbot/game-details-maintenance.lock \
  node api/scripts/maintainGameDetails.js --limit 99
# Use the same environment/database configuration as the worker.
# Dependencies are installed in api/node_modules, not the repository root.
cd /var/www/tfcbot/api
node - "$match_id" <<'NODE'
require('dotenv').config({ path: require('path').resolve('.env'), quiet: true });
const config = require('./src/config');
const queue = require('./src/pickup/gameDetailsQueue').openGameDetailsQueue(config.GAME_DETAILS_QUEUE_DB, { readonly: true });
try {
  const rows = queue.db.prepare("SELECT round_number,state FROM game_detail_jobs WHERE match_id=? AND round_number IN (1,2)").all(process.argv[2]);
  if (![1,2].every(round => rows.some(row => row.round_number === round && row.state === 'ready'))) process.exitCode = 75;
} finally { queue.close(); }
NODE
