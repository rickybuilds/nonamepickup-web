# NoName HLTV Investigation Console — Final Technical Audit

Audit date: 2026-11-18  
Scope: read-only review of `C:\Projects\nonamepickup-web`, `C:\Projects\tfcbot`, and the available Ghosty upstream checkouts.  
Execution limits: no application code, tests, production database, services, deployment, credentials, or production evidence were modified or accessed.

Evidence labels used below:

- **Confirmed** — directly established from current source, schema, local artifacts, or existing test definitions.
- **Unverified** — the code path exists, but the required real-demo or production evidence is absent.
- **Hypothesis** — plausible explanation that requires production records or a real run; not treated as fact.

## A. Executive Summary

The console is not production-verified complete. The reviewer UI, authenticated API, queue, content-addressed statistics store, and upstream adapter are substantially implemented. The scanner pipeline is also genuinely wired to the pinned upstream `runAnalysis()` implementation, including both wall-track and snap code. However, there is no local authorized complete `.dem` plus private map/model fixture and no production registry snapshot in the repositories, so the reported production result of zero findings cannot be distinguished here between a successful empty scan, an old firing-only payload, an unprocessed queue, or a failure whose UI is being summarized as zero.

The five most important remaining issues are:

1. **P0 — Real-demo scanner execution is unverified.** The existing test definitions prove only a terminal empty synthetic scan and optional transport compatibility. They do not prove positive wall-track or snap findings on an actual HLTV demo.
2. **P0 — Manual failed-run cleanup protection has a gap.** `queueRun()` creates an upstream run and hold, but not an `hltv_statistics_jobs` row. The cleanup blocker only checks failed upstream runs through that jobs table. If a reviewer releases the failed run’s hold, manual-retention mode can make the failed recording eligible despite an attempted failed scan (`api/src/hltv/upstream.js:51-63`, `api/src/hltv/registry.js:168-192`).
3. **P1 — Failure diagnostics are lossy.** Missing parser logs, parser/decode failures, invalid demo state, memory-headroom failures, and many worker exceptions collapse to `upstream_failed`; detailed stderr is logged but not persisted. `last_error` is explicitly hidden from HTTP responses (`api/src/hltv/upstream.js:179-186`, `api/src/hltv/router.js:7-11,113-118`).
4. **P1 — Historical raw parser logs are not retained by the registry.** Runs hash and reference the external parser-log store, but do not preserve an immutable raw-log copy. Replacing the external log directory and its manifest/result can change what a later analysis can accept (`api/src/hltv/upstream_bridge.py:77-113`, `docs/HLTV-REVIEW.md:29`, `docs/HLTV-UPSTREAM.md:103`).
5. **P1 — “Round unpaired” is a metadata presentation, not a failure diagnosis.** The bot intentionally stores `round_id: null`; the UI prints `Round unpaired` whenever no successful statistics observation supplies `log_round`. It does not identify whether the cause was missing logs, pairing rejection, parser failure, assets, or resources (`C:\Projects\tfcbot\services\hltvHandoff.js:26-37`, `api/src/hltv/review.html:110-114`).

Overall readiness: **implemented but unverified for real-demo scanner behavior; not production-verified for evidence retention and failure diagnosis**.

## B. Feature Completion Matrix

