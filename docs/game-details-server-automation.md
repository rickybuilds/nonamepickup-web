# Server game-details automation

New completed recordings are imported automatically by a five-minute cron worker. Conversion happens outside the API process. Each run discovers all historical and current verified complete primary artifacts in MariaDB into `/root/tfcbot/game-details-queue.db`, then processes at most four due rounds sequentially into `/root/tfcbot/game-details.db`. `flock` prevents overlapping maintenance runs; this is one server conversion worker, not four parallel workers.

The queue is separate from ELO and details. Failed jobs retry after 15 minutes and retain their error. Successful jobs are complete and are never scheduled again. The first writable run of the updated worker clears existing ready-job refresh schedules automatically. Pending/retry jobs first verify a matching package in the details database; valid packages are marked ready without opening or hashing their archives. Missing or invalid packages proceed to conversion. Late analytics/weapons/role updates require a deliberate import. Aborted/unverified uploads are never queued. A recording must be at least 30 seconds past upload verification before conversion, so a just-arrived round may wait until the next cron pass. Recent new uploads are prioritized over historical catch-up.

## Install after the desktop import

Finish the laptop import and upload the completed database BEFORE starting this live writer. Once automation is running, do not overwrite its database with an older desktop copy: that could discard newly imported server rounds. Future historical additions need a deliberate merge/cutover with the writer stopped and newer data preserved. The queue is not a backup of the detailed records.

On the web server as root:

```bash
cd /var/www/tfcbot
git pull origin main
bash -n api/scripts/installGameDetailsCron.sh
bash api/scripts/installGameDetailsCron.sh
pm2 restart tfcapi --update-env
```

The installer creates/replaces only `/etc/cron.d/tfc-game-details`, captures the installed Node/flock paths, and writes logs to `/root/tfcbot/game-details-maintenance.log`. It does not edit API environment settings, delete archives or change other cron jobs. Cron must be running on the host. The worker reads `api/.env` explicitly, including the existing pickup MariaDB credentials and `PICKUP_STORAGE_PATH`; it does not need the upload token. `ELO_DB` defaults to `/root/tfcbot/elo.db`, with details/queue beside it. Set environment paths explicitly in `api/.env` if they differ from these defaults.

To run a maintenance pass manually, use the same lock as cron:

```bash
flock -n /root/tfcbot/game-details-maintenance.lock node /var/www/tfcbot/api/scripts/maintainGameDetails.js --limit 4
```

Do not run the desktop bulk importer as an independent writer against the server database while maintenance is enabled. To stop scheduled writes, remove/disable this one cron entry and wait for any current process to finish; removing the cron entry does not terminate an existing run. Ctrl+C/SIGTERM requests a stop after the active round finishes.

## Status and troubleshooting

```bash
node /var/www/tfcbot/api/scripts/maintainGameDetails.js --status
tail -n 60 /root/tfcbot/game-details-maintenance.log
```

Status is read only and reports pending/ready/retry counts, deleted archive counts and the latest job errors. Missing files or unavailable analytics/indexes are retained for inspection rather than classified as successful deletion. A deliberate import can create a new package revision; the API reads the newest compatible revision.

Historical discovery is no longer restricted by `GAME_DETAILS_CATCHUP_DAYS`; that legacy configuration key remains accepted but is not used by this worker. All verified complete primary artifacts are considered, so older desktop imports can join maintenance. Existing ready/deleted jobs keep their state, import time and retry schedules. Discovery enriches missing recording dates but cannot overwrite dates verified from retained database packages. The worker scans verified MariaDB metadata, not arbitrary filesystem folders. Archives missing from MariaDB, unverified artifacts and incomplete rounds remain outside automatic cleanup.

## One-time reconciliation of historical database imports

After pulling the retention fix, leave archive deletion off. Use the existing cron lock:

```bash
cd /var/www/tfcbot
git pull origin main
flock -n /root/tfcbot/game-details-maintenance.lock node api/scripts/maintainGameDetails.js --reconcile
node api/scripts/maintainGameDetails.js --status
flock -n /root/tfcbot/game-details-maintenance.lock node api/scripts/maintainGameDetails.js --dry-run
```

