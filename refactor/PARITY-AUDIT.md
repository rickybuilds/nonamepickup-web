# Project 2080 production parity audit

**Updated:** 2026-09-25
**Scope:** Full source review of the legacy user-facing pages, Project 2080, and relevant API routes. The parity implementation in this working tree is updated; no production data or database schema was changed. No test files were created or modified. Existing tests and static checks are run separately and recorded below.

## Result

Project 2080 now contains native routes for ordinary pickup and speedrun workflows plus identity, analytics, and community tools. The 2080 Archive links to these routes. The former internal legacy links for matches, players, maps, speedrun catalogue/map/runner, analytics, tracker, kicked history, odds, MVPs, and community honors have been removed or replaced. Specialized pickup replay, live viewer, and browser spectator engines remain the existing mature implementations, presented within 2080 wrappers. The speedrun replay remains at `/refactor/replay.html`.

Privacy and operator boundaries remain explicit. The tracker searches public identity fields and aliases but never returns IP addresses or shared-IP matches. Shadow ELO/admin and the server-build runbook are not surfaced in ordinary-user navigation; the existing public/API authorization state is unclear and needs product-owner/security review before integration. This is a documented exception, not an ordinary-user parity blocker.

## Parity matrix

| Area | Project 2080 implementation | Status | Remaining note |
|---|---|---|---|
| Home and live queue | Existing overview, live status, queue, active match, score/round and 2080 viewer actions | PASS | Viewer integrations retain the existing runtime; rendered browser verification on the deployed build remains open. |
| Browser spectator and pickup live viewer | 2080 shell pages embed the existing browser client and pickup live renderer; the live/replay engines retain camera, HUD, scrubber, POV, effects, clips, share and download controls | PASS | Their complex canvases remain specialized embedded experiences. |
| Match history | Search, result/map/player filters, paged records, and deep-linked match details | PASS | Filters and page are URL-backed; list filters apply to fetched records as indicated in the UI. |
| Match detail and pickup replay | Rosters, scores, dates/status, identities, privacy/rating, combat rows, rounds, round/no-name MVPs, reports, map navigation; replay metadata is discovered per available round and opens the 2080 replay wrapper | PASS | Replay discovery depends on the replay metadata API at deployment. No round number is hardcoded. |
| Player leaderboard/profile | Qualified leaderboard/search and a new 2080 player dossier: identity and standing, performance and class-time distribution, granular combat with map/match filters, visual recent-match history, ELO trend, activity heatmap, relationships, map tendencies, and connected records | PASS | Source/API and rendered legacy comparisons are recorded below. |
| Player event detail | Map/class/weapon/objective filters, paged chronological events, match/source links | PASS | Uses the existing granular-event route. |
| Tracker/identity | Search name, Steam/Discord IDs and aliases; paginated directory; current server, connections, last seen, alias history, player-file navigation | OWNER DECISION REQUIRED | Safe alias/history UI is implemented. Raw IP and shared-IP lookups remain excluded pending a decision on audience and authorization; new `/public` API routes also require deployment and smoke verification. |
| Maps index/detail | Searchable archive, map average, score/outcome charts, sortable player records, rivalry and winning-duo ledgers, speedrun relation, paged match-history windows, progressive map-regular list | VERIFICATION REQUIRED | Backward-compatible API offset/count addition in `api/src/routes/maps.js` must be deployed and older match-history windows smoke-tested in production. |
| Speedrun hub | Summary, records and holders, recent runs/maps, searchable class-filtered paged map index, runner lookup and replay links | PASS | Existing ruleset and class semantics are retained from the API. |
| Speedrun catalogue | Server inventory/setup states, enabled state, servers, run/runner/record counts, last seen/run, search and filters, imported comparison records and source URLs | PASS | Live production check on 2026-09-23 returned 1,049 maps and the expected setup/enabled/runner/last-seen fields. |
| Speedrun map detail | Metadata and zones, class leaderboard with attempts, imported class/source comparisons, all returned recent runs, complete returned world-record progression, progression chart, deep links and replay links | PASS | Live production check for `2fort` returned 71 runs, 21 leaderboard entries, and 23 progression points across 9 classes. |
| Speedrun runner detail | Rank, PBs with attempts/runner counts/WR gaps/date/replay links, class breakdown, WRs, progressively browsable recent activity and enabled-map progress, unplayed-map text download | PASS | History/progress is progressively disclosed from all arrays returned by the current runner endpoint. |
| Speedrun replay | Existing Project 2080 route and playback engine, search/deep-link/replay/viewer export | PASS | Kept in `/refactor/`; no legacy speedrun replay exit introduced. |
| Analytics | Summary, 12-month match activity chart, outcomes, streaks, leaders, map/player/match links, filterable combat/flags/roles/rounds/matches/per-game/MVP/maps/chaos/weapons views | PASS | Live production `/api/analytics?limit=10` returned all required data groups on 2026-09-23. |
| Player comparison | Exact-name/ID lookup, teammate/opponent totals, matchup record, shared matches and player navigation | PASS | Inputs are reflected in query parameters for direct links and refresh. |
| Missed votes/kicked history | Summary, rankings, player filter, progressive event history | PASS | Uses existing `/api/kicked` payload and does not add write access. |
| Vegas odds | Player lookup and prediction from the existing read endpoint | PASS | Current data usefulness is not otherwise established; preserved as a discoverable specialist tool. |
| MVP breakdown | Match lookup, match/round awards and map/match navigation | PASS | Uses existing match response. |
| Community honors | Tag list and tag submission | PASS | Preserves existing moderation and rate limiting; no new administrative mutation was introduced. |
| Shadow ELO/admin | Not placed in public 2080 navigation | OWNER DECISION REQUIRED | Repository routes do not establish a reliable restriction policy. Confirm intended audience and server-side authorization before surfacing admin controls. |
| Server-build guide | Not placed in ordinary-user 2080 navigation | INTENTIONAL EXTERNAL | Root runbook is operator documentation with shell/configuration instructions. It remains at its existing operator-facing destination and is omitted from ordinary-user navigation. |
| Status/health | No separate legacy user page identified; API health remains an operational endpoint | OWNER DECISION REQUIRED | Confirm whether a user-facing status page is wanted; the currently identified routes expose operational details and should not be added to public navigation by assumption. |
| Original-site escape | Explicit “Original site” links remain | INTENTIONAL | Same-origin exit to the root legacy homepage. |

