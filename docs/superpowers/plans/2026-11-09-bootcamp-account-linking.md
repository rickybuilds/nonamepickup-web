# TFC Bootcamp account linking implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default-off, self-service Steam and Discord link flow that writes to NoName's existing shared identity records and causes Bot role sync.

**Architecture:** The Website owns a short-lived SQLite flow table, verifies Steam OpenID and Discord OAuth callbacks, and commits a shared `player_steam_ids` row plus a durable sync outbox in one SQLite transaction. The Bot drains the outbox and uses the existing Website license API and Discord role synchronizer. A Bootcamp hub action and Bot link copy expose the flow only when configured.

**Tech Stack:** Express, Node 20 built-in fetch/crypto, existing `better-sqlite3` identity DB, existing Bot `SteamLinks` store, Node test runner, existing static HTML/CSS/JS.

## File map

- `api/src/db/schema.js`: create namespaced temporary flow and role-sync outbox tables.
- `api/src/auth/bootcampAccountLink.js`: state handling, Steam/Discord provider verification, identity conversion, and transaction-safe shared-link write.
- `api/src/routes/bootcampAccountLink.js`: feature status and start/callback endpoints; fixed redirects and safe result codes.
- `api/src/routes/index.js`: mount the flow under the already feature-flagged Bootcamp API using the existing identity DB and MySQL event connection only where required.
- `bootcamp.html`, `assets/js/bootcamp-hub.js`, `assets/css/bootcamp-hub.css`: show the account-link entry and result state using the existing NoName Bootcamp style.
- `C:/Projects/tfcbot/lib/steamLinks.js`, `services/bootcampWatcher.js`: read pending outbox entries and process license/role sync with retry.
- `C:/Projects/tfcbot/commands/bootcamp.js`, `config.js`: show the hub URL when configured; retain the admin-link fallback otherwise.
- Website/Bot tests and Bootcamp integration docs: prove provider and shared-identity contracts without external credentials.

## Review focus

1. Callback CSRF: a state from another browser or an expired/consumed flow must not link an identity.
2. OpenID issuer/return URL: forged endpoints, unsigned fields, and a claimed ID outside Steam's exact identity path must fail closed.
3. Discord authority: only a valid OAuth token plus `/users/@me` identity may finish linking; access tokens are never persisted or logged.
4. Identity takeover: an already-linked Steam ID cannot be silently moved to another Discord ID.
5. Role sync durability: Bot/Discord outage leaves an outbox row pending for retry and does not duplicate identities.

## Tasks

### Task 1: Account-link flow schema and pure identity helpers

**Files:** modify `api/src/db/schema.js`; create `api/src/auth/bootcampAccountLink.js`; create focused tests in the existing Bootcamp integration test file.

**Interfaces:**
- `steam64ToSteam2(steamId64) -> canonical Steam2 string | null`.
- `createLinkFlowStore(db).create/consume/update(...)` stores SHA-256 state digests, stages, and expiry without provider credentials.
- `linkVerifiedIdentities(db, {steamId, discordId, discordName, flowHash})` commits the shared identity and a uniquely keyed sync-outbox item or returns a conflict.

- [ ] Write tests for Steam64 conversion, expiry, one-time consumption, conflicting ownership, idempotent repeated link, and atomic outbox insertion.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement schema and pure helpers using the current `player_steam_ids` schema without changing competitive/speedrun identities.
- [ ] Re-run focused tests and Website Bootcamp tests with disposable MariaDB enabled.

### Task 2: Provider verification and HTTP flow

**Files:** create `api/src/routes/bootcampAccountLink.js`; modify `api/src/routes/index.js`; modify `api/src/app.js` configuration only as needed; add tests in the existing Bootcamp route test file.

**Interfaces:**
- `createBootcampAccountLinkRouter({db, enabled, config, fetchImpl, clock})` exposes `/status`, `/start`, `/steam/return`, and `/discord/return`.
- Steam verification posts the assertion to the fixed Steam OpenID endpoint; Discord uses the authorization-code token endpoint and `identify` scope.
- All callbacks use exact configured URLs, browser-bound cookie state, a 10-minute expiry, bounded HTTP timeouts/responses, and no-store headers.

- [ ] Write tests for default-off status, incomplete config, cookie/state mismatch, Steam signature/return/claimed-ID failures, Discord token/profile failures, success redirects, and state replay.
- [ ] Run focused tests and verify failures are due to the missing flow.
- [ ] Implement provider requests with injectable fetch and strict issuer/identity validation.
- [ ] Re-run focused and complete Website Bootcamp suites with DB tests enabled.

### Task 3: Durable Bot role synchronization

**Files:** modify `C:/Projects/tfcbot/lib/steamLinks.js`, `services/bootcampWatcher.js`, `commands/bootcamp.js`, and relevant existing tests.

**Interfaces:**
- `SteamLinks.getPendingBootcampLinkSyncs(limit)` and `markBootcampLinkSyncDelivered(id)` read/ack the shared SQLite outbox idempotently.
- The watcher recomputes the Website license and syncs configured Discord roles before acknowledging; errors leave rows pending.
- The Bot hub/account-link URL is empty and inactive by default.

- [ ] Add tests for successful sync, Discord/API outage retry, idempotent acknowledgement, and default-off hub-link copy.
- [ ] Confirm tests fail on current code.
- [ ] Implement bounded outbox processing without changing existing event cursor behavior or queue gates.
- [ ] Run Bootcamp Bot tests and the full Bot test suite.

### Task 4: Bootcamp hub UI and operations docs

**Files:** modify `bootcamp.html`, `assets/js/bootcamp-hub.js`, `assets/css/bootcamp-hub.css`, API/Bot example environment files and `docs/bootcamp-integration.md`.

- [ ] Add a hidden-by-default accessible link action and safe success/error status copy.
- [ ] Add placeholder-only provider configuration, HTTPS callback setup, explicit enablement, and rollback instructions.
- [ ] Run the Website accessibility/static contracts and inspect the existing responsive page at desktop/mobile widths.
- [ ] Run final Website/Bot Bootcamp tests; record any unrelated full-suite failures separately.

### Task 5: Package, commit and publish

- [ ] Update the Bootcamp integration manifest and machine-readable continuation checkpoint with exact files, tests, flags, and external provider verification requirements.
- [ ] Run current full suites, retain baseline failures with evidence, and compile/verify the AMXX package (no AMXX source behavior changes expected).
- [ ] Commit and push Website changes to `ricky-bootcamp` and Bot changes to `ricky-bootcamp`; do not merge or deploy production.
