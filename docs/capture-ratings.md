# Capture Ratings (Experimental)

Open Analytics → Capture Ratings. Select a map and minimum game count (5, 10, or 25). These filters persist while switching Overview, Players, Trends, and Distribution views.

## Meaning

Each eligible completed match contributes exactly two team capture observations to its map baseline, regardless of roster size. Imported player captures are summed by their roster team. Matches with missing player records, ambiguous identity links, duplicate player records or overlapping rosters are excluded. Existing source/import limitations still apply: the presence of an imported record cannot prove that its source captured every event.

For each player on that map:

- Team caps/game = sum of their teams’ capture totals / eligible games played.
- Conceded/game = sum of opposing teams’ capture totals / eligible games played.
- Offense = team caps/game − map average.
- Defense = map average − conceded/game.
- Net = offense + defense = average team capture differential.

Higher is better for both ratings. These are associations with team outcomes, influenced by teammates, opponents, roles and samples. They do not isolate individual impact or infer time spent on offense/defense. No duration normalization or opponent adjustment is applied.

## Charts and summaries

Distribution uses actual team totals from eligible matches, with two observations per match. Chronological map trends use match observations and the map baseline; they do not join unrelated player averages. The qualifying-player population is explicitly weighted by eligible player-game appearances. This can differ from the map baseline because filtering players changes the sampled population.

Leaderboard bars show signed differences on one consistent scale for the displayed players. Tooltips and signed numeric values supplement color. Missing data is unavailable rather than fabricated. No schema migration or bot changes are required.

## Delivery

The dashboard extends the existing Analytics tab system, shared fonts, map image helper and profile routes. It introduces no chart dependency. Production deployment and human review remain with the repository owner.

## Validation record

Focused command: `node --test api/test/capture-ratings.test.js api/test/capture-ratings-ui.test.js` (7 passing). Covers signed/zero/net calculations, eligibility, SQL identity resolution, real observation consistency, minimum/map filters, sorting, profile links, view persistence, chart counts, timestamps and empty states. Both changed JavaScript files pass `node --check`; `git diff --check` passes.

Browser inspection includes the desktop dashboard using the live capture response. That older server response lacks observations, so charts correctly show unavailable until the updated backend is deployed. Accurate phone emulation was blocked by environment policy; narrower-window validation is documented in the delivery report. No production deployment performed.

Populated charts were visually inspected on desktop and in a 600px-wide browser capture using a clearly labeled temporary QA fixture. Fixture values are not part of the shipped dashboard. Final review found no capture-dashboard overflow at the inspected sizes; the wide leaderboard has its own horizontal scroll region.

## V2 interpretation and credibility

The competitive KPI row ranks every player qualifying under the current minimum and optional 25-game filter, without pagination truncation. Tied values share a competition rank; table row numbers describe the current sorted order.

Sample labels describe the amount of data, not statistical confidence: 5–9 limited, 10–24 developing, 25–49 established, and 50+ extensive. The optional established filter raises the effective minimum to 25 without changing raw formulas or hiding five-game qualifiers by default.

The trend’s rolling overlay uses a trailing five-match window, including the current observation. Initial points use the available smaller window. Each underlying match value is the arithmetic mean of its two team captures, not a player observation. Distribution still counts two separate team observations per eligible match. Raw observation visibility and rolling visibility are independent. When every timestamp is reliable, match order is chronological; otherwise the chart explicitly uses match-ID order rather than implying chronology.

The old population number could legitimately match the map baseline (including rounding to 6.84). Its numerator was the sum of each qualifying player’s team caps/game multiplied by their eligible games; its denominator was total qualifying player-game appearances. Constant equal-size rosters and complete player participation repeat each team observation equally, so this weighting can yield exactly the baseline. Varying roster sizes can weight matches differently. Applying player filters may change that relationship. The baseline itself always divides total eligible captures by twice the number of eligible matches. V2 removes the repetitive population KPI rather than changing these authoritative formulas.

Roster associations follow recorded match rosters. All roster players must have unambiguous imported capture records, extra/unmatched or duplicate records invalidate a match, and overlapping rosters are excluded. Substitutions or mid-match team changes are not reconstructed from time slices; discrepancies visible in records cause exclusion, while unrecorded changes cannot be inferred. This remains a team-outcome association, not an estimate of individual impact.

V2 focused validation: 13 API/UI regression tests pass, including all sample-tier boundaries, established/minimum filter intersections, full qualifying-set leaders and tied ranks, spotlight changes, exact trailing-window averages, visibility toggles, sparse/missing observations and roster changes. The production API and database schema were unchanged after the audit found no formula defect.
V2 visual review: inspected desktop and 600px-wide captures of the refined KPIs, spotlight, sample badges and populated raw/rolling charts using a labeled temporary QA dataset. No QA statistics ship with the page. Accurate phone-width emulation remains unverified due the previously recorded environment restriction.
