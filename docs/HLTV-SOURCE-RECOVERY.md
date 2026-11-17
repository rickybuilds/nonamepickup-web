# Recovery of unfinished HLTV captures

The bot's `recoverHltvSources.js --apply` imports finalized originals through `Registry.recoverFinalizedSource`, using the API checkout on the shared server. See the bot's `docs/HLTV-FINALIZATION.md` for SFTP inspection and rollout. No HTTP recovery endpoint or automatic replacement is added.

Recovery requires the old registered file/checksum to be intact, a missing directory on its HLDEMO header, a larger candidate with a structurally valid directory, and a matching byte prefix. The new header's four-byte directory offset is zeroed for prefix comparison; all other captured bytes must match the old registered SHA-256. Inputs are inspected through the existing storage containment/type/size/hash safeguards. New recordings preserve original match/map/server/recording time but do not claim a round until upstream log pairing verifies it.

One SQLite transaction registers the new checksum, preserves the stronger retention class/expiry, creates a protected upstream job and records both identities in `hltv_source_recoveries` and the audit log. Original review decisions, assignments, holds and bytes stay intact. Repeated calls return the same recovery/job. Recovery never marks the earlier failed run successful, releases its holds or reuses its identity for different bytes.

The private review page offers links between the unfinished capture and its recovered version. Account access and existing token access use the same authorization.

The recording list now shows only the current version of each capture. Recovered originals remain in the registry and are accessible under Recording details. Old direct links open the recovered version by default. Analysis status comes from the current version, so an earlier failed capture does not label its completed replacement failed. Active reviews/assignments stay visible; escalated and in-progress cases take precedence over a newly queued case. Notes, holds and audit history from the original remain available on the current recording. Review actions target that displayed case; file-specific actions still target the selected recording or the hold's owning demo.

The quick view shows player names and supported weapon hit-evidence rates/counts. Unsupported weapons, aim-near comparisons, exclusions, baseline progress, provenance and individual firing evidence are available under Analysis details. Storage policies, recording metadata, history and holds are collapsed by default. These presentation changes do not alter stored metrics, alert rules, account permissions, retention, files or review decisions.

For readable download filenames, add to API `.env`:

```dotenv
HLTV_FRIENDLY_DEMO_NAMES_ENABLED=true
```

Restart `tfcapi`. Downloads with verified stored log pairing use `<match>-<map>-round-<N>.dem`; unpaired recordings remain explicitly labelled `unpaired`. This flag defaults off. Physical originals are not renamed, so existing manifests, cases, copies and active downloads remain valid. Recovery creates readable new folders rather than rewriting old paths. Original HLTV filenames are retained in recovery provenance for server lookup.

The finalization guard for future routine bot downloads remains a separate default-off bot setting: `HLTV_FINALIZATION_CHECK_ENABLED=true` and `HLTV_FINALIZATION_WAIT_MS=120000`. A playable unfinished capture is not proof that its missing tail can be analyzed safely; the adapter continues to require finalization and now reports missing directory, wrong map and non-HLTV failures separately.
