# Player Firing Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect real per-player firing measurements and expose descriptive personal histories, with no automatic anomaly scoring.

**Architecture:** Extend the private upstream adapter while preserving official upstream code. Persist versioned counters and provenance separately from expiring raw recordings, and expose only authenticated review endpoints. Full comparison activation depends on a validated interface to the upstream viewer's geometry and evidence functions.

**Tech Stack:** Existing Node/Express, better-sqlite3, Python standard library and unchanged Ghosty upstream; Linux systemd resource isolation.

**Spec:** `docs/HLTV-PLAYER-BASELINES-DESIGN.md`

## Global Constraints

- Disabled by default; no duplicate raw downloads, public asset hosting or simulated/automatic Discord findings.
- No new anomaly algorithm, cheating score or automatic suspicion alert is part of this stage.
- Missing or zero eligible denominators produce null percentages, not zero accuracy.
- Preserve upstream definitions, map/pose/visibility checks and strict/inclusive distinctions.
- Original demos/logs and their review holds remain governed by existing retention safeguards.
- Read Steam assets locally; no Valve/TFC files enter Git.

## Review Focus

- Slot reuse/class changes must not assign shots to another person or class.
- Retries, duplicate registry copies and upstream revision changes must not inflate history.
- Missing geometry and unknown concussion states must remain exclusions, not misses.
- Current/future recordings and incompatible settings must not contaminate comparison history.
- Resource failure, raw expiration and disabled flags must preserve valid statistics and explicit source availability.

### Task 1: Validate upstream comparison execution and asset provisioning

Files: extend `api/src/hltv/upstreamRelease.js` and `api/scripts/updateHltvUpstream.js`; create a focused private comparison adapter only after this spike establishes its executable interface; document asset setup in `docs/HLTV-UPSTREAM.md`.

Interfaces: consume the current immutable upstream root, verified demo/log inputs and a private asset root; produce an agreed versioned comparison JSON contract with original settings, raw counters, per-shot evidence and capability/exclusion states.

- [ ] Inventory asset search paths and exact files required by a real `78ZA59` comparison without publishing/copying unrelated game files.
- [ ] Establish whether unchanged upstream can run its original geometry/evidence callbacks through a callable interface; if not, measure a private browser runner or request an upstream export API. Do not substitute invented geometry.
- [ ] Compare one player's original viewer result against the proposed adapter with identical assets and settings, including missing-map and missing-model cases.
- [ ] Measure whole-job RAM/CPU/runtime on Linux before selecting/enabling the runner on the 1.9 GiB host; preserve failsafe behavior if it cannot fit.
- [ ] Freeze the actual callable contract and compatibility probes in this plan after the spike. Subsequent implementation must use that measured contract; this is an explicit unresolved integration dependency.

### Task 2: Add versioned observation storage and descriptive aggregation

Files: `api/src/hltv/schema.sql`; new focused `api/src/hltv/playerStatistics.js`; existing `api/test/hltv.test.js` under the user's original explicit test authorization.

Interfaces: `storeStatistics(registry, observation)` validates and persists canonical observations transactionally; `playerHistory(registry, {steamId, configHash, weapon, classId, map, before, days})` returns compatible historical counters, sample sizes and pooled ratios.

- [ ] Add failing tests for retry/duplicate idempotence, slot/class assignment, revision canonicalization, invalid counters, null denominators, raw-expiry independence and exclusion of current/future recordings.
- [ ] Implement additive provenance/observation tables and strict contract validation using the Task 1 schema.
- [ ] Implement parameterized aggregation with exact compatible grouping and sum-of-counts denominators; preserve quality/exclusion totals and separate strict/inclusive measures.
- [ ] Run targeted tests and commit verified storage changes.

### Task 3: Connect opt-in durable collection

Files: `api/src/hltv/upstream.js`, `api/scripts/hltv-worker.js`, `.env.example`, existing targeted tests.

Interfaces: a separate default-off statistics flag controls collection; existing retained demos and verified logs supply inputs. A durable claim invokes Task 1, then commits through `storeStatistics` only after verified completion.

- [ ] Test disabled flags, incomplete recordings, active-source protection, interrupted jobs, resource failures and successful retry without double counting.
- [ ] Integrate one bounded statistics job per worker pass; distinguish automatic temporary source leases from explicit reviewer holds.
- [ ] Preserve raw storage safeguards and structured failure diagnostics; no failure is a baseline sample or a clean anti-cheat result.
- [ ] Run targeted tests and actual Linux resource checks, then commit verified collection changes.

### Task 4: Expose private firing and baseline review

Files: `api/src/hltv/router.js`, `api/src/hltv/review.html`, existing tests, `docs/HLTV-UPSTREAM.md` and this plan.

Interfaces: authenticated per-demo statistics and per-SteamID history endpoints consume Task 2; reviewer UI shows counts, sample size, settings/version/source availability, exclusions and rate definitions.

- [ ] Test denied access, safe bounded queries, private-path omission, unavailable/zero-data states and compatible history filters.
- [ ] Add per-round and personal-history views with clear estimated-measure labels and all-history/rolling-30-day selection.
- [ ] Verify browser desktop/mobile behavior, CSP, source expiry messaging and no production Discord side effects.
- [ ] Document implemented versus pending capabilities, validate a real complete round end-to-end, commit and push completed changes.

## Planning evidence

Inspected both repositories and unchanged upstream `web/conc_aim.js`, `web/blood_hits.js`, `web/viewer.js`, `web/studio.js`, `demo_viewer.py` and concussion documentation. Raw firing extraction is exported; full `runConcAim` currently supplies geometry/visibility callbacks from viewer state. The existing NoName adapter invokes only `Conc.withLog`. User confirmed local Steam installation and absent server assets; local stock player models and the custom map in `tfc_downloads` were found. No executable player-statistics functionality or new tests have been added by this planning change.
