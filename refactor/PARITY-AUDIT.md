# Project 2080 production parity audit

**Audit date:** 2026-09-23  
**Scope:** Repository source audit of root legacy HTML/JS, Project 2080 (`refactor/`), and registered API routes/consumers. Read-only review; no fixes or API changes. No tests run. Responsive conclusions come from stylesheet breakpoints and markup, not a new device/browser edge-case pass. The deployed static host/configuration is not present in this repository.

## Executive Summary

Project 2080 has broad useful parity for the main pickup journey: overview, live queue/server snapshot, match history and details, player standings/profiles, map intel, speedrun hub/map/runner views, comparison, global player search, and an archive index. Query-string view links provide refreshable deep links; normal anchors provide browser history navigation. Its established editorial presentation remains the design authority.

Parity is **partial overall**. The most material confirmed gaps are the full analytics instrument, connection/identity tracker, kicked/missed-vote history, odds, MVP/community-honor tools, detailed pickup replay and browser spectator workflows, and some full speedrun map/runner history. Match detail only exposes a round-1 legacy replay link; the current richer pickup replay viewer is not incorporated into 2080. Several pages intentionally link into the root legacy UI from 2080's Archive or detail actions. Speedrun replay itself currently links to `/refactor/replay.html` and stays in the 2080 directory; no `speedrun-replay.html` fallthrough was found in the inspected source.

The main views retain key community identity semantics (supporter diamonds, private rating treatment, team colors, identity search, and player/map/match links). Some profile identity history and match/replay relationships remain outside the new presentation. Existing responsive CSS recomposes layouts and preserves mobile secondary data, but narrow-screen operability of the legacy specialist tools is unverified here.

## Parity Matrix

“Likely implementation source” identifies the existing frontend/API surface; entries marked API opportunity are already backed by current routes. Priority is migration importance, not effort.

