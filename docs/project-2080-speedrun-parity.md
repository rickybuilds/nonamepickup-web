# Project 2080 Speedruns parity inventory

Source: production HTML and `assets/js/speedruns.js`, API routes and serializers, and rendered production pages inspected 2026-09-23. The refactor baseline was `refactor/app.js` at the start of this pass.

| Production capability | Baseline 2080 status | Migration decision |
| --- | --- | --- |
| Hub summary, recent WR, holders, paged map search | PRESENT IN 2080 | Keep; add enabled map count, recent runs and popular maps |
| Hub class filter and map-specific runner/replay access | NEEDS MIGRATION | Add class filter, direct runner and replay links |
| Server map catalogue with setup status, search/filter, server coverage, external source WR columns | NEEDS MIGRATION | Add archival catalogue view with source comparisons and setup metadata |
| Map detail category, difficulty, enabled state, counts, class leaderboard, attempts, achieved date | NEEDS MIGRATION | Expand map detail in 2080 layout |
| Map global comparison by class with Squishy's Batcave and Church of Conc source links from `sourceUrl` | NEEDS MIGRATION | Render per-class comparison with exact API URLs |
| Map recent runs and WR progression/chart | NEEDS MIGRATION | Render run and progression ledgers; retain production chart via full map link |
| Runner profile, PBs, class breakdown, WRs, all runs, progress, incomplete-map download | NEEDS MIGRATION | Add runner view and key ledgers; retain full profile for specialized progress/download |
| Interactive replay viewer with run ID or map/class/Steam fallback | PRESENT IN 2080 via production link | Make replay actions descriptive and use run ID where API supplies it |
| Current ruleset and run eligibility | PRESENT IN API | Describe current-timer scope; no invented rules URL |
| Static map thumbnail from tfcmaps.net | INTENTIONALLY OBSOLETE | Decorative image does not carry unique record functionality |
| External record destination when `sourceUrl` is absent | REQUIRES INVESTIGATION | Show source without a link; do not invent a destination |

Production uses `/api/speedruns/summary`, `/maps`, `/maps/:map`, `/maps/:map/progression`, `/server-maps`, `/players/:id`, `/comparisons/maps/:map`, `/comparisons/leaderboard`, and replay routes. External source labels and URLs come from `api/src/speedruns/comparisonModels.js` and the importers; the rendered map comparison links to the record's `sourceUrl`. Supporters use `/api/supporters` (array of string Discord IDs), independent of rating visibility. There is one supporter type in this API.
