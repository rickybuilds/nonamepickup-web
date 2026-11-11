# Experimental capture ratings implementation plan

**Goal:** Compare players' teams with the average captures per team on each map.
**Architecture:** A cached stats endpoint derives match totals from imported player capture statistics only when each roster player can be matched unambiguously. The existing Analytics Maps panel provides map selection, sortable offense/defense comparisons, sample sizes, and methodology.
**Constraints:** Do not create, change, or run tests. Keep matches.html and bot unchanged. Treat incomplete or ambiguous match data as unavailable, never as zero.

- [x] Derive map averages and player team averages from complete match records; expose the underlying data and sample counts.
- [x] Add an experimental comparison to Analytics, including loading, empty, and error states and a clear team-performance caveat.
- [x] Check syntax and inspect the resulting changes without running tests.
