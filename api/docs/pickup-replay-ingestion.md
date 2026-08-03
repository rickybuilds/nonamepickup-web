# Pickup replay ingestion

`POST /api/pickup-replays` accepts one schema-version-2 through schema-version-6 TFC 4v4 round replay package. The
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
render_models.csv    # schema version 3+
buildable_defs.csv   # schema version 3+
buildables.csv       # schema version 3+
brush_defs.csv       # schema version 4+
brushes.csv          # schema version 4+
entity_defs.csv      # schema version 5+
entities.csv         # schema version 5+
entity_census.csv    # schema version 5+
entity_meta.csv      # schema version 6+
scene_events.csv     # schema version 6+
manifest.json
complete.ready       # exactly one ready marker
```

Use `aborted.ready` instead of `complete.ready` for an aborted round. A ready
marker may contain up to 4 KiB of recorder diagnostic text; its content is not
treated as authoritative. Directories, nested paths, absolute paths, traversal,
duplicate names, symlinks, hard links, devices, and other tar entry types are
rejected. The manifest is limited to 1 MiB and `roster.csv` to 16 MiB in
addition to the global extracted-byte and file-count limits.

Schema versions 2 and 3 require `schema_version`, `match_id`, `round`, `map`,
`complete`, `reason`, `started_at_epoch`, `ended_at_epoch`, `duration_ms`,
`sample_interval_seconds`, `snapshots`, `dropped_snapshots`, `write_error`,
`rows`, and `bytes`. Version 3 additionally requires `rows.render_models`,
`rows.buildable_definitions`, `rows.buildables`, the matching byte entries for
`render_models.csv`, `buildable_defs.csv`, and `buildables.csv`, and all three
files. Header identifiers must
equal manifest identifiers, and the ready marker must agree with `complete`.
Version 4 additionally requires `rows.brush_definitions`, `rows.brushes`, the
matching byte entries, and exact `brush_defs.csv` and `brushes.csv` streams.
Brush definitions accept only the supported mover classnames and literal `*N`
BSP submodel names; brush timelines are ordered by stable `brush_id` and may
terminate with `active=0`. Version 5 additionally requires the three generic
entity streams and their `entity_definitions`, `entities`, and `entity_census`
manifest counts. Generic definitions expose edict generations and stable
lifetime IDs; state references must use an `entity` render-model kind. An
`active=0` row hides the generic track, but that lifetime may resume if a
specialized tracker temporarily claimed the edict. Entity snapshot order is
authoritative; `time_ms` may regress by at most 50 milliseconds to accommodate
bounded recorder-clock jitter. The census is a validated diagnostic inventory of
stream assignment and exclusion decisions. Version 6 additionally requires
`entity_meta.csv` and `scene_events.csv`, with `entity_metadata` and
`scene_events` row counts and matching byte entries. Semantic object identity
is the composite `(stream, stream_id)` in metadata and
`(object_stream, object_id)` in ordered scene events. Scene `seq` values are
strictly increasing within a round. Versions other than 2, 3, 4, 5, and 6 are rejected with `unsupported_schema_version`;
future versions are never reinterpreted.

Event rows preserve file order and may regress by at most 100 milliseconds in
`time_ms` to accommodate the same recorder clock; replay parsing clamps that
bounded jitter to a monotonic playback timestamp.

The schema-2 `players.csv` header is the original 21-column contract. Schema 3
appends recorder animation state and the `player_model_id` and
`weapon_model_id` dictionary references. `render_models.csv` contains
`model_id,kind,path,first_seen_ms`; IDs are positive, round-local, and unique,
while any reference of zero means no model was available. Safe model paths not
present in the website catalog are retained as telemetry and use local fallback
geometry; they are never converted into client asset URLs. Catalogued models
must match the expected stream kind, except generic entities may reuse a
specialized model and schema-6 objectives may reuse a generic pickup model.
Separators and casing are normalized before lookup. Model paths must be safe relative `models/.../*.mdl` paths with no URL,
drive letter, absolute prefix, null byte, or dot segment, and must exist in the
generated standard-TFC catalog. Generic entities may also name a safe `.spr`
path; unknown generic assets render as diagnostics and never trigger a
filesystem read or conversion from uploaded data.

Schema 3 changes `projectile_defs.csv` and `objective_defs.csv` from a `model`
string to `model_id`. Schema 2 retains the string columns and 21-column player
contract. Schema 3 also records stable buildable identities in
`buildable_defs.csv` and their ordered timeline in `buildables.csv`; a terminal
`active=0` row prevents later state for the same `buildable_id`.

`roster.csv` uses these canonical columns:

```text
session_id,slot,userid,steamid,name,initial_team,is_bot,joined_ms
```

This is the field-tested recorder header. `userid` is accepted but intentionally
not persisted because it is a transient server identifier. The aliases
`session_index`/`session`, `steam_id`/`authid`, `player_name`, `initial_slot`,
`team_number`/`team`, `class_id`, `bot`, `connected_ms`, and `disconnected_ms`
are also accepted. Missing aggregate statistics default to zero. Each
`session_id` must be unique within the round. Each row is a distinct round
session, so reconnects remain separate while `steamid` upserts the shared
player. Team numbers map to Blue (1), Red (2), Yellow (3), and Green (4).

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
format_version = <manifest schema_version>
```

The repository expects these existing column/index contracts:

- `pickup_matches`: `id`, unique `match_id`, `source_server`, `started_at`,
  `ended_at`, `status`, `created_at`, `updated_at`
- `pickup_rounds`: `id`, `match_pk`, `round_number`, `map`, `status`,
  `completion_reason`, `started_at`, `ended_at`, `duration_ms`,
  `schema_version`, `sample_interval_ms`, `snapshot_count`,
  `dropped_snapshot_count`, the four typed row-count columns, `created_at`,
  `updated_at`, unique (`match_pk`, `round_number`)
- `pickup_players`: `id`, unique `steamid`, `current_name`, `first_seen_at`,
  `last_seen_at`, `created_at`, `updated_at`
- `pickup_round_players`: `round_pk`, `player_pk`, `session_id`,
  `initial_slot`, `team_number`, `team_name`, `primary_class_id`, `is_bot`,
  `joined_ms`, `left_ms`, the aggregate combat/objective columns,
  `created_at`, `updated_at`
- `pickup_artifacts`: `id`, `round_pk`, `artifact_kind`, `status`,
  `storage_backend`, `storage_key`, `content_type`, `compression`, `byte_size`,
  `sha256`, `format_version`, `is_primary`, `manifest_json`, `uploaded_at`,
  `verified_at`, `created_at`, `updated_at`, with uniqueness on
  (`round_pk`, `artifact_kind`, `sha256`)

Confirm the deployed table definitions match this contract before restarting
PM2. No migration is run by the application.

The recorder's precise `sample_interval_seconds` value is preserved in
`pickup_artifacts.manifest_json`. Because the existing round column stores
whole milliseconds, `pickup_rounds.sample_interval_ms` contains the nearest
millisecond (for example, `0.0199` seconds is stored as `20` milliseconds).

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

Invalid complete archives are stored once in `quarantine`, keyed by SHA-256,
with a sanitized JSON diagnostic. Legacy random-name quarantine diagnostics are
also checked before a new copy is created. Concurrent identical uploads cannot
overwrite the retained archive and their staged duplicates are deleted.

After a deterministic 4xx failure has been quarantined successfully, the API
returns HTTP 202 with `quarantined: true` and `retryable: false`. The uploader
records that response as terminal and removes the round from its retry queue.
Transport failures, HTTP 408/429, and 5xx responses remain retryable.

Quarantine retention is intentionally manual for now. A future cleanup job may
enforce a configurable maximum age or total byte budget, but it must preserve
each archive/diagnostic pair, skip active writes, log every candidate, and run
in report-only mode before deletion is enabled. No production quarantine files
should be removed as part of deploying this ingestion fix.

Game servers may delete their local archives only after receiving a verified
HTTP 200/201 success or terminal HTTP 202 quarantine response **and** completing
the separately configured local retention window. A timeout, disconnect,
HTTP 408/429, 5xx, or unverified response is not permission to delete the local
artifact.

## Automated game-server uploader

The repository includes `scripts/upload-pickup-replays.sh` and matching
systemd service/timer units under `deploy/systemd`. The timer scans finalized
directories shaped like:

```text
<PICKUP_REPLAY_ROOT>/<match_id>/round-XX/
```

Only rounds containing exactly one of `complete.ready` or `aborted.ready` are
eligible. The script validates the manifest identity against the directory,
creates a fixed-member `.tar.zst` under its private spool, and uploads it over
HTTPS. It does not construct archive members from filenames found on disk.

Authentication comes from the existing mode-0600 curl configuration, so the
token is absent from the repository, environment file, process arguments, and
logs:

```text
/root/.config/tfc/pickup-upload.curl
```

Install once on each game server from a checkout of this repository:

```bash
install -D -m 755 scripts/upload-pickup-replays.sh \
  /usr/local/sbin/upload-pickup-replays
install -D -m 644 deploy/systemd/tfc-pickup-replay-upload.service \
  /etc/systemd/system/tfc-pickup-replay-upload.service
install -D -m 644 deploy/systemd/tfc-pickup-replay-upload.timer \
  /etc/systemd/system/tfc-pickup-replay-upload.timer
install -D -m 600 deploy/systemd/pickup-replay-uploader.env.example \
  /etc/tfc/pickup-replay-uploader.env
```

Edit `/etc/tfc/pickup-replay-uploader.env` and set the real HTTPS URL and a
stable server ID such as `east`. The default replay root matches the deployed
AMXX recorder path:

```text
/root/steamcmd/tfc/tfc/addons/amxmodx/data/pickup_replays
```

If a server uses another replay or spool path, update both the environment
file and the service unit's `ReadWritePaths` sandbox. Then enable the timer:

```bash
systemctl daemon-reload
systemctl enable --now tfc-pickup-replay-upload.timer
systemctl start tfc-pickup-replay-upload.service
systemctl status tfc-pickup-replay-upload.service --no-pager
journalctl -u tfc-pickup-replay-upload.service -n 100 --no-pager
systemctl list-timers tfc-pickup-replay-upload.timer
```

The service uses `StateDirectory=tfc-pickup-uploader` to create the private
spool before systemd applies its filesystem sandbox. This prevents a first-run
`226/NAMESPACE` failure when `/var/lib/tfc-pickup-uploader` does not yet exist.

For the east-server field test, a finalized
`pickup_replays/test3/round-02` is discovered on the next scan. A verified HTTP
200 or 201 response produces this durable, sanitized receipt:

```text
/var/lib/tfc-pickup-uploader/receipts/test3/round-02.json
```

The receipt is written only after `ok`, `matchId`, `round`, `sha256`, and
`byteSize` all match the submitted archive. Existing receipts suppress
duplicate work, while a crash or error before the receipt causes a safe retry;
the API's idempotency handles an upload whose response was lost.

`PICKUP_DELETE_AFTER_DAYS=0` disables deletion and is the production-safe
default. After choosing a retention window, set it to a positive whole number.
Only a round with a verified receipt can then have its raw directory and local
spooled archive removed, and only after that receipt reaches the configured
age. Receipts remain as the durable local audit trail.

The service's `StateDirectory=tfc-pickup-uploader` directive creates the
private spool before systemd applies its filesystem sandbox. This prevents a
first-run `226/NAMESPACE` failure when `/var/lib/tfc-pickup-uploader` does not
yet exist.

## Web replay viewer

The first 4v4 viewer reuses the speedrun replay renderer, map GLBs, classic TFC
player models, playback controls, and free-roam camera. Open a verified round
with:

```text
/pickup-replay.html?matchId=<match_id>&round=<round_number>
```

For the field-test artifacts this is:

```text
/pickup-replay.html?matchId=test&round=1
/pickup-replay.html?matchId=test&round=2
```

The page requests public replay metadata from:

```text
GET /api/pickup-replays/viewer/<match_id>/<round_number>
```

It then loads the recorded CSV streams in a Web Worker. The worker incrementally
decodes response bodies into chunked typed-array builders and transfers the
finished arrays so parsing
does not block the page's render thread.

The API never publishes the storage directory or sends the original archive.
It looks up only a verified primary `round_replay` artifact in MariaDB, resolves
its private relative storage key, and streams only these allowlisted members:

```text
roster.csv
players.csv
projectile_defs.csv
projectiles.csv
objective_defs.csv
objectives.csv
events.csv
render_models.csv    # v3+
buildable_defs.csv   # v3+
buildables.csv       # v3+
brush_defs.csv       # v4+
brushes.csv          # v4+
entity_defs.csv      # v5+
entities.csv         # v5+
entity_census.csv    # v5+
entity_meta.csv      # v6+
scene_events.csv     # v6+
```

Archive members are read with a fixed `tar` argument array. Match IDs and round
numbers are validated again at the viewer boundary, and a requested filename
cannot supply a path. The viewer requires GNU tar with zstd support on the API
host, which is already required to inspect `.tar.zst` replay packages.