| Feature | Status | Evidence and limitation |
|---|---|---|
| HLTV source download and private handoff | Implemented but unverified | Existing SFTP downloader writes the same downloaded bytes to a private handoff, validates size, and publishes `ready.json` after ZIP completion (`C:\Projects\tfcbot\services\hltvFetch.js:42-150`, `C:\Projects\tfcbot\services\hltvHandoff.js:4-46`). Actual production handoff, permissions, and PM2 checkout are not locally verified. |
| Demo finalization guard | Implemented but unverified | Optional header/directory polling and post-download verification are implemented (`C:\Projects\tfcbot\services\hltvFinalization.js:14-80`). The feature is default-off in the example configuration (`C:\Projects\tfcbot\services\hltvFinalization.js:4-12`). |
| Registry ingestion/deduplication | Verified working locally | SQLite schema, idempotent ingestion, checksum verification, duplicate-copy tracking, and indexes are implemented (`api/src/hltv/schema.sql:43-69`; `api/src/hltv/registry.js:1-60`). No production DB was inspected. |
| Recording registry, search, review status, priority, pagination | Partially implemented | API filtering and pagination exist (`api/src/hltv/registry.js:61-82`); UI uses fixed ten-row pages and cannot filter `not_analyzed`, `unsupported`, or `missing_assets` directly (`api/src/hltv/review.html:93-115,248`). |
| Review Queue global-disable regression | Implemented; locally covered; production unverified | Navigation uses request epochs and per-control pending state (`api/src/hltv/review.html:64-71,139-147`). The browser/navigation test definitions cover queue navigation, rapid responses, failures, and malformed responses (`api/test/hltv-review-navigation.test.js:21-58`). Tests were not run per task instructions. |
| Authenticated reviewer access | Implemented but unverified in deployment | Bearer auth, account login, first-login password change, session expiry, throttling, and owner controls exist (`api/src/hltv/router.js:13-35`, `api/src/hltv/accounts.js`, `api/src/hltv/auth.js`). HTTPS, proxy routing, effective environment, and account revocation were not production-checked. |
| Verified demo download | Implemented but unverified | The route verifies checksum, opens with no-follow, adds an audit event and temporary hold, and releases on close/finish (`api/src/hltv/router.js:83-111`). The UI downloads the file for local Ghosty viewing; no hosted playback is implemented (`api/src/hltv/review.html:260`). |
| Review assignment/claim | Partially implemented | Claiming is supported and protected against a second claimant (`api/src/hltv/registry.js:135-140`). There is no explicit reassignment, unclaim, or owner transfer action in the API/UI. |
| Reviewer notes/bookmarks | Verified working locally | Notes, optional ticks, audit attribution, and UI rendering exist (`api/src/hltv/registry.js:149-151`, `api/src/hltv/review.html:46-47,221`). Real reviewer workflow is unverified. |
| Case actions and audit history | Implemented but unverified | Flag/report/hold/evidence/status/retention actions and audit rows exist (`api/src/hltv/registry.js:101-166`, `api/src/hltv/schema.sql:70-86`). The UI relies on generic errors for many failures (`api/src/hltv/review.html:59-71`). |
| Upstream decode/log pairing/concussion estimate | Implemented but unverified | The worker calls the untouched upstream decoder, log matcher, and concussion adapter under bounded subprocesses (`api/src/hltv/upstream_bridge.py:31-113`, `api/src/hltv/upstream.js:125-160`). No real production match was run in this audit. |
| Wall-track scanner | Implemented but unverified | The adapter loads the original viewer and calls `runAnalysis()`; the pinned scanner contains the wall-track scan and thresholds (`api/src/hltv/upstream_statistics.js:23-34,62-89`, Ghosty `web/viewer.js:2300-2360`). No positive real-demo result is proven. |
| Snap scanner | Implemented but unverified | The same `runAnalysis()` contains the snap scan and thresholds (`Ghosty web/viewer.js:2362-2394`). No positive real-demo result is proven. |
| Scanner state/result distinction | Partially implemented | Stored scanner payloads can distinguish completed-empty, queued, running, failed, unsupported, and missing assets (`api/src/hltv/investigation.js:8-30`). Existing older firing-only payloads have no scanner object and are not proof of execution (`api/src/hltv/investigation.js:32-34`). |
| Content-addressed statistics persistence | Verified working locally | Payload SHA-256, input key, configuration hash, demo/log/upstream provenance, immutable per-run result identity, and gzip storage are implemented (`api/src/hltv/playerStatistics.js:8-47`, `api/src/hltv/schema.sql:23-40`). Real payload creation remains unverified. |
| Player filtering/timeline/selected-event inspector | Implemented but unverified | API filtering, stable event IDs, timeline conversion, and inspector rendering exist (`api/src/hltv/investigation.js:32-89`, `api/src/hltv/review.html:282-320`). Findings with null/invalid player identity are deliberately excluded from player timelines. |
| Storage cleanup and retention holds | Partially implemented | Checksums, holds, cases, deletion intents, identity checks, and evidence retention are strong (`api/src/hltv/registry.js:168-252`). Manual failed-run cleanup protection is incomplete as described in Executive Summary. |
| Analysis-job monitoring/recovery | Partially implemented | Queue listing, heartbeat recovery, one-job worker execution, scratch cleanup, and targeted runs exist (`api/src/hltv/router.js:65-67`, `api/src/hltv/upstream.js:95-113,187-192`). Detailed failure diagnostics and health checks are not exposed; the UI itself says health checks are unavailable (`api/src/hltv/review.html:242-243`). |
| Production deployment | Not verified | Required Linux/systemd, private assets, parser logs, upstream release, shared DB/storage, proxy route, flags, and service permissions are documented but not checked against the live host (`docs/HLTV-UPSTREAM.md:20-103`, `deploy/nginx/hltv-review.conf:1-12`). |

## C. Wall-Track Root-Cause Investigation

### Confirmed execution trace

