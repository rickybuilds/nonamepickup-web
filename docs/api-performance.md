# API performance optimization — 2026-11-11

## Scope and safety

Implemented on `codex/api-performance`, starting from `3155733`. No deployment, production database access, bot changes, ELO changes, PM2 restart, Nginx execution, or schema/index change was performed. Unrelated untracked overview assets were preserved. The existing checkout was reused on a feature branch under the explicit autonomous execution instruction.

## Root causes and changes

- The old 45-second analytics cache discarded useful stale responses and synchronously rebuilt on the API event loop. The module-global cache also rebuilt independently for each result limit.
- Leaderboard scans copied full rows for every candidate, then compared most rejected candidates against the entire top list. The builder now reuses a small comparison candidate, checks the last ranked row first, and copies only accepted rows. The complete comparator, qualification thresholds, SQL filtering, and stable insertion order remain intact.
- EXPLAIN QUERY PLAN showed `MATERIALIZE player_stats` in weapon/dispenser identity joins, along with existing indexed weapon scans. Those materializations now select only required join keys and resolved identity fields. No index was added. Remaining round/match aggregations retain their SQL semantics rather than introducing speculative grouping changes.
- One analytics build produces limit 10; explicit projections serialize limits 1–10. Fixed top-50, fixed top-5 map/weapon lists, archives, and weapon totals retain their original lengths. This removes duplicate rebuilds across result limits.
- Defense previously ran historical coverage counts and joins on the request path. Its full diagnostic/rating payload now refreshes in the same isolated scheduler as analytics and is reused by all detail projections. Rating, sample, identity, anomaly, roster, coverage, capture-data and estimated-label safeguards remain unchanged.
- JSON gzip level 1 is scoped to the two report routes. Existing unrelated API routes, streaming routes and relay configuration remain untouched.
- The report client now retries only explicit report-warming 503 responses, respecting Retry-After with a bounded four-attempt limit. Other request failures retain their existing behavior. This lets a page recover from cold startup without a manual refresh.

## Refresh and cache behavior

Changed files: `api/src/lib/analytics.js` (extracted calculations), `analyticsProjection.js` (limit projections), `reportCache.js` (shared cache/scheduler), `reportStore.js` (restart snapshots), `api/src/workers/reportRefresh.js` (read-only child), both `api/src/routes/analytics.js` and `stats.js` (HTTP integration), `api/scripts/benchmarkReports.js` (local measurement), existing `api/test/defense-ratings.test.js`, `capture-ratings-ui.test.js` and `defense-ratings-ui.test.js` (regressions), `assets/js/main.js`, `analytics.js`, `capture-ratings.js`, `defense-ratings.js` and `analytics.html` (live checks, preserved selections, cold-start recovery/cache versions), `deploy/nginx/report-json-gzip.conf` (proposal), this report and the implementation plan. Existing `defenseRatings.js` formulas and Capture Ratings calculations were left intact.

`reportCache.js` keeps at most two report entries: ten serialized analytics variants and one serialized defense body. It holds no unbounded per-query cache. The service is scoped by database connection through a WeakMap.

Only one child runs at a time across both report kinds. A second kind waits in a queue with at most one pending task per kind; concurrent requests share that task. Routine refreshes use a 60-second global cooldown after each child exits. The first successful cold loads of the two report kinds run sequentially without that artificial gap; initial loads never bypass the cooldown after a failed child. There is no recurring refresh timer or startup rebuild loop. A request must create demand.

The child lowers its process priority to OS `PRIORITY_LOW` before opening SQLite; failure to lower priority fails the refresh. On Ubuntu this corresponds to nice 19. It opens the existing file read-only, enables query-only mode, limits the SQLite page cache to 8 MiB, uses file-backed temporary work and one read transaction for a consistent snapshot. It sets a 192 MiB V8 old-space limit and a 1-second SQLite busy timeout. The heap limit is **not** a hard total-RSS cap: SQLite/native allocations remain outside it. Observed peak RSS is reported below.

A 30-second timeout kills a stuck child. Its slot is released only after the process actually closes, preventing timeout overlap. The previous successful body survives crashes, timeouts, revision-read errors and calculation failures. Retry backoff increases from 1 minute through 2, 4, 8, 16 to a maximum 30 minutes, and retries require demand. Success resets failure state. Explicit in-process invalidation is supported.

