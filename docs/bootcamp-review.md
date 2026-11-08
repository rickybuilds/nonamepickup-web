# Bootcamp record review

The Bootcamp review page is `/bootcamp-review.html`. It and the review API are mounted only when `BOOTCAMP_API_ENABLED=true`; the flag is off unless configured explicitly. Training records remain in the Bootcamp tables and are not written to the speedrun leaderboard.

## Reviewer setup

Configure `BOOTCAMP_ADMIN_USER` and `BOOTCAMP_ADMIN_PASSWORD` in the website API environment. Keep the password out of source control. Serve the page and API over HTTPS: the reviewer submits HTTP Basic credentials, and the browser keeps the encoded credential only in page memory while the queue is open. Reloading the page clears it.

The review page lists only flagged, valid, finalized ranked runs with a complete recording linked to the run and matching its current map, route and class. Select Play or scrub the top-down movement view, then approve or reject the run. Approvals use the `bootcamp_review_run` database procedure, which commits review state, tier changes and record/PB events atomically. Rejections invalidate the run. An approved recording becomes visible through the normal public replay endpoint; pending recordings are available only to the authenticated review endpoint.

## API

- `GET /api/bootcamp/admin/reviews?limit=50` — authenticated queue; limit is 1–100.
- `GET /api/bootcamp/admin/reviews/:runId/replay` — authenticated replay inspection for a complete pending recording.
- `POST /api/bootcamp/admin/reviews/:runId` — authenticated JSON body `{ "verdict": "approve" }` or `{ "verdict": "reject" }`.

All reviewer responses use `Cache-Control: no-store`. The endpoints return 503 when reviewer credentials are not configured, 401 for bad credentials, and 409 when a run is no longer eligible. Configure the web API database account with the permissions required by migrations `001_bootcamp_schema.sql` through `013_claim_recordings.sql`, including EXECUTE on `bootcamp_review_run`.

The drill leaderboard preserves historical sets created before recording bindings (`recording_token IS NULL`). New bound sets are visible only after `bootcamp_finalize_drill_set` clears the pending flag, writes its finalized marker and links a complete position recording that matches the set's player, map and class. Missing replay data or an inconsistent marker does not make a new score public.

Player profile links use `/bootcamp.html?steamid=STEAM_…`. The hub opens that profile directly and shows the current license, route personal bests and the best published score for each drill/class. The profile drill query applies the same legacy-versus-finalized visibility rule as the drill leaderboard.

## Validation

The route unit tests cover authentication, pending eligibility, validation, replay isolation and decision handling. Set `BOOTCAMP_LOCAL_DB_TEST=1` only against the disposable local Bootcamp database to run `api/test/bootcamp-mariadb.test.js`; that integration verifies a pending replay is private before approval and public after the atomic review publishes it. Do not run the fixture against production.