1. **Retrieval and provenance.** TFCbot selects recent `.dem` files by map and size, downloads each once, and publishes a private manifest with `round_id: null` (`C:\Projects\tfcbot\services\hltvFetch.js:69-145`, `C:\Projects\tfcbot\services\hltvHandoff.js:26-42`). This is why an unpaired round label exists before analysis; it is not itself a parser result.
2. **Registry and verified bytes.** The worker ingests `ready.json`; the registry stores demo size/SHA-256 and later requires `Storage.verify()` before analysis (`api/src/hltv/worker.js:3-29`, `api/src/hltv/storage.js:32-49`).
3. **Required parser inputs.** `runPending()` requires a valid active upstream release, an available checksum-matching demo, and a parser-log manifest/result under `HLTV_PARSER_LOG_ROOT` (`api/src/hltv/upstream.js:120-140`, `api/src/hltv/upstream.js:83-93`). The Python bridge requires a complete HLTV demo, matching map/game, valid manifest, matching `matchId`/map, source hash, and exactly one accepted log (`api/src/hltv/upstream_bridge.py:57-113`).
4. **Asset resolution.** When statistics are enabled, the worker converts required maps and player models into a private asset bundle (`api/src/hltv/upstream.js:149-158`, `api/src/hltv/upstream_assets.py:19-80`). The JS adapter then loads every map, derives server player models, and refuses to proceed without valid map/model assets (`api/src/hltv/upstream_statistics.js:62-79`).
5. **Ghosty scanner invocation.** `loadViewer()` evaluates the untouched upstream `conc.js`, `conc_aim.js`, `blood_hits.js`, `studio.js`, and `viewer.js`, verifies that `runAnalysis` exists, and calls it exactly once (`api/src/hltv/upstream_statistics.js:23-34,80-89`). This is the production-compatible worker call; it is not a local reimplementation of the scanner.
6. **Actual wall-track algorithm.** The pinned active release is `98c841d0592dae4eb7cb2d20482d1ffeedd5ea8d` (`C:\Projects\goldsrc-hltv-tools-adapter-validation\active.json`). The scanner samples roughly ten times per second, requires a map, tracks an enemy behind line of sight, and records a track only if duration is at least `0.45s`, target movement is at least `80`, and angular sweep is at least `max(2.5°, 3 × tolerance)` (`web/viewer.js:2300-2324`). It ignores visible targets and targets outside 64–3500 game units (`web/viewer.js:2326-2359`).
7. **Returned findings.** The adapter maps upstream `track` records to demo-relative seconds, player/target identities at the event time, movement, sweep, firing, kill, and score (`api/src/hltv/upstream_statistics.js:90-108`). It rejects incomplete/timeout/oversized scanner output (`api/src/hltv/upstream_statistics.js:80-94`).
8. **Persistence.** The scanner is embedded in the firing-statistics payload under `scanner.findings`, with scanner version, time coordinate, source, sample rate, and lag-compensation setting (`api/src/hltv/upstream_statistics.js:151-165`). The payload validator permits a zero-length findings array and stores the gzip payload by SHA-256 (`api/src/hltv/playerStatistics.js:23-45`).
9. **API and UI.** `investigation.events()` counts `track` findings as `wall_track`; the API exposes overall state/count and per-player counts, and the timeline filters by player/category/time (`api/src/hltv/investigation.js:8-30,32-83`). The UI renders violet wall-track intervals and an inspector with reconstructed geometry/limitations (`api/src/hltv/review.html:272-319`).

### What is proven, and what is not

- **Both scanners truly execute in the worker when the required flags and inputs are valid:** confirmed by the call chain and the upstream `runAnalysis()` source.
- **The worker calls the correct upstream function:** confirmed; it calls the original exported `runAnalysis`, not a stub or an internal replacement.
- **Required assets are available in this checkout:** not confirmed. The web checkout has converted/public TFC assets, but no local `.bsp` files were found under `assets/tfc`; the documented private asset root is a separate deployment dependency. The private production asset root was not accessed.
- **Existing old analyzed demos contain scanner results:** not guaranteed. Older firing-only payloads do not contain `scanner`; only a payload with `scanner.version === "upstream-runAnalysis"` proves a scanner result was persisted (`api/src/hltv/investigation.js:11,21-23`).
- **A successful zero can be distinguished from never-run:** yes in the current API if the payload is available: `completed` plus `count: 0` and scanner provenance is distinct from `not_analyzed`, `unsupported`, or `statistics_unavailable` (`api/src/hltv/investigation.js:14-30,32-34`). The UI also displays “Completed — none found.”
- **Threshold/filter loss is possible:** yes, but not demonstrated as the production cause. The upstream thresholds are intentionally strict. Player identity is resolved only when exactly one `meta.players` row covers the event time; otherwise the stored finding has null identity and is not exposed in player timelines (`api/src/hltv/upstream_statistics.js:90-105`, `api/src/hltv/investigation.js:38-44`). A valid finding can therefore exist in the aggregate scanner count while being absent from a selected player’s timeline.
- **Failures are swallowed as empty arrays:** scanner exceptions do not become empty arrays; they fail the run and are stored as an error code. However, many non-scanner failures are reduced to generic `upstream_failed`, and old payloads are represented as unavailable/unsupported rather than as an explicit “scanner never ran” record (`api/src/hltv/upstream.js:179-186`, `api/src/hltv/investigation.js:32-34`).

