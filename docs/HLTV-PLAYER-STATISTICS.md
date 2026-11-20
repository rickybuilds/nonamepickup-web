# Private firing statistics and personal histories

Current quick-view headline and notification policy: [strict hit evidence, concussion-window coverage and 25-game personal baselines](HLTV-HIT-EVIDENCE-ALERTS.md). Aim-near is now supporting context. Single-round close aim-near markers stay quiet; older descriptions below record the original statistics rollout.

Implemented behind default-off flags. Uses Ghosty's unchanged firing counter, viewer geometry/visibility/server-model pose functions and strict/inclusive hit-evidence matching inside the existing isolated background worker. No Chrome installation is required on the server: drawing uploads are inert, while original comparison functions execute in Node. Upstream remains an official immutable checkout managed by the existing updater.

## Before enabling

Provision private map/model assets on the Linux server. A first-map archive has been prepared locally at `C:/Users/ricky/AppData/Local/Temp/noname-hltv-assets-first-validation.zip` (about 75 MB). It includes `2trof_b4`, models and WADs, without executables, logs or credentials. Upload that archive privately, outside the web root, then extract its `valve`, `tfc` and `tfc_downloads` folders into `/srv/noname-hltv-assets`. Keep this directory private (root-owned in the user's deployment). Never commit the archive or expose the assets as public static files.

To package other maps on Windows, use `api/scripts/packageHltvAssets.ps1 -Maps '*' -Destination <private-path-outside-repository.zip>` or specify individual map names. The helper refuses to overwrite an existing archive. Custom future maps must be provisioned before their comparisons can run.

Append to `/var/www/tfcbot/api/.env`:

```dotenv
HLTV_STATISTICS_ENABLED=false
HLTV_STATISTICS_AUTO_COLLECT=true
HLTV_ASSETS_ROOT=/srv/noname-hltv-assets
```

Keep the already-working `HLTV_UPSTREAM_ENABLED`, storage/log paths and resource limits. On the user's 1.9 GiB RAM host the previously successful decoding budget was `HLTV_UPSTREAM_MEMORY_BYTES=536870912`; firing comparisons add work and still require a real Linux memory/runtime trial. Each child remains limited by systemd and the worker refreshes its processing heartbeat to prevent recovery from expiring a valid multi-stage run.

After assets are installed, update/check the upstream pin with `node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --apply`. For a controlled first trial, set **only** `HLTV_STATISTICS_ENABLED=true`, keep automatic collection false, and restart `tfcapi`. Queue the finalized first `78ZA59` demo (`8bc2702c-94b9-492c-a29b-7c4a9355cb00`) through its existing Ghosty analysis button, then run the existing locked worker command. Refresh the review detail for firing statistics. The other `78ZA59` demo has no finalized directory and remains a separate retrieval issue; do not silently repair original evidence.

With statistics enabled, automatic collection is on by default. Set `HLTV_STATISTICS_AUTO_COLLECT=false` to disable automatic enrollment. The installed worker enrolls eligible retained demos as finalized parser inputs become available and runs one job at a time. All players in a successful round are collected. Automatic jobs release only their own processing holds when they finish, including failures. Manual review and evidence holds are preserved. An admin can explicitly retry failed automatic runs.

## Definitions and history

The detail page now leads with a selected-player Weapon / Conc / Non-conc quick comparison. Percentages are aim-near rates; the three counts are aim-near / normal-hitbox intersections / eligible firing events. The original viewer's additional concussion-count field is not exposed by this summary and is not fabricated. Full firing and history tables have searchable, selectable-size pagination. Concussion-event/log-pairing details, recording metadata, review actions and audit history are collapsed by default. Concussion tables can search/page all stored windows rather than truncating the display at 300. Browser fixture checks covered collapsed defaults, search, page reset, empty results, CSP and desktop/mobile layout.

The intended next detector report is a private Discord review alert identifying the player, weapon, actual finding, comparable baseline/sample sizes, source version and evidence/review link. Collecting firing statistics and displaying this comparison do not themselves implement an anomaly detector. No ordinary rate difference is automatically promoted to a finding, and no simulated detector alert is emitted.

The review table separates SteamID, observed class, weapon and estimated concussion state. A firing event can contain multiple pellets. Aim intersections and strict/inclusive hit evidence are estimates, not exact bullet accuracy. Unmatched evidence means unknown, not a confirmed miss. Zero eligible denominators display no percentage. Unknown visibility and uncertain concussion boundaries are explicit exclusions.

History pools integer numerators/denominators from earlier verified recordings of that player, using the same map, weapon, class and exact upstream/settings/asset configuration. It excludes the current recording and later recordings. All verified earlier history and rolling 30-day views are available. Incomplete groups do not enter rate histories. There are no anomaly scores, thresholds, automatic suspicion alerts or public rankings.

SQLite stores canonical observations once per demo/log/configuration, compressed content-addressed evidence payloads and immutable per-run references. Retries and duplicate registry copies do not add baseline samples; incompatible upstream revisions remain separate cohorts. Structured counters and evidence references survive routine raw-demo deletion. Source hashes and provenance remain inspectable even when raw playback bytes have expired. Shot evidence is served only through authenticated bounded pages. No raw files are downloaded or uploaded again.

## Validation and remaining rollout work

Local tests cover original viewer loading, execution with real `2trof_b4`/scout assets and synthetic firing events, parity of those synthetic results with the original functions in Chrome using real WebGL, distinct same-time event evidence, heartbeat recovery, disabled flags, automatic lease ownership, source holds, authenticated empty states, immutable/deduplicated payloads, pooled history and current/future exclusion. These checks are not real-demo accuracy validation. Actual Linux whole-job RAM/runtime and real-match parity remain required before automatic collection. The new review UI follows existing components; a full visual browser pass remains pending. Game assets stay outside Git.
