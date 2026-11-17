# Player firing statistics and personal baselines

Status: design for review; not implemented. The existing connected capability remains matched-log concussion estimates.

## Approved direction

Collect statistics for everyone using SteamID identity, then build each player's own comparable history before considering anomaly detection. No new anomaly algorithm, cheating score or automatic suspicion alert is part of this stage. Keep Ghosty's official checkout untouched and compatible with the existing updater.

## Metrics and evidence

Use upstream `ConcAim.firingEvents` for deduplicated recorded firing events. One firing event is not necessarily one bullet or pellet. Separate weapon, observed player class and estimated concussion state (`conc`, `outside`, `uncertain`). Preserve unassigned identity/class and unavailable geometry as exclusions, never misses. Identify the player at the firing timestamp; slot reuse must not mix SteamIDs.

Connect the original upstream firing comparison, visibility, server-model poses, map traces and strict/inclusive evidence matching together. Do not replace its geometry callbacks with approximations merely to make the CLI run. An integration spike must establish an executable private interface to these viewer-dependent functions before enabling comparisons. Prefer an upstream-supported callable/export interface; a private bounded browser runner is a fallback to measure, not an assumed dependency that will fit the server.

Keep the original metric names and denominators: total recorded firing events; enemy-visible eligible firing events; normal hitbox aim-ray intersections; aim-near intersections; strict and inclusive hit-evidence counts; no-enemy, unavailable and uncertain exclusions. Keep unmatched evidence distinct from a confirmed miss. Projectile geometry is not projectile hit accuracy. Kill/damage totals remain separate from inferred firing associations. Exact client spread, FOV and lag compensation are not known.

Each observation records demo and raw-log hashes, verified log round, match/server/map, SteamID/display name, class/weapon/state, upstream SHA, adapter version, asset hashes, margin/FOV/aspect/lag settings, alignment uncertainty, counters and reviewable event timestamps/log lines. Unknown or zero eligible denominators produce null percentages. Store integer numerators and denominators, not only percentages.

## Private assets

Observed local installation: `C:/Program Files (x86)/Steam/steamapps/common/Half-Life`. Standard models exist in `tfc/models/player`; `2trof_b4.bsp` exists in `tfc_downloads/maps`. Valve/TFC assets are not committed, published or served as public static files. Operator provisions a private server directory such as `/srv/noname-hltv-assets`, preserving upstream search folders (`valve`, `tfc`, `tfc_downloads`, optional `tfc_addon`). Do not require the Windows recorder executable for background decoding.

Inventory exact required maps/models and hash them. Missing map/model data reports unavailable comparison capability. Custom model/skeleton differences and absent level assets must be visible in quality metadata. Verify resource usage before enabling this on the user's 1.9 GiB RAM server; the existing successful decode used a 512 MiB job budget.

## Persistent observations and baselines

Use additive SQLite tables for immutable analysis provenance, per-player/weapon/class/state counters and per-shot evidence references. A logical observation key includes recording content hash, verified log content hash, SteamID, class/weapon/state and metric configuration. Retries and duplicate registry files do not add samples. Reruns remain auditable; baseline queries select one canonical accepted result per logical recording/configuration, never count every upstream revision.

Statistics survive routine raw-demo expiry. Keep source hashes, retention status and evidence references so an unavailable old recording is disclosed rather than linked as if playable. Raw retention and explicit holds retain their current rules. Failed and partial runs do not enter comparable rate histories. Do not infer raw shooting statistics from the existing concussion-window-only results.

Baseline is the player's own history grouped by compatible weapon, class, map and exact analysis configuration. Show match/round count, eligible and excluded event totals, dates covered and pooled ratios (sum numerators / sum denominators); never average round percentages. Show all verified history by default and allow a rolling 30-day filter. Historical comparisons must exclude the current recording and later recordings to prevent leakage. Label the result descriptive history, not a normality model; no invented confidence scores or statistical alert thresholds.

## Operations and review UI

All new collection features default off behind a separate statistics flag. Reuse retained demos and the private matched logs; do not download or upload them again. The existing one-job-at-a-time resource isolation remains. Add an idempotent statistics queue for validated complete recordings with explicit quality/failure states; automatic collection must not create permanent reviewer-request holds for every match. Protect source files while actively used, leave existing admin holds untouched and keep incomplete/error retention behavior explicit.

Authenticated review pages show per-round firing counters and personal history with denominators and provenance, plus separate unavailable-capability messages. No global public player ranking or production Discord anomaly message is added. Existing admin review actions and manual alerts remain unchanged. The unresolved final-directory problem for the second `78ZA59` demo remains a separate retrieval investigation; do not repair or silently replace original evidence here.

## Acceptance

Validate original upstream comparison results against the adapter for a real round/player on identical assets/settings. Test slot reuse, duplicate reruns, revision replacement, zero eligible events, missing assets, stale settings, failed processing, disabled flags and statistics surviving routine raw deletion. Confirm counts balance and baseline exclusion prevents current/future-recording leakage. Verify private asset paths do not cross authenticated API responses. Test actual Linux resource consumption before turning collection on. No success claim for shot accuracy until this full comparison is connected and validated.
