# Capture Ratings dashboard redesign

## Intent and design
Extend the existing Analytics Capture Ratings tab using the supplied esports dashboard reference. Preserve the NoName navigation, typography, page width and established navy/cyan surfaces. Use green/red signed metrics and accessible explanatory text.

## Data contract
Preserve completed-match eligibility, unambiguous identity mapping and complete roster capture coverage. Map baseline is total recorded captures divided by two team observations per eligible match. Player scored/conceded averages use their eligible game count. Net equals offense plus defense. Add chronological real match observations for distribution and trend charts. Player-population summaries must identify player-game weighting.

## Implementation
- Backend aggregation and focused automated validation.
- Dashboard controls, real charts, contextual calculations, sortable leaderboard and responsive layout.
- Review syntax, focused tests and available visual checks, then commit and push main.

## Authorization and constraints
The user requests autonomous completion and pushing changes. The attached directive explicitly requests tests for this feature. Preserve unrelated untracked map assets. No production deployment.
