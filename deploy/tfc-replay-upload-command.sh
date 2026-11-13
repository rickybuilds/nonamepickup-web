#!/usr/bin/env bash
# Install root-owned as /usr/local/sbin/tfc-replay-upload-command.
set -euo pipefail
if [[ ! "${SSH_ORIGINAL_COMMAND:-}" =~ ^upload\ ([A-Za-z0-9_-]{1,64})$ ]]; then
  echo 'Only upload MATCH_ID is permitted' >&2
  exit 64
fi
match_id="${BASH_REMATCH[1]}"
# Root-owned uploader settings; never read configuration supplied by the client.
set -a
source /etc/tfc/pickup-replay-uploader.env
set +a
verified() {
  local round receipt
  for round in 01 02; do
    receipt="${PICKUP_SPOOL_ROOT:-/var/lib/tfc-pickup-uploader}/receipts/$match_id/round-$round.json"
    jq -e '.verifiedByUploader == true and .quarantined != true' "$receipt" >/dev/null || return 1
  done
}
if ! verified; then
  systemctl start tfc-pickup-replay-upload.service
  [[ "$(systemctl show tfc-pickup-replay-upload.service -p Result --value)" == success ]]
  verified
fi
echo "Uploaded and verified $match_id rounds 1 and 2"
