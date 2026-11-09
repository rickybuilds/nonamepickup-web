# Lossless pickup replay database storage

## Intent

Preserve all recorded data from the game-server replay CSVs in the existing MariaDB database, retain full replay and future analytics capabilities, and enable a later, separately reviewed reduction in redundant game-server files. Do not discard samples or derive a reduced substitute for the original data. Data that the recorder never captured cannot be reconstructed.

## Current behavior

Game servers package each finalized round's schema-dependent CSVs, manifest, and ready marker as a zstd-compressed tar archive and upload it to the website. MariaDB stores replay metadata, but the verified archive itself remains on the website filesystem. The replay viewer and flag carry/death backfills extract individual members from that file. The uploader may record a terminal quarantine receipt as well as a verified receipt; quarantine is not a verified replay.

The successful flag-death backfill only establishes coverage of that derived feature. It does not establish that all source rounds on all game servers reached the website or that every byte is already in MariaDB.

## Approaches

1. Import every CSV row into relational tables. This enables direct SQL queries on every field, but creates substantial schema, indexing, ingestion, and storage costs and can lose file-level fidelity unless separately preserved.
2. Store the exact compressed round archive in MariaDB, in bounded ordered chunks with its original SHA-256 and length. This preserves every included file byte and supports full replay, but individual data points are not directly SQL-queryable without decoding the archive.
3. Use lossless database archive storage as the source of truth and build indexed tables for selected analytics as needed. This is the proposed direction: preserve the original round in MariaDB first, then add queryable projections, such as flag routes, without requiring a wholesale database migration. Chunking and storage size will be measured, not assumed to reduce disk use.

## Required behavior

- Store the **complete original compressed archive**, including every included CSV, manifest, and ready marker, byte-for-byte; do not downsample, filter fields, convert numeric precision, or omit schemas or aborted rounds that were accepted and retained.
- Associate a complete database copy with the existing artifact identity, match, round, schema, length, and original SHA-256. Use an additive MariaDB schema and bounded chunks; do not depend on a single unbounded database packet.
- Backfill existing retained, verified replay artifacts in resumable, idempotent batches. Read the source in a bounded-memory stream; stage chunks in order; read the stored chunks back; verify total length and SHA-256 against the artifact before atomically publishing the database copy. Interrupted or mismatched copies must remain incomplete and be eligible for retry. Coordinate concurrent upload and backfill writers, and reconcile uncertain commits before retrying.
- Inventory each game server's retention configuration, active and finalized rounds, upload receipts, unuploaded, aborted, quarantined, non-primary and missing artifacts, and CSVs or schemas outside the current packaging allowlist separately. Identify inputs already removed or otherwise unrecoverable. Do not report terminal quarantine as a verified replay. Existing uploader retention is not proof that a round is in the new database store.
- Ensure newly accepted replay uploads reach the same lossless database store. Do not acknowledge database preservation until it is committed and independently verified. Preserve the existing uploader's compatibility and distinguish ordinary upload verification from database-copy verification during transition.
- Update replay member streaming and the existing flag carry/death recovery paths to read verified database-backed artifacts, including rounds previously stored on the filesystem. Prefer database copies only after verification. Preserve existing replay routes, access controls, and expected CSV bytes. Keep an explicit legacy-file fallback during migration. Clean up database streams and subprocesses on cancellation, disconnect, or error.
- Keep database storage private and bound reads/writes. Do not expose raw database credentials or storage paths to clients. Handle duplicate uploads, concurrent backfill and upload, connection loss, partial transactions, and missing chunks without marking incomplete data complete.
- No new automatic deletion, migration cutover, server cleanup, or retention changes are included. Existing uploader retention **may already delete** a local round after either a verified response or terminal quarantine when a positive retention window is configured; audit this setting on each server before claiming those local files will remain. Report active cleanup and recommend holding it until database-copy and backup coverage are established; do not silently change production settings. Provide a read-only report of storage coverage, bytes, and unresolved rounds; any later cleanup requires separate user direction after verification and independent backup decisions.
- Preserve sample timestamps, row order, schema versions, and manifest diagnostics, including dropped-snapshot counts. A verified copy is lossless relative to the recorded archive, not proof of samples the recorder did not capture.

## Storage and performance

MariaDB is already deployed and is the intended storage engine. A separate database/schema versus additive tables in the existing pickup database is an implementation choice constrained by deployed permissions and backup policy. The database copy occupies storage on its host; moving bytes into a database on the same disk is not itself a space saving and can temporarily require both copies plus database overhead. Independently backed-up data is required before later cleanup is considered.

Measure representative archive sizes, import throughput, database growth, peak temporary disk/memory usage, and replay-read cost. The replay viewer may request multiple streams concurrently, so ensure the database-backed path does not load an entire round per request into memory or exhaust the connection pool. If the measured design cannot meet practical limits, report the limitation instead of marking the migration complete.

## Scope and verification

First deliver the lossless database copy, resumable migration, read compatibility, and coverage reporting. The requested Flag Pace “View route” feature and a complete SQL schema for all telemetry are subsequent work built on the preserved source. No existing test files may be changed, no new test files created, and no tests run, per repository instructions. Use appropriate non-test checks and carefully scoped inspection of representative archived data; establish exact byte-for-byte readback and replay compatibility before any production cleanup decision.