Keep `GAME_DETAILS_RETENTION_DAYS=30` in `api/.env`. Reconciliation discovers all verified complete primary uploads, verifies matching packages already in the details DB and marks them ready with source recording dates. It does not convert missing packages, read/delete archives, change API environment flags or retire a viewer. Missing/corrupt packages become retry jobs and remain protected; normal maintenance can import/repair them. The command rejects `--prune` together with `--reconcile`. It verifies up to 10,000 rounds by default, sequentially; `--limit 99` can bound one pass. Subsequent passes skip packages whose recording-date reconciliation succeeded, so bounded passes advance. Retry jobs respect their existing 15-minute backoff. Already-deleted archives are never requeued. Check the final verified/failed/remaining summary; repeat if remaining is true. Queue readiness alone is not a substitute for DB backup coverage or the fresh cleanup verification.

A large preview is still limited to 100 candidates per invocation; only actual enabled pruning marks removals and advances through eligible files. Confirm the preview before enabling deletion. The live API must still retire the raw-file viewer as described below. A recent recording, checksum mismatch, missing retained package/index or stale recording identity blocks deletion even if an old filesystem timestamp suggests otherwise.

## Rolling archive retention

Archive deletion is OFF by default. Import automation works independently of cleanup. To inspect eligibility without importing, modifying the queue or deleting anything:

```bash
node /var/www/tfcbot/api/scripts/maintainGameDetails.js --dry-run
```

A ready round becomes eligible once its recording end is older than `GAME_DETAILS_RETENTION_DAYS` (minimum 14, default 14; set 30 for the previous rolling 30 days), with no scheduled import. Age uses the verified source manifest’s `ended_at_epoch`, falling back conservatively to the verified upload timestamp if the recording date is unavailable/invalid. Import time and file modification time do not reset the retention clock. Queue schema v3 stores the recording date and whether it was verified from the retained package; writable maintenance/reconciliation migrates v1/v2 automatically without changing existing job states. Read-only status/preview can still open old queues, using upload age until reconciliation populates recording dates. Cleanup rechecks source age and timestamp agreement from the verified database package before removing anything. The script re-verifies the newest matching database package hash, decompression, source identity and public playback format, and requires matching ELO flag-carry markers plus kill/flag-death markers for schemas that support those indexes. It hashes the archive again, checks for changed files/database and limits removal to the exact matching regular archive beneath the canonical artifact storage root. Missing, corrupt, mismatched or changing records are retained and reported. No recursive folder deletion or age-only `find -delete` is used. Only the original `.tar.zst` is eligible; prepared tactical files, ELO, queue and details DB are not deleted.

Once legacy 3D replay has been retired, first set only the legacy switch in `/var/www/tfcbot/api/.env`:

```dotenv
PICKUP_LEGACY_REPLAY_ENABLED=false
```

Then restart the API so the old raw CSV routes are disabled:

```bash
pm2 restart tfcapi --update-env
curl -i http://127.0.0.1:4000/api/pickup-replays/viewer/retention-check/1/files/roster.csv
```

Confirm 410 with `legacy_replay_retired`. Only then add the cleanup settings to `api/.env`:

```dotenv
GAME_DETAILS_ARCHIVE_DELETE=true
GAME_DETAILS_RETENTION_DAYS=30
```

The installed cron already includes `--prune`; both switches allow eligible deletions on subsequent runs. The worker also probes the running local API before deletion and refuses cleanup unless that API confirms the legacy route is retired; restarting or editing one process's config alone is not enough. Retention cannot be set below 14 days. The tactical endpoint keeps working. Metadata may still list legacy files; their presence in metadata does not mean they are being used by 2D playback. Old site links should be migrated to `round-playback.html` as part of retiring the old viewer.

Cleanup does not remove MariaDB artifact/history metadata or mark the match unverified. Deleted source archives are recorded in the queue; repeating maintenance does not requeue those artifacts. Deletion blockers appear in status and logs and are retried the next day, allowing later eligible records to proceed. Keep the queue file when migrating the service. Once sources are deleted, re-conversion cannot rely on them; the details DB and ELO need their normal backup coverage.

Confirm a new round's source with:

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:4000/api/pickup-replays/viewer/MATCHID/1/tactical
```

Expect `X-Tactical-Source: game-details-db`. No production cron, environment setting or archive deletion is performed by the local development session.
