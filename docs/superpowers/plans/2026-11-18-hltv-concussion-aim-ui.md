# HLTV Concussion Aim Analysis UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Investigation Console explicitly distinguish aim-near context, strict hit evidence, and historical review context without changing concussion detection or alert policy.

**Architecture:** Reuse the existing `statisticsGroups`, `review_context`, `aim_markers`, and `gap_findings` payloads. Add pure presentation helpers to the inline console runtime, render a compact comparison summary per selected player/weapon, and preserve existing detailed tables and finding records. No schema, detector, threshold, or alert changes.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js built-in test runner, existing browser/runtime tests.

**Spec:** User-provided HLTV Concussion Aim Analysis & Investigation Console Improvements brief.

## Global Constraints

- Do not create a new detector or duplicate stored findings.
- Do not change concussion-window logic, thresholds, alert types, wall-track detection, or snap detection.
- Do not enable historical backfills, production configuration, or Discord notifications.
- Do not modify production systems.
- Preserve existing API response compatibility and fail closed when data is unavailable.
- Modify existing tests only because the user explicitly requested test coverage; do not create new test files.
- Preserve the pre-existing unrelated `docs/HLTV-FINAL-AUDIT.md` worktree change.

## Review Focus

- Aim-near and strict-hit denominators must remain visibly distinct; test both values and numerators/denominators.
- Positive, negative, and near-zero comparison gaps must receive descriptive neutral labels; test all three.
- Missing outside data, zero eligible events, and uncertain states must show insufficient evidence rather than fabricated percentages.
- Historical baseline and review-rule context must remain compatible with existing map/class/weapon/config filtering.
- Existing navigation and investigation-console behavior must remain intact after the inline runtime changes.

### Task 1: Add pure comparison presentation helpers

**Files:**
- Modify: `api/src/hltv/review.html` near the existing statistics helpers.
- Test: `api/test/hltv-review-navigation.test.js`

**Interfaces:**
- Produce a pure `comparisonSummary(conc, outside, options)` helper returning metric rates, numerators, denominators, percentage-point difference, status label, and availability state.
- Produce a pure `comparisonText(summary)` helper for neutral descriptive copy.

- [ ] Write failing runtime tests for strict-hit and aim-near summaries, positive/negative/near-parity labels, and insufficient data.
- [ ] Run the targeted test and confirm it fails because the helpers are not present.
- [ ] Implement the helpers with no new metric calculations beyond existing stored numerators/denominators.
- [ ] Run the targeted test and confirm it passes.
- [ ] Commit: `feat: add concussion comparison presentation helpers`

### Task 2: Render the three evidence concepts in Firing Analysis

**Files:**
- Modify: `api/src/hltv/review.html`
- Test: `api/test/hltv-review-navigation.test.js` or existing browser test coverage, as appropriate.

**Interfaces:**
- Consume the selected player/weapon buckets already assembled by `renderQuickStatistics()`.
- Consume `review_context` and existing finding/marker payloads without changing their schemas.

- [ ] Write failing tests asserting the rendered runtime includes separate Aim-near context and Strict hit evidence sections, with both rates and count pairs.
- [ ] Run the targeted test and confirm the new assertions fail.
- [ ] Add compact comparison cards/rows using existing console styles and neutral status labels.
- [ ] Add historical consistency text for baseline readiness, comparable games, concussion-window coverage, and existing review outcomes when available; display explicit unavailable/insufficient text otherwise.
- [ ] Keep the current strict-rate table and detailed breakdown intact for backward compatibility.
- [ ] Run targeted console tests and confirm they pass.

### Task 3: Improve marker/finding wording and documentation

**Files:**
- Modify: `api/src/hltv/review.html`
- Modify: `C:\Projects\tfcbot\docs\HLTV-REVIEW.md`
- Modify: `docs/HLTV-HIT-EVIDENCE-ALERTS.md` if needed to clarify metric provenance.

- [ ] Update quiet-marker and finding copy to identify aim-near as contextual proximity evidence and strict hit evidence as matched evidence, never conventional accuracy or cheating classification.
- [ ] Correct stale documentation that describes active legacy `aim_gap_review` notifications; document current `hit_evidence_review` behavior and supplied production observations as externally verified only.
- [ ] Run documentation/string regression checks.

### Task 4: Full verification and delivery

**Files:**
- No additional files.

- [ ] Run the relevant existing website test suite.
- [ ] Run any focused static/runtime checks needed for the inline console.
- [ ] Inspect the diff and confirm no production files/configuration, schema, detector, threshold, or alert behavior changed.
- [ ] Commit remaining task changes.
- [ ] Push the current branch to its configured remote.
- [ ] Provide manual read-only PuTTY verification commands without attempting production access.

