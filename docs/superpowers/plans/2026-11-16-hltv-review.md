# HLTV infrastructure plan and design

Goal: retain existing downloaded demos and provide private, auditable manual review while the external analyzer is unavailable.

Architecture: existing SFTP retrieval writes to private storage when enabled. Atomic manifests feed a dedicated SQLite registry through a separate worker. Express serves an individually authenticated admin UI/API. TFCbot drains a durable alert outbox to one configured private channel. No new dependencies.

Decisions: reuse both clean checkouts. Preserve originals without copying. Do not guess round IDs from filename order. Use individual random bearer credentials stored as SHA-256 hashes, mapped to explicit Discord IDs. No reusable website login exists. Guild administrators inherently retain Discord channel access. Hold SQLite IMMEDIATE locks through verified unlink to coordinate holds and cleanup across processes. No automatic analyzer or viewer until the external implementation is supplied.

Tasks:
- Add tests for registry deduplication, holds, cleanup, unauthorized access and channel privacy.
- Hook successful hltvFetch finalization at both match-aware callers; preserve ZIP delivery and prevent legacy temporary cleanup from deleting retained originals.
- Add versioned schema, private path validation, hashing, manifest ingestion and local backfill.
- Add cases, notes, holds, policies, retention extension, evidence verification, audit and notification outbox.
- Add disabled-by-default cleanup, dry-run, crash reconciliation and storage metrics.
- Add private admin queue/detail API and UI with credentials held only in memory.
- Document analyzer contract, configuration, rollout, backup/recovery and capacity emergencies.
- Verify, review, commit and push under repository instructions.

Review focus: path/symlink substitution, duplicate manifests, hold/deletion interleaving, authorization, disabled behavior. Cleanup requires complete analysis or an explicit audited manual waiver. Open reviews and evidence always block deletion. Real demo/parser validation requires samples and the external parser.

## Execution record

Implemented all infrastructure tasks. External parser execution, analysis scheduler/results integration and playback are deliberately pending; see the contract and runbook. Independent review fixes: include ignored source directory, filter cleanup eligibility before batching, track physical duplicates, enforce global physical-key ownership, support verified restore, commit deletion intent before unlink. Validation: 19 new tests plus desktop/mobile local Chrome workflow. Full-suite failures match original-source baseline (website 15, bot 2). No deployment flags were enabled and no production alerts sent.