## Player profile parity accounting

The legacy `player.html` profile supplies the information architecture; `refactor/?view=player&id=<player-id>` supplies the Project 2080 visual language. The new dossier uses the existing `/api/player/:id/v3`, `/recent`, `/permap`, and `/granular` responses without duplicating stored data or changing production API behavior.

| Legacy section or capability | 2080 treatment | Classification |
|---|---|---|
| Avatar, player/display and Steam identity, profile link, supporter marker | Identity header with existing supporter identity component, avatar, and Steam relationship | Migrated |
| Online dot / live status | No reliable per-player online-status field in the public profile response; a static dot would imply presence that is not established | Intentionally omitted |
| Current ELO, overall rank, ELO tier, last-20 movement, recent form | Ruled standing strip and ten-match result sequence; private ELO remains hidden | Transformed |
| Peak ELO, record, win rate, best streak, MVPs, PUGs/week | Compact stat rule immediately below the standing | Migrated |
| K/D, kills, deaths, damage, captures, conc jumps, class time | Performance figures and a proportional class-time distribution | Transformed |
| Map and match kill-event filters | Map selector, recent-match selector, and match-ID entry backed by the granular API and URL state | Migrated |
| Offense/defense; frags, touches, SG, conc and flag-carrier kills per match; class time and top weapon | Paired role comparisons with metrics, class-time bars, and named weapons | Transformed |
| Class/weapon breakdown, favorite victims, alias history | Expandable dense class/weapon ledger and two ruled people/name columns | Transformed |
| Recent matches with map imagery, result, score, ELO delta, teams, Hampalyzer, TFCStats, match detail and pagination | Five-match editorial history pages with map images, team/rating semantics and all available report actions | Transformed |
| ELO trend and day/hour activity heatmap | 2080 SVG trend and a 7×12 local-time activity matrix | Transformed |
| Best teammates and toughest opponents | Ruled relationship columns from completed match rosters | Transformed |
| Most-played, best and worst maps; complete per-map history | Image-led tendency groups and an expandable complete map ledger | Transformed |
| Speedrun relation, identity history, player comparison and event drilldown | Connected-record links within Project 2080 | Migrated |

