# Map Kill Layers Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation.

**Goal:** Switch the map dots among carrier deaths, defensive kills, and offensive kills with team and weapon filters.

**Architecture:** Index scene deaths and victim positions during replay validation, persist them separately, and resolve recorded round sides on API reads by matching player team names to round offense/defense teams. Reuse the existing map renderer and filters.

**Tech Stack:** Node.js, Express, SQLite, vanilla JavaScript, HTML, CSS.

**Spec:** docs/superpowers/specs/2026-11-11-map-kill-layers-design.md

## Global Constraints

- Do not create, modify, or run tests.
- Preserve unrelated working changes and the existing overview projection.
- No inferred roles for missing round records.

## Review Focus

- Missing roles: exclude unclassified kills and explain coverage.
- Missing positions: omit stale samples and suicides/team kills.
- Empty filters: clear stale player/weapon choices when changing layers or games.
- Async layer changes: never render a stale response over the selected layer.
- Existing data: provide idempotent backfill and clear unindexed states.

### Task 1: Replay kill index

- [x] Add kill extraction and persistence, wire validation and ingestion, and supply an archive backfill script.
- [x] Check modified JavaScript syntax without running tests.

### Task 2: Combat API

- [x] Add `/api/map/:map/kills` with identities, roles, weapons, teams, indexed-round coverage, and bounded results. Enrich carrier deaths with matching kill metadata.
- [x] Review SQL joins for duplication, missing roles, and identity ambiguity.

### Task 3: Map tabs and filters

- [x] Add accessible layer buttons and team/weapon selects; update labels, options, counts, and tooltips from the active data.
- [x] Preserve zoom and game/player selections where valid; handle loading, unavailable, empty, and unindexed states.
- [x] Check JavaScript syntax, whitespace, and the design detector; review the final diff. Do not run tests.

Review: corrected side classification to use round teams (the `role` column may contain class names). Expanded weapon labels and drew the overview before data loading so API failures retain the map. Design detector findings concerned incumbent page styling, which this scoped change preserves. Runtime/API behavior has not been exercised against a populated replay database; server backfill remains a deployment step.
