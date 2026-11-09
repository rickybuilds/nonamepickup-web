# Bootcamp replay archive

The Bootcamp API can read TFTR v1 replay archives from the separate private
Bootcamp sidecar service. Both Bootcamp Website visibility and archive reads
are disabled unless explicitly enabled.

Set these Website environment values only in an isolated test deployment:

```text
BOOTCAMP_API_ENABLED=true
BOOTCAMP_REPLAY_ARCHIVE_ENABLED=true
BOOTCAMP_REPLAY_ARCHIVE_URL=http://127.0.0.1:28197
BOOTCAMP_REPLAY_ARCHIVE_TOKEN=<same private token as sidecar>
```

The Website requires a URL and bearer token when the archive flag is enabled.
Use HTTPS for a service on another host, with an authenticated TLS reverse
proxy in front of the sidecar API. The Bootcamp service itself binds only to
loopback. Store the token in the service secret manager; do not commit it.

For every replay request, the Website first checks that the run is complete,
public, reviewed if flagged, valid, and tied to the current route geometry. It
then validates all five DB track hashes, generates the expected TFTR v1 bytes,
and asks the private archive for the ghost object. It accepts and caches the
archive only when the returned SHA-256 and every byte match the database-derived
sidecar. An absent, stale, altered, timed-out, or unavailable archive falls back
to the current DB-generated sidecar. Ineligible runs never cause archive or
cache reads. Existing NoName JSON replay endpoints and speedrun records are
unchanged.

The external S3 bucket, Website flag, and sidecar API remain unconfigured in
this development checkout. Automated tests use local HTTP fixtures; they do
not claim live storage or production acceptance.
