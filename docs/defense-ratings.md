# Defense Ratings V3 (Estimated)

## Root cause and data contract

The V2 chart containers contained text only. There were no distribution or trend rendering functions. V3 renders SVGs using the existing Capture Ratings chart styles. The API supplies class-specific, unique defensive team-round outcomes and the IDs of qualifying players sharing each outcome.

The observation unit is a defensive round, never a completed match. Legacy API fields `games` are retained for compatibility: bucket.games means unique class/team-rounds; player.games means qualifying player-round appearances. All V3 visible labels use rounds. Completed matches in the map card are coverage only.

## Calculation and weighting

- Captures conceded: sum of `match_player_round_stats.flag_captures` for the assigned offensive team in the same match/round. Missing, fractional or negative values invalidate that offense team's total. No score-to-capture conversion is assumed.
- Baseline: mean captures conceded across unique eligible `(match_id, round_num, defense_team)` outcomes for a map/class. Multiple qualifying defenders on one team-round do not duplicate that outcome.
- Player average: sum of team concessions across qualifying selected-class player-rounds / qualifying player-round count.
- Estimated Defense Rating: baseline minus player average. Positive is favorable. This is an association with team results, not causal individual impact.
- Baseline population remains all eligible class/team-rounds. Minimum-round filters select players; charts include the unique team-rounds associated with at least one such player. Name search filters the table only.
- Exact rating ties share competition ranks. Bars share a symmetric zero-centered scale across the eligible player set, including the spotlight.

## Estimated eligibility and integrity

Join `matches`, `match_rounds`, `match_player_round_stats` and `match_player_classes` by match, round and exact Steam player key. Require completed known-map matches, matching defensive team assignment, positive round duration, known identity, a role naming the selected class, at least 70% selected class share of recorded class seconds, and at least 70% class-time coverage of the round. Total recorded class time may not exceed round duration plus two seconds of rounding tolerance.

When match roster columns are present, require an unambiguous Steam-to-Discord profile mapping in the recorded roster; invalid/overlapping rosters are excluded. Stable Steam IDs distinguish participation records. Profile links use uniquely mapped Discord IDs; unlinked names are rendered as text.

Scout, Medic or Spy totals of at least 120 seconds, or more than half the recorded class time, flag an unresolved attribution anomaly and exclude that appearance. Aggregate seconds cannot prove *continuous* duration, so the 120-second check is explicitly a conservative aggregate-duration flag. No class time is reassigned or historical data mutated. Substitutions with under 70% coverage are excluded; remaining substitutions and missing class transitions cannot be fully verified from aggregate telemetry. Estimated and verified observations are never mixed.

Runtime coverage.exclusions reports counts by first failing check. Local read-only snapshot audit (2026-11-11): 3,043 completed matches, 22,807 eligible defensive player-round appearances. Exclusions: identity 11; roster 183; invalid duration 1; suspicious class 61; dominance 433; coverage 609; capture data 27. Counts describe player-round records after joins and defensive assignment, not distinct matches, and are not additive diagnostic overlap counts. Offense round stats must include at least the roster's expected team size before publishing a capture total.

Local phantom_lg (279 completed matches; production had 295 at investigation time): Soldier 523 unique rounds / 528 appearances; Demoman 522 / 522; HWGuy 523 / 523; Engineer 506 / 507. Baselines approximately 6.80, 6.78, 6.82, 6.79 captures conceded/round respectively. Production results depend on its newer snapshot.

Both Capture and Defense use `loadDiscordDisplayNames`: Discord's persisted display_name (global_name/username when blank), then ratings.display_name as the cached Discord fallback. Match aliases, Hampalyzer names, and Steam last-used names are never display-name fallbacks. Names and profile URLs resolve through the Discord identity. The local audit found 142 eligible Discord profiles, all with names. Name freshness depends on bot-maintained database caches; the website does not make live Discord requests. Unknown names show an explicit Discord-ID label, never a guessed alias.

## Charts and interactions

Distribution uses adaptive integer capture buckets (up to roughly eight), percentage axis, and tooltips with counts and percentages. Every team-round counts once regardless of how many qualifying defenders share it.

Trend shows actual individual team-round outcomes, all-eligible baseline and optional trailing-five-observation average. First four averages use available partial windows. No interpolation or fabricated historical observations. Complete timestamps use chronological match creation order, then match ID / round / team. Match creation timestamps establish order between matches, not exact round start time. Incomplete timestamps switch the entire series to explicitly labeled deterministic match ID / round / team order.

The shared searchable combobox updates spotlight only on selection, supports keyboard/mouse/clear/outside dismissal, and stays synchronized with row Inspect buttons. Highest-rated qualifying defender is the default. Map, class and minimum changes retain a selected player only while eligible. Empty/error states clear stale charts and rankings. Sample badges describe counts (<10, 10–24, 25–49, 50+ defensive rounds), not confidence intervals or equivalent full-match experience.

## Validation

Focused API/model/VM UI tests cover deduplication, baseline/formula, suspicious and excessive durations, missing capture data, ordering, partial rolling windows, tiers, filters, class changes, search, keyboard selection and spotlight synchronization. Existing Capture tests now use its minimum selector for 25+ thresholds following the previously requested removal of the established-samples checkbox; Capture calculations are unchanged.

Desktop and 390px mobile browser inspection used the local read-only database-backed preview. Spotlight, charts, class selectors and scrollable table were inspected. No production deployment or database mutation is part of this work.

25 focused ratings tests pass. The repository-wide Node suite reports 138 tests, 123 passing and 15 failures in Elo/replay tests outside the changed ratings files. No lint script is defined in api/package.json. Syntax and diff checks pass; the design detector reports incumbent site-wide typography/contrast/decorative patterns, which this parity change preserves.
