# TFC Bootcamp account linking design

## Intent

Let a player prove ownership of a Steam account and a Discord account from the Bootcamp hub, then connect those identities for licenses, roles, profiles, and queue eligibility. Reuse NoName's existing `player_steam_ids` records so the Website, Bot, and pickup systems continue to resolve one shared identity.

## Goals

- Verify Steam through Steam OpenID 2.0 and verify Discord through the Discord OAuth2 authorization-code flow.
- Bind both callbacks to a short-lived, one-time browser state and fixed configured callback URLs.
- Insert only into the existing `player_steam_ids` identity table. Reject a Steam ID already linked to another Discord account; allow a Discord account to link multiple Steam IDs as the existing schema does.
- Keep current admin-managed `!linksteam` and unlink tooling as a recovery path.
- Queue role synchronization durably so the Bot can apply current license roles after a new link.
- Keep the feature disabled by default and avoid enabling queue or offense enforcement.

## Non-goals

- Creating a second Bootcamp player/identity table or replacing Steam2 identities in the plugin/database.
- Persisting Steam/Discord access tokens or creating a general website session.
- Changing existing account links, production flags, queue enforcement, or production services.

## Approaches considered

1. **Keep admin-only linking.** This has the least code and reuses `!linksteam`, but does not satisfy the specification's self-service Steam/Discord linking requirement.
2. **Steam OpenID followed by Discord OAuth, then write the shared link table (chosen).** This proves control of both providers, rejects account takeover, and leaves existing player identity consumers unchanged. It requires HTTPS callback configuration and registered provider credentials; the feature stays off until configured.
3. **Add Bootcamp-owned account records and synchronize later.** This duplicates identities and creates a conflict-prone second source of truth, so it is rejected.

## Architecture and security decisions

- Mount the linking flow under the existing feature-flagged Bootcamp API. Add a separate `BOOTCAMP_ACCOUNT_LINK_ENABLED` flag that defaults to false.
- Configure exact Steam and Discord return URLs; never construct security-sensitive callback URLs from an untrusted Host header.
- Create a cryptographically random state, store only its SHA-256 digest in a short-lived Bootcamp SQLite flow row, and place the opaque state in an HttpOnly, SameSite=Lax cookie. Require the callback query and cookie to match and consume the flow atomically.
- Verify Steam assertions server-to-server against the fixed Steam endpoint, require a signed claimed ID and exact configured return URL, and accept only a Steam Community identity URL containing a valid SteamID64.
- Exchange Discord authorization codes server-to-server using form encoding, request only `identify`, and validate the returned Discord user ID. Do not store provider tokens.
- Convert the verified SteamID64 to canonical Steam2 form for the existing plugin/Bot identity contract.
- In one SQLite transaction, reject conflicting Steam ownership, upsert the shared link, update an existing `player_identities` row if present, enqueue a role-sync outbox entry, and consume the flow.
- The Bot drains that outbox idempotently, recomputes the authoritative Website license, and synchronizes configured roles. Existing Bot watcher and role flags remain default-off.
- The Bootcamp hub shows the link action only when the account-link status endpoint says the feature is enabled. Bot copy links to that page only when an operator configures the URL.

## Configuration and rollout

Required configuration is supplied through environment variables for the feature flag, public hub URL, fixed Steam return URL, fixed Discord client ID/secret/redirect URL, and Discord Bot's Bootcamp hub URL. Examples use placeholders only. Tests inject provider HTTP calls and use isolated SQLite; no provider credentials or production account rows are needed. Deployment documentation requires HTTPS, matching provider redirect registrations, and explicit feature enablement. Queue gates remain independently disabled by default.

## Verification

Automated tests cover disabled and incomplete configuration, state/cookie mismatch, expiry/replay, invalid or unsigned Steam assertions, invalid Discord responses, identity conflicts, idempotent link writes, durable outbox retry, Bot role sync, and hidden/default-off UI. Provider calls are mocked only at the HTTP boundary. A real provider/guild round trip remains an operator verification step because this environment has no registered OAuth credentials.
