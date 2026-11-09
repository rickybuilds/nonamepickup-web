# Bootcamp Steam and Discord account linking

The Bootcamp hub can let a player prove control of a Steam account and a Discord account, then connect those identities through NoName's existing `player_steam_ids` table. The Website stores Steam IDs in the plugin's canonical Steam2 form. It does not create a second identity table or retain provider access tokens.

## Default state

The flow is unavailable unless both the Bootcamp API and this separate flag are enabled. The Bot sync worker is also disabled by default. Queue and offense enforcement use their own independent flags and remain disabled unless an operator deliberately enables them.

```dotenv
BOOTCAMP_API_ENABLED=false
BOOTCAMP_ACCOUNT_LINK_ENABLED=false
BOOTCAMP_ACCOUNT_LINK_STEAM_RETURN_URL=https://noname.example/api/bootcamp/account-link/steam/callback
BOOTCAMP_ACCOUNT_LINK_DISCORD_CLIENT_ID=replace-with-discord-application-id
BOOTCAMP_ACCOUNT_LINK_DISCORD_CLIENT_SECRET=replace-with-discord-client-secret
BOOTCAMP_ACCOUNT_LINK_DISCORD_REDIRECT_URL=https://noname.example/api/bootcamp/account-link/discord/callback
BOOTCAMP_HUB_URL=https://noname.example/bootcamp.html
```

Register the Discord redirect URL exactly as configured. Steam's OpenID provider must return to the fixed HTTPS URL shown above. Do not derive either callback URL from the incoming `Host` header. Local loopback HTTP is accepted only in test mode.

## Bot synchronization

The Website and Bot must use the same NoName SQLite database file. After reviewing role IDs and permissions, operators may enable the existing event watcher and the separate link-sync worker:

```dotenv
BOOTCAMP_WATCHER_ENABLED=false
BOOTCAMP_ACCOUNT_LINK_SYNC_ENABLED=false
BOOTCAMP_ACCOUNT_LINK_URL=https://noname.example/bootcamp.html
```

Set `BOOTCAMP_ACCOUNT_LINK_URL` on the Bot only if the Website flow is configured and enabled. `!license` and `!learning` then direct unlinked players to the hub; otherwise the existing admin `!linksteam` recovery path remains in use. The Bot claims durable outbox rows, recomputes licenses through the Website API, synchronizes only configured Bootcamp roles, and acknowledges a row only after success. Failed work is retried with bounded backoff; stale claims are recoverable after a Bot crash.

The sync worker does not enable queue gates. Keep `BOOTCAMP_LEARNING_ELIGIBILITY_ENABLED` and every main-queue enforcement switch disabled until the policy is explicitly ready.

## Flow and stored data

1. The hub reads `GET /api/bootcamp/account-link/status` and displays the link action only when the complete configuration is valid.
2. `/api/bootcamp/account-link/start` creates a random one-time state. Only its SHA-256 digest is stored in `bootcamp_account_link_flows`; the browser gets an HttpOnly, SameSite=Lax state cookie.
3. Steam OpenID returns an assertion. The Website verifies it server-to-server with Steam before accepting its SteamID64, then converts it to Steam2.
4. Discord OAuth asks only for `identify`. The authorization code and profile are fetched server-to-server. Access tokens are discarded.
5. In one SQLite transaction, the Website rejects a Steam ID owned by another Discord account, writes the existing identity record, updates `player_identities` if that optional table exists, queues `bootcamp_account_link_outbox`, and consumes the flow.
6. The Bot performs the durable role sync described above.

The short-lived flow tables and outbox are added by the Website's normal SQLite schema initializer. They can remain after rollback; disabling `BOOTCAMP_ACCOUNT_LINK_ENABLED` removes the public flow, while disabling `BOOTCAMP_ACCOUNT_LINK_SYNC_ENABLED` stops Bot processing. Do not delete or rewrite existing identity rows as part of rollback.

## Result states

- `linked`: both providers verified and the shared Steam/Discord link was stored.
- `steam_conflict`: that Steam account already belongs to another Discord account; the flow is discarded and no row is changed.
- `steam-failed` / `discord-failed`: restart from the hub; provider state and tokens are not kept for retry.

The route can be exercised without real provider credentials by injecting provider responses in the automated tests. Before enabling this on a live site, register real HTTPS callbacks and complete a real Steam, Discord, shared-database, and guild-role round trip in a non-production environment.