### Required proof still missing

The minimum evidence is one authorized complete HLTV demo, its accepted parser log, the exact private map/model asset tree, the active upstream SHA, and the resulting stored payload. The payload must show `scanner.version`, `scanner.settings`, `scanner.findings` (including a real zero or positive result), `demo_sha256`, `log_sha256`, `log_round`, `config_hash`, and the API/UI response for both aggregate and player-filtered views. No such artifact exists locally.

## D. Snap Root-Cause Investigation

The snap pipeline shares steps 1–5 and 7–9 above. The actual pinned scanner requires:

- a player with at least one recorded firing event;
- consecutive present, alive, non-observer snapshots with `0 < dt <= 0.1s`;
- angular speed of at least `1500°/s` and turn magnitude of at least `12°`;
- a shot in the interval from `t - 0.02s` through `t + 0.15s`;
- an enemy alive and at least 100 units away; and
- final aim within `max(0.8°, atan2(5, distance))` of the reconstructed head.

These conditions are directly visible in Ghosty’s `snapScan()` (`web/viewer.js:2362-2393`). The adapter records snap time, a 0.2-second pre-shot window, turn, speed, sample interval, firing delay, and a fixed heuristic score (`api/src/hltv/upstream_statistics.js:95-107`). The UI labels this as a “Pre-shot snap lead,” not a verdict (`api/src/hltv/review.html:303-318`).

Confirmed conclusions:

- The snap scanner is part of the same real `runAnalysis()` call and is not disabled by a separate feature switch.
- `HLTV_UPSTREAM_ENABLED=true` and `HLTV_STATISTICS_ENABLED=true` are required for the statistics/scanner stage (`api/src/hltv/upstream.js:5-11`, `api/src/hltv/router.js:70-75`).
- A zero snap count can be a valid completed result, but it can also reflect no eligible firing events, missing snapshot cadence, missing identity mapping, an old firing-only payload, or a failed/never-run job. Only the stored scanner provenance distinguishes these cases.
- Snap visibility is intentionally `not_evaluated` in the stored event; the scanner’s head alignment and shot timing are not a wall-visibility proof (`api/src/hltv/upstream_statistics.js:106`, `api/src/hltv/review.html:316`).

No current source evidence identifies a snap-specific defect. Positive real-demo validation remains outstanding.

## E. Failed Demo Investigation

### What “Round unpaired” proves

It proves only that the registry row has `round_id` null and/or the UI has no successful statistics observation with `log_round`. The bot explicitly records `round_id: null` because it does not infer round order from filenames (`C:\Projects\tfcbot\services\hltvHandoff.js:26-37`; `docs/HLTV-REVIEW.md:14`). The UI displays the fallback string at `api/src/hltv/review.html:110-114`.

### What cannot be established locally

The production registry records for `raiden9` / `PC3S6V` and `nexus_b4` / `EFWN6W` are not present in either checkout. Therefore the root cause of those three failures cannot be established from the red badge or from this repository. Possible codes include `no_verified_log_pairing`, `ambiguous_log_pairing`, missing parser files, unfinalized/invalid demo, missing map/model assets, upstream failure, resource limit, or a generic exception. The code does not justify choosing one without the run row and worker log.

### Safe production diagnostics

Run from the actual TFCbot checkout after confirming the PM2 script/cwd. These commands are read-only with respect to the registry and source server; they do not download full demos or stop recording:

```sh
cd /var/www/tfcbot
node scripts/checkHltvSources.js --match PC3S6V
node scripts/checkHltvSources.js --match EFWN6W
node scripts/checkHltvSources.js --all-failed
```

The script reads the local demo header and performs only small remote header/directory range reads (`C:\Projects\tfcbot\scripts\checkHltvSources.js:1-54`). It reports local/remote finalization, map, size, directory offset, source filename, and recovery candidacy.

Use a read-only SQLite client against the production registry. Substitute the actual configured paths; redact filenames, hashes, and result details before sharing them:

