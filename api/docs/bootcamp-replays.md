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
response bytes. Responses are not cached.

The shared 3D replay viewer requests TFTR first and then the small metadata
response, avoiding the JSON movement payload for current recordings. If the
sidecar is unavailable, malformed or from an older format, the viewer falls
back to the established JSON replay endpoint.

Old recordings with the original nine-column position track remain available
from the JSON endpoint. The TFTR endpoint responds with `406` and
`legacy_position_track_has_no_motion_fields` for those recordings. Integrity
or structure failures return `422`; recordings that are not publicly eligible
return `404`.

This is database-backed generation on request. It does not yet store the
sidecar in object storage or maintain a server cache. The route is mounted only
when `BOOTCAMP_API_ENABLED=true`, which remains opt-in.
