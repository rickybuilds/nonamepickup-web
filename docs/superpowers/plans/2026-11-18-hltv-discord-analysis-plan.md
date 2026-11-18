# HLTV Analysis Discord Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver durable, deduplicated Discord notifications from completed or failed HLTV scanner runs through the existing tfcbot review-alert outbox.

**Architecture:** The website writes one bounded notification payload and one `hltv_alerts` outbox row after a terminal scanner outcome. The existing tfcbot `hltvReviewAlerts` lease/retry/privacy loop reads the payload from the shared SQLite database, formats a compact safe embed, and sends it only to the configured private review channel.

**Tech Stack:** Node.js, better-sqlite3, SQLite additive schema, discord.js `EmbedBuilder`, node:test fixtures/mocks.

**Spec:** `docs/superpowers/specs/2026-11-18-hltv-discord-analysis-design.md`

## Global Constraints

- Do not send test messages to production Discord channels.
- Do not modify production data, clear historical results, reprocess historical demos, or publish historical findings automatically.
- Do not create another parser, scanner, downloader, webhook, or independent polling loop.
- Candidate details remain private and automated candidates are never presented as verdicts.
- Do not create new test files; extend existing test suites only.

## Review Focus

- A successful statistics-only payload must not emit a scanner-complete notification; cover in website notification tests.
- A malformed scanner payload must fail closed without creating a candidate alert; cover in website notification tests.
- Repeated worker cycles and reanalysis runs must deduplicate per run while allowing a new run to notify; cover in website notification tests.
- Candidate-heavy output must remain within Discord embed limits while reporting omitted count; cover in bot formatter tests.
- Missing/private channel and transient send failures must preserve bounded retry state and never leak details; cover in bot delivery tests or existing delivery fixture.

### Task 1: Website analysis notification outbox

**Files:**
- Modify: `api/src/hltv/schema.sql`
- Modify: `api/src/hltv/registry.js`
- Modify: `api/src/hltv/upstream.js`
- Modify: `api/test/hltv.test.js`

**Interfaces:**
- Produce `Registry.queueAnalysisNotification({ runId, demo, outcome, payload })` returning `{ alertId }` idempotently by run ID.
- Store `hltv_analysis_notifications(alert_id,run_id,outcome,data_json,created_at)` with unique `run_id`.

- [ ] Add failing tests for zero findings, candidate summaries, failed runs, legacy/statistics-only suppression, malformed scanner suppression, repeated-cycle deduplication, and reanalysis uniqueness.
- [ ] Run the focused website tests and confirm the new assertions fail before implementation.
- [ ] Add the additive payload table and implement bounded summary extraction from authoritative `statistics.scanner.findings`.
- [ ] Call the outbox method only after terminal run persistence; failed runs use sanitized `diagnostic_json` and retry eligibility.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Bot embed formatter and delivery integration

**Files:**
- Modify: `services/hltvReviewAlerts.js`
- Modify: `test/pickupReplayDelivery.test.js`
- Modify: `.env.example`

**Interfaces:**
- Produce `formatHltvAnalysisNotification(data, reviewUrl)` returning a discord.js embed payload with bounded fields and no mentions.
- Consume `hltv_analysis_notifications` by `alert_id` from the existing leased `hltv_alerts` row.

- [ ] Add formatter tests for empty, wall-track, snap, multi-player, failed, malformed, and over-limit payloads.
- [ ] Format title, match/map, status, counts, candidate details, disclaimer, and HTTPS deep link with real values.
- [ ] Extend the existing alert switch without creating a second timer or delivery table.
- [ ] Keep missing-channel/privacy/send errors on the existing bounded retry path.
- [ ] Run bot tests with mocked channels and no live Discord access.

### Task 3: Console deep links and documentation

**Files:**
- Modify: `api/src/hltv/review.html`
- Modify: `docs/HLTV-INVESTIGATION-CONSOLE.md`
- Modify: `C:\Projects\tfcbot\docs\HLTV-REVIEW-ALERTS.md` (create only if an existing alert doc is absent)

- [ ] Accept `demo` and safe scanner-tab query parameters without changing existing navigation.
- [ ] Document activation variables, shared DB requirements, privacy routing, retry behavior, and no-backfill behavior.
- [ ] Run syntax checks and both repository test suites.

### Task 4: Final verification and delivery

- [ ] Review both diffs for hardcoded secrets, public candidate routing, unbounded text, and historical notification behavior.
- [ ] Commit website changes and push the configured website remote.
- [ ] Commit bot changes and push the configured bot remote.
- [ ] Report test results, commit hashes, push status, activation steps, and remaining real-demo/production blockers.