```sh
sqlite3 -readonly /srv/noname-hltv/registry.db <<'SQL'
.headers on
.mode json
SELECT d.id,d.match_id,d.server,d.map,d.filename,d.file_status,d.analysis_status,
       d.review_status,d.round_id,d.last_error,d.sha256,d.recorded_at,
       u.id AS run_id,u.status,u.error_code,u.upstream_sha,
       u.created_at,u.started_at,u.finished_at,u.result_json
FROM hltv_demos d
LEFT JOIN hltv_upstream_runs u ON u.id=(
  SELECT id FROM hltv_upstream_runs WHERE demo_id=d.id
  ORDER BY created_at DESC,id DESC LIMIT 1
)
WHERE (d.match_id='PC3S6V' AND d.server='raiden9')
   OR (d.match_id='EFWN6W' AND d.server='nexus_b4')
ORDER BY d.match_id,d.id;

SELECT demo_id,run_id,skip_reason,created_at
FROM hltv_statistics_jobs
WHERE demo_id IN (SELECT id FROM hltv_demos WHERE match_id IN ('PC3S6V','EFWN6W'));

SELECT demo_id,actor,action,details,created_at
FROM hltv_audit
WHERE demo_id IN (SELECT id FROM hltv_demos WHERE match_id IN ('PC3S6V','EFWN6W'))
ORDER BY created_at,id;

SELECT match_id,server,filename,storage_key,file_status,last_error
FROM hltv_demos
WHERE match_id IN ('PC3S6V','EFWN6W');
SQL
```

Interpretation order: inspect `u.error_code` and `u.result_json` first; then compare the worker log at `/var/log/noname-hltv-worker.log` or the configured PM2/service log; then run the read-only source finalization check. Do not infer a pairing failure from a null `round_id` alone.

### Error-reporting limitation

`runPending()` stores a small set of known error codes, but `insufficient_memory_headroom`, invalid parser-log files, unfinalized demos, decode failures, and many filesystem errors fall through to `upstream_failed` (`api/src/hltv/upstream.js:120-145,179-186`). The worker logs only the error message; the API returns the code/result but not `last_error` (`api/src/hltv/router.js:7-11,97-99,113-118`). This makes the failed-demo investigation dependent on private logs and is a P1 completion issue.

## F. UI/UX Gaps

### Functional gaps

1. **Scanner status is split across several concepts.** The registry table’s Analysis filter uses upstream run status, the detail page shows `analysis_status` (which remains `unsupported` for anomaly detection), and the investigation panel shows scanner state. This is technically explainable but easy to misread (`api/src/hltv/review.html:93-114,197-200`, `api/src/hltv/investigation.js:14-30`).
2. **Registry filters omit important scanner states.** There are no filters for not analyzed, unsupported, missing assets, or completed-empty; only complete/queued/processing/failed are injected (`api/src/hltv/review.html:248`).
3. **Assignment is claim-only.** There is no reassignment/unclaim action, and no reviewer identity appears in the main registry row beyond the detail audit/assignment data (`api/src/hltv/registry.js:135-140`).
4. **Failure detail is not operationally rich.** Generic API errors and absent health checks make a reviewer dependent on server logs for diagnosis (`api/src/hltv/review.html:59-71,242-243`).
5. **Player visibility depends on identity mapping.** Scanner findings do not create a player option unless they have a valid Steam ID; null-identity findings remain aggregate-only (`api/src/hltv/investigation.js:12-13,38-44`).

### Cosmetic/polish priorities

- The registry is visually polished but sparse for an investigation console: a fixed ten-row page, a large four-card summary strip, and broad padding leave unused space on desktop. Consider an operator-selectable 25/50/100 page size and tighter row density.
- The filter toolbar is dynamically mutated after page construction (`api/src/hltv/review.html:248`), so priority/analysis fields and the submit button can wrap into uneven widths at intermediate viewport sizes. Test at 760–1100px, not only desktop/mobile endpoints.
- The evidence timeline has a 390px scroll region and a three-lane marker collision strategy; dense events beyond three lanes are visually overlaid without an event-density cue (`api/src/hltv/review.html:300-305`).
- The selected-event inspector is useful but provenance is below a collapsible disclosure. The demo SHA, upstream SHA, configuration hash, source, quality, and limitations should remain visible as a compact “evidence identity” block for quicker review (`api/src/hltv/review.html:311-319`).
- The UI should expose reviewer identity/assignee beside the match heading and in registry rows, not only in audit history.
- Loading and stale-data states are mostly text/generic message states. There is no explicit scanner polling cadence or “last refreshed” timestamp; the operator must click Refresh after queueing (`api/src/hltv/review.html:218`, `api/src/hltv/review.html:144`).
- The layout is responsive at broad breakpoints, but the timeline filter has many controls and can become a tall, hard-to-scan stack on narrow screens (`api/src/hltv/review.html:20-21,256-258`).

