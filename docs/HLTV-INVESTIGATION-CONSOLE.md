# HLTV investigation console

## Scanner workflow

The bounded upstream statistics worker calls the pinned Ghosty viewer's `runAnalysis()` once per verified demo. That function runs both the wall-track and pre-shot snap scans. Map geometry is required for wall-track line of sight; the worker also verifies required player models before recording a scanner result. A completed scanner payload contains an explicit empty `findings` array when no candidates qualify. Older firing-only payloads do not establish that either scanner ran.

`HLTV_UPSTREAM_ENABLED=true` and `HLTV_STATISTICS_ENABLED=true` are both required for scanner processing. Keep the existing pinned upstream release, private map/model asset root, verified source logs, and bounded worker configuration. The registry changes are additive and self-upgrade existing databases when the service starts. `HLTV_STATISTICS_AUTO_COLLECT` controls automatic collection of new recordings; it is not needed for a reviewer's manual reanalysis request.

Open a retained, verified recording in the authenticated review console and select **Run / Reanalyze Wall-Track & Snaps**. This uses the existing `POST /api/admin/hltv/demos/:id/upstream` queue, deduplicates an active run, and keeps its evidence hold. The worker verifies the retained demo bytes and source pairing, reads private assets through its constrained asset manifest, and stores the result in the content-addressed statistics store. It does not download the demo again. Reanalysis is per recording; the archive is not automatically reprocessed. Use the console's Refresh button to check queued, running, and terminal status.

The investigation and player timeline APIs report `scanner.wall_track` and `scanner.snap` states: `not_analyzed`, `queued`, `running`, `completed`, `failed`, `unsupported`, or `missing_assets`. Completed with `count: 0` means the pinned scanner finished with no candidate leads under its recorded settings. Failure explanations, run ID, upstream SHA, configuration hash, settings, and whether an older result remains available are included. The action is available only when the server flags and retained file permit a run. A failed reanalysis does not erase a previous content-addressed payload; its findings remain marked as previous results.

Wall-track intervals and snaps appear in their respective tabs and the filtered evidence timeline. Selecting an event opens its evidence inspector. Violet markers represent wall-track intervals; amber markers represent snap samples. Concussion markers are cyan and firing markers blue. Intervals show start, end, and duration. Snap timestamps identify the sampled angular change near firing; their upstream pre-shot window is shown separately. The event inspector exposes available movement, angular, visibility, firing, source, and limitation context. Reconstructed occlusion cannot establish what a player heard or knew; a candidate is not a cheating verdict or probability.

Times in the event API are seconds from the demo start. The existing authenticated file route provides a verified demo download and temporary download hold. Reviewers can copy an event timestamp and seek to it in the pinned local viewer. No private evidence is served on a public static route.

## Verification and limits

Run the HLTV tests from the website repository with `HLTV_TEST_UPSTREAM_ROOT` set to the pinned local checkout. The deterministic tests invoke the actual pinned `runAnalysis()` to confirm a terminal empty result, reject unsupported revisions, and fail on missing map assets. They also cover scanner states, content-addressed persistence, previous result provenance, authenticated reanalysis, duplicate prevention, player filtering, timeline conversion, browser interval/snap rendering, and existing evidence holds.

No authorized complete `.dem` plus private map/model fixture was available in the local projects during this change. The optional real-asset integration test remains skipped until `HLTV_TEST_UPSTREAM_ROOT`, `HLTV_TEST_PYTHON`, and `HLTV_TEST_ASSETS` point to an authorized complete fixture. Production findings and scanner execution on a real demo remain to be confirmed by an operator after the normal deployment workflow. This change does not deploy or restart production.

## Failure and evidence guarantees

Every queued upstream run creates an explicit evidence hold. A failed run remains protected after that temporary hold is released until an authenticated reviewer records the separate **Dispose failed analysis** action. Cleanup therefore cannot infer that a failed or interrupted run is safe to delete. The disposition and failure stage are written to the audit trail.

When a parser round is accepted, the original log bytes, pairing metadata, source checksum, and manifest checksum are stored in a compressed content-addressed snapshot. Reanalysis uses that immutable snapshot when one exists, and rejects any attempt to attach conflicting metadata to the same bytes. The API exposes only safe diagnostic categories and next actions; private filesystem paths and raw worker errors stay server-side.

The authenticated worker-status endpoint reports queue depth, current run, last successful pass, configured capability flags, and the latest safe diagnostic. The console polls a queued or running reanalysis until it reaches a terminal state. Scanner findings with no valid Steam identity remain in the aggregate timeline as **Identity unavailable** rather than disappearing from investigation results. Real-demo validation is still pending until an authorized fixture is configured; no result is fabricated when it is absent.

Terminal scanner outcomes also create one durable shared-registry notification outbox row for tfcbot. A zero-finding scan, candidate scan, and failed scan have distinct outcomes; legacy statistics-only payloads are silent. The bot formats the persisted summary in the configured private review channel, uses the demo and scanner-tab deep link, retries transient delivery failures with the existing bounded lease, and does not backfill historical runs automatically.
