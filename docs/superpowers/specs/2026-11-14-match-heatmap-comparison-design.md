# Match heatmap comparison prototype

Status: Proposed design; implementation has not started.

## Intent

Compare where flags or players spent time in one complete match versus another, without long flag drops obscuring carry routes. The user chose a separate prototype page in the existing site. Keep the current Map Vision viewer intact.

## Approaches

- Chosen: a standalone `map-vision-compare.html` page in the existing repository and deployment. Reuse tactical replay data and map overview projection. This provides room for two maps without adding a new hosting environment.
- Alternative: embed comparison in the existing Map Vision tab. Easier to find, but crowds the playback interface before the comparison workflow is settled.
- A separate hosted test site would duplicate deployment setup without adding value for this first prototype.

## First version

- Two match inputs, accepting IDs or match-page links. A Compare button loads both matches. Preserve the pair and heatmap settings in the page URL for sharing.
- Use both recorded rounds (1 and 2) from each match. Require both complete tactical datasets before showing a full-match comparison. Explain which match/round is unavailable; never silently compare partial games.
- Both matches and all four datasets must use the same map. Show a clear mismatch message instead of projecting different maps onto one overview.
- Two equally sized map panels on desktop, stacked on mobile. Use the same map orientation and initial extent for both. No synchronized playback, pan, or zoom in this first version; these are static whole-match heatmaps.
- Show match ID, map, included rounds, and recorded duration on each panel, with a link back to its match page.
- Heat source: Flags (default) or Players.
- For flags: All flags / Blue flag / Red flag, plus Both / Carried / Dropped. Default to All flags and Carried so routes are visible immediately. Exclude base time before the first touch and after every reset. Reuse current carrier-position, visibility, flag-ownership, and sample-gap rules.
- For players: Everyone / In-game blue / In-game red. Count living samples only, across both rounds. These color filters describe recorded in-game sides, not persistent rosters or equivalent teams across games. Do not imply that matching colors identify the same players.
- Flag ownership uses explicit metadata or existing two-flag carrier evidence. Unknown ownership contributes only to All flags. Explain absent/unidentified flag tracks without falling back to player heat automatically.
- Record time in seconds, capping contributions at the recording interval and round boundaries. Sum round density grids, not separately colored/normalized images. Never create dwell time across recording gaps.
- One shared heat scale for the displayed pair: use the greater peak density of the two combined match grids, with identical smoothing and color mapping. For flags, retain the current compressed time mapping to keep shorter carries visible beside long drops. A warmer area always represents more accumulated recorded time on either panel; do not normalize each match independently.
- Show recorded carried/dropped totals for the current flag filters, or living player-time for player filters. Totals sum time across tracked entities and can exceed elapsed match duration. Display recorded match durations so different recording lengths remain apparent. This first version compares raw time, not time-normalized percentages or drop counts.
- A shared legend states that warmer means more recorded time and that both panels use one scale. An empty activity selection should explicitly say no recorded activity; a blank map must not masquerade as missing replay data.
- Keep entry out of main navigation while prototyping. Provide a small "Compare matches (prototype)" link from Map Vision that prefills the current match. Do not mount the existing playback engine twice and label it full-match heat comparison.

## Implementation boundaries

Reuse the current overview image loader and coordinate projection rather than maintaining a second map calibration list. Share heatmap accumulation/rendering helpers where useful, while preserving existing single-round playback behavior. The implementer chooses helper boundaries and filenames consistent with the repository. No backend or recording format changes are expected: `/api/pickup-replays/viewer/{matchId}/{round}/tactical` already supplies the necessary tracks.

Bound concurrent data requests, abort superseded comparisons, and guard against stale results replacing a newer pair. Cache the four round datasets for filter changes rather than downloading them again. Release old data when replacing the pair. Use native labelled controls and existing dark interface styles; loading, invalid IDs, missing rounds, missing overview, mismatched maps, and no activity need distinct messages.

## Deferred

Difference overlays, same-player matching across games, persistent team/attacking-side alignment, mirrored map halves, per-life filters, playback synchronization, time-normalized comparisons, saved comparisons, and a separate test deployment.

## Verification and delivery

Follow repository instructions: do not add, modify, or run tests. Check JavaScript syntax and whitespace, review shared-scale calculation, all-four-round requirements, cancellation, and zero-activity behavior. Inspect desktop/mobile rendering if a usable local browser/data setup is available; report that limitation honestly otherwise. Review the completed change before committing and pushing as the repository requires.