After five seconds, a request validates lightweight revision metadata. If unchanged, the cached result remains a HIT without a rebuild. Changed data returns the successful stale body immediately while scheduling a refresh. Metadata comprises completed match counts, successful Hampalyzer import counts/timestamps, TFCStats import counts/timestamps, and available MVP result timestamps. Unavailable MVP retry timestamps and failed Hampalyzer attempts are excluded. Unavailable MVP retries otherwise caused unnecessary invalidations during review and now have a regression test.

The importer/bot lives outside this repository, so no reliable ingestion callback was added. Source changes become visible on the next requested revision check, on requested five-second metadata validation, plus cooldown/build time. A request-driven 15-minute data-version fallback catches other historical corrections and identity/name changes; an hourly time bucket updates rolling-window calculations even without imports. The fallback is deliberately conservative: unrelated database writes can cause a fallback rebuild, but never repeated expensive polling. This is metadata-driven invalidation, not a claim of direct event subscriptions.

Restart persistence: the last successful analytics and defense bodies are atomically saved under `api/.cache/reports` (override with `REPORT_CACHE_DIR`). The API database and bot files are never written by this store. Each snapshot has a report format version, database-file fingerprint and generation time. On first request after a process restart, an asynchronous/coalesced load can serve that snapshot as STALE immediately while the one-child scheduler revalidates it. The real generation timestamp and age are preserved. Files older than 24 hours, larger than 32 MiB, incompatible, corrupt, missing or belonging to another database are ignored. Files use mode 0600 in a 0700 directory, with a flushed temporary file and atomic rename; fixed per-kind temporary paths bound interrupted-write debris. One API instance is required. Persistence failure warns and leaves successful in-memory responses available. Snapshot JSON serialization/validation adds small main-process work; filesystem operations are asynchronous. The child slot remains held through snapshot saving, so a slow fsync can delay first-load completion or the next worker while existing cached responses remain readable.

The first deployment of persistence still needs one successful build per report to create its files. Subsequent restarts reuse them. A separate local process built/saved both reports, then a new process restored both complete payloads in 42.47 ms; the initial seed took 9.29 seconds under the then-current local load. This measures disk hydration, not a production restart guarantee. The restored bodies retained exactly their prior contents, and no calculation had to finish before serving them. Snapshot files totaled 6.70 MB locally.

When no usable snapshot exists, startup still starts one refresh and waits asynchronously for at most 1.5 seconds per HTTP request. Until ready it returns HTTP 503, a public error code, `Cache-Control: no-store` and `Retry-After: 5`. Actual failures keep `Retry-After: 60` and backoff. Initial successful cold loads run sequentially without the routine cooldown. The report page retries up to three times and its live watcher can retry later. No synchronous calculation fallback is used.

Live freshness: visible analytics and defense views make a HEAD check every 15 seconds and when focus/visibility returns. HEAD transfers no report body. ETag changes trigger a full GET and rerender; unchanged statistics neither rebuild nor redownload. Failed checks retain the current data and show an interrupted-check status. The main label now distinguishes "Checked" (server validation) from "Stats generated" (the payload calculation time); STALE/BACKOFF show refresh progress/delay rather than falsely claiming new data. Report view selections and Shame pagination survive updates, with obsolete selections/pages clamped appropriately. Capture ratings reload once after changed analytics data, after their existing ten-second cache can expire; they are not continuously recalculated on the 15-second check. Hidden tabs pause network checks. This is bounded near-live reconciliation with completed/imported data, not a direct bot event subscription or a promise that all sections refresh simultaneously.

Headers: `X-Analytics-Cache` / `X-Defense-Cache` are HIT, MISS, STALE or BACKOFF; corresponding `-Validated-At` is the last successful validation timestamp, `-Age` is seconds since the last successful generation, `-Revision` is a short hash, and `-Refresh` is `ok` or `failed`. HTTP caching remains `public, max-age=30, stale-while-revalidate=60`. Age remains visible even when unchanged data is revalidated. The old public `refresh=1` and `explain=1` parameters no longer force expensive public work; profiling is available through `buildAnalytics` options locally.

## Measured results

Local read-only database: 3,047 matches, approximately 2.33 GB. Windows, Node v24.22.1, better-sqlite3 12.11.1. Both final baseline and refresh benchmarks were pinned to **one logical CPU**, with child affinity inherited and child priority confirmed as 19. These are bounded local measurements, not production Ubuntu/Node 20.20.2 results or proof of Discord responsiveness.

