# Ghosty upstream adapter: no fork required

Optional firing comparisons and personal histories are now implemented separately behind default-off statistics flags. See [private player statistics rollout](HLTV-PLAYER-STATISTICS.md); provisioning assets and validating a real Linux run are required before automatic collection.

This connection uses the official [ghostile/goldsrc-hltv-tools](https://github.com/ghostile/goldsrc-hltv-tools) repository without modifying its files or pushing to it. Our transport, queue and access controls stay in `nonamepickup-web`; upstream algorithms stay in upstream. No submodule edit or fork is required.

## Connected capability

The private background worker calls the actual upstream `goldsrc_demo.Demo.parse`, `demo_viewer.export_demo`, `server_log.align_log` and `web/conc.js.withLog`. It verifies the registered demo checksum and both existing raw logs' combined source hash, then lets upstream test each log against the demo. Exactly one accepted log is required. Filename order, equal map names or file counts never establish the pairing. Insufficient kill anchors, inconsistent clocks, wrong sources and ambiguous pairing fail with a retained hold.

For an accepted match, results include the upstream commit, log round/hash, alignment anchors/residuals/uncertainty, pause intervals and logged concussion events with upstream estimated timer windows. Upstream's stock duration defaults and pause/death/cure/track rules are used unchanged. No replacement timer or anomaly algorithm is implemented here. These outputs are gameplay estimates, not cheating probabilities or verdicts. Zero concussion events is not a clean anti-cheat result.

The first connection does **not** host Ghosty's 3D viewer, run weapon/hitbox comparisons, or emit Discord anomaly alerts. Those capabilities need game assets and a separately reviewed authenticated viewer service. Never proxy Ghosty's entire localhost HTTP application publicly: its listing/upload/export/filesystem-oriented features are not this API. Decoding and matched-log concussion estimation here do not need a Half-Life installation; the later rendered viewer does. Game assets are not included or redistributed.

The original registry `analysis_status` remains `unsupported` for automated anomaly detection. The separate `hltv_upstream_runs` table and **Conc analysis** UI column report this real connected capability, avoiding a false complete/clean detector status.

## Install on the existing Linux web server

The user deployment runs bot/API/worker as root on one server. Required tools: Git, Node, Python 3.9+ and a running systemd manager with memory cgroup support and permission to create transient services. No pip packages are needed. Other service users need access to the same private sources and permission for the configured transient services; fail closed if that is not provisioned. Do not change the bot or game server for this connection.

Pull the website repository in `/var/www/tfcbot`. Append to **`/var/www/tfcbot/api/.env`**:

```dotenv
HLTV_UPSTREAM_ENABLED=false
HLTV_UPSTREAM_ROOT=/opt/noname-hltv-tools
HLTV_UPSTREAM_PYTHON=python3
HLTV_UPSTREAM_MEMORY_BYTES=2147483648
HLTV_PARSER_LOG_ROOT=/var/lib/noname-parser
```

Install/check the real upstream source:

```sh
python3 --version
node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --check
node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --apply
```

`--check` is the default and reports the current pin and official remote HEAD without changing anything. `--apply` installs an untouched checkout under `/opt/noname-hltv-tools/releases/<commit>`, verifies official origin/commit/clean files, imports the Python APIs, exercises the real matcher and conc transport with labelled synthetic compatibility fixtures, and runs upstream's three regression scripts. On Linux it also checks a transient service's actual memory cgroup limit. Compatibility failure leaves the previous active pin unchanged. Full decode of the user's actual recording still needs the live test below; synthetic compatibility is not real-demo validation.

After installation succeeds, set `HLTV_UPSTREAM_ENABLED=true` and restart **only the website API**:

```sh
pm2 restart tfcapi --update-env
```

## First real match

Use the already-registered, automatically retained `78ZA59` demos and source logs. On the review page open each demo and choose **Run Ghosty conc analysis**, or queue the match locally:

```sh
node /var/www/tfcbot/api/scripts/analyzeHltvDemo.js --match 78ZA59
flock -n /var/lib/noname-hltv-worker/worker.lock node /var/www/tfcbot/api/scripts/hltv-worker.js
```

The existing five-minute worker processes at most one queued upstream run per pass, serially. For two demos run the worker twice or wait for the next cron pass. Source demos and logs are read from their existing private locations, never downloaded/re-uploaded/copied for this work. The CLI only queues existing registered available demos; it does not invoke normal match reporting or any public stats upload.

Refresh the review detail to see the latest run. A successful report gives a **verified matched log** and estimated concussion windows. A failure exposes a safe error code, and rejected log-pair candidates show the upstream matching reasons when available. Consult `/var/log/noname-hltv-worker.log` for private operational detail. The result is versioned by demo hash, log hash and exact upstream commit. Source parser directories can be explicitly replaced by their own operator; these hashes preserve which source version was used but do not make that external store immutable.

Every user-requested upstream run adds an explicit hold. That hold persists after both success and failure until an authorized admin releases it after inspection. Queued/processing runs also independently block demo cleanup even if someone releases their hold early. These rules do not shorten manual evidence/report holds or set an anti-cheat clean verdict. A retry is another explicit request, with its own hold; resolve obsolete failed-run holds deliberately.

## Resource and recovery controls

On Linux each Python/Node analysis stage runs as the current worker UID through a transient systemd service with a whole-process memory cap (default 2 GiB), no swap, one-CPU quota, 180-second runtime, five-second stop timeout, task limit, no new privileges, private network/tmp and read-only system mounts except its generated scratch directory. The parent also bounds stdout, wall time and subprocess lifetime; Python adds address-space/CPU limits. The Node heap cap is supplemental, not the process RAM guarantee. The installer verifies memory enforcement before activation. This uses systemd's [transient service controls](https://www.freedesktop.org/software/systemd/man/latest/systemd-run.html).

The worker checks `/proc/meminfo` for at least the configured budget plus 256 MiB available before starting, as well as normal storage headroom. Adjust the budget only after measuring; too small a budget produces a held failed run. Do not disable resource isolation to force large inputs through a busy match server. Actual jobs require Linux/systemd; Windows compatibility checks cover imports and the algorithm/transport contract only.

Decoded meta/binary data is temporary under `/srv/noname-hltv/cache/ghosty-<run UUID>`. It is removed after the run. A killed worker leaves its raw-source hold intact; processing rows older than ten minutes become failed on recovery. Known scratch files for completed/failed jobs are reaped on subsequent enabled passes, so crash retries do not accumulate large decoded caches. Cleanup is scoped to those job UUID directories and fixed temporary filenames; it never recurses through raw demos or source logs. Unexpected files/symlinks are retained for investigation. Original demo cleanup still uses its existing checksum/hold/lease safeguards.

If upstream or sources are missing, disabled, changed, corrupt, unmatched, timed out or unsupported, the job fails and retains its hold. Failed work is not automatically called clean. There is no background fetch/update of upstream during a job.

## Updates and rollback

When Ghosty publishes an update:

```sh
node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --check
node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --apply
```

No edits to your bot, no fork and no upstream merge are required for compatible revisions. The pin switches atomically only after checks. Running jobs retain their immutable old release directory; new jobs use the new pin. Unsupported upstream export/API changes intentionally block activation until our adapter is updated. The initially verified contract is upstream export version 16 at `fdc1d372ead25b63dc19ebd176f949503e86cdd9`.

To roll back, use an installed known-good full commit SHA:

```sh
node /var/www/tfcbot/api/scripts/updateHltvUpstream.js --apply --revision FULL_40_CHARACTER_SHA
```

The output/`active.json` includes `previous`. Reanalysis is explicit; updates do not silently overwrite old results or rerun all demos. Keep old releases while jobs/results depend on them. Do not `git pull` inside a pinned release or edit it; dirty releases are rejected. An interrupted updater may leave `update.lock` and `.staging-*`; inspect that no updater is running before manually removing its lock. Never clear a live job's source holds merely to repair an update.

## Licensing and validation limits

Upstream's MIT license and credits remain in every untouched checkout. Optional GPL server plugins are not installed by this adapter. No Valve/Steam content is bundled. Rights to hosted game assets must be resolved before publishing any viewer asset bundle.

Local verification covers upstream Python import/export contract, real upstream matching/conc regression probes, its three JS regression scripts, authenticated queue controls, source-hold races, timeout/output guards, orphan cache cleanup and UI behavior. The source demos and `/var/lib/noname-parser` logs exist only on the user's server; a live run and Linux transient-service validation are the remaining rollout checks, not claimed completed by local fixture tests.
