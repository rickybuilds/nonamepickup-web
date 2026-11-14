---
name: NoName TFC Match Details V2
description: Scoped documentation of the existing navy, blue, and red match dashboard.
colors:
  page-navy: "#030911"
  panel-navy: "#030d1b"
  player-navy: "#05101e"
  text: "#dce9fa"
  muted: "#a1b9d3"
  border: "#194566"
  team-blue: "#42b3ff"
  team-red: "#ff4766"
  selected: "#00b6ff"
  focus: "#60ccff"
typography:
  headline:
    fontFamily: "Orbitron, system-ui, sans-serif"
    fontSize: "36px"
    fontWeight: 950
    lineHeight: 1
  team-score:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "24px"
    fontWeight: 800
    lineHeight: 1.1
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "10px"
rounded:
  control: "5px"
  panel: "6px"
  team: "7px"
spacing:
  panel-gap: "10px"
  team-gap: "12px"
components:
  tab:
    backgroundColor: "#061221"
    textColor: "#c7d8ee"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  tab-selected:
    backgroundColor: "#062642"
    textColor: "#fff"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  support-panel:
    backgroundColor: "{colors.panel-navy}"
    rounded: "{rounded.panel}"
    padding: "9px 10px"
---

# Match Details V2

## Overview

This document describes only `match.html` and its match dashboard. It extends the incumbent navy, blue, and red visual system in Operate mode: users compare teams, inspect player and round performance, explore captures, and open recorded replays. It does not establish a new site-wide identity or change other screens.

The page retains the shared navigation, real match metadata, map preview, score, external sources, and round tables. Compact team summaries and expandable player rows lead into class, weapon, damage, and capture comparisons. The lower MVP analysis disclosure has been removed. A Back to Matches link sits beside Downloads, outside the analytics tablist.

Implementation sources are `assets/css/match-dashboard.css`, `assets/js/match-analytics.js`, `assets/js/match.js`, and `match.html`. Round-relative capture normalization is shared through `assets/js/capture-timeline.js`, also loaded by `matches.html` for its sidebar renderer in `assets/js/matches.js`. The dashboard stylesheet loads after the incumbent `match.css`. Shared style overrides are scoped to the match document/page; analytics behavior mounts inside `#match-analytics`.

The frontmatter records actual reusable values from those styles. It is descriptive of this surface; the source files remain the implementation authority. No root `DESIGN.md`, `PRODUCT.md`, or global design sidecar is introduced.

## Colors

Team blue identifies Team 1; team red identifies Team 2 throughout summaries, player containers, comparison bars, and capture lines. Labels accompany color so users can distinguish the teams without relying on hue alone. Selected cyan marks active tabs and filters; the focus color marks keyboard interaction.

Navy page, panel, and player surfaces provide tonal separation. Muted text supports labels and explanatory notes; the border token separates panels and disclosures. Friendly damage and deaths receive red emphasis; enemy damage receives blue emphasis; conceded kills and concussion jumps receive gold emphasis. These metric accents describe the displayed values and do not replace team identity.

## Typography

Inter is the dashboard's reading and control face. Orbitron retains the existing match heading and score character. Hero typography, rounded frame, borders, and glow come from the shared page-hero styles. Its background uses the actual match map screenshot through the existing map-image resolver; unavailable screenshots retain the shared banner fallback. Team summary scores retain the compact dashboard role.

Panel headings use the title role. Player names use (11px, weight 700), class labels use (10px), and the dense metric labels use (7px). Round-table headers use (8px) and values use (10px). Supporting notes use (9px, line-height 1.5). Analytics and round tables use tabular numerals for reliable column comparison.

## Layout

The main container follows the shared page width and gutter tokens (a 1650px rendered desktop cap at the standard 75% density), with desktop vertical padding of (21px 0 24px). The match hero and score share a two-column header; each round has its own table. Team summaries and player sections use two equal columns with the team-gap token. Selecting one team changes the summary and player grids to one column.

| Viewport | Team and round layout | Support panels and overflow |
| --- | --- | --- |
| Above 1150px | Two team columns; two round columns | Four support panels in one row |
| 761–1150px | Two team columns; two round columns | Two support columns; tabs wrap above the filter; player and round tables scroll internally |
| 481–760px | Teams and rounds stack; hero stacks; main padding becomes (8px) | Two support columns; tabs scroll horizontally; player identity stays sticky within its scrolling row |
| 480px and below | Stacked teams and rounds | One support column |
| 1500px and above | Wider player columns | Player-grid minimum increases from (605px) to (680px); team summary metrics use eleven columns |

