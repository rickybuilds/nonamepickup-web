# Defense Ratings implementation plan

## Intent
Add a dedicated experimental Analytics tab for Soldier, Demoman, HWGuy and Engineer, using the existing Capture Ratings style and loaded-data interaction patterns. User explicitly authorizes focused tests, autonomous implementation, commit and push; no production deployment.

## Data gate
Audit persisted match/round/class/role/capture records and replay collection. Aggregate class seconds, primary class, class-at-kill or class name alone cannot establish full-match defensive participation. Only publish ratings with verified compatible role/class/team participation and capture-result coverage. If unavailable, complete the API/UI foundation with explicit unavailable values and missing-telemetry explanation rather than inferred ratings.

## Work
- Backend source audit, truthful API contract and focused eligibility/compatibility regressions.
- Defense tab, class/map/filter controls, dashboard views, spotlight/search contract, accessible responsive empty states; reuse existing styles/components without copying the capture controller.
- Document sources, units, baseline/formula and missing telemetry; focused test and syntax checks, bounded visual review, diff review.
- Commit and push main, preserving unrelated map assets.
