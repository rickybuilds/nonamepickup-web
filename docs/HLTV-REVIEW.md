# NoName HLTV registry and private review

This release implements retention/review infrastructure. Ghosty's GoldSrc source is now optionally connected through an untouched, revision-pinned upstream checkout for decoding, log pairing and concussion estimates. See [upstream setup and updates](HLTV-UPSTREAM.md). There are **no automatic cheating decisions, fabricated findings, hosted playback service, game asset redistribution, or simulated production alerts** in this release. Existing pickup replay is independent and unchanged.

## Existing workflow and integration

TFCbot `services/hltvFetch.js:fetchAndZipRecentDemos` uses the existing SFTP listing/selection and `fastGet` downloads. It groups recordings by filename map and takes the latest two recordings (minimum 4 MB). `autoRecap.js` supplies the canonical `a.matchId` and server; manual `commands/admin.js` supplies its existing `matchId` and resolved server. Remote modification time is the best available recording timestamp; it is not a verified parser timestamp. The automatic recap already waits three seconds for the recorder to close. This is not a guarantee that a remote recorder is stopped; parser-level finalization validation remains external.

Previously: download into OS temp, build ZIP, upload ZIP to Discord if size permits, recursively delete temp. Now, **only when enabled and match-aware**, that same download goes directly to generated `incoming/<uuid>/` under private storage. Each download uses `.part` then rename. The bot records a `pending.json` after validating size. ZIP creation must close successfully before publication as `ready.json`, so the worker cannot remove raw inputs while archiving reads them. Discord continues using its existing ZIP attachment. `cleanupResult` only removes the transient ZIP for retained downloads; registry cleanup owns raw files. There is no new downloader and no analysis in the Discord delivery path. Other callers without a match ID retain their old temporary behavior.

Private manifest publication and failures are isolated from Discord. If storage configuration/headroom is invalid, the old temporary delivery continues and logs the missing retention handoff. Operators must monitor those errors; no retention guarantee is made for that failed handoff. Invalid/oversized finalized files remain unregistered in private storage for operator reconciliation. No unregistered file is automatically purged.

Round mapping and player SteamIDs are unavailable in this retrieval code. Round IDs remain null rather than guessing from newest-first file order. Existing match ID, map and server are retained. The future parser may enrich verified metadata.

## Implemented

- Private original storage with SHA-256/size checks, no evidence copies, independent analysis/review/file states.
- Version 1 idempotent SQLite migration, foreign keys, WAL/FULL durability, indexes, stable UUIDs; deduplicate logical recordings by match/server/hash. Repeated existing fetches with identical bytes are tracked as managed physical copies under the same holds and cleanup. This does not introduce any fetches or copies. Physical duplicate bytes are included in totals.
- Separate manifest worker with persisted receipts, five-minute retry delay and dead-letter state after 12 failures. Correcting a manifest changes its digest and retries it; no remote access occurs. Completed ready manifests recover registration after crashes/restarts.
- Queue filtering/pagination, detail, priority, assignment/claim, notes with optional ticks, manual flags/player-report records, open cases, status decisions and audit history.
- Explicit hard holds, checksum-verified evidence preservation, non-shortening retention extensions, configurable policy defaults 7/14/30/90 days. Policies apply to future registrations/flags; existing expiration dates and holds remain intact.
- Closing a case keeps all holds. Each ordinary hold needs an explicit reason for release. Evidence is permanent in this first release; this interface cannot downgrade/delete it.
- Individual authorized reviewer API, verified authenticated demo download, no raw paths in HTTP responses, no-store responses, memory-only browser credential handling. A transient download hold is released on connection completion; crashes leave the hold for manual inspection/release.
- Dedicated Discord channel alerts for real manual flags/reports and low disk, durable outbox, claims/leases, exponential backoff and stalled state after 12 failed sends. No generic ADMIN channel fallback, automatic mentions, notes or accusations in alerts. Delivery is at least once: a crash after send but before acknowledgment can duplicate the same alert ID.
- CLI cleanup defaults off/dry-run, storage totals and headroom, ingestion/alert failure counts, and local manifest backfill.

## Configuration and access

