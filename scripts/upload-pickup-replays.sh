#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

readonly REQUIRED_FILES=(
  roster.csv
  players.csv
  projectile_defs.csv
  projectiles.csv
  objective_defs.csv
  objectives.csv
  events.csv
  manifest.json
)
readonly SCHEMA_V3_FILES=(
  render_models.csv
  buildable_defs.csv
  buildables.csv
)

log() {
  printf '[pickup-replay-uploader] %s\n' "$*"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    log "required command is unavailable: $1"
    exit 1
  }
}

for command_name in curl find flock jq readlink sha256sum stat tar; do
  require_command "$command_name"
done

: "${PICKUP_REPLAY_ROOT:?PICKUP_REPLAY_ROOT is required}"
: "${PICKUP_UPLOAD_URL:?PICKUP_UPLOAD_URL is required}"
: "${PICKUP_SERVER_ID:?PICKUP_SERVER_ID is required}"

PICKUP_SPOOL_ROOT="${PICKUP_SPOOL_ROOT:-/var/lib/tfc-pickup-uploader}"
PICKUP_CURL_CONFIG="${PICKUP_CURL_CONFIG:-/root/.config/tfc/pickup-upload.curl}"
PICKUP_DELETE_AFTER_DAYS="${PICKUP_DELETE_AFTER_DAYS:-0}"

[[ "$PICKUP_SERVER_ID" =~ ^[A-Za-z0-9._-]{1,64}$ ]] || {
  log "PICKUP_SERVER_ID is invalid"
  exit 1
}
[[ "$PICKUP_DELETE_AFTER_DAYS" =~ ^[0-9]+$ ]] || {
  log "PICKUP_DELETE_AFTER_DAYS must be a non-negative integer"
  exit 1
}
[[ -d "$PICKUP_REPLAY_ROOT" ]] || {
  log "replay root does not exist"
  exit 1
}
[[ -r "$PICKUP_CURL_CONFIG" ]] || {
  log "curl authentication config is not readable"
  exit 1
}

