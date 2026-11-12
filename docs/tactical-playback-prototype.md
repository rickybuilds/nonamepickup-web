# Tactical playback prototype

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

The preparation script unpacks each required member once and writes a compact gzip JSON file to `PICKUP_STORAGE_PATH/tactical/v1-<artifact-sha256>.json.gz`. Movement is retained at approximately 10 Hz along with every recorded health, armor, class, team, and alive/dead change. The original archive remains intact. Life intervals and event indexes are included in the same bundle for this prototype; no new event database tables are needed to try one game.

The API's `GET /api/pickup-replays/viewer/:matchId/:round/tactical` route selects the current verified primary artifact and streams its prepared file. It performs no archive extraction, trajectory parsing, or generation on a page request. Missing preparations return `tactical_not_prepared`, displayed as a recoverable message on the page. The browser downloads the round once and handles playback, speed, seeking, and life selection locally.

## Controls and evidence

- Everyone or a selected player: selected portraits and trails are highlighted, other players remain visible.
- Life selection and previous/next controls: seek to the first observed alive sample and stop at the selected life endpoint.
- Health bars, names, class portraits, facing arrows, and selected-player health/armor values.
- Play/pause, ±5 seconds, timeline scrubber, speed, and map zoom.
- Recent deaths are clickable and show repaired weapons where available. Suicides and team kills are labelled; the life kill counter excludes them.
- Conc rings animate at recorded concussion projectile removal positions. Removal does not prove detonation; handheld concs with no projectile track are not invented.

All movement, deaths, and effects use the replay clock. Repaired analytics weapon values attach by the existing indexed victim session and replay death time, avoiding a second clock conversion in the client. No interpolation crosses an alive/dead boundary, a long recording gap, or a large teleport. First observed alive samples and recording-end/gap boundaries are not claimed as authoritative spawn or death events.

## Pilot verification

Prepared HDPVET round 1 locally from the deployed public replay streams: 8 players, 286 scene death events, 462 concussion projectile endpoints, and a 981,764-byte compressed package without SQLite weapon enrichment. Reviewed that actual package in the browser: player/life selection, playback, health values, movement trail, death feed, and desktop/mobile layout. The server preparation includes the local repaired weapon index, which the public-stream preview cannot access. JavaScript syntax and whitespace checks were run; no tests were created, modified, or run.

Before integrating with `map.html`, review both prepared rounds on the server, compare recognizable fights and conc endpoints against the existing replay, and confirm the prototype's player-icon size and trail behavior. Automatic preparation on upload, searchable life database tables, additional effects, and map-page integration remain follow-up work after pilot approval.