The exact support breakpoint uses `max-width:1150px`, so a viewport of exactly (1150px) has two support columns. Round tables have a (590px) minimum width. Player grids retain their readable minimum width inside focusable scroll regions rather than widening the document. Dense player rows use a minimum height of (70px), increasing to (76px) on wide desktops.

## Elevation & Depth

The dashboard uses navy tonal layers and thin team/border strokes instead of panel shadows. The hero map image is darkened by a directional overlay so the match metadata and scores remain legible. Selected controls have a cyan inset bottom stroke; open player rows change surface tone and add a dividing border. Existing disclosed MVP components retain their incumbent treatments.

## Shapes

Controls and player rows use the control radius, support panels use the panel radius, and team containers use the team radius. The hero uses the shared rounded page frame. Filters join into a segmented group with rounded outer ends. Compact bars use (2px) tracks and (1px) fills; capture markers are circles.

## Components

### Match navigation and team filters

Eight views are available: Player Overview, Team Comparison, Round Timeline, Flag Pace, Weapon Usage, Damage, Map Vision, and Downloads. Native buttons implement a tablist with a single active tab stop, `aria-selected`, and a labelled tabpanel. Arrow Left/Right cycle through enabled tabs; Home/End select the first/last enabled tab. Both, Team 1, and Team 2 filters use `aria-pressed` and apply consistently to summaries and analytical views.

Controls show an explicit focus outline of (2px) with an offset of (3px). Hover adds a lighter navy surface and blue border. Disabled views retain an explanatory title, reduced opacity, and a default cursor. Round Timeline and Weapon Usage are disabled when their required records are absent; Flag Pace stays accessible with an explicit empty state when the API supplies no capture events. Reduced-motion preferences remove analytics transitions.

### Player rows and expanded statistics

Each native `details` row presents identity/class, twelve combat and objective metrics, up to four weapon-share bars, and a round K/D graphic. Profile links preserve the existing player identity and supporter badge behavior. Mouse and keyboard expansion expose all returned class playtimes and weapon kill records, a detailed round table, damage taken, initial touches, and rating change.

Engineer information reuses `renderEngineerBuildings` rather than implementing a second interpretation. It includes sentry kills and uptime by level, total SG, dispenser uptime, and applicable recording notes. Incomplete building values remain unavailable; the section appears only when recorded building information supports it.

### Support comparisons and captures

Overview shows five class entries and six weapon entries ranked by pooled totals; notes identify truncated overview lists and point users to complete player detail records. Comparison bars use actual values and scale each pair against its larger finite value. Damage totals and per-kill/per-death ratios are distinct rows.

Round Performance and Flag Pace compare separate round/team series on a shared round-relative axis: All lines are solid and retain actual blue/red team colors; every series starts at 00:00 with zero captures. Round labels remain in capture hover details and event tables. The match-history sidebar uses the same normalized events, labels each capture's round and relative time, and scales its marker axis to recorded round durations rather than a fixed 15 minutes. The API's concatenated gameplay timestamps are converted only for display by subtracting the sum of preceding recorded round durations. Replay recording epochs include different recording boundaries and are not used. Capture points have accessible names and can be hovered or focused to reveal round, team, capture number, relative time, and player. The capture table identifies each round and shows the same relative time while preserving event order.

Missing, invalid, duplicated, or nonconsecutive round durations stop boundary calculation; captures without a verified boundary remain in the table with unavailable round/time and are excluded from the chart. A capture exactly on a shared round boundary is also unavailable: the API supplies no capture round ID to distinguish the previous round's final second from the next round's zero. No captures produces an explicit empty state, accessible through the Flag Pace tab. Missing timeline records cannot be reconstructed from aggregate capture totals; parser/API ingestion is separate from this frontend correction. The overview still falls back to recorded round scores when available.

### Map Vision and downloads

Map Vision includes independent player and flag heatmaps. Select **Flag heatmap → All flags, Blue flag, or Red flag** to see time spent at recorded flag locations across the full selected round, counting carried and dropped samples only. Untouched opening time and all time after a return/reset at base are excluded; counting resumes on the next pickup. Turn off **Player heatmap** to isolate flag density. Player/life selections and the playback cursor do not limit the flag heatmap. Warmer colors indicate more recorded time, scaled within the current heatmap; colors are not a shared scale for comparing games. Unknown flag ownership is included in All flags; unavailable color choices are disabled. Missing samples are capped to the recording interval, and carried flags use their living carrier's recorded position. Games cannot yet be compared side by side or combined across rounds.

