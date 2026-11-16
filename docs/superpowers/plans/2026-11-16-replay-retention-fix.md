# Replay archive retention correction

Fix the observed zero-candidate preview for old recordings imported recently. Keep all deletion switches unchanged and preserve the database/hash/index/legacy-viewer checks.

- Migrate the maintenance queue to v3 with nullable recording-end epoch seconds. Existing queues remain readable and fall back conservatively to their upload timestamps until discovery enriches them.
- Discover all verified complete primary artifacts using MariaDB recording end timestamps. Existing ready/deleted rows retain their states; retries remain bounded. The former catch-up window must not exclude historical imported rounds.
- Base expiry on recording end, falling back to verified upload time, and report that basis in status. Verify the retained package's source recording date again before unlink.
- Add `--reconcile` to verify already-imported packages and register them ready without converting missing packages or deleting archives. This is the explicit one-time historical cutover; regular import remains bounded.
- Update operator instructions for 30-day preview, queue migration, reconciliation and viewer retirement.
- Repository instructions prohibit adding/modifying/running tests without explicit test authorization for this fix. Use syntax checks and isolated manual queue/migration/CLI verification, leaving real databases and archives untouched. Commit and push completed changes.

## Verification and review

Node syntax checks passed for all three changed JavaScript files. CLI help documents reconciliation and its no-deletion behavior. Isolated manual SQLite checks confirmed: a 40-day recording imported today expires at 30 days while a 10-day recording does not; verified dates survive later discovery; verified null uses upload fallback; bounded reconciliation advances; read-only v2 opening and v3 migration retain existing rows. Isolated package/archive previews verified existing packages, rejected a corrupt retained package, blocked a recent source despite stale discovery metadata, and blocked changed archive checksums. Every fixture archive survived the dry-runs. Independent review findings about reconciliation progress and source-date provenance were fixed and re-reviewed without remaining important issues. No repository test files were changed and no test suite was run, per AGENTS.md. No production data, service flags, cron, or viewer settings were changed.
