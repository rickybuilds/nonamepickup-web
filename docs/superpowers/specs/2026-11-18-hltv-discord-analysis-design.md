# HLTV Analysis Discord Notifications Design

## Intent

Notify reviewers when a persisted HLTV scanner run reaches a terminal outcome. The website owns authoritative analysis data and the shared SQLite outbox; tfcbot owns Discord delivery and channel privacy checks.

## Goals

- Publish one deduplicated notification per newly completed scanner run or failed scanner run.
- Distinguish completed-empty, completed-with-candidates, failed, and legacy statistics-only outcomes.
- Include real match/map/player/timestamp/duration values and a safe HTTPS Investigation Console link.
- Preserve existing alert leases, retry bounds, bot restart recovery, and private-channel authorization.
- Keep historical runs silent unless they create a new run after activation.

## Non-goals

- No new demo parser, scanner, downloader, webhook, or public-channel candidate feed.
- No live Discord sends during tests, historical backfill, production deployment, or production data edits.
- No reinterpretation of concussion markers, gap findings, or firing statistics as scanner candidates.

## Constraints

- Reuse `hltv_alerts` as the delivery outbox and its existing lease/retry state machine.
- Additive SQLite schema only; existing rows and retention policy remain unchanged.
- Candidate details stay in the configured private review channel.
- Raw stack traces, private paths, secrets, and untrusted free-form text never enter Discord payloads.

## Approaches

1. **Shared persisted outbox (selected):** the website creates a payload linked to the completed/failed run and one `hltv_alerts` row; tfcbot’s existing leased drain formats and sends it. This gives durable deduplication, restart recovery, and one delivery loop.
2. **Bot polls a website API:** simpler schema changes, but creates another polling loop, requires API credentials/routing, and makes concurrent-worker deduplication harder.
3. **Website sends a webhook:** low latency, but introduces a new secret path and loses the bot’s established private-channel checks and retry history.

The shared outbox is selected because both repositories already use the same protected registry database and the bot already provides the required lease, retry, privacy, and Discord embed infrastructure.

## Design

`runPending()` creates an analysis notification only after a scanner payload is validated and the upstream run is committed complete, or after a run is committed failed. A unique run identity prevents repeated worker cycles from creating another alert. No notification is created when statistics are disabled or a successful payload has no scanner section.

The payload stores a bounded, sanitized summary: outcome, match ID, map, run ID, candidate counts, candidate player labels, event kind, relative timestamp, and duration. The bot builds a compact embed, deterministically limits candidate fields to Discord’s embed budget, and reports the remainder count. The direct link contains the demo ID and scanner tab and is generated only from the configured HTTPS review base URL.

The existing review alert drain claims the outbox row with a lease, validates the configured private channel, sends with mentions disabled, marks success, or applies the existing exponential retry cap. Unknown/missing channels remain bounded delivery failures and never bypass privacy checks.

## Activation

The existing `HLTV_REGISTRY_ENABLED=true`, `HLTV_ALERTS_ENABLED=true`, `HLTV_REGISTRY_DB`, `HLTV_REVIEW_ALERT_CHANNEL_ID`, `HLTV_REVIEW_ALLOWED_USER_IDS`, and HTTPS `HLTV_REVIEW_BASE_URL` settings remain required. No Discord credential or channel ID is hardcoded. A production operator enables the existing flags after deploying both commits; no historical backfill is run.
