# Offline game-details pilot

For the full archive tree, use the [bulk import instructions](game-details-bulk-import.md). The shared converter now accepts schemas 2–7, retaining only fields/streams actually present; the HDPVET pilot measurements below describe the original schema-7 experiment.

This is a schema-7, one-round archival conversion pilot. The importer does not write to ELO or change the API configuration. The tactical API can read its output as described below. The output format is experimental, not the final AMXX recording contract. It retains the original manifest, small semantic CSV streams, companion analytics when supplied, sampled player inventory/view/movement, projectile/objective/building tracks, and an embedded existing-format tactical playback.

It indexes raw events (scene and event streams separately), players and sampled life summaries in SQLite. A death can appear in both raw streams; do not add them together as a unique kill count. The indexed events remain lossless raw source events; repaired weapons are applied to embedded playback and retained with their reference/provenance data, not silently rewritten into raw evidence. Looking angles and ownership are preserved as recorded, not claimed correct merely because a field exists. This is not a lossless archive replacement: detailed rendering and full-rate geometry/animation are omitted.

From the repository root in PowerShell:

```powershell
node api/scripts/pilotGameDetails.js --root C:/Projects/pickup-replays --match HDPVET --round 1
```

The command recursively discovers `HDPVET/round-01-<sha256>.tar.zst`, including year/month folders, and writes `C:/Projects/pickup-replays/game-details.db`. If the archive is absent, it exits with code 2 and does not open the output database. If multiple originals match, select a specific path with `--archive PATH`. It skips hidden directories/symlinks and never substitutes an old audit package. A partial transfer fails checksum/manifest verification before database writes.

For repaired historical weapons and recorded role/roster references, supply a consistent SQLite backup:

```powershell
node api/scripts/pilotGameDetails.js --root C:/Projects/pickup-replays --match HDPVET --round 1 --elo C:/Projects/pickup-replays/elo-snapshot.db
```

The snapshot is opened read only. Do not copy only the main file of a live WAL-mode database; use SQLite's backup facility. Keep the private snapshot outside public web directories. Without it, conversion still preserves the recorded data but reports unavailable weapon/role references. Rerunning with a snapshot creates a separate enriched revision; identical source and references reuse the same revision. The API selects the most recently inserted compatible revision for a round. Earlier revisions are deliberately retained; import enriched data last when replacing an unenriched revision.

The converter validates original archive SHA-256 against its filename, manifest identity/completeness, retained CSV byte counts and sampled stream row counts. It hashes again before writing to detect a changing transfer. It writes one transaction per round and verifies the stored compressed bytes and decoded source identity. Console output reports actual package/DB sizes and coverage. No test suite is invoked.

Keep originals. This command is not bulk ingestion, a server merge/import or an AMXX change. Missing historical weapons require authoritative analytics; missing building ownership, reload data or confirmed explosions cannot be manufactured. Current playback lives are sampled estimates rather than exact authoritative spawn events. Output should remain on local disk and outside the web root. Linux requires `tar` with zstd support; Windows bsdtar detects the archive encoding automatically.

## Serving playback from the database

The existing `/api/pickup-replays/viewer/:matchId/:round/tactical` endpoint first checks the details database, opened read only. `GAME_DETAILS_DB` defaults to `game-details.db` beside the configured `ELO_DB`. With the deployed ELO path `/root/tfcbot/elo.db`, the default is `/root/tfcbot/game-details.db`. No new setting is needed for that location. To choose another location, set `GAME_DETAILS_DB` in the API environment.

After pulling the reader change, restart the API:

```bash
cd /var/www/tfcbot
git pull origin main
pm2 restart tfcapi --update-env
curl -sS -D - -o /dev/null http://127.0.0.1:4000/api/pickup-replays/viewer/HDPVET/1/tactical
```

Expect `X-Tactical-Source: game-details-db` (HTTP header names are case-insensitive). The page URL stays `/round-playback.html?match=HDPVET&round=1`. Only the embedded public playback is returned; raw CSVs and private companion analytics never form part of this response. The richer database package is decoded once per cached revision, and only the smaller playback response is recompressed/cached. Compressed response cache is bounded to eight entries/16 MiB. Package length and decompressed length are bounded and checksummed before use.

A missing database or missing round falls back to the existing prepared file and returns `X-Tactical-Source: prepared-file`. Incompatible/corrupt packages also fall back, with an API warning. If the prepared file is absent too, the existing endpoint error behavior applies. An imported round is read before any MariaDB artifact lookup, but this change does not remove the API server's existing replay/MariaDB startup configuration requirements.

The database is not mounted as a public file. The reader closes its handle after each lookup and keys its bounded response cache by revision and payload hash, so a complete offline database replacement is visible. Replacing a live database while another process writes to it is outside this pilot; use proper imports/backups for future live ingestion. This still supports only the pilot package format, not the future AMXX format.

## HDPVET round 1 measurement

Converted the original `2026/11/HDPVET/round-01-097b42fffd6d07de516d8ebec32b7fc08713cf8703a7128e5f3d8ff7d02c9df9.tar.zst` with the supplied local ELO copy opened read only:

- Original: 18,095,413 bytes (17.26 MiB).
- Compressed richer detail package: 4,331,020 bytes (4.13 MiB).
- Standalone database including queryable raw events: 7,516,160 bytes (7.17 MiB).
- Eight players, 291 sampled lives, 6,517 event-stream records and 2,371 scene-stream records.
- All 229 indexed enemy kills aligned to analytics weapons, using a round offset of -58.154 seconds. The 286 embedded playback deaths include cases outside that enemy-kill index; do not claim every death has a weapon.
- Role reference retained: Team A attacking, Team B defending for this round.
- Recorded player sample count reduced from 360,754 to 103,575; immediate tracked inventory/input/state changes cause a rate above the nominal 10 Hz movement interval. Projectile, building and objective tracks are retained too.
- SQLite quick-check returned `ok`, foreign-key inspection found no issues, and stored compressed SHA-256 matched its metadata and decompressed source identity.

The result is larger than the earlier 1 MiB playback cache because it retains substantially more gameplay data and searchable raw event rows. This pilot also intentionally duplicates raw events inside the compressed evidence package; production storage can revisit that choice after queries and the canonical schema are agreed. The first unenriched measurement was moved into `.audit/game-details-unenriched-pilot.db`; it is not included in the enriched database's size above.