The UI does not require a complete redesign. The architecture is suitable for a density, status-language, assignment, and error-state pass.

## G. Security, Evidence and Retention Risks

| Severity | Risk | Impact and evidence |
|---|---|---|
| Critical | No immutable/offsite raw-log archive | Historical raw logs live in an external parser directory. The registry stores source hashes but not the raw bytes; a future operator replacement can alter reanalysis inputs. This is explicitly deferred (`docs/HLTV-REVIEW.md:29`, `docs/HLTV-UPSTREAM.md:103`). |
| Critical | Manual failed-run cleanup gap | A reviewer-queued run creates a hold but no `hltv_statistics_jobs` row. After releasing the hold, `manualRoutine` can allow expiry because cleanup’s failed-run blocker joins through `hltv_statistics_jobs` (`api/src/hltv/upstream.js:51-63`; `api/src/hltv/registry.js:168-192`). |
| High | Source attribution is partly operational, not immutable | Recording time is remote modification time; round IDs are intentionally null until pairing; parser source files remain externally replaceable (`C:\Projects\tfcbot\services\hltvFetch.js:69-84`, `docs/HLTV-REVIEW.md:14`). |
| High | Database/filesystem backup coupling | Documentation correctly requires coordinated DB plus storage backup, but no WORM/offsite implementation exists (`docs/HLTV-REVIEW.md:29,85-103`). A DB-only or storage-only restore can misrepresent evidence availability. |
| Medium | Generic failure persistence | Loss of specific errors impedes incident response and makes a failed result look less actionable than it is (`api/src/hltv/upstream.js:179-186`). |
| Medium | Release/config drift is recorded only for successful statistics payloads | `config_hash` and upstream SHA are strong for stored results, but failed runs do not preserve a complete configuration snapshot; environment changes can make retry comparisons harder (`api/src/hltv/playerStatistics.js:28-45`). |
| Low | At-least-once alert delivery | The docs acknowledge duplicate alert delivery after send-before-ack crash. This is not evidence loss, but operators should use alert IDs (`docs/HLTV-REVIEW.md:45`). |

Positive controls confirmed: private storage outside public roots, path traversal/symlink checks, checksum verification, no raw paths in HTTP responses, authenticated downloads, evidence holds, audit records, content-addressed payloads, and no public Ghosty viewer route (`api/src/hltv/storage.js:7-30`, `api/src/hltv/router.js:7-16,83-111`, `docs/HLTV-REVIEW.md:29-59`).

## H. Test Coverage Gaps

The repository contains 48 tests in `api/test/hltv.test.js`, 4 navigation tests in `api/test/hltv-review-navigation.test.js`, and 1 browser test in `api/test/hltv-review-browser.test.js` by static inventory. These were not executed for this audit because repository instructions prohibit running tests unless explicitly requested.

### Existing coverage

- Unit/contract coverage: configuration defaults, scanner API presence, unsupported revisions, missing map assets, payload validation, persistence, history, timeline conversion, queue idempotency, resource guards, cleanup, auth, accounts, and path safety (`api/test/hltv.test.js:9-719`).
- Integration-style coverage: temporary SQLite/storage, API loopback, worker queue state, and optional upstream/asset transport (`api/test/hltv.test.js:52-102,560-719`).
- Browser interaction coverage: navigation lock regression, rapid switching, API failure, malformed responses, queue/detail navigation, scanner tabs, empty/queued/missing-asset states, selected events (`api/test/hltv-review-navigation.test.js:21-58`, `api/test/hltv-review-browser.test.js:10-78`).
- Real-demo validation: not present in the local environment. The real-asset test is conditional on `HLTV_TEST_UPSTREAM_ROOT`, `HLTV_TEST_PYTHON`, and `HLTV_TEST_ASSETS` and uses a synthetic transport fixture, not an authorized real `.dem` (`api/test/hltv.test.js:52-102`).
- Production verification: none in this audit. Existing docs explicitly leave Linux/systemd and real-match rollout outstanding (`docs/HLTV-INVESTIGATION-CONSOLE.md:19-21`, `docs/HLTV-UPSTREAM.md:103`).

### Minimum additional verification

No new test file is required for the audit deliverable. Before production sign-off, the implementation work should add or execute coverage for:

1. One authorized real HLTV fixture producing a scanner-complete empty payload.
2. One authorized real fixture or controlled upstream fixture that produces at least one real wall-track lead and one real snap lead, with aggregate count, player identity, timeline, and inspector parity.
3. A failed manual run followed by hold release, proving cleanup remains blocked until explicit disposition.
4. Parser-log missing, invalid manifest, unfinalized demo, decode failure, memory headroom, asset failure, and worker-timeout diagnostics, verifying stable persisted error codes and safe UI display.
5. Slot reuse/ambiguous identity behavior, proving findings are either clearly aggregate-only or surfaced with an explicit “identity unavailable” state.
6. Production-like Linux/systemd memory, CPU, timeout, private-network, asset-root, and scratch-cleanup validation.
7. Browser checks at desktop, tablet, and narrow mobile widths for filter alignment, timeline density, job refresh, assignment display, and failure states.

