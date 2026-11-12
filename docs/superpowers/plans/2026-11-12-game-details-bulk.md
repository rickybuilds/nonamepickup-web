# Bulk Game Details Import Plan

**Goal:** Provide a resumable desktop CLI for the full year/month archive tree, enriched from a read-only ELO snapshot.

**Architecture:** Reuse conversion with schema-aware optional telemetry. Worker processes perform expensive conversion; the parent is the only SQLite writer. Resume checks use original content hash, converter revision and per-round references. Append machine-readable progress/failures, keep originals intact, and support bounded concurrency, match selection and status-only inspection.

**Constraints:** Current main checkout; no tests created/modified/run per AGENTS.md. Do not automatically start all 1,560 archives during development. Validate a small real selection including HDPVET and an older July recording. Never overwrite or modify ELO/source archives. No server replacement from a running transfer.

- [x] Split preparation from persistence, retain single-round CLI compatibility, and support recording schemas 2–7 with explicit missing fields. Recover old-format deaths from raw death events, with guarded analytics weapon alignment.
- [x] Add a worker-backed batch CLI, parent-only writes, deterministic discovery/deduplication, resume/status/filter/limit options and durable result/failure reporting. Default four workers; return failures clearly and allow retry by rerunning.
- [x] Manually convert a small real set, inspect packages/SQLite and verify resumed runs skip existing revisions. Check syntax and obtain code review without tests.
- [x] Document desktop command, status, safe interruption/resume and server transfer/restart; commit/push main.

**Review focus:** Old schemas cannot manufacture inventory/scene events; worker shutdown must not orphan recordings or tar processes; failures do not stop unrelated rounds or count as successful imports; existing pilot/API contract stays compatible; report file cannot overwrite a database/archive.

## Execution evidence

Actual schema-7 HDPVET rounds imported with two workers in about 31 seconds, aligning 229/229 and 195/195 enemy-kill weapons. Actual July schema-4 ZY9NGT rounds imported, aligning 257/257 and 254/258; missing inventory fields explicitly listed. Repeated commands skipped all four completed round revisions without decompressing them. SQLite quick-check returned ok and foreign-key inspection returned no issues. Syntax and diff checks passed; no tests created, modified or run.

Manual Ctrl+C while ZY9NGT round 2 was active requested stop, allowed the round to finish importing, then printed stopped summary with zero failed/unprocessed rounds. Review caught SIGINT propagation to tar; fixed with detached extractor process groups and tracked cleanup. Worker lane completion uses exit plus explicit spawn-error resolution; close-only resolution had omitted the final summary on IPC-only fork workers. Fresh review after fixes reported no blockers. Full collection was not started automatically.
