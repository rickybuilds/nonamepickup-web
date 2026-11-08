# Bootcamp replay API

Bootcamp keeps the existing NoName five-track replay rows (`pos`, `proj`,
`input`, `cmd`, and `event`) in its isolated `bootcamp_*` tables. The public
JSON endpoint remains:

```text
GET /api/bootcamp/replay/run/:runId
```

The compact context required by the binary sidecar client is available at:

```text
GET /api/bootcamp/replay/run/:runId/metadata
```

For consumers that need the versioned packed movement stream, the API also
serves a TFTR v1 binary sidecar:

```text
GET /api/bootcamp/replay/run/:runId/tftr
```

The sidecar endpoint only selects a complete replay attached to a valid ranked
run that is not awaiting finalization, has passed review when flagged, and
matches the route's current configuration version. It verifies chunk order,
sample counts, per-track SHA-256 values, field validity and size limits before
encoding the response. The binary header exposes format version 1 through both
the TFTR payload and `X-TFTR-Version`; `X-TFTR-SHA256` identifies the exact
response bytes. HTTP responses are marked `no-store`; replay bytes use the
private server-side cache described below.

The shared 3D replay viewer requests TFTR first and then the small metadata
response, avoiding the JSON movement payload for current recordings. If the
sidecar is unavailable, malformed or from an older format, the viewer falls
back to the established JSON replay endpoint.

Old recordings with the original nine-column position track remain available
from the JSON endpoint. The TFTR endpoint responds with `406` and
`legacy_position_track_has_no_motion_fields` for those recordings. Integrity
or structure failures return `422`; recordings that are not publicly eligible
return `404`.

The server maintains a private filesystem cache under
`TFCBOT_DATA_DIR/bootcamp/replay-cache` (default data directory: `/root/tfcbot`).
Cache keys bind the ghost/run identity, current route config version, frame
counts and stored track hashes. Cache entries have an internal SHA-256 check,
expire after 30 days, and are pruned to at most 1,000 entries or 256 MiB. The
cache refuses paths inside the public web root. Every request still checks
current public replay eligibility in MariaDB before reading the cache, so
pending, rejected, invalid or stale-geometry runs cannot be served from a stale
cache file. Cache read/write failures are logged and fall back to database
encoding. The route is mounted only when `BOOTCAMP_API_ENABLED=true`, which
remains opt-in. Remote object storage is not configured; this is local durable
cache storage, not a replicated archive.

## Mentor license co-sign

The Discord Bot may record an optional mentor attestation with the service-only
endpoint `POST /api/bootcamp/integrations/discord/licenses/cosign`. It accepts
`{ "steamId": "STEAM_0:1:123", "mentorDiscordId": "12345678901234567" }`
with the configured `BOOTCAMP_DISCORD_API_TOKEN`. The Bot exposes this only
when `BOOTCAMP_MENTOR_COSIGN_ENABLED=true` and a mentor role is configured.
The endpoint is idempotent for the same mentor, rejects an existing different
attestation with `409`, and does not grant or change tier-based license levels.
The player profile returns the stored Discord ID as `license.cosignedBy`.