Synthetic fixtures must remain labeled as compatibility checks, not evidence of real-demo scanner behavior.

## I. Final Implementation Backlog

### P0 — Broken functionality or evidence safety

| Item | Affected files | Required change and acceptance criteria | Dependencies | Tests | Complexity |
|---|---|---|---|---|---|
| Close failed manual-run retention gap | `api/src/hltv/upstream.js`, `api/src/hltv/registry.js`, `api/src/hltv/schema.sql` | Make every scanner/upstream run participate in the same cleanup-blocking state, or make cleanup directly block on any failed/attempted run unless an explicit audited disposition exists. A manually queued failed run must remain ineligible after hold release. | Registry schema compatibility and retention policy decision | Regression for manual failed run, released hold, dry-run and actual deletion gate | Medium |
| Preserve immutable raw-log provenance | `api/src/hltv/upstream_bridge.py`, `api/src/hltv/upstream.js`, `api/src/hltv/schema.sql`, storage/backup docs | Persist immutable source-log manifest/hash and either immutable raw-log bytes or a WORM/offsite reference tied to the run. Reanalysis must identify source revision and refuse silent replacement. | Private storage capacity, backup/WORM policy | Replaced external log, rerun, restore, checksum mismatch | High |
| Obtain real scanner evidence | deployment/configuration and audit runbook; no code file alone | Run one authorized complete demo with private assets and logs; record exact run/payload/API/UI evidence. If zero, prove `completed` scanner state and settings. If positive, prove both categories through player filtering and timeline. | Production access, fixture approval, Linux worker | Real-demo integration and browser verification | Medium operational |

### P1 — Essential completion

| Item | Affected files | Required change and acceptance criteria | Dependencies | Tests | Complexity |
|---|---|---|---|---|---|
| Persist specific failure diagnostics | `api/src/hltv/upstream.js`, `api/src/hltv/schema.sql`, `api/src/hltv/router.js`, `api/src/hltv/review.html` | Normalize missing logs, invalid manifests, unfinalized demos, parser/decode errors, memory/storage limits, assets, and scanner failures into stable codes with bounded safe diagnostics. UI must show actionable category without private paths. | Decide public-safe diagnostic vocabulary | Error matrix plus API/UI assertions | Medium |
| Add explicit scanner provenance to registry rows | `api/src/hltv/registry.js`, `api/src/hltv/investigation.js`, `api/src/hltv/review.html` | Separate “not run,” “firing-only old result,” “scanner completed empty,” “scanner completed findings,” and “failed.” Add filters for missing assets/unsupported/completed-empty. | Status vocabulary decision | API state matrix and browser filter tests | Medium |
| Surface identity-unavailable findings | `api/src/hltv/upstream_statistics.js`, `api/src/hltv/investigation.js`, `api/src/hltv/review.html` | Preserve aggregate findings whose Steam identity is null and display them with explicit identity-unavailable context instead of silently excluding them from all player review. | Review policy for unidentified events | Slot reuse/invalid identity fixture | Medium |
| Improve assignment workflow | `api/src/hltv/registry.js`, `api/src/hltv/router.js`, `api/src/hltv/review.html` | Add owner-authorized reassignment/unclaim or document claim-only policy; show assignee in registry/detail. | Authorization policy | Concurrent claim/reassignment browser/API coverage | Small/medium |
| Add worker health and run polling | `api/src/hltv/router.js`, `api/src/hltv/review.html`, deployment docs | Expose last worker heartbeat/last successful pass and provide bounded refresh/polling after queueing. Keep no-store/auth behavior. | Operational endpoint policy | Queued/running/failed/complete browser flows | Medium |
| Validate production assets and active release | deployment only plus `docs/HLTV-UPSTREAM.md` | Confirm `/opt/noname-hltv-tools/active.json`, release SHA, private `HLTV_ASSETS_ROOT` map/model coverage, parser log root, systemd cgroup enforcement, and shared DB/storage permissions. | Production operator access | Read-only preflight commands and one targeted run | Medium operational |

### P2 — Visual polish and enhancements

