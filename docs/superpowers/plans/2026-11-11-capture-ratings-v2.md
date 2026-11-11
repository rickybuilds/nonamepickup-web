# Capture Ratings V2 implementation

Refine the existing dashboard, preserving API architecture and raw rating formulas. User directive authorizes autonomous implementation, focused tests, commit and push; production deployment remains separate.

- Competitive KPIs: baseline, top offense, top defense, most experienced, computed across all qualifying players.
- Player spotlight: profile, games, ratings, score/conceded, ranks, shared-scale bars, descriptive sample tiers and expandable formulas.
- Retain minimum selector and default five; optional established-only filter applies a 25-game floor consistently to ranking and display.
- Trend: baseline, optional raw match points, optional trailing five-match average with partial initial windows. Chronological order when every timestamp is reliable; explicit match-ID order otherwise. No synthetic production observations.
- Audit eligibility, roster identity, denominators and weighting; execute focused regressions and bounded browser inspection.
- Preserve unrelated files, review diff, commit and push main.