| Legacy area | Legacy capability | Project 2080 equivalent | Status | Parity gap | Likely implementation source | Priority |
|---|---|---|---|---|---|---|
| Home (`index.html`) | Community overview, current queue, latest match, rating and history summaries | Overview view, queue rail, latest matches, current ELO | PASS | The overview is intentionally recomposed; not all legacy dashboard widgets/analytics are on the overview. | `refactor/app.js` overview; `/api/home`, `/api/queue`, `/api/matches`, `/api/leaderboard` | P2 |
| Live (`live.html`) | Queue, active servers/matches, status and spectator links | Live view, queue roster, server score/round snapshot, refresh | PARTIAL | Operational presentation is present; original live spectator and browser viewer remain root legacy destinations. Match-row spectator action routes to old `live.html`. | `refactor/app.js` live; `/api/queue`, `/api/matches`; `/api/pickup-live/viewer/*` | P1 |
| Browser live / pickup viewer (`live/`, `pickup-live.html`) | In-browser TFC client; live 3D replay, roster/POV/camera, HUD, scrubber, clips, share/download | Archive links to Browser spectator; live view links to Browser live viewer | LEGACY FALLBACK | Capabilities exist only in legacy presentation/standalone viewer; not integrated into 2080. Viewer actions include live POV/camera, effects, clip editor, copy-link and WebM download. | `live/index.html`, `live/app.js`; `pickup-live.html`, `assets/js/pickup-replay-v2.js`; `/api/pickup-live/viewer/*` | P1 |
| Match history (`matches.html`) | Search/filter by map/result/player, pagination, pending matches, per-match report links | Match view; 100-row API pages with local loaded-page text/map/result filters and newer/older paging | PARTIAL | Core workflow present. Filter/search fields and page selection are transient (not URL state); legacy per-row Hampalyzer/TFCStats actions are absent from the ledger. Filtering is intentionally limited to fetched page. | `refactor/app.js` matches; `/api/matches` | P2 |
| Match detail (`match.html`) | Rosters, scores, player combat rows, rounds, reports, replay and related navigation | Match view with team rosters, ELO/privacy, kills/deaths/caps/damage, round scores, Hampalyzer/TFCStats | PARTIAL | Legacy full breakdown link remains. Only round 1 is linked to pickup replay, and the replay route is legacy; detailed replay discovery/round availability and other report fields are not surfaced in 2080. | `refactor/app.js` match; `/api/match/:id`; `/api/player-identities/:steamid`; pickup replay API | P1 |
| Player leaderboard (`leaderboard.html`) | Rated standings, search, time-window stats, supporter status | Players view with current ELO, games/record/recent form, 7/30/90/all-time window, global search | PARTIAL | 2080 deliberately omits private and <10 all-time-game ratings from ranked rows (findable through search); legacy leaderboard/API may expose more rating states and ranking/record detail. Confirm qualification policy against product intent. | `refactor/app.js` players; `/api/leaderboard`, `/api/supporters`, `/api/players/search` | P1 |
| Player profile (`player.html`) | Rating/privacy, record, combat and class stats, match history, per-map and granular/event views, speedrun profile, identities/actions | Player view with rating/record, combat, top classes, 10 recent matches, speedrun link, compare and profile links | PARTIAL | Full 300/5000 recent history, per-map detail, granular kill/event timeline, Steam profile context, identity aliases/connections, and richer speedrun summary are omitted or reachable only by legacy page. Class rendering is limited to nine. | `refactor/app.js` player; `/api/player/:id/v3`, `/recent`; `/granular`, `/granular/events`, `/permap`; `/api/speedruns/players/:id` | P1 |
| Player search / identity (`tracker.html`) | Search name, SteamID, Discord ID, alias or IP; paginated identity records; connection/server history; drawer and shared-IP view | Global player-name search modal; match detail resolves SteamID to Discord identity | PARTIAL | 2080 search is not the tracker: no identity catalogue, alias/IP search, connection counts/history, last server, IP grouping or identity drawer. Do not expose sensitive identity detail without preserving existing access/presentation rules. | `assets/js/identities.js`; `/api/player-identities`, `/api/player-identities/:steamid`, `/ip/:ip`; `/api/players/search` | P1 |
| Maps index/detail (`map.html`) | Map averages, players, match history, charts and linked matches/players | Maps index and map detail with averages, players, up to 25 recent matches | PARTIAL | Map analytics chart and broader match-history browsing are absent; map detail has a 25-match slice and links to full legacy intel. Speedrun relationship is not represented as a first-class map link. | `refactor/app.js` maps/map; `/api/mapaverages`, `/api/map/:map/players`, `/matches`; `/api/analytics` | P2 |
| Speedrun hub (`speedruns.html`) | Summary, class-filtered searchable/paged map leaderboard, recent runs, top maps/runners, WRs | Speedruns view, server-side map search/paging, recent WR/holders and record index | PARTIAL | Several legacy hub panels and class-based map filtering/ranking behavior are not present at the same breadth; run category/ruleset and broader recent activity have limited exposure. | `refactor/app.js` speedruns; `/api/speedruns/summary`, `/maps`, `/recent`, `/records` | P2 |
| Speedrun map index/catalog (`speedrun-maps.html`) | Map statistics, server coverage/setup states, source comparison records, search/filter | Speedrun index and server map catalogue with search/status filters and imported comparison data | PARTIAL | Catalogue API availability is uncertain (prior project note records a 503); full map stats page remains legacy-linked. 2080 currently combines catalogue rows and comparisons but does not reproduce every legacy column/summary. | `refactor/app.js` speedrunCatalog; `/api/speedruns/server-maps`, `/api/speedruns/comparisons/leaderboard` | P1 |
| Speedrun map detail (`speedrun-map.html`) | Category/difficulty/enabled metadata, leaderboard, attempts, recent runs, class filter, WR progression chart and comparison sources | Speedrun map detail with metadata, class comparison, leaderboard, 20 recent completions, 25 progression points | PARTIAL | Chart/complete progression history and full map detail remain legacy-linked. Current comparison is rendered from existing endpoint; check all attempts/runner metadata and external source links are preserved. | `refactor/app.js` speedrunMap; `/api/speedruns/maps/:map`, `/progression`, `/api/speedruns/comparisons/maps/:map` | P2 |
| Speedrun runner (`speedrun-player.html`) | Global rank, PBs, class/category breakdown, WRs, recent activity, all-map progress, incomplete-map download | Runner view with rank/PBs/WRs/recent runs, class/category/rank filters, unplayed-map download | PARTIAL | Class breakdown and complete history/progress details are reduced; “Full runner history and progress” links back to the legacy page. Current runner content is capped at 30 recent rows. | `refactor/app.js` speedrunPlayer; `/api/speedruns/players/:id` | P2 |
| Speedrun replay (`speedrun-replay.html`) | Replay playback, run/map/class/Steam deep links, comparison and replay controls | Separate `/refactor/replay.html` player with 2080 navigation, runner link, search and record/viewer exports | PASS | Playback uses the existing specialized replay engine and replay styles; verify the historical query variants (`runId`, map/class/Steam) remain supported end-to-end. Current `replayAction` prefers run ID and falls back to tuple. | `refactor/replay.html`, `refactor/replay.js`, `assets/js/speedrun-replay.js`; `/api/speedruns/replay/*` | P2 |
| Analytics (`analytics.html`) | Long-form summary, maps, players, outcomes, streaks, MVPs, match patterns and filters | Analytics summary and top maps; link to “Full analytics instrument” | LEGACY FALLBACK | Most charts, breakdowns and controls remain on legacy page. Current view consumes a limited top-maps summary. | `assets/js/analytics.js`; `/api/analytics`, `/api/stats/summary`, `/stats/players`, `/matchOutcomes`, `/streaks`, `/mvps`, `/mapaverages` | P1 |
| Player comparison (`compare.html`) | Head-to-head and teammate history, matchup records, shared matches | Compare form supports exact names/IDs; teammate/opponent totals and shared matches | PARTIAL | Core comparison exists. Legacy comparison's additional profile metrics / per-match detail / URL-preserved input behavior should be checked against actual payload; 2080 links to original comparison. | `refactor/app.js` compare; `/api/compare`, `/api/players/search` | P2 |
| Missed votes / kicked history (`kicked.html`) | Summary, ranking/chart, searchable event history | Archive link only | LEGACY FALLBACK | No 2080 equivalent or first-class page. | `assets/js/kicked.js`; `/api/kicked` | P2 |
| Vegas odds (`vegasodds.html`) | On-demand player lookup and matchup prediction | Archive link only | LEGACY FALLBACK | No 2080 equivalent; current data usefulness and audience are unverified. | `assets/js` odds entry; `/api/vegasodds/:player` | P3 |
| MVP breakdown (`mvp-breakdown.html`) | Match-ID lookup and round/match MVP breakdown with link to match | Archive link only | LEGACY FALLBACK | No equivalent in 2080 match/player views; related aggregate MVP data also exists. | `assets/js/mvp-breakdown.js`; `/api/match/:id`, `/api/stats/mvps` | P2 |
| Community honors (`coolest-dude.html`) | View/tag community honor recipients; tag write action | Archive link only | LEGACY FALLBACK | No equivalent. Confirm write permissions and moderation workflow before migration. | `assets/js/coolest-dude.js`; `/api/coolest-dude/tags` | P3 |
| Shadow ELO / ELO administration (`admin-elo.html`, shadow tool) | Alternative rating allocations and administrative controls | No surfaced 2080 view found | INVESTIGATE | User audience, current usage, visibility and whether API is restricted are not established by a static audit. Keep distinct from public leaderboard parity until confirmed. | `assets/js/shadow-elo.js`; `/api/shadow-elo`; `admin-elo.html` | P3 |
| Server documentation (`docs/server-build.html`) | Interactive server build guide, progress tracking and config inputs | Archive link only | LEGACY FALLBACK | Specialist documentation remains a root legacy page; likely lower priority for ordinary users. | `docs/server-build.html`, `docs/server-build.js` | P3 |
| Server status (`status.html`/service) | Operational health state | No distinct status page in 2080 | INVESTIGATE | API status route exists, but no legacy HTML page or 2080 consumer was identified in the inventory. Determine intended audience/use. | `/api/status`, `/api/health`, `/api/speedruns/health` | P3 |
| Identity/supporter/community marks | Supporter diamonds; team-color meaning; private-rating label; player navigation | Supporter markers and private-rating treatment in 2080 main and replay views | PASS | Alias, linked-account and identity history is partial (see tracker/player rows). | `/api/supporters`, `/api/player-identities/:steamid`; `refactor/app.js`, `refactor/replay.js` | P2 |
| Root/original-site links | Links to current root site | “Original site” in 2080 shell and error state | INTENTIONAL EXTERNAL | These are same-origin exits from `/refactor/` to the legacy root homepage, not an external destination. They are explicit escape links; retain their presence in route inventory. | `refactor/index.html`, `refactor/replay.html`, `refactor/app.js` | P3 |

