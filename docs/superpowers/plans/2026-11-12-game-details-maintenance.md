# Server Game Details Maintenance Plan

**Goal:** Automatically import new verified completed uploads into the details database and provide guarded 14-day archive retention after the legacy viewer is retired.

**Architecture:** A five-minute server cron command reconciles recent complete primary artifacts from MariaDB into a separate durable SQLite queue. One standalone maintenance process converts at most four due rounds per invocation, outside the HTTP/API process. `flock` serializes cron/manual maintenance. Successful rounds are rechecked at 2 min, 15 min, 2 hr and 24 hr for late ELO analytics. Failed rounds retry after 15 min. Queue metadata survives details-database replacement; source hashes/revisions and package bytes are verified before a job is marked ready.

**Retention:** Default 14 days after first verified import, with a fresh payload/hash/source check and existing ELO map-index markers required. Delete only matching regular archive files beneath the canonical artifacts root. A deletion switch is off by default and requires the legacy raw-file viewer to be explicitly disabled. Provide dry-run/status; do not install cron, modify server environment or delete real recordings from this workstation.

**Constraints:** User requested automation on the bot/web server, not a Codex scheduled chat. Keep existing ELO indexes and ingestion behavior. No test files or test runs per AGENTS.md. Work on main; do not modify unrelated overview files. Desktop bulk replacement must finish before enabling live writes, or newer server rows can be overwritten.

- [x] Add durable queue and maintenance conversion/verification/retention module with delayed enrichment and failure recording.
- [x] Add server CLI: reconcile, bounded due jobs, status, cleanup dry-run and explicit prune. Add config and legacy-file-route guard.
- [x] Document five-minute flock cron, paths, deployment order and cleanup settings; manually exercise actual local rounds/queue without deletion or MariaDB mutation. Check syntax and obtain code review.
- [x] Commit and push main; provide concrete installation commands. No production cron/env change is performed locally.

## Verification and review

Manually queued the real HDPVET artifact in a separate local audit queue, processed its due initial/refresh passes as unchanged, and verified its actual enriched package. Queue state became ready, stage advanced correctly, no archive was marked deleted, and dry cleanup reported zero eligible/deleted/blocked. Read-only CLI status returned the expected paths/settings/state. An actual local HTTP request to the retired raw-file route returned 410/legacy_replay_retired. Node syntax checks passed; no tests created, modified or run. Bash is unavailable in this Windows workspace, so installer shell syntax must be checked on the server. MariaDB discovery and cron installation require the real server environment and were not executed locally.

Review fixes: enforce min14 at config/module/query boundaries; verify expected conversion revision; migrate queue to schema2 with daily cleanup-blocker retry to avoid starvation; stage legacy cutover before enabling cleanup and probe the running API before deletion. Re-review found no blockers. Archive eligibility starts at first verified maintenance import; already-converted desktop records still get a verified server job. No real archive unlink or server environment change was performed.