Rendered comparison used the production legacy profile for `wheaties` and a local Project 2080 preview backed by the existing production read APIs. The 2080 dossier was inspected at 1440px desktop and 390px mobile, including combat, recent matches, trend, relationships, and map tendencies. The `alchimy_lg` filter reproduced the legacy offense values (20.3 frags, 18.6 touches, 6.0 sentry kills per match); match filtering, URL restoration with Back/Forward, and match-history pagination were exercised. A direct link to supporter `Moreno` confirmed the diamond and private-rating treatment in both 2080 themes. Player Detail is **PASS** for the documented user-facing sections. The page still requires deployment before the public `/refactor/` URL will show this revision.

## Sensitive identity boundary

The legacy identity API and UI contain current/historical IP addresses and shared-IP relationships, and the existing route mounting does not establish a clear authorization gate in this repository. The new Project 2080 tracker only uses the added `public` identity responses, which exclude raw IP and IP-derived relationships. Do not migrate precise location, raw IP, or shared-IP browsing until the owner confirms the audience and authorization policy.

## Deployment and verification boundary

The live production checks above exercised the already deployed catalogue, speedrun map/progression, and analytics APIs. They do **not** verify the new backend code in this branch. Deploying the new tracker API and map-history offset requires pulling the branch on the server and restarting the API. Until then, the tracker and older map-history windows can report unavailable/error states in production. No production data, schema, or server configuration was changed here.

## Remaining internal legacy fallthroughs

No ordinary-user 2080 route was found linking to root `live.html`, `match.html`, `player.html`, `map.html`, `speedruns.html`, `speedrun-map.html`, `speedrun-player.html`, `speedrun-maps.html`, `analytics.html`, `tracker.html`, `kicked.html`, `vegasodds.html`, `mvp-breakdown.html`, or `coolest-dude.html`.

The integrations intentionally load the existing `pickup-live.html`, `pickup-replay.html`, and `live/` engines inside 2080 framing. Their footer and the main shell's “Original site” exit link to `../index.html`. The speedrun renderer retains its repository-root base for its existing data/runtime assets while its own navigation is Project 2080.

## URL state and responsive behavior

Useful list searches, filters, pages, selected map/player/match entities, analytics grouping, speedrun class/category/rank filters, identity search/page, and comparison players use query parameters. `popstate` restores the selected Project 2080 view by reloading its URL. Ephemeral search-dialog/expanded controls are intentionally not encoded. The new player dossier uses scoped rules in `refactor/player-detail.css`; the embedded 3D runtimes remain their purpose-built responsive canvases. The player dossier received a local rendered desktop/mobile pass backed by production read APIs. Other previously documented responsive/deployment checks remain open.

## Validation

- 2026-09-25 player dossier: local rendered comparison against the legacy production profile at 1440px and 390px, with `wheaties` (including filtered `alchimy_lg` analytics and match pagination) and supporter `Moreno` (private rating and diamond); day/night compositions inspected. JavaScript syntax and `git diff --check` passed. No automated tests were run for this change, per repository instructions.
- Existing production APIs: server-map catalogue (1,049 entries), `2fort` map detail/progression (71 runs, 21 leaderboard entries, 23 progression points), and analytics (all requested data groups) returned successfully on 2026-09-23.
- Branch-local API edits not yet in production: privacy-safe identity routes and map-history offset/count support; deploy by pulling and restarting the API before relying on those production paths.
- Static JavaScript syntax checks passed for all `api/src` scripts and Project 2080 scripts; `git diff --check` passed.
- Existing API suite: 119 tests, 105 passed, 14 failed. Failures were in shadow-ELO distribution/replay, pickup replay renderer/material/projectile behavior and uploader tests; these implementation/test files were not changed in this parity work. No test files were added or modified.
- No automated check can establish access policy for shadow ELO, identity IP history, or operator documentation; these remain explicitly documented owner decisions.