curl_mode="$(stat -c '%a' -- "$PICKUP_CURL_CONFIG")"
(( (8#$curl_mode & 077) == 0 )) || {
  log "curl authentication config must not be accessible by group or other users"
  exit 1
}

replay_root="$(readlink -f -- "$PICKUP_REPLAY_ROOT")"
mkdir -p -- "$PICKUP_SPOOL_ROOT/archives" "$PICKUP_SPOOL_ROOT/receipts" "$PICKUP_SPOOL_ROOT/tmp"
spool_root="$(readlink -f -- "$PICKUP_SPOOL_ROOT")"

exec 9>"$spool_root/uploader.lock"
if ! flock -n 9; then
  log "another uploader run is active; exiting"
  exit 0
fi

safe_remove_after_retention() {
  local round_dir="$1"
  local receipt="$2"
  (( PICKUP_DELETE_AFTER_DAYS > 0 )) || return 0

  local now receipt_time minimum_age
  now="$(date +%s)"
  receipt_time="$(stat -c '%Y' -- "$receipt")"
  minimum_age=$((PICKUP_DELETE_AFTER_DAYS * 86400))
  (( now - receipt_time >= minimum_age )) || return 0

  local round_real archive archive_real
  round_real="$(readlink -f -- "$round_dir")"
  archive="$(jq -r '.localArchive // empty' "$receipt")"
  archive_real="$(readlink -f -- "$archive" 2>/dev/null || true)"

  [[ "$round_real" == "$replay_root"/*/round-* ]] || {
    log "retention cleanup refused an unsafe round path"
    return 1
  }
  if [[ -n "$archive_real" ]]; then
    [[ "$archive_real" == "$spool_root"/archives/*/round-*.tar.zst ]] || {
      log "retention cleanup refused an unsafe archive path"
      return 1
    }
    rm -f -- "$archive_real"
  fi
  rm -rf -- "$round_real"
  log "retention complete; removed verified local round $(basename "$(dirname "$round_real")")/$(basename "$round_real")"
}

process_round() {
  local round_dir="$1"
  local complete_marker="$round_dir/complete.ready"
  local aborted_marker="$round_dir/aborted.ready"
  local marker marker_count=0

  [[ -f "$complete_marker" ]] && marker_count=$((marker_count + 1)) && marker="complete.ready"
  [[ -f "$aborted_marker" ]] && marker_count=$((marker_count + 1)) && marker="aborted.ready"
  (( marker_count > 0 )) || return 0
  if (( marker_count != 1 )); then
    log "skipping round with invalid ready markers: $(basename "$round_dir")"
    return 1
  fi

  local required
  for required in "${REQUIRED_FILES[@]}"; do
    [[ -f "$round_dir/$required" ]] || {
      log "skipping finalized round missing $required: $(basename "$round_dir")"
      return 1
    }
  done

  local schema_version
  schema_version="$(jq -er '.schema_version | select(type == "number" and floor == .)' "$round_dir/manifest.json")" || {
    log "manifest has no valid schema_version"
    return 1
  }
  if (( schema_version == 3 )); then
    local schema_file
    for schema_file in "${SCHEMA_V3_FILES[@]}"; do
      [[ -f "$round_dir/$schema_file" ]] || {
        log "skipping schema-v3 round missing $schema_file: $(basename "$round_dir")"
        return 1
      }
    done
  elif (( schema_version != 2 )); then
    log "unsupported replay schema version: $schema_version"
    return 1
  fi

  local match_id manifest_round directory_round
  match_id="$(jq -er '.match_id | select(type == "string")' "$round_dir/manifest.json")" || {
    log "manifest has no valid match_id"
    return 1
  }
  manifest_round="$(jq -er '.round | select(type == "number" and floor == . and . >= 1 and . <= 9999)' "$round_dir/manifest.json")" || {
    log "manifest has no valid round"
    return 1
  }
  [[ "$match_id" =~ ^[A-Za-z0-9_-]{1,64}$ ]] || {
    log "manifest match_id is unsafe"
    return 1
  }
  [[ "$(basename "$(dirname "$round_dir")")" == "$match_id" ]] || {
    log "manifest match_id does not match its replay directory"
    return 1
  }
  directory_round="${round_dir##*/round-}"
  [[ "$directory_round" =~ ^[0-9]{1,4}$ ]] || {
    log "round directory name is invalid"
    return 1
  }
  (( 10#$directory_round == manifest_round )) || {
    log "manifest round does not match its replay directory"
    return 1
  }

  local round_pad receipt receipt_dir archive_dir
  printf -v round_pad '%02d' "$manifest_round"
  receipt_dir="$spool_root/receipts/$match_id"
  archive_dir="$spool_root/archives/$match_id"
  receipt="$receipt_dir/round-$round_pad.json"
  mkdir -p -- "$receipt_dir" "$archive_dir"

  if [[ -f "$receipt" ]]; then
    safe_remove_after_retention "$round_dir" "$receipt"
    return 0
  fi

  local archive temporary sha256 byte_size
  local -a candidates=()
  shopt -s nullglob
  candidates=("$archive_dir/round-$round_pad-"*.tar.zst)
  shopt -u nullglob
  if (( ${#candidates[@]} > 0 )); then
    archive="${candidates[0]}"
  else
    temporary="$(mktemp "$spool_root/tmp/$match_id-round-$round_pad-XXXXXX.part")"
    local -a package_files=("${REQUIRED_FILES[@]}")
    if (( schema_version == 3 )); then package_files+=("${SCHEMA_V3_FILES[@]}"); fi
    if ! tar --zstd -C "$round_dir" -cf "$temporary" \
      "${package_files[@]}" "$marker"; then
      rm -f -- "$temporary"
      log "archive creation failed for $match_id round $manifest_round"
      return 1
    fi
    sha256="$(sha256sum -- "$temporary" | awk '{print $1}')"
    archive="$archive_dir/round-$round_pad-$sha256.tar.zst"
    if [[ -e "$archive" ]]; then
      rm -f -- "$temporary"
    else
      mv -- "$temporary" "$archive"
    fi
  fi

  sha256="$(sha256sum -- "$archive" | awk '{print $1}')"
  byte_size="$(stat -c '%s' -- "$archive")"
  local response http_status curl_result
  response="$(mktemp "$spool_root/tmp/$match_id-round-$round_pad-response-XXXXXX.json")"

  set +e
  http_status="$(curl --config "$PICKUP_CURL_CONFIG" \
    --silent --show-error \
    --connect-timeout 15 --max-time 1800 \
    --retry 2 --retry-delay 10 --retry-all-errors \
    --output "$response" --write-out '%{http_code}' \
    --request POST "$PICKUP_UPLOAD_URL" \
    --header "X-Pickup-Server-Id: $PICKUP_SERVER_ID" \
    --header "X-Pickup-Match-Id: $match_id" \
    --header "X-Pickup-Round: $manifest_round" \
    --header "X-Pickup-SHA256: $sha256" \
    --header "Content-Length: $byte_size" \
    --header "Content-Type: application/zstd" \
    --data-binary "@$archive")"
  curl_result=$?
  set -e

  if (( curl_result != 0 )); then
    rm -f -- "$response"
    log "upload transport failed for $match_id round $manifest_round; it will be retried"
    return 1
  fi

  if [[ "$http_status" != "200" && "$http_status" != "201" ]] || ! jq -e \
    --arg match "$match_id" \
    --arg round "$manifest_round" \
    --arg sha "$sha256" \
    --arg bytes "$byte_size" \
    '.ok == true and .matchId == $match and (.round | tostring) == $round and .sha256 == $sha and (.byteSize | tostring) == $bytes' \
    "$response" >/dev/null; then
    rm -f -- "$response"
    log "upload was not verified for $match_id round $manifest_round (HTTP $http_status); it will be retried"
    return 1
  fi

  local receipt_tmp
  receipt_tmp="$(mktemp "$receipt_dir/.round-$round_pad-XXXXXX.tmp")"
  jq \
    --arg uploaded_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg local_archive "$archive" \
    --arg http_status "$http_status" \
    '. + {verifiedByUploader: true, uploadedAt: $uploaded_at, localArchive: $local_archive, httpStatus: ($http_status | tonumber)}' \
    "$response" >"$receipt_tmp"
  mv -- "$receipt_tmp" "$receipt"
  rm -f -- "$response"
  log "verified upload for $match_id round $manifest_round (HTTP $http_status)"
  safe_remove_after_retention "$round_dir" "$receipt"
}

failures=0
while IFS= read -r -d '' round_dir; do
  if ! process_round "$round_dir"; then
    failures=$((failures + 1))
  fi
done < <(find "$replay_root" -mindepth 2 -maxdepth 2 -type d -name 'round-*' -print0)

if (( failures > 0 )); then
  log "$failures finalized round(s) need retry or operator attention"
  exit 1
fi

log "scan complete"