The original source was loaded from the untouched pre-change snapshot; complete response bodies and EXPLAIN plans were captured in ignored local scratch. Tests, JSON comparisons and measurements never wrote the source database. Initially the native addon was absent; it was rebuilt locally. The final comparative numbers below all use better-sqlite3, rather than mixing the earlier built-in SQLite measurements.

| Measurement | Original, one CPU | Optimized, one CPU |
| --- | ---: | ---: |
| Analytics limit 5 rebuild | 6,226 ms | 2,901 ms child build, including all 10 variants |
| Analytics limit 10 rebuild | 6,708 ms independently | Same shared build; refresh repeat 2,693 ms |
| Analytics build CPU | 6,094 / 6,625 ms per limit | 2,640 / 2,656 ms per shared build |
| Analytics cached response | 1.18 / 3.72 ms direct-handler samples | 1.95 ms HTTP median; 4.73 ms max of 15 |
| Analytics stale response | Synchronous expiration rebuild | 9.57 ms HTTP |
| Analytics event-loop maximum during rebuild | 6,245 / 6,728 ms | 58.36 ms |
| Lightweight endpoint during analytics rebuild | Main loop blocked | 57.96 ms maximum, 158 samples |
| Defense rebuild | 1,467 ms on main loop | 1,367 ms child; repeat 1,340 ms |
| Defense build CPU | 1,469 ms | 1,313 ms |
| Defense cached/stale response | Full response serialized per request | 39.83 ms cached median; 43.19 ms max; 28.52 ms stale |
| Defense event-loop maximum during rebuild | 1,468 ms | 29.72 ms |
| Lightweight endpoint during defense rebuild | Main loop blocked | 4.83 ms maximum, 71 samples |
| Revision marker check | N/A | 6.19 ms initial local sample |

The old cache-hit samples are direct-handler calls including JSON parsing; new samples are real HTTP transfers/reads. They are different measurement boundaries and should not be interpreted as a cache-hit speedup. The material improvements are lower rebuild CPU, shared limits, and elimination of multi-second main-loop blocking.

Analytics child peak RSS: 219–221 MiB; end-of-build RSS: 197–199 MiB. Defense child peak: 314 MiB; end-of-build RSS: 297 MiB. Benchmark parent RSS was approximately 103 MiB after analytics and 167 MiB after defense, including retained benchmark response strings, HTTP parsing and assertion data. Summing those observed parent/child figures gives an approximate upper envelope of 481 MiB, **not** a simultaneous whole-host peak measurement. The original single-process benchmark reached 384 MiB after sequential builds. Parent CPU during the sampled cold periods was 374 ms for analytics and 94 ms for defense, including frequent HTTP ping probes. No claim is made that total process memory always falls; isolation adds process overhead while protecting the main event loop.

The initial benchmark predates the follow-up cold-start scheduling fix. Its cold analytics request returned 503 after 1,523 ms while the shared build finished after 3,175 ms overall. Cold defense returned 503 after 1,515 ms while finishing after 1,554 ms. These requests demonstrate the bounded wait; subsequent requests used the ready cache. The browser warming retry is separately verified.

| Transfer | Uncompressed | Negotiated gzip, level 1 |
| --- | ---: | ---: |
| Analytics limit 5 | 244,098 bytes | 21,460 bytes (91.2% reduction) |
| Full Defense envelope | 3,314,118 bytes | 491,156 bytes (85.2% reduction) |

HTTP benchmarks asserted `Content-Encoding: gzip` and complete decoded-body equality. `Vary: Accept-Encoding` is supplied by the compression middleware.

## Defense detail API and remaining bottlenecks

Default `/api/stats/defense-ratings` remains the complete compatible payload. Opt-in `?detail=summary` preserves all ratings and diagnostic metadata while leaving observation arrays empty (880,409 bytes locally). `?detail=selected&map=phantom_lg&class=soldier` preserves the complete selected bucket, including its real observations and safeguards (79,358 bytes locally). Invalid selected map/class values return 400. Existing class/map query parameters retain their old behavior unless detail is explicitly requested.

