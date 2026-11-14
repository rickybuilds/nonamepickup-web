# Match heatmap comparison implementation plan

**Goal:** Ship the approved standalone same-map full-match heatmap comparison.
**Architecture:** Share overview projection and replay sampling helpers with existing Map Vision. Aggregate both rounds per match into density grids, then color both using one peak.
**Tech stack:** Existing static HTML, CSS, browser JavaScript, tactical replay API, Canvas 2D.
**Spec:** `docs/superpowers/specs/2026-11-14-match-heatmap-comparison-design.md`.
**Execution:** Implement inline in the existing clean checkout; user authorized proceeding. No additional plan approval pause. Review the completed change independently before push.

## Constraints and review focus

No test files or test runs, per AGENTS.md. Preserve existing playback. Verify four-round completeness, shared map/scale, empty activity, cancellation, bounded requests, and URL restoration. Unknown flag teams must not become color-filtered heat. Raw entity-time totals must not be labelled elapsed game time.

- [ ] Extract reusable overview, sample, flag-ownership, and density helpers into `assets/js/map-vision-data.js`; wire both existing viewer entry pages before `round-playback.js`. Keep existing behavior and validate syntax.
- [ ] Create `map-vision-compare.html`, `assets/css/map-vision-compare.css`, and `assets/js/map-vision-compare.js`. Load four datasets with at most two requests at a time, require same map and both rounds, aggregate flags/players, and render with a shared peak. Add labelled controls, URL state, totals, errors, and responsive panels.
- [ ] Add the prefilled prototype link to Map Vision, update documentation, review lifecycle and edge cases, and inspect desktop/mobile if browser/data access permits.
- [ ] Run syntax and whitespace checks, obtain independent review and fix material findings, then commit and push all completed changes.