## Remaining Legacy Fallthroughs

These are confirmed internal root-page destinations in Project 2080 source. Their functionality may be preserved, but their presentation/navigation leaves `/refactor/`:

- `../live.html`: live-view action and active-match spectator row.
- `../pickup-live.html`: browser live viewer.
- `../match.html?id=…`: full legacy match breakdown.
- `../pickup-replay.html?matchId=…&round=1`: round 1 pickup replay from match detail.
- `../player.html?id=…`: full player file.
- `../map.html?map=…`: full map intel.
- `../speedruns.html`: full run archive.
- `../speedrun-map.html?map=…`: full chart and history.
- `../speedrun-player.html?id=…`: full runner history and progress.
- `../speedrun-maps.html`: full catalogue/map stats.
- `../analytics.html`: full analytics instrument.
- Archive entries: `../tracker.html`, `../kicked.html`, `../vegasodds.html`, `../mvp-breakdown.html`, `../pickup-replay.html`, `../speedrun-player.html`, `../docs/server-build.html`, `../admin-elo.html`, `../coolest-dude.html`, and `../live/`.
- Explicit “Original site” exits: `../index.html` from the shell, replay footer, and data-error state.

No legacy internal route was found for the ordinary speedrun replay action: it targets `./replay.html?...` inside `/refactor/`. External Hampalyzer, TFCStats, Steam, Squishy's Batcave, and Church of Conc links are intentionally external when supplied and should retain source URLs. Potential obsolete/broken links are not asserted from source alone. Existing query links preserve entity IDs for legacy detail pages; 2080's transient filters/pagination do not survive refresh, while view/entity deep links do.

