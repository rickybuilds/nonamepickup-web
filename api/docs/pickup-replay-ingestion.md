# Pickup replay ingestion

`POST /api/pickup-replays` accepts one version-2 TFC 4v4 round replay package. The
route is upload-only. Replay storage is private and is not registered as an
Express static directory.

## Runtime configuration

The production PM2 process requires:

| Variable | Purpose |
| --- | --- |
| `PICKUP_DB_HOST` | MariaDB host; keep this at `127.0.0.1` for the local database |
| `PICKUP_DB_PORT` | MariaDB port, normally `3306` |
| `PICKUP_DB_NAME` | Database containing the five pickup tables |
| `PICKUP_DB_USER` | Least-privilege ingestion database user |
| `PICKUP_DB_PASSWORD` | Ingestion database password |
| `PICKUP_STORAGE_PATH` | Absolute private storage root, normally `/srv/pickup-replays` |
| `PICKUP_UPLOAD_TOKEN` | High-entropy bearer token shared with approved game servers |
| `PICKUP_MAX_UPLOAD_BYTES` | Maximum compressed request size, normally `1073741824` |

Optional safety controls are `PICKUP_MAX_EXTRACTED_BYTES` (defaults to four
times the compressed limit), `PICKUP_MAX_ARCHIVE_FILES` (defaults to 32), and
`PICKUP_ZSTD_COMMAND` (defaults to `zstd`).

The host must have a compatible `zstd` executable in the PM2 process path. The
API invokes it directly with a fixed argument array; no request value is
interpolated into a shell command.

`PICKUP_STORAGE_PATH` must be outside `PUBLIC_DIR`. At startup/use time the
ingestor also verifies that `incoming`, `artifacts`, and `quarantine` resolve
under the configured storage root. Do not add this path to nginx, Apache, or
Express static-file configuration.

## Request contract

The request is:

```text
POST /api/pickup-replays
Authorization: Bearer <upload token>
X-Pickup-Server-Id: central-1
X-Pickup-Match-Id: pug-20260730-1842
X-Pickup-Round: 1
X-Pickup-SHA256: <64 lowercase or uppercase hex characters>
Content-Length: <exact compressed byte count>
Content-Type: application/zstd
```

Match IDs match `^[A-Za-z0-9_-]{1,64}$`; rounds are integers from 1 through
9999. Accepted media types are `application/zstd`, `application/x-zstd`,
`application/x-tar+zstd`, and
`application/vnd.tfc.round-replay+tar.zstd`.

Example (placeholders only):

```bash
ARCHIVE=round-01.tar.zst
UPLOAD_URL=https://example.invalid/api/pickup-replays
UPLOAD_TOKEN='<pickup-upload-token>'

curl --fail-with-body \
  -X POST "$UPLOAD_URL" \
  -H "Authorization: Bearer $UPLOAD_TOKEN" \
  -H "X-Pickup-Server-Id: central-1" \
  -H "X-Pickup-Match-Id: pug-20260730-1842" \
  -H "X-Pickup-Round: 1" \
  -H "X-Pickup-SHA256: $(sha256sum "$ARCHIVE" | cut -d' ' -f1)" \
  -H "Content-Length: $(stat -c%s "$ARCHIVE")" \
  -H "Content-Type: application/zstd" \
  --data-binary "@$ARCHIVE"
```

Do not put the real token in scripts committed to source control, command
examples, logs, or support tickets.

## Archive and manifest

The compressed tar must contain only top-level regular files:

```text
roster.csv
players.csv
projectile_defs.csv
projectiles.csv
objective_defs.csv
objectives.csv
events.csv
manifest.json
complete.ready       # exactly one ready marker
```

Use `aborted.ready` instead of `complete.ready` for an aborted round. Ready
markers must be empty. Directories, nested paths, absolute paths, traversal,
duplicate names, symlinks, hard links, devices, and other tar entry types are
rejected. The manifest is limited to 1 MiB and `roster.csv` to 16 MiB in
addition to the global extracted-byte and file-count limits.

Schema version 2 requires `schema_version`, `match_id`, `round`, `map`,
`complete`, `reason`, `started_at_epoch`, `ended_at_epoch`, `duration_ms`,
`sample_interval_seconds`, `snapshots`, `dropped_snapshots`, `write_error`,
`rows`, and `bytes`. Header identifiers must equal manifest identifiers, and
the ready marker must agree with `complete`. Versions other than 2 are rejected
with `unsupported_schema_version`; future versions are never reinterpreted.

