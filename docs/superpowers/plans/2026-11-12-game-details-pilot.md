# Game Details Pilot Implementation Plan

> Execute inline with the executing-plans skill. Work in the current main checkout, per the user's branch preference.

**Goal:** Convert HDPVET round 1 from an original local archive into a separate pilot SQLite database without modifying ELO or the deployed reader.

**Architecture:** A local CLI discovers one archive recursively and verifies its hash. A conversion module builds the existing playback representation plus richer sampled telemetry and lossless small event/definition streams. One transaction saves a versioned compressed package, indexed events, player/life rows and provenance. An optional read-only ELO snapshot supplies repaired weapons, analytics and team-role references. Missing source data remains unknown.

**Tech stack:** Existing Node.js, tar, gzip and better-sqlite3 dependencies.

**Spec:** `C:/Projects/pickup-replays/AMXX-TACTICAL-RECORDING-HANDOFF.md`, limited to the first offline archival pilot.

## Constraints

- Do not create, modify or run tests. Verify syntax and actual conversion artifacts only.
- Do not alter originals, ELO, API behavior or unrelated untracked overview assets.
- No MariaDB connection or production credentials for offline conversion.
- Missing HDPVET is a waiting condition; do not substitute another match or old lossy package.
- No production database replacement or deletion. No new worktree; user requested main.

## Review focus

- Incomplete transfers fail hash/manifest checks before database writes.
- No guessing historical weapons, owners, role swaps or detonation semantics.
- Missing CSV fields are null/unknown rather than fabricated zero values.
- Same source and enrichment snapshot resumes without duplicate rows.
- Read-only ELO and output database must resolve to different files.

## Tasks

- [x] Add the schema-7 offline conversion/store module, preserving raw small streams and sampled gameplay fields, plus indexed raw events and life summaries.
- [x] Add the local discovery CLI with optional ELO enrichment and content revision checks, no server dependencies.
- [x] Document exact commands and limitations; check Node syntax and CLI help.
- [x] Convert HDPVET round 1 when the original arrives, inspect SQLite counts, compressed package round-trip and byte sizes. If not present, report the remaining prerequisite explicitly.

## Execution record

HDPVET originals absent at initial discovery. Audit packages exist but are not acceptable conversion sources. No ELO backup found in the replay folder. Rich telemetry can be preserved without it, but repaired historical weapons/round roles require enrichment and must be labelled missing until supplied.

HDPVET arrived under `2026/11`, followed by ELO. Converted round 1 first without and then with read-only ELO enrichment, keeping the unenriched database separately. Enriched pilot: 4,331,020-byte package; 7,516,160-byte standalone database; 8 players, 291 sampled lives, 8,888 distinct raw stream records. Aligned 229/229 indexed enemy kills, offset -58.154s. SQLite quick-check, foreign-key inspection, payload hash/decompression/identity and syntax checks succeeded; no tests invoked. Production API remains unchanged. Converter revision 2 corrects the diagnostic interpretation of -1: it is a missing-value sentinel for inventory fields, while negative movement/view values remain valid.