Use **Flag activity → Both / Carried / Dropped** to separate carry routes from dropped-flag hotspots. Each selection is scaled independently. Flag heat uses a compressed time scale to keep shorter routes visible beside long drops while preserving the ordering of recorded time; player heat scaling is unchanged. The map note shows carried and dropped time included in the current selection, summed across selected flags (not unique elapsed round time), or indicates that the selection has no recorded time. Base time remains excluded in every activity view.

Map Vision checks `api/pickup-replays/viewer/{matchId}/{round}` for each known round and enables itself only when metadata with replay files is returned. It links to the existing `pickup-replay.html?matchId={matchId}&round={round}` viewer. Both rounds were verified for D9M3FT. An unavailable replay leaves Map Vision disabled and shows an availability message in Downloads.

JSON exports the full match API response regardless of team selection. CSV exports player metrics for the selected team(s), with quoted cells and spreadsheet-formula escaping for string values. Exports use Blob URLs and revoke them after initiating a download. Available Hampalyzer and TFCStats links remain accessible as match sources.

## Do's and Don'ts

- Do preserve the dashboard content density. Shared navigation renders at native size across pages; the match hero uses the standard desktop density and shared page-hero styles.
- Do retain team labels, explicit metric definitions, keyboard access, and internal table scrolling.
- Do show unavailable data as `—` and preserve complete-record checks for round-derived metrics.
- Don't convert weapon kill counts into shots fired, weapon shares into aggregate kill shares, or pooled class time into elapsed match duration.
- Do convert Flag Pace timestamps using recorded preceding round durations, preserving the original response and stored timestamps.
- Don't assume a fixed round duration, substitute replay recording start times, or infer score points when the source omits them.
- Don't turn this compact match composition into a requirement for unrelated screens.

## Metric sources and interpretation

The page loads `api/match/{id}`. Player matching reuses the incumbent key/Steam ID/name resolution. Full-match player totals come from the API's aggregate `player_stats`; round details retain separate enemy/team/suicide values.

| Display | Source and calculation | Availability or interpretation |
| --- | --- | --- |
| K, D, K/D | `player_stats.kills`, `deaths`; kills / deaths | D excludes suicides. For all eight audited players it equals round enemy deaths + team deaths. K/D displays infinity for positive kills with zero deaths and zero for zero kills/zero deaths. |
| CK, SG | Sum `round_player_stats.conced_kills`, `sentry_kills` | Requires exactly one player record for every known round and valid values throughout; missing or duplicate round records produce `—`. |
| TK | `player_stats.team_kills` | Friendly kills, separate from enemy kills. |
| DMG, TDMG | `player_stats.damage`, `team_damage` | Enemy damage and friendly damage remain separate. |
| CJ, CAPS, TOUCH, TIME | `player_stats.conc_jumps`, `caps`, `touches`, `flag_time_seconds` | Concussion jumps, captures, flag touches, and formatted possession time. |
| Additional details | `player_stats.damage_taken`, `initial_touches`; roster `delta`; returned round fields | Preserve the API's meaning; round deaths show enemy / team / suicide. |
| Team totals | Sum each selected team's player metrics | Missing inputs propagate as unavailable; team K/D is total kills / total deaths. |
| Class Breakdown | Pool `class_stats.seconds` by class and team | Player playtime can exceed elapsed match duration when pooled across a roster. |
| Weapon Usage / player bars | Returned `weapon_stats.kills` | The API query has `LIMIT 50`. Percentages divide a weapon's returned kills by that player's total returned weapon kills, not aggregate player kills. Counts describe recorded kills, not firing frequency. |
| Damage / kill, Damage / death | Team enemy damage / team kills or deaths | Missing inputs or zero denominators produce `—`; no invented finite ratio. |
| Duration | Sum `rounds.duration_seconds` | Requires valid duration for every returned round. |
| Capture charts and sidebar | Sorted nonnegative `capTimeline.time_seconds`; shared helper subtracts preceding `rounds.duration_seconds` | Dashboard charts reset counts for each round/team series and use a shared round-relative axis. Sidebar markers and event list use the same normalization. Unknown boundaries produce unavailable values, never guessed offsets. |
| Score after capture | `capTimeline.score_after` | Null values remain `—`. The chart counts actual captures and does not manufacture score points. |

