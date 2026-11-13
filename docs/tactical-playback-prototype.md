# Tactical playback prototype

## Single-round SQLite storage comparison

`node api/scripts/pilotTacticalDatabase.js HDPVET 1` opens the configured live `ELO_DB` read-only and uses SQLite's backup API to create a consistent private copy beside it: `elo.tactical-pilot-HDPVET-r1.db`. It refuses to overwrite an existing copy and checks available disk space when supported. This requires space for a full second database, not just a single round's package.

The command inserts one prepared compressed playback into a `tactical_playback_packages` BLOB table in the copy, verifies the stored bytes, and reports gzip/JSON sizes, trial DB size before/after, file growth, and free-page counts. It does not copy the 3D archive into SQL. Live `elo.db`, archives, and the website's current playback storage are unchanged. The copy contains the full database and must remain private.

Package bytes are the useful per-round storage estimate; DB file growth may be smaller because SQLite reuses free pages. Storing the same gzip package in SQL relocates its storage and adds database overhead; it does not compress it further or shrink the original replay archive. Reducing future recorder archives requires a separate AMX telemetry/schema change after choosing which information to retain.

The standalone `/round-playback.html?match=HDPVET&round=1` page previews one actual pickup game before integration into Map Intel. It uses existing overview images, sampled player positions/health/armor/class/team, explicit scene deaths, and projectile removal endpoints. The existing replay viewer and `map.html` are unchanged.

## Prepare the pilot game

On the deployed website host:

```sh
cd /var/www/tfcbot
git pull origin main
node api/scripts/prepareTacticalPlayback.js HDPVET
pm2 restart tfcapi
```

Open `/round-playback.html?match=HDPVET&round=1` and switch to Round 2 with Load round. Preparation processes only the complete rounds of the specified match. It explicitly reads `api/.env` with existing environment values taking precedence. It requires the replay database credentials and private storage path, tar with zstd support, and read access to the API's `ELO_DB`. It does not require the upload token or write SQLite records. Re-running regenerates the two derived files, including the latest repaired weapon names.

## Data and loading

The preparation script unpacks each required member once and writes a compact gzip JSON file to `PICKUP_STORAGE_PATH/tactical/v2-<artifact-sha256>.json.gz`. Movement is retained at approximately 10 Hz along with every recorded health, armor, class, team, and alive/dead change. Version 2 adds identified flag tracks from objective definitions, model names, objective positions, and carrier sessions. Regenerate the pilot match after updating from version 1; the source archives and prior derived files remain intact. Life intervals and event indexes are included in the same bundle for this prototype; no new event database tables are needed to try one game.

The API's `GET /api/pickup-replays/viewer/:matchId/:round/tactical` route selects the current verified primary artifact and streams its prepared file. It performs no archive extraction, trajectory parsing, or generation on a page request. Missing preparations return `tactical_not_prepared`, displayed as a recoverable message on the page. The browser downloads the round once and handles playback, speed, seeking, and life selection locally.

## Controls and evidence

- Everyone shows team-colored trails for the last five seconds. Selecting a player shows their full life path so far in gold, retained after death until the next life starts. A selected recorded life remains inspectable after its endpoint. Other players remain visible. The trail toggle controls both modes; the caption explains which mode is active.
- Life selection and previous/next controls: seek to the first observed alive sample and stop at the selected life endpoint.
- Health bars, names, class portraits, facing arrows, and selected-player health/armor values.
- Flag markers at recorded base/drop coordinates; carried flags follow the recorded carrier's living position with a small icon offset. A status line names the carrier. Missing/removed/hidden objective states are not shown as flags at base. A Show flags toggle controls the overlay. Flag numbers are objective identifiers in display order, not inferred team ownership.
- Blue/red flag markers use the existing `assets/images/icons/webp/blueflag.webp` and `redflag.webp` artwork, clipped into badges because those images contain backgrounds. Explicit recorded flag team/name is preferred. In two-flag CTF recordings without that metadata, consistent opposing carrier-team evidence identifies a flag's color; the remaining unobserved member of the pair takes the other color. Conflicting evidence stays unknown, rendered with neutral grayscale artwork. Objective IDs are never interpreted as team IDs. Colors resolve once per loaded round and do not change during playback. This presentation update requires no data regeneration.
- Play/pause, ±5 seconds, timeline scrubber, and speed. Mouse-wheel zoom is centered on the cursor (1–8×), with left-button drag panning, a grab cursor, and Reset view. The map viewport remains a stable size while zooming. Keyboard +/− zoom, 0 resets, and arrow keys pan; native touch scrolling remains available. Ctrl-wheel is reserved for browser zoom. Zoom and pan do not change playback time.
- The scrollable scene defines zoom/pan coordinates, while a sticky viewport-sized canvas redraws at device-pixel resolution. Labels, paths, health bars, and icons are rendered anew at every zoom, rather than magnifying the overview-sized canvas. Memory scales with the visible viewport instead of the full 8× scene. The background overview remains a raster image; zoom cannot add source terrain detail.
- Recent deaths are clickable and show repaired weapons where available. Suicides and team kills are labelled; the life kill counter excludes them.
- Conc rings prefer the last recent active concussion projectile position. Cleared/missing projectile coordinates use the owner's recent alive position as an explicit `owner-sample` estimate. Removal does not prove detonation; concs with no tracked event are not invented. Missing owner samples produce no effect instead of a ring at map origin.

Existing game-details packages are repaired from their stored projectile tracks when served; original archives are not reprocessed. The public event includes `positionSource` to distinguish a recorded projectile endpoint from an owner-position estimate. The renderer also handles zero-coordinate endpoints in older prepared-only files using nearby owner samples. API restart is required to load the new reader and ETag representation.

All movement, deaths, and effects use the replay clock. Repaired analytics weapon values attach by the existing indexed victim session and replay death time, avoiding a second clock conversion in the client. No interpolation crosses an alive/dead boundary, a long recording gap, or a large teleport. First observed alive samples and recording-end/gap boundaries are not claimed as authoritative spawn or death events.

## Pilot verification

Prepared HDPVET round 1 locally from the deployed public replay streams: 8 players, 286 scene death events, 462 concussion projectile endpoints, and a 981,764-byte compressed package without SQLite weapon enrichment. Reviewed that actual package in the browser: player/life selection, playback, health values, movement trail, death feed, and desktop/mobile layout. The server preparation includes the local repaired weapon index, which the public-stream preview cannot access. JavaScript syntax and whitespace checks were run; no tests were created, modified, or run.

Version 2 preparation of the same actual round produced two flag tracks and a 1,062,983-byte compressed package. Reviewed base, dropped, and carried states in the browser, including Flag 2 carried by HanzzYolo at replay time 4:12. Regenerate with the same single-match preparation command before restarting the API to serve version 2.

Flag-color correction: actual PF2DRT round 1 on schtop uses objective IDs 6 and 7. Flag 7 is carried by recorded blue players, while flag 6 is unobserved in carriers. Reviewed the corrected renderer against the existing database package in the browser: blue artwork at the blue base and red artwork at the red base. No archive conversion, database write or tests were required.

Before integrating with `map.html`, review both prepared rounds on the server, compare recognizable fights and conc endpoints against the existing replay, and confirm the prototype's player-icon size and trail behavior. Automatic preparation on upload, searchable life database tables, additional effects, and map-page integration remain follow-up work after pilot approval.