## Missing Data

- **Identity/player:** alias lists and connection history, last server/seen, connection totals, IP relationship view, full recent match history, per-map player stats, granular combat events, and some Steam/profile metadata. Sources include `/api/player-identities`, `/api/player-identities/ip/:ip`, `/api/player/:id/permap`, `/granular`, `/granular/events`, `/recent`, and `/api/steam/profile/:discordId`.
- **Match:** available replay rounds/resources and complete replay/report navigation; current 2080 detail hardcodes a round-1 pickup replay link. Legacy match cards/details expose report actions and full per-match breakdown beyond the compact overview.
- **Map/analytics:** full long-range analytics (player/rating distributions, outcomes, streaks, MVPs, map averages), map chart/history, and potentially all map matches. Existing legacy calls include `/api/analytics`, `/api/stats/*`, `/api/mapaverages`, and `/api/map/:map/matches`.
- **Speedruns:** full progression history/chart, richer runner class breakdown/all activity and map progress, all server catalogue fields, and portions of hub recent-run/category/class summaries. Data routes already exist; catalogue endpoint health is uncertain from code review and prior repository notes.
- **Community:** kick/missed-vote history, odds, MVP breakdown, community-honor tags and specialist server documentation are not presented in 2080 views.
- **Identity semantics:** supporter diamonds, privacy, team colors, community references and linked profile navigation are preserved in core views; aliases and account-link relationships are not presented as a complete identity history.

## Missing Interactions

- Identity tracker search by alias/IP/SteamID, pagination, per-player connection drawer, and shared-IP lookup.
- Full analytics filters, chart interactions and cross-navigation.
- Kicked history filtering, odds lookup, MVP match lookup and community-honor tagging.
- Pickup replay selection across rounds, POV/camera/effects controls, scrub/live controls, clips, deep-link sharing and WebM download from a 2080-native workflow.
- Browser spectator currently opens the standalone legacy app.
- Full speedrun progression chart and complete runner-history navigation; current 2080 runner download covers unplayed map names only.
- Match list filters/search and page are not serialized into query state; browser Back/Forward only restores page/entity URLs, not those in-view control states. No History API route mutation was found in `refactor/app.js`.
- Legacy match-list report shortcuts are absent from 2080 list rows; match detail still exposes Hampalyzer/TFCStats when present.
- No API-backed data export was found for pickup histories; speedrun runner's unplayed-map text download is present.

## API Opportunities

### Used by Project 2080

`/api/home`, `/queue`, `/matches`, `/match/:id`, `/leaderboard`, `/player/:id/v3`, `/player/:id/recent`, `/mapaverages`, `/map/:map/players`, `/map/:map/matches`, `/players/search`, `/player-identities/:steamid`, `/supporters`, `/compare`, `/analytics`, speedrun summary/maps/map detail/progression/players/server-maps/comparison endpoints, and speedrun replay endpoints. The replay shell separately consumes speedrun-player data, supporter IDs and player search.

