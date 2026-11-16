# Seven-day HLTV manual-review retention

The user explicitly wants original HLTV downloads kept for seven days and expired automatically unless needed for review. The external analyzer is unavailable. Existing collection already downloads into private storage and removes only the Discord ZIP when enabled; confirm the deployed bot through explicit startup/save logs instead of adding another downloader.

Add an opt-in `HLTV_MANUAL_RETENTION_ENABLED=false` policy. When enabled, it permits expiry of normal/unreviewed/unsupported demos only if no analysis run has ever existed and no error is recorded. Analysis failures, pending/processing status, detector-unsupported results, flagged classes, open reviews, explicit holds and evidence remain protected. Keep checksum/path/locking safeguards and existing cleanup/dry-run switches. Do not mark absent analysis complete.

Load worker api/.env independently of shell cwd. Provide a separate five-minute cron installer with a shared flock lock; installation does not enable deletion. Display the effective retention mode in worker output and review UI. Document the seven-day policy and the separation from 30-day pickup CSV archive cleanup and parser raw-log storage.

Verify with the ongoing user-authorized tests: defaults stay off, routine expiry requires the new flag and expiry date, holds/cases/evidence/failed/attempted analysis block deletion, and deletion audit identifies the policy. Run relevant existing tests, independently review, commit and push both repositories. No production changes or alerts from this workspace.

## Verification

19 targeted web tests and 2 bot handoff/privacy tests pass. Checks cover opt-in/off defaults, future expiry, routine expiry with unsupported status unchanged, protected/failed/attempted analysis exclusion, audit mode, original-file survival after ZIP cleanup, path checks and deletion locks/recovery. Node syntax checks and review-script compilation pass. Independent review requested service-account-safe cron setup; installer now requires an explicit worker account, provisions its persistent lock/log, and preserves log ownership during rotation. Bash is unavailable on this Windows workstation; run the documented bash -n command on the server before installation. No production flags, files, scheduled jobs or messages changed.