| Item | Affected files | Required change and acceptance criteria | Dependencies | Tests | Complexity |
|---|---|---|---|---|---|
| Increase registry density and pagination choice | `api/src/hltv/review.html` | Add 25/50/100 page size, tighten desktop whitespace, preserve mobile table behavior. | None | Browser widths and pagination | Small |
| Align filters and expose status language | `api/src/hltv/review.html` | Stabilize toolbar grid at tablet widths; use consistent scanner/run terminology; show “last refreshed.” | Status vocabulary from P1 | Browser visual checks | Small |
| Improve timeline density/inspector hierarchy | `api/src/hltv/review.html` | Add event density/overflow indication, persistent evidence identity, and clearer selected-event hierarchy. | None | Browser event fixture | Small/medium |
| Show reviewer/assignee context | `api/src/hltv/review.html`, `api/src/hltv/registry.js` | Display current reviewer, assignee, and case state beside match identity and in queue rows. | Assignment policy | Browser/detail assertions | Small |

## J. Production Verification Checklist

1. Confirm the actual API/bot checkouts, PM2 script/cwd, service user, shared private storage root, registry DB, parser-log root, and asset root. Do not assume `/var/www/tfcbot` is the active checkout.
2. Confirm `HLTV_REGISTRY_ENABLED=true`, `HLTV_UPSTREAM_ENABLED=true`, and `HLTV_STATISTICS_ENABLED=true` in the effective API/worker environment; keep cleanup disabled/dry-run during verification.
3. Confirm the upstream release is clean, official, revision-pinned, and the active SHA is recorded. Confirm Linux `systemd-run` memory/CPU/runtime enforcement.
4. Confirm private asset manifests can resolve every map BSP and server player model required by the selected demo. Confirm assets are outside public roots and readable only by the worker service user.
5. Confirm parser-log manifest/result and raw logs exist for the selected match, source hashes agree, and exactly one log round is accepted by the upstream matcher.
6. Confirm the selected demo is finalized, available, checksum-stable, and the stored SHA matches the private file.
7. Queue exactly one explicit scanner run for a selected retained demo. Record run ID, demo SHA, log SHA/round, upstream SHA, config hash, settings, and worker log location.
8. Run the targeted worker once under the normal lock. Do not trigger a bulk reanalysis or production demo reanalysis beyond the explicitly approved verification recording.
9. Inspect the run status and error code. A successful empty result must show `scanner.version=upstream-runAnalysis`, `state=completed`, `count=0`, settings, and a retained content-addressed payload. A positive result must show both categories where present.
10. Verify API responses for investigation summary, aggregate count, player list, player timeline, category filters, stable event detail, and previous-result behavior.
11. Verify the UI’s Wall-Track, Snaps, Evidence Timeline, inspector, verified download, notes, audit, assignment, and refresh behavior. Verify no public static route exposes demos/assets.
12. Verify a failed run: error code is actionable, diagnostics are safe, the source/demo hold remains active, scratch is cleaned, and the original bytes remain available.
13. Verify retention: with cleanup disabled, preview shows the recording blocked. Do not release holds until evidence review is complete. Specifically test that failed manual runs remain blocked after any hold-release operation before enabling cleanup.
14. Verify backup/restore readiness for DB, raw demos, raw logs, manifests, holds, audit, and content-addressed payloads as one evidence set.
15. Record the verification outcome and exact revisions in the audit log/runbook. Do not call a zero result “clean”; call it “scanner completed with no candidate leads under recorded settings.”

## K. Codex Handoff

The next autonomous implementation execution should proceed in this order:

1. Reproduce the P0 retention gap with a local temporary registry and fix the cleanup eligibility model so every attempted upstream run is a first-class blocker until explicit audited disposition.
2. Design and implement immutable parser-log provenance/retention, including schema, storage, backup, and recovery behavior. Treat missing historical logs as a deployment blocker rather than silently reusing replacement files.
3. Normalize and persist bounded failure diagnostics, especially missing parser logs, invalid/unfinalized demos, resource headroom, asset failures, and scanner exceptions. Expose safe categories to the authenticated reviewer.
4. Make scanner status explicit in the registry/detail/UI: not run, old firing-only result, queued, running, completed empty, completed with leads, failed, unsupported, and missing assets. Add aggregate identity-unavailable visibility.
5. Add the minimum regression coverage for the retention gap and diagnostic matrix, without treating synthetic fixtures as real-demo proof.
6. Deploy only after the operator provisions the pinned upstream release, private assets, parser logs, Linux resource isolation, shared DB/storage, and effective flags. Run one targeted real-demo verification and capture its evidence.
7. Apply the P2 UI pass after functional verification: density, filter alignment, assignee identity, scanner status language, timeline overflow, and inspector hierarchy.

Until steps 1–6 are complete, the console should be described as **review infrastructure with an implemented but unverified real-demo scanner integration**, not as a production-verified HLTV detector.