Append the relevant `.env.example` settings to TFCbot `.env` and website `api/.env`. Use the **same private local filesystem mount and registry DB path** on the host (SQLite WAL must not use NFS or a remote filesystem). Precreate `/srv/noname-hltv` with a dedicated service group and restrictive permissions. Run bot, API and worker under the same dedicated OS user (or explicitly provision inheritable ACLs). Generated directories use mode 0700 and manifest files 0600; a shared group alone is insufficient. No untrusted account may write raw files or replace directories. A separate evidence WORM/offsite archive is deferred. Keep storage and DB outside both repositories and every Nginx static root. Set bot `HLTV_PUBLIC_ROOT` to the actual website root. Registry also rejects storage inside the website repository. Back up the DB and storage together.

For username/password accounts with first-login password changes and owner-only account management, see [Reviewer accounts](HLTV-REVIEWER-ACCOUNTS.md). The following configuration describes legacy credential access, which remains available for owner setup/recovery.

Set `HLTV_REVIEW_ALLOWED_USER_IDS` to **specific Discord user IDs**, identically in bot and API. Empty denies legacy credential access. There is no inherited general-admin or role-based bypass in the review API. Legacy access uses individual credentials, not Discord OAuth: an operator verifies the recipient's Discord identity, issues their credential privately, and stores only its hash in `HLTV_REVIEW_TOKEN_HASHES`. Every mutation is attributed to that configured user ID. All allowlisted reviewers are trusted reviewers with equal evidence permissions.

Generate one random token per admin locally:

```sh
node -e "const c=require('crypto');const t=c.randomBytes(32).toString('hex');console.log('token:',t);console.log('sha256:',c.createHash('sha256').update(t).digest('hex'))"
```

Store the hash mapping as `HLTV_REVIEW_TOKEN_HASHES='{"DISCORD_USER_ID":"64_lowercase_hex_characters"}'` (substitute actual numeric ID/hash). Give the token only to that user. Never place tokens in URLs or commit `.env`. Rotate/revoke by changing the mapping and restarting the API. TLS is required in deployment. Existing API IP rate limits apply.

Create a **new private text channel** in Discord and copy its real channel ID to **`HLTV_REVIEW_ALERT_CHANNEL_ID`**. No channel was created and no real ID is invented by this code. Deny `View Channel` to `@everyone`; remove **all role-level View Channel allows**; explicitly allow only approved user members and the bot member. Bot needs View Channel/Send Messages. The sender refreshes channel data and refuses sends if privacy overwrites are unsafe or the allowlist/channel is missing. Discord server owner and users with Administrator inherently bypass channel denies; remove that privilege from anyone who must not see this channel. Merely setting the environment allowlist does not change Discord permissions. Archived messages remain subject to Discord's permissions when users are removed; update both permissions and API allowlists when revoking access.

Keep `HLTV_ALERTS_ENABLED=false` until channel permissions, queue and recipients are validated. Never point it at a public or general admin channel. Alerts contain a private review link, demo/alert ID and kind; evidence requires API authentication.

## Worker and deployment

No new package installation is needed beyond each repository's existing `npm ci` dependencies. API startup applies the HLTV schema only when `HLTV_REGISTRY_ENABLED=true`. The bot accesses an existing migrated registry DB for alerts. Validate API configuration/schema first, then enable bot collection, then schedule the worker.

From the website `api/` directory:

```sh
node scripts/hltv-worker.js
```

The worker loads `api/.env` from its script path. Use the systemd installer below for continuous ingestion and serial analysis. The command without `--watch` runs one pass for maintenance or troubleshooting. The HTTP preview uses metadata only, while the CLI preview verifies files. Individual evidence downloads perform bounded file hashing on demand.

Expose `/api/admin/hltv/` through the existing API proxy and add the provided `deploy/nginx/hltv-review.conf` shell route to the existing TLS server. Do not expose storage. No public viewer/static demo route is added.

Open `/admin/hltv-review`, enter an individual credential, verify registry/storage summary, flag a real demo and add notes. Claimed cases have one assignee; approved admins may resolve a case regardless of assignee. Automatic findings remain empty until a real adapter is integrated. Queue lists all registered demos, allowing admins to manually flag a previously unreviewed recording.

Run cleanup in preview mode for a full retention window before enabling actual removal. `HLTV_CLEANUP_ENABLED=true` **and** `HLTV_CLEANUP_DRY_RUN=false` are both necessary. Changing flags only on the API does not change the separately scheduled worker's environment. Stop the timer or turn cleanup off to roll back; already deleted routine bytes require a backup to restore.

## Deletion safety and recovery

