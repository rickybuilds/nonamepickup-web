# Bulk game-details import

Run this on the desktop that holds the originals and a consistent private ELO backup. The API server is not needed during conversion. Required Node dependencies are the project's existing API dependencies; archive decompression uses Windows bsdtar or Linux tar with zstd support.

From PowerShell:

```powershell
cd C:/Projects/nonamepickup-web
git pull origin main
node api/scripts/importGameDetails.js --root C:/Projects/pickup-replays --elo C:/Projects/pickup-replays/elo.db --workers 4
```

The output defaults to `C:/Projects/pickup-replays/game-details.db`. The selected number of child processes perform conversion while one parent writes to SQLite. The CLI defaults to four workers and accepts 1–10 via `--workers`. Observe CPU, memory and disk usage when increasing concurrency. Do not run multiple independent writers/import commands against the same output database simultaneously.

Discovery handles `2026/<month>/<match>/round-<number>-<sha256>.tar.zst` recursively, skips hidden folders/symlinks, and deduplicates identical match/round/hash copies. A conflicting pair of different hashes for one match/round is reported for review; it is not silently selected. An unrecognized filename is outside the recording naming contract and is not selected. Discovery is a snapshot at command start; rerun to pick up files copied in later.

Recording schemas 2–7 are accepted by the existing manifest validator. Only data present in each schema is retained. Older recordings lack inventory or scene streams; the package reports absent fields, and raw death events provide attacker/victim/time where scene events do not exist. Analytics weapons still require unambiguous alignment by both Steam IDs and a per-round clock. Unknown historical information remains unknown. Corrupt, incomplete, unsupported or changing recordings are reported as failures while other rounds continue.

## Progress and resume

```text
[42/1562 · 1520 remaining · 300s] MATCHID round 2: imported · 4.10 MiB package; 240/240 weapons aligned
```

Rerun the same command to resume. Completed rounds are skipped after checking archive content hash, converter version and current per-round ELO references; their CSVs are not decompressed again. Changes to enrichment or converter code can intentionally create a new revision, so previous pilot rounds may be converted once by this newer converter. Older revisions are retained, and the API reads the latest compatible inserted revision.

Ctrl+C requests a stop after currently active rounds finish. It does not start more queued rounds. A forced termination still preserves committed transactions; rerunning retries work that did not finish. Do not copy the database to the server while the importer is running.

For an inventory-only view:

```powershell
node api/scripts/importGameDetails.js --root C:/Projects/pickup-replays --status
```

Status reports archive coverage by the current converter without hashing all files or comparing ELO contents. Exact enrichment changes are checked during import. No data is imported by `--status`.

For a selected match or limited run:

```powershell
node api/scripts/importGameDetails.js --root C:/Projects/pickup-replays --elo C:/Projects/pickup-replays/elo.db --match HDPVET --workers 2
node api/scripts/importGameDetails.js --root C:/Projects/pickup-replays --elo C:/Projects/pickup-replays/elo.db --limit 10 --workers 4
```

`--limit` selects the first N discovered unique rounds, including any that are already imported. It is not a count of new imports. To choose a different output database or JSONL report, use `--db PATH` and `--report PATH.jsonl`.

## Failures and report

`C:/Projects/pickup-replays/game-details-import.jsonl` is appended as results commit. It contains started/imported/skipped/failed and final summary records, including quality/alignment information and error messages. A nonzero exit code indicates failed or unprocessed work; stopped runs with pending work use 130. Rerunning retries failures and skips completed revisions. Correct malformed/corrupt/missing inputs rather than treating a failure as a complete recording.

Inspect failed results in PowerShell:

```powershell
Get-Content C:/Projects/pickup-replays/game-details-import.jsonl | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object status -eq 'failed' | Select-Object match,round,error
```

The report is append-only history, so an older failure remains in the file even after a later successful retry. Refer to the latest result for that match/round and the latest run summary. Keep the report and ELO snapshot private.

## Server copy

After the import exits and all writers are closed, upload the completed database to a temporary filename beside `/root/tfcbot/game-details.db`. Rename that completed upload into place on the same filesystem, rather than copying bytes over a database being read. The new file must be readable by the API process. The current reader opens fresh read-only handles, so it sees the replacement without a cache purge. This remains an offline replacement workflow; future live writes need proper batch merge/import rather than replacing a live writer's database.

Install [server import automation](game-details-server-automation.md) only after that initial transfer. Once server maintenance is writing new rounds, replacing its database with an older desktop copy can discard them; stop the writer and preserve/merge newer data before a later cutover.

Use the existing header check for any newly imported round:

```bash
curl -sS -D - -o /dev/null http://127.0.0.1:4000/api/pickup-replays/viewer/HDPVET/2/tactical
```

Expect `X-Tactical-Source: game-details-db`. Keep original archives; do not delete them as an import side effect. No database or recording is committed to Git.