### Existing endpoints with no observed 2080 consumer

- Analytics/statistics: `/api/stats/mostGamesAndTies`, `/stats/mvps`, `/stats/matchOutcomes`, `/stats/summary`, `/stats/players`, `/stats/streaks`; richer `/api/analytics` response is consumed only for summary/top maps.
- Player detail: `/api/player/:id/granular`, `/granular/events`, `/permap`, `/api/steam/profile/:discordId`; 2080 uses the aggregate v3 and 10 recent matches only.
- Identity: `/api/player-identities` and `/api/player-identities/ip/:ip`; only per-SteamID identity lookup is consumed by match detail.
- Specialized community tools: `/api/kicked`, `/api/vegasodds/:player`, `/api/coolest-dude/tags` and POST; no 2080 consumer.
- Ratings/admin: `/api/shadow-elo`; no 2080 consumer.
- Pickup playback: `/api/pickup-replays/viewer/*` and `/api/pickup-live/viewer/*` are consumed by legacy viewers, not the 2080 main app; replay capability uses legacy renderer.
- Speedrun: `/api/speedruns/recent` and `/records` have no direct 2080 consumer identified (summary/detail endpoints provide overlapping data); replay-specific endpoints are consumed by the shared legacy playback engine.
- Status: `/api/status` and health endpoints have no user-facing 2080 consumer identified.

These are endpoint-consumer observations, not recommendations to duplicate requests. Reuse existing response payloads where adequate; server-side changes are not indicated for the confirmed dashboard gaps. Whether all routes are still healthy/current must be checked before implementation. Do not treat endpoint existence as proof that a legacy UI's exact data remains available.

## Responsive Parity

The 2080 stylesheet has explicit intermediate and mobile breakpoints: navigation becomes a touch-sized section index; major ledgers recompose sequentially; match/ranking/map/combat rows retain key metadata in secondary lines; and the speedrun hub preserves its chosen four-metric strip. That follows the stated principle of sequential composition when columns no longer read well. Source review did not reveal a core 2080 view hidden solely by a narrow-width rule. Actual mobile interaction of search dialogs, tables, the replay shell and legacy-only tools was not re-tested in a browser in this audit; their mobile usability remains INVESTIGATE, particularly the legacy tracker, analytics charts, and 3D replay/spectator controls.

## Possible Obsolete Features

No feature is marked OBSOLETE on source evidence alone. Candidates for product-owner review (not removal): admin ELO/shadow ELO (likely restricted audience); Vegas odds (unclear current use); server-build documentation (operator-oriented rather than normal-user capability); and the old full analytics instrument if its unique charts are superseded by another maintained surface. Tracker/IP history is sensitive and may require a deliberate audience/access decision, but sensitivity is not evidence of obsolescence. The existing speedrun replay engine is still linked and should not be treated as obsolete because it uses older renderer code.

## Recommended Migration Order

1. **Core pickup continuity (P0/P1):** replace match/player/map legacy detail exits where data already exists; restore match replay discovery by actual available round and keep Hampalyzer/TFCStats links; bring queue spectator actions into a 2080-integrated experience or make the legacy destination unmistakable.
2. **Player identity and history (P1):** add full match/per-map history and alias/connection lookup using existing player and identity endpoints, with a reviewed policy for IP and linked identity data.
3. **Analytics parity (P1):** map the legacy analytics panels to current `/analytics` and `/stats/*` responses; migrate the charts/filters and connect map/player/match destinations.
4. **Speedrun completeness (P1/P2):** verify server-map API health; complete map catalogue/detail and runner history/progression while keeping the current replay route inside `/refactor/`; preserve categories, attempts, supporter marks, source links, downloads and query-state.
5. **Community specialist tools (P2/P3):** migrate missed votes, MVP breakdown, odds and community honors according to current use and permissions; determine the future of admin/shadow ELO and server docs.
6. **Navigation/state and responsive verification (P2/P3):** serialize useful filters/pages in URLs where appropriate; audit real narrow-width interactions for both 2080-native and linked specialist experiences. Reuse current APIs unless inspection shows a concrete data/API gap.

This order is an audit recommendation only; no migration batch is implemented here.
