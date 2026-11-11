# API Performance Implementation Plan

**Goal:** Eliminate routine expiration stalls while preserving statistics and protecting the shared single-core bot host.

**Architecture:** Extract the existing synchronous analytics builder, optimize measured allocations/joins, and run expensive refreshes in one low-priority, read-only child process per API database. Serve successful serialized responses while refreshing. Detect completed imports using cheap metadata checks, with an on-demand low-frequency fallback for other historical edits. Keep legacy response fields and all formulas.

**Constraints:** No production changes, bot changes, ELO changes, schema/index changes, or new test files. The master directive explicitly authorizes existing-test updates, local tests, commits, and push. Reuse the current checkout on `codex/api-performance`, preserving unrelated untracked overview assets. Execute autonomously as requested; design/plan approval prompts are waived by that instruction.

## Tasks

- [x] Baseline: measure read-only local analytics limits 5/10, cache hit, defense, CPU/RSS/event-loop delay; collect EXPLAIN plans and complete JSON snapshots.
- [x] Calculations: extract `buildAnalytics(db, limit, options)` into `api/src/lib/analytics.js`; avoid allocating a full copied row for every rejected leaderboard candidate; narrow materialized weapon identity CTEs based on query plans. Compare complete representative snapshots and exercise every supported limit projection. Do not add indexes.
- [x] Refresh: add `api/src/lib/reportCache.js` and `api/src/workers/reportRefresh.js`. Share one active child across report kinds; cap retained variants at 10 analytics plus defense; restrict child to read-only/query-only SQLite, bounded page cache, low process priority and heap. Apply timeout, global cooldown, exponential retry backoff; retain previous success. Cold requests await the same refresh, with a bounded HTTP wait. Request-driven only: no background loop. Diagnostics include status, age, revision and last failure. Cache lifetime is per database, not module global payloads.
- [x] Defense: move rebuild off the main event loop using the shared refresh service; offer opt-in selected map/class observations without changing default responses or integrity checks. Cache the full result, avoiding repeated diagnostic scans across projections. Enable scoped JSON gzip and document Nginx configuration.
- [x] Verification: extend existing defense test file with deterministic cache lifecycle/failure/concurrency/timeout/limit cases and real child integration. Run authorized relevant suites, before/after benchmark, full JSON comparison, negotiated compression checks. Document limitations of Windows/Node 24 versus single-core Ubuntu/Node 20.
- [x] Final: review diff, document measured results and exact deployment/rollback instructions, commit scoped files, push feature branch, report hash and push result. Initial implementation pushed as `1c7dee3`.

## Review focus

Late child exit after timeout must not start overlapping work. Failed refreshes must preserve stale data. Limit changes must preserve fixed-length lists and all ranking ties. Import markers must not trigger expensive rebuilds continuously. Cold start and process restart must remain recoverable without synchronous fallback. Compression must leave unrelated routes and SSE alone.

## Decisions and progress

- Ruling: Use the current checkout and a new feature branch; no worktree or intermediate approval is needed under the explicit autonomous directive.
- Ruling: Preserve the repository ban on new test files; put requested regression cases in an existing test file.
- Baseline harness uses Node 24's built-in SQLite because the local better-sqlite3 native binding is absent. Production keeps better-sqlite3; runtime differences will be reported.
- The local native binding was subsequently rebuilt; final baseline and optimized figures both use better-sqlite3 on one logical CPU. Complete JSON matches at limits 5/10 and defense; all ten projections covered by regression tests. 36 relevant tests pass; full suite 134/149, with the same 15 failures reproduced on baseline source (123/138).
- Ruling: Document the unchanged full-suite failures and continue with the explicitly authorized feature-branch commit/push, without merging or deploying. Otherwise unrelated replay/model-asset/ELO test failures would expand the requested optimization scope. Cost: a full-suite green release still needs that unrelated work.
- Independent review fixes: revision errors preserve stale data/backoff; unavailable MVP retries do not change semantic revision markers. Both were verified RED-to-GREEN. Added bounded browser warming retries for cold startup; unrelated request behavior is unchanged.
- Full implementation report and deployment/rollback: `docs/api-performance.md`. Final commit/push confirmation comes from Git command output and the user-facing completion report.
- Startup follow-up: production feedback confirmed the global cooldown and long browser retry were inappropriate for initial cold loads. Successful initial loads now run sequentially without the routine gap; work after failures still waits. Warming responses retry after five seconds and do not log expected waits as errors. 39 relevant tests pass; confirmed full suite 137/152 with the original 15 failures (one unrelated oversized-upload test was intermittent on the initial run). Local two-report cold boot finished in 5.67 seconds total with one active child maximum. Focused independent review found no actionable issues. No production restart or deployment was executed by the agent.