`roster.csv` uses these canonical columns:

```text
session_index,steam_id,player_name,team_number,joined_at_epoch,left_at_epoch
```

`session_id`/`session`, `authid`/`steamid`, `name`, `team`,
`connected_at_epoch`, and `disconnected_at_epoch` are accepted recorder
aliases. Each row is a distinct round session, so reconnects remain separate
while `steam_id` upserts the shared player. Team numbers map to Blue (1), Red
(2), Yellow (3), and Green (4).

## Storage and MariaDB lifecycle

The body is streamed into a random mode-0600 `.part` file under `incoming`
while SHA-256 and byte count are calculated. The whole request is never held in
Node memory. Valid packages are extracted only into a random directory under
`incoming`.

After validation, the API creates an exclusive hard link at:

```text
artifacts/YYYY/MM/<match_id>/round-XX-<sha256>.tar.zst
```

Only the relative key below `artifacts` is stored in MariaDB. The transaction
upserts `pickup_matches`, `pickup_rounds`, `pickup_players`,
`pickup_round_players`, and `pickup_artifacts` with:

```text
storage_backend = local
artifact_kind = round_replay
format_version = 2
```

The repository expects these existing column/index contracts:

- `pickup_matches`: `id`, unique `match_id`, `server_id`, `started_at`,
  `ended_at`, `status`, `created_at`, `updated_at`
- `pickup_rounds`: `id`, `match_id`, `round_number`, `map_name`, `status`,
  `completion_reason`, `started_at`, `ended_at`, `duration_ms`,
  `schema_version`, `sample_interval_seconds`, `snapshots`,
  `dropped_snapshots`, `write_error`, JSON `row_counts`, JSON `byte_counts`,
  `created_at`, `updated_at`, unique (`match_id`, `round_number`)
- `pickup_players`: `id`, unique `steam_id`, `last_name`, `created_at`,
  `updated_at`
- `pickup_round_players`: `round_id`, `player_id`, `session_index`,
  `player_name`, `team_number`, `team_name`, `joined_at_epoch`,
  `left_at_epoch`, JSON `session_data`, `created_at`
- `pickup_artifacts`: `id`, `round_id`, `storage_backend`, `artifact_kind`,
  `format_version`, `sha256`, `byte_size`, `storage_key`, `is_primary`,
  `created_at`, with uniqueness protecting a round/checksum artifact

Confirm the deployed table definitions match this contract before restarting
PM2. No migration is run by the application.

The round row is locked during artifact selection. An identical
match/round/SHA-256 is a successful idempotent retry; a different primary
artifact for the round returns `409 round_artifact_conflict`. The staging link
is removed only after commit. On a definite transaction failure the promoted
link is removed and the verified source is quarantined. If commit outcome
cannot be determined because MariaDB becomes unreachable at commit time, the
private artifact and quarantine record are retained for operator
reconciliation rather than risking deletion of a committed artifact.

## Responses and retention

A new artifact returns HTTP 201; an idempotent retry returns HTTP 200:

```json
{
  "ok": true,
  "artifactId": 123,
  "matchId": "pug-20260730-1842",
  "round": 1,
  "status": "complete",
  "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "byteSize": 12345678,
  "storageKey": "2026/07/pug-20260730-1842/round-01-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.tar.zst"
}
```

Errors are JSON such as `{"ok":false,"error":"sha256_mismatch"}`. Typical
statuses are 400/411 for request metadata or length errors, 401 for
authentication, 409 for a conflicting round artifact, 413 for size limits, 415
for media type, 422 for archive/manifest validation, 500 for persistence or
tool failures, and 503 for unsafe/missing storage configuration. Responses do
not contain tokens, SQL, stack traces, or absolute paths.

Invalid complete archives are moved to `quarantine` with a random identifier
and a sanitized JSON diagnostic. Partial/disconnected uploads are deleted.

Game servers may delete their local archives only after receiving a verified
HTTP 200 or 201 success response **and** completing the separately configured
local retention window. A timeout, disconnect, or error response is not
permission to delete the local artifact.