These projections reuse one cached full report; they do not run historical diagnostic queries again. The existing dashboard still loads the full response by default; switching it to progressive detail loading is deferred to avoid changing its client-side charts/filter contract in this optimization. Diagnostics are cached with the full source revision rather than placed on an independent freshness schedule that could mix integrity metadata from another dataset version. Large event-table coverage scans and SQLite/native allocations remain the main defense cost. The full default transfer is still 3.3 MB before compression.

## Correctness and tests

Full native-SQLite JSON comparisons passed at limits 5 and 10, after ignoring only intentionally changing `generated_at`. This includes every combat, player, match, round, map, MVP, role, flag and weapon field. The full Defense Ratings payload compared equal, including diagnostics, exclusions and estimated-data labels. Capture logic was not altered; its API, population/roster, formula and UI tests pass.

48 relevant tests pass across `defense-ratings.test.js`, `capture-ratings.test.js`, `capture-ratings-ui.test.js` and `defense-ratings-ui.test.js`. Requested regressions were added only to an existing test file: fresh/stale/cold cache, shared limits, cross-kind serialization, invalidation, metadata failure, backoff/recovery, child timeout/close/crash/spawn error, real read-only child integration, bounded resource options, all limit projections, defense projections and bounded client cold-start retries. No new test file was created.

The full suite is **not green**: 161 tests, 145 pass, 16 fail in the latest run (the 15 baseline failures plus the previously observed intermittent oversized-upload failure). The original baseline has the 15 persistent failure names (138 tests, 123 pass, 15 fail), verified with original route and test sources loaded without changing workspace files. Failures are unrelated comparison/ELO replay expectations, replay lighting/brush/schema/layout/material assertions, missing local player-model assets, upload quarantine/timestamp checks and a projectile cache-key assertion. These were not changed to conceal failures or expanded into unrelated fixes. Syntax checks and `git diff --check` pass.

Review found and fixed stale-serving failure on metadata errors and spurious MVP retry invalidations; both fixes were reproduced with failing tests before correction. No statistical extraction/projection issue was found in independent code review.

Re-run local verification:

```powershell
node --test api/test/defense-ratings.test.js api/test/capture-ratings.test.js api/test/capture-ratings-ui.test.js api/test/defense-ratings-ui.test.js
node api/scripts/benchmarkReports.js C:/path/to/LOCAL/elo.db C:/path/to/output
```

The benchmark opens the specified database read-only and starts only local ephemeral HTTP listeners/children. It deliberately uses cooldown 0 to bound benchmark duration; production uses 60 seconds. Retain the generated metrics and private JSON snapshots outside Git. The script measures parent delay and a lightweight ping throughout cold refresh, full and gzip transfers, stale responses, child CPU/peak RSS and selected defense size.

## Proposed Nginx change — not executed

Only a relay fragment exists in the repository; the production server's full Nginx configuration is external. Do not modify the relay fragment. First inspect `sudo nginx -T` privately and locate the existing ordinary JSON API proxy location. Add the contents of `deploy/nginx/report-json-gzip.conf` **inside that existing location**, replacing duplicate gzip directives rather than duplicating a location or modifying proxy behavior:

```nginx
gzip on;
gzip_types application/json;
gzip_vary on;
gzip_min_length 1024;
gzip_comp_level 1;
gzip_proxied any;
```

Keep all existing upstream, proxy-header, authentication and timeout directives. Leave live relay, WebSocket and SSE locations untouched. Application compression already covers these two report endpoints; Nginx must not recompress an upstream response with Content-Encoding. Offloading compression entirely to Nginx can be considered later after checking the real proxy-header inheritance. This change introduces no global compression behavior.

After reviewing the exact diff, the operator can validate with `sudo nginx -t` and reload Nginx only if validation succeeds. This task did neither. Verify through the actual public hostname:

```bash
curl -sS -H 'Accept-Encoding: gzip' -D - -o /dev/null 'https://nonamepickup.servehalflife.com/api/analytics?limit=5'
curl -sS -H 'Accept-Encoding: gzip' -D - -o /dev/null 'https://nonamepickup.servehalflife.com/api/stats/defense-ratings'
curl -sS -H 'Accept-Encoding: identity' -D - -o /dev/null 'https://nonamepickup.servehalflife.com/api/analytics?limit=5'
```

Expect Content-Encoding: gzip when negotiated, Vary: Accept-Encoding, the normal JSON content type, cache diagnostic headers and no Content-Encoding for identity. A cold 503 should be retried after its Retry-After interval. Local application-level negotiation is verified; production Nginx-level behavior remains unverified until the operator applies and checks the external configuration.