## Recorded verification

The public reference inspected on October 10, 2026 was [D9M3FT](https://nonamepickup.servehalflife.com/match.html?id=D9M3FT), on `demolish2_b6`, with score (100:70) and duration (30:41). The validation record reconciles all eight players, sixteen round records, and seventeen captures. It records zero page errors and successful checks of all tabs, team filters, mouse/keyboard expansion, keyboard tab navigation, and both replay links. Flag Pace's seventeen relative timestamps were independently compared to the original Hampalyzer flag chart: Round 2 runs from its first capture at 02:20 through its seventh at 13:45, using the recorded Round 1 duration of 941 seconds. Both rounds start at 00:00 and each series starts at zero. Empty and incomplete data states were also checked.

JSON Blob payloads matched the full response; filtered CSV Blob payloads contained the selected team's four players. Actual browser file saving was canceled by the sandbox, so payload validation is the completed export evidence.

Evidence is saved in `C:/Users/riari/.codex/visualizations/2026/10/11/01a128a1-45ef-7893-9549-9de92f44df66/`:

- `dashboard-validation.json` — reconciliation and interaction results.
- `flag-pace-validation.json`, `flag-pace-desktop.png`, `flag-pace-mobile.png` — round-relative capture verification and focused viewport captures.
- `site-wide-round-clock-validation.json`, `round-clock-overview.png`, `flag-pace-sidebar-desktop.png`, `flag-pace-sidebar-mobile.png` — shared clock verification across dashboard, sidebar, and legacy renderer; sidebar unknown-boundary and no-capture states also checked without fabricated axes.
- `desktop-final.png`, `tablet-final.png`, `mobile-final.png` — final viewport captures.
- `replay-1.json`, `replay-2.json` — returned replay metadata.
- `main-tests.log` — existing suite result: 119 tests, 104 passed, 15 pre-existing failures outside the Match Details changes. The API package defines no lint or build scripts.

This documentation pass only reads the saved verification artifacts; it creates, changes, and runs no tests. The recorded failing test names are:

| Existing file | Failing names |
| --- | --- |
| `comparison-engine.test.js` | invalid performance and zero variance use equal-share fallback; fixed-pool replay is chronological, cumulative, separate, and read-only |
| `pickup-replay-brushes.test.js` | pickup replay renders bounded and trigger-aware GoldSrc entity lighting; schema-v4 worker parses sparse brush definitions and transferable timelines; renderer binds brush IDs to submodel nodes and seeks sparse tracks deterministically |
| `pickup-replay-corpses.test.js` | schema-v3 crouch uses baked crouch_idle player geometry instead of scaling; catalog provides class-held weapons and distinct buildable team palettes |
| `pickup-replay-hitscan.test.js` | assault cannon effects originate at the player muzzle and honor the projectile toggle; held weapons inherit the normalized player model scale |
| `pickup-replay-layout.test.js` | pickup replay uses the complete site-wide navigation |
| `pickup-replays.test.js` | event timestamp reversals greater than 50 ms are rejected; schema-v3 rejects absolute, URL, drive-letter, null, and unallowlisted model paths; concurrent identical invalid uploads create one terminal quarantine |
| `replay-map-materials.test.js` | classifies GoldSrc water and effect textures without matching signs |
| `replay-projectile-colors.test.js` | pickup replay cache key exposes the latest projectile classifier |

### Round selection

The independent All rounds / Round 1 / Round 2 selector combines with Both / Team 1 / Team 2. Round views use matched round_player_stats for player and team metrics, round scores, role, damage, timeline and CSV export. Deaths exclude suicides; damage taken sums enemy and team damage and excludes self damage, matching full-match totals. Flag Pace filters normalized events after boundary detection, retaining the original timestamps. Replay links follow the selected round. Class playtime remains full-match only. Round weapon breakdowns use the additive `round_weapon_stats` API field, aggregated from `match_kill_events` by round, attacker and weapon, counting only enemy kills and excluding team kills. No event limit is applied. Player bars and details are shown only when event counts reconcile with that player’s recorded round kills. Team comparisons require complete coverage for every roster player; incomplete teams show unavailable values. Older API responses and missing event tables retain full-match weapon views and report unavailable round events. JSON always exports the original full API response.
