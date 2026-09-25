# Project 2080 Player Dossier Art-Direction Implementation Plan

> **For agentic workers:** Execute this plan inline with superpowers:executing-plans. The user approved the design and explicitly selected inline implementation.

**Goal:** Recompose the Player Detail view into an identity-led competitive archive dossier with a single desktop/mobile story order.

**Architecture:** Keep all existing API requests and data transformations in `refactor/player-detail.js`, wrapping the existing view into semantic dossier chapters and reordering them to match the approved narrative. Build the visual system in `refactor/player-detail.css` using Project 2080 tokens, current assets, and responsive rules; preserve every existing control ID and destination.

**Tech Stack:** Static HTML strings, vanilla JavaScript, scoped CSS, existing `/api/` endpoints, browser-rendered verification.

**Spec:** `docs/superpowers/specs/2026-09-25-player-dossier-art-direction-design.md`

## Global Constraints

- No API/data changes, data removal, unrelated parity work, or new test files.
- Preserve every dossier value, filter, navigation link, supporter marker, chart, history record, expandable detail, and pagination behavior.
- Keep Project 2080 palette, typography, and navigation authoritative.
- Desktop and mobile share this order: identity/standing → ELO career trajectory → recent matches → performance → play style → activity → relationships → map tendencies → connected records.
- Repository instruction: do not run tests unless explicitly requested.

## Review Focus

- Query and deep-link behavior: preserve `view=player`, ID query, and existing target URLs; verify in browser after render.
- Hidden or unavailable rating data: keep existing private-rating states; inspect existing guards and retain them.
- Dense dynamic lists and long identities: prevent image, text, and result collisions at phone width.
- Match and class filters: preserve existing IDs and event wiring when inserting chapter wrappers.
- Map images and responsive crops: inspect the complete page in both color themes if the visual pass requires it; report unavailable assets rather than changing data behavior.

---

### Task 1: Recompose the player dossier markup and chapter order

**Files:**
- Modify: `refactor/player-detail.js`

**Interfaces:**
- Consumes: existing `renderPlayerDossier(helpers)`, API responses, and helper functions.
- Produces: the same rendered page data and existing controls, grouped into semantic sections in the approved sequence.

- [x] Keep existing queries, transforms, helper calls, IDs, event listeners, and external/internal destinations intact.
- [x] Refactor only the `set(...)` template and targeted render fragments to create these direct chapters in order: identity/standing; career trajectory (career snapshot and ELO chart); recent matches (records and pager); performance; play style (filters and `#dossier-granular`); activity heatmap; relationships; map tendencies; connected records.
- [x] Build match history as one featured record plus four compact strips for the visible page; preserve the complete match record markup and all report links for each match.
- [x] Recompose performance around K/D plus a proportional kills/deaths comparison, with damage and objective/movement totals grouped by importance. Reuse current values without changing formatters or sources.
- [x] Make offense/defense share of class time and existing class percentages available in a single visual fingerprint while retaining all role metrics and filter behavior.
- [x] Keep current supporter-aware identity rendering for the subject, teammates, victims, aliases, and match rosters.
- [x] Run `node --check refactor/player-detail.js` and inspect the diff for removed IDs, API calls, or links. Do not run or add automated tests.

### Task 2: Art-direct desktop and mobile chapters

**Files:**
- Modify: `refactor/player-detail.css`

**Interfaces:**
- Consumes: semantic chapter classes and existing data markup from Task 1.
- Produces: a responsive dossier composition that preserves Project 2080 tokens and existing global navigation.

- [x] Replace the additive override pile with a coherent page-scoped stylesheet for the dossier; retain required baseline selectors and media behavior, removing superseded declarations from this file only.
- [x] Give the identity masthead an asymmetrical portrait/name arrangement; make current ELO/rank/form subordinate to the name and portrait, and render the secondary career rail with a clear typographic hierarchy.
- [x] Give the ELO line a wide low-furniture chart surface with current, peak, low, and real date context. Contrast activity with a compact dark heatmap field.
- [x] Render recent history as a large image-led first match and four ruled contact-strip records with unmistakable W/L/T semantics and readable score/ELO movement.
- [x] Use scaled paired values/bars for performance, role-tinted offense/defense visual fingerprints, a blue/red teammate/opponent split, and an asymmetric most-played/best/toughest map image composition.
- [x] At mobile widths keep the approved chapter sequence; stack and crop imagery intentionally, keep chart text visible, avoid horizontal overflow, and preserve current navigation/compositions.
- [x] Keep all styles scoped to `.player-dossier` or existing `.dossier-*` selectors; use palette and typography tokens rather than changing shared design rules.

### Task 3: Render and review the complete dossier

**Files:**
- No additional product files unless a concrete visual defect is found.

- [x] Start a local static preview backed by existing read-only production APIs and render the direct Carbon player profile.
- [x] Inspect the entire page at desktop and mobile in the approved chapter order; compare the full-page silhouette and individual visual encodings against the live production Carbon profile.
- [x] Confirm identity, supporter diamond, match results, ELO chart, activity grid, relationships, map history, filters, pagination, links, and expanded details remain represented.
- [x] Make one focused correction pass based on rendered defects, then re-render the affected desktop and mobile views.
- [x] Run `node --check refactor/player-detail.js` and `git diff --check`; do not run automated tests.