Cleanup selects at most 100 eligible demos after filtering incomplete analysis, evidence, holds and open cases. Expiry alone is insufficient. By default, with no analyzer, `unsupported` blocks deletion. An admin may record **waive-analysis**, with an inspection reason, to permit normal retention without pretending analysis completed. This applies only after explicit inspection; the analysis status stays unsupported/failed. It never bypasses holds, cases, expiry, checksum or evidence class. The separately opt-in manual-review policy below allows routine expiry without per-demo waivers.

Deletion has two transactions: commit an audited `deleting` intent after checking existence, then reacquire an IMMEDIATE writer lock, recheck eligibility, verify all checksums/paths and unlink while holding that lock. A hold/review arriving between transactions cancels deletion; concurrent writers during unlink wait/retry. The SQL DB and filesystem are not atomic together. If a process dies after unlink, the committed intent permits a later run to reconcile missing bytes as deleted. Partial duplicate deletion is similarly retried. A pre-existing missing `available` file is not called a successful deletion. Unsafe symlinks, hardlinks, traversal, identity changes or checksum mismatches stop deletion and leave an error. A failed `deleting` record remains protected by the recheck on each retry. Raw cache/export directories are not swept at all.

Stop workers and bot before reconciling filesystem anomalies. Investigate `last_error` locally (not returned through HTTP). Restore missing/corrupted original bytes from a trusted backup, verify SHA-256 against `hltv_demos.sha256`, retain holds and retry. Do not release evidence holds to resolve storage pressure. Crash-left download holds require admin inspection; never blanket-release them.

For ready files not registered, rerun the worker. Failed manifests are visible in `hltv_manifests` with attempts/error; fix the underlying cause before clearing the receipt/retrying. `pending.json` means ZIP finalization/publication was interrupted; stop the bot, inspect every referenced file and backfill the local manifest. `.part` files and leftover ZIPs after failed Discord delivery are operator-owned recovery items, never blindly swept. Files rejected by the maximum-size policy need explicit investigation/config correction before backfill.

## Backfill without downloads

Supply a local version-1 manifest with known match/server metadata and relative storage keys inside the configured root. Recording time is epoch milliseconds; null round ID is valid. Never infer a match from an arbitrary filename. Existing temporary demos outside owned storage must be migrated deliberately while all users of the files are stopped; this tool does not copy or fetch them.

```json
{"version":1,"match_id":"existing-match-id","server":"east","map":"2fort","demos":[{"storage_key":"incoming/known-directory/round.dem","filename":"round.dem","recorded_at":1794690000000,"round_id":null}]}
```

```sh
node scripts/hltv-worker.js --manifest /private/backfill.json
node scripts/hltv-worker.js --manifest /private/backfill.json --apply
```

First command validates referenced files and prints a preview; second registers them idempotently. Dry-run may initialize the configured empty registry schema but does not add demo records or alter bytes.

## Operations

Monitor worker JSON, storage free/protected/duplicate bytes, open reviews, analysis-blocked count, failed manifests, pending/stalled alerts, DB lock failures and bot handoff errors. Headroom default is 10 GiB. Low disk emits at most one real alert per UTC day; it does not delete protected material. If full: pause collection by disabling its registry flag (existing Discord workflow continues), stop cleanup, free unrelated caches or expand storage, inspect unregistered files and move evidence only under a deliberate offline migration. The feature does not automatically shrink held evidence or claim to maintain unlimited capacity.

Backup: stop collection/worker/API briefly for a consistent snapshot, or use SQLite's backup API plus a coordinated filesystem snapshot; never copy only the live DB main file while ignoring WAL. Encrypt and restrict backups. Restore database and original files to the configured mount, verify checksums/permissions, keep cleanup and alerts disabled, run a preview and review holds before restarting. Restore evidence's original checksum and audit records together. This release has no API to delete evidence.

Stalled alerts: inspect channel privacy/token/bot permissions; after correcting, an operator can reset that outbox row's attempts/next_attempt/lease locally. Preserve alert ID and sent_at. Never enqueue synthetic detections for validation in production. Privacy-check failures leave the queue intact.

## Validation and pending work

Run `node --test test/hltv.test.js` from `api/`, and `node --test test/hltvReview.test.js` from TFCbot. Tests use temporary storage and HTTP loopback; no test alerts reach Discord. Coverage includes deduplication, physical copies, report/case/evidence holds, dry-run, explicit waiver, incomplete analysis, hash mismatch, missing/symlink paths, concurrent DB writer rejection, durable deletion intent/crash reconciliation, authenticated reads/writes and channel privacy.