## Deployment procedure — operator only

1. Review the feature commit and known baseline failures; record the currently deployed Git SHA, `pm2 describe tfcapi`, Node version and API environment. Confirm the bot process is separate. Do not print secrets or modify the bot.
2. During a quiet pickup period, confirm free RAM/headroom, SQLite WAL health and the exact API database path. With approximately 907 MiB previously available, budget the additional child process and measure the real host rather than assuming the local envelope transfers unchanged. No migration, backfill, index or DB modification is required.
3. Fetch/review `origin/codex/api-performance` using the site's existing release workflow. Install only required existing locked API dependencies with the operator's normal Node 20 tooling; no dependency versions changed here. Verify the better-sqlite3 native addon loads on that runtime.
4. Restart/reload **only `tfcapi`**, once, using the established release procedure. Do not restart the Discord bot. Avoid overlapping old/new API instances or PM2 cluster mode: the scheduler is per API process. The supported VPS layout is one `tfcapi` instance. A rolling reload with two API processes can temporarily double refresh concurrency and should be avoided on the single-core host.
5. Warm analytics once with a normal local request. Allow the bounded cold response and wait its Retry-After before checking again. Then warm defense once. Initial successful cold loads are sequential without the routine cooldown; failures and later refreshes still obey it. Avoid refresh loops or parallel load testing. Confirm HIT/STALE/BACKOFF diagnostics, low-priority child scheduling (`ps -o pid,ppid,ni,rss,cmd --ppid <api-pid>`) and no overlapping report children.
6. While a requested changed-data refresh runs, make a small number of lightweight `/api/queue` requests and observe API/bot latency, CPU, RSS and WAL growth. Confirm matchmaking with the operator's normal monitoring. Check one normal completed import causes eventual refreshed statistics. If headroom or bot responsiveness deteriorates, roll back rather than adding workers or repeated retries. Local Windows results do not establish live bot safety.
7. Apply the reviewed Nginx-only gzip proposal separately if needed, validate `nginx -t`, reload Nginx and perform the negotiated header checks above. This task does not authorize executing those production actions now.

## Rollback — operator only

1. Restore the recorded previous API/static release SHA using the established release mechanism, without touching the database. Restart only the single `tfcapi` process. Verify all report children from the stopped API exited before warming anything. Never kill/restart bot processes.
2. If Nginx was changed, restore only the edited gzip lines or prior config backup, run `nginx -t` and reload Nginx after validation. Preserve relay and unrelated proxy configuration.
3. Check API payloads and bot responsiveness. Caches are disposable memory/disk snapshots; old releases ignore the API cache files. There is no schema migration, database restore, formula change or statistical backfill to undo.

## Decisions and limits

Cold-start follow-up: production feedback exposed the unconditional cooldown plus 60-second browser retry delaying initial reports by a minute or more. First successful cold loads now run sequentially with no intentional cooldown gap, and expected warming responses request a five-second retry without producing error-log stacks. Routine refreshes, actual failures and retries retain their cooldown/backoff, low priority and single active child. A local read-only two-report startup check using the default production scheduler completed defense at 2.03 seconds and analytics at 5.67 seconds total, with maximum active children 1 and event-loop maximum 33.10 ms. This follow-up measurement was not CPU-affinity pinned; it verifies removal of the artificial minute-long gap, not a new production timing guarantee. Three added regressions cover sequential cold boot, retained failure cooldown and short warming retries. The first full-suite follow-up also hit an intermittent unrelated oversized-upload test failure; that test passed in isolation and the confirmation full suite returned to the same 15 known baseline failures (137/152 pass).

The autonomous request waived intermediate design/worktree/finish approval prompts. Work stayed on the current checkout with a separate feature branch; the cost is less filesystem isolation, mitigated by explicit file staging and preserving existing assets. Tests were confined to existing files. The same 15 baseline failures were documented instead of preventing an authorized feature-branch push; the cost is that a full-suite green release remains blocked on unrelated work. The branch is not merged or deployed. Conservative revision fallback can refresh on unrelated writes, bounded to demand and the configured interval. Defense's total native RSS is measured rather than falsely described as capped by V8. Production behavior and Nginx validation remain operator checks, with rollback above.
