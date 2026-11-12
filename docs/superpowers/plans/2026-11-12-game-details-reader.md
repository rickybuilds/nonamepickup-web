# Game Details Playback Reader Plan

**Goal:** Serve imported rounds through the existing tactical API from the read-only details database, falling back to existing gzip files.

**Approved approach:** User requested the database reader with prepared-file fallback. Default database is beside ELO: `/root/tfcbot/game-details.db`; override with `GAME_DETAILS_DB`. Keep the renderer's existing version-2 contract by returning only the embedded playback, not private raw recording/reference data.

**Execution:** Use writing-plans and executing-plans inline in the current main checkout. Do not create, edit or run tests, per AGENTS.md. Do not change archives, database content, ELO, ingestion or unrelated overview assets.

- [x] Add a read-only, bounded database playback reader. Select newest completed compatible pilot revision by insertion ID. Verify schema, package checksum, decoded identity and playback format. Bound decoded size and cache public compressed playback, not private references. Open/close per lookup so database replacement is visible.
- [x] Configure the path; read database before MariaDB/artifact lookup. Return a source header and revision-specific ETag. Fallback on missing rounds/database/read failures; preserve gzip and uncompressed response behavior.
- [x] Update deployment docs for the real server path and PM2 restart; retain fallback instructions.
- [x] Inspect live local HTTP output with the actual HDPVET database, including database/gzip/cache and file-fallback behavior. Check syntax and staged diff. Request code review; commit/push main.

**Review focus:** No raw references in HTTP output; no DB writes/creation; no MariaDB dependency for an imported round; changing revisions/files must invalidate cache correctly; existing file-only rounds continue loading.

## Verification record

Manually served the real tactical route using the actual local details database and companion artifact references. HDPVET round 1 returned 200, `game-details-db`, eight players and 229 known death weapons. Gzip transfer was 1,063,123 bytes; requesting identity encoding returned the identical JSON. Conditional ETag request returned 304 with no body. HDPVET round 2 returned 200 from `prepared-file`. The public object contained only the current playback keys, with no raw/reference package fields. All four changed/new JS files passed Node syntax checks; diff whitespace check passed. No tests created, changed or run. Independent code review found no actionable issues. Local preview uses port 8877; production deployment requires pulling main and restarting `tfcapi`.