No real `.dem` samples or live production infrastructure were supplied. Storage tests validate actual temporary file operations, **not real GoldSrc decoding**. Before rollout validate one real completed TFCbot download and Discord attachment, its exact match association/checksum, restart recovery, channel permissions and storage mount behavior on the production Linux filesystem. Parser/viewer playback, asset licensing, advanced detectors, isolated parsing CPU/RAM/time limits, report-system automatic linkage, per-finding disposition, assignee filters and external evidence archives remain future work. Player reports can be recorded manually now and immediately create a hard hold. No existing player-report service was connected by this change.

See [analyzer contract](HLTV-ANALYZER-CONTRACT.md) for the future integration boundary.

## Verification record (2026-11-16)

HLTV tests: 17 API tests and 2 bot tests pass. A local headless Chrome check verified login, empty queue, manual flag, note/tick bookmark, desktop/mobile rendering, no script errors and no horizontal overflow. It used temporary fixture bytes and no Discord connection. The design detector found no issues. The full suites reproduce 15 existing website failures and 2 existing Rule 8 bot failures with original modified-source contents supplied from Git HEAD; the same failures appear with this change. Those unrelated failures were not changed. Real-demo and production Discord/Linux rollout validation remain outstanding.

## Automatic seven-day demos in manual-review mode

To keep every new HLTV download for the normal seven-day window while the analyzer is unavailable, set `HLTV_MANUAL_RETENTION_ENABLED=true` in website `api/.env`. This is an explicit retention policy, not a successful analysis result. It only admits normal/unreviewed demos whose analysis status is unsupported because no analysis run has ever existed, with no recorded error. A failed, pending, processing or actually attempted analysis remains blocked; so do all holds, open reviews and evidence. Flagged retention classes never enter routine expiry, even after case closure. Deliberate admin disposition/release or the existing inspected waiver is required for those cases. Check the normal policy in the review UI: its default is seven days; previous admin overrides are respected. Expiry is based on the original recording timestamp, not when the worker happens to run.

Keep `HLTV_CLEANUP_ENABLED=false` and `HLTV_CLEANUP_DRY_RUN=true` while confirming a real retained download and preview. The worker summary and admin banner report `retention_mode: manual_review`. Once validated, actual automatic removal requires `HLTV_CLEANUP_ENABLED=true` and `HLTV_CLEANUP_DRY_RUN=false` as well as the manual-policy flag. Restart the API after changing its environment for the banner to match the worker. These settings are separate from `GAME_DETAILS_RETENTION_DAYS=30` for pickup CSV replay archives. Parser source logs in `/var/lib/noname-parser` are not managed or deleted by HLTV cleanup.

Install the recurring worker on the server after pulling the website repository:

```sh
bash -n /var/www/tfcbot/api/scripts/installHltvCron.sh
HLTV_WORKER_USER=root bash /var/www/tfcbot/api/scripts/installHltvCron.sh
install -m 0644 /var/www/tfcbot/deploy/noname-hltv.logrotate /etc/logrotate.d/noname-hltv
```

Set `HLTV_WORKER_USER` to the same account running both bot and API. Use `root` only for an all-root deployment. The installer enables and starts `noname-hltv-worker.service` and retires `/etc/cron.d/noname-hltv`. The service uses the existing private worker lock and appends to `/var/log/noname-hltv-worker.log`. Stop the service before a one-shot command that takes the same lock. Restart the service after changing `api/.env`. Keep cleanup in dry-run while verifying deployment.

TFCbot must also be updated in its actual PM2 script/cwd checkout, with `HLTV_REGISTRY_ENABLED=true` and the shared root/DB configured in its loaded environment. Run `pm2 describe tfcbot` to identify that checkout before pulling or editing. After restart, `[HLTV registry] Collection enabled` confirms the effective flag/root. On a normal completed match, `Retaining original downloads` and `Published ... retained demos` confirm the handoff; the existing Discord cleanup removes only its ZIP. No `incoming` directory before the first enabled successful recap is expected. A collection-disabled, storage/headroom failure or missing match identity means retention did not occur; inspect bot logs rather than assuming all posted Discord demos were saved. Do not rerun public stats uploads merely to validate this.
