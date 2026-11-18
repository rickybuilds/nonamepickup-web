# HLTV Investigation Console Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the verified evidence-safety and diagnostics gaps, make scanner state/identity trustworthy in the existing console, add operational monitoring and assignment controls, and validate the result without touching production.

**Architecture:** Extend the existing SQLite registry additively. Each upstream run records disposition, bounded diagnostic metadata, and an immutable content-addressed parser-log snapshot; cleanup blocks undisposed attempted runs while allowing completed runs and explicit audited dispositions. Reuse the existing investigation/API/UI schemas and Ghosty `runAnalysis()` without changing upstream algorithms.

**Tech Stack:** Node.js, Express, better-sqlite3, Python bridge, inline HTML/CSS/JS, Node test runner.

**Spec:** `docs/HLTV-FINAL-AUDIT.md` and the user-provided FINAL completion brief.

## Global Constraints

- Do not modify Ghosty upstream source.
- Do not deploy, restart production, download production evidence, or run destructive cleanup against production.
- Preserve unrelated work, including the untracked audit report.
- Existing tests may be modified because this task explicitly requests focused regression coverage; do not create new test files.
- Keep cleanup disabled by default and preserve existing content-addressed payloads, holds, cases, audit rows, and retention policy behavior.
- Real-demo validation is pending unless an authorized local fixture is actually available; synthetic tests are not production proof.

## Review Focus

- A manually queued failed run whose temporary hold is released must still be blocked from cleanup until explicit disposition; cover in `hltv.test.js`.
- A replaced or missing parser log must not silently become the source for a historical rerun; cover snapshot/hash validation and recovery in `hltv.test.js`.
- A missing parser input, unfinalized demo, resource limit, and scanner exception must retain a stable safe diagnostic category; cover worker/API error mapping.
- A null/ambiguous scanner identity must remain visible as an aggregate identity-unavailable event; cover investigation API and browser rendering.
- A queued job must transition through bounded UI refresh without duplicate runs or stale-view updates; cover navigation/browser tests.

### Task 1: Analysis disposition and immutable parser-log evidence

**Files:**
- Modify: `api/src/hltv/schema.sql`
- Modify: `api/src/hltv/registry.js`
- Modify: `api/src/hltv/storage.js`
- Modify: `api/src/hltv/upstream_bridge.py`
- Modify: `api/src/hltv/upstream.js`
- Modify: `api/test/hltv.test.js`

**Interfaces:**
- Add run fields for `diagnostic_json`, `analysis_disposition`, and bounded source snapshot identity.
- Add private storage helpers for immutable content-addressed log snapshots and verified reads.
- `upstream_bridge.py` returns accepted log bytes/source manifest metadata for the worker to snapshot.
- Cleanup eligibility blocks failed/interrupted/undisposed attempted runs and permits completed runs or an explicit audited disposition.

Implement schema-safe additive creation/alteration, atomic snapshot publication with no overwrite, and recovery verification before any analysis rerun. Add tests for manual/automatic failures, released holds, interrupted runs, successful runs, explicit disposition, dry-run, actual temporary deletion, replaced/missing logs, checksum mismatch, and snapshot reuse.

### Task 2: Stable diagnostics and authenticated operational status

**Files:**
- Modify: `api/src/hltv/upstream.js`
- Modify: `api/src/hltv/router.js`
- Modify: `api/src/hltv/registry.js`
- Modify: `api/test/hltv.test.js`

**Interfaces:**
- Normalize errors to `{code, stage, message, retryable, next_action}` without paths/stacks/credentials.
- Persist bounded `diagnostic_json` on every terminal run.
- Add authenticated `/health` or `/worker-status` response with queue depth, current run, last pass, and configured capability flags.

Map parser, pairing, finalization, checksum, asset, scanner, timeout, memory/storage, and unexpected failures. Preserve original codes for historical rows and expose safe diagnostics through detail/jobs. Add focused API and worker tests.

### Task 3: Scanner status and identity-unavailable investigation flow

**Files:**
- Modify: `api/src/hltv/investigation.js`
- Modify: `api/src/hltv/router.js`
- Modify: `api/src/hltv/review.html`
- Modify: `api/test/hltv.test.js`
- Modify: `api/test/hltv-review-browser.test.js`

**Interfaces:**
- Scanner summary includes explicit legacy firing-only, completed-empty, completed-findings, failure category, version, settings, and last completion.
- Investigation events preserve null-identity findings with an `identity_unavailable` marker and an aggregate filter/view.
- Event detail keeps existing IDs/provenance and adds identity limitation context.

Do not change Ghosty thresholds or fabricate findings. Add deterministic positive scanner fixture coverage through the adapter contract, null/ambiguous identity coverage, and browser state/identity rendering.

### Task 4: Reviewer workflow, pagination, polling, and visual polish

**Files:**
- Modify: `api/src/hltv/registry.js`
- Modify: `api/src/hltv/router.js`
- Modify: `api/src/hltv/review.html`
- Modify: `api/test/hltv.test.js`
- Modify: `api/test/hltv-review-navigation.test.js`
- Modify: `api/test/hltv-review-browser.test.js`

**Interfaces:**
- Add authorized reassignment/unclaim actions with audit records and concurrent claim protection.
- Accept page sizes 25/50/100 within a server-side cap.
- Queue action starts bounded polling tied to the selected view and stops on terminal state/navigation.

Display assignee and scanner status distinctly, improve failure/empty/loading states, tighten density and filter alignment, add timeline overlap cues, and keep the existing dark NoName responsive architecture.

### Task 5: Documentation, verification, and delivery

**Files:**
- Modify: `docs/HLTV-REVIEW.md`
- Modify: `docs/HLTV-UPSTREAM.md`
- Modify: `docs/HLTV-INVESTIGATION-CONSOLE.md`
- Modify: `.env.example`

Document schema additions, source-log retention/backup, diagnostic codes, worker status, safe targeted commands for `PC3S6V`/`EFWN6W`, rollback, and the pending real-demo verification procedure. Run the focused HLTV tests and browser checks, inspect the final diff, commit in logical commits, and push to the verified `origin/main` only after all verification passes.
