# Defense Ratings (Experimental)

## Status

The Analytics Defense Ratings tab publishes clearly labeled **estimated** class ratings when round-level role, class-duration, identity and score records pass the 70% dominance/coverage checks. These are not verified continuous participation ratings.

## What the proposed rating measures

Defense rating = eligible map defensive-team captures conceded per round minus the player's defensive-team captures conceded per round in estimated selected-class defensive appearances. Positive is favorable. It is an observational team-result association, affected by teammates, opponents, roles and sample size, not causal individual skill or contribution.

The API never mixes estimated and verified observations. Estimated baselines use unique defensive team-rounds for the selected class; player minimums are eligible appearances, not full matches.

## Source investigation

- `matches`: completed map, persisted rosters and match results. Does not establish player class/role windows.
- `match_player_classes`: class duration by match/round; a brief appearance must not receive an entire match's result.
- `match_player_round_stats`: role and team snapshots by round; no uninterrupted class assignment.
- `match_rounds`: round scores and team roles, not player class windows.
- `match_role_events`: timestamped class/role/team records exist in the schema, but this repository has no validated initial-state or transition-completeness ingestion contract. Isolated events cannot establish what happened between them.
- Capture and combat event tables: event timestamps and class snapshots cannot prove continuous defensive participation.
- Pickup/replay ingestion: persists session team, primary class and joined/left times. Primary class and snapshots cannot prove uninterrupted class plus verified defensive duty.

Runtime table coverage and linked-row counts are reported by the API. Table presence or nonzero rows are evidence of records, not proof of reliable full participation. Suspicious Scout/Medic/Spy durations (>=120 seconds or >50% of recorded time) are excluded and documented as diagnostic anomalies. No source records are modified or synthesized.

## Missing collection contract

A future recorder/importer must provide verified initial class, team and defensive role per session, complete timestamped class/team/role/substitution transitions, round clock alignment for capture events, and explicit start/end coverage and gap validation. Observations require all relevant player/session and capture coverage. Incomplete matches, ambiguous identity, partial class appearance, substitution gaps and missing telemetry must remain excluded rather than becoming zero concessions.

The current repository does not own a validated game-server class/role recorder with that contract. Adding a web endpoint accepting arbitrary inferred class labels would not solve the evidence gap. This implementation establishes the safe API/readiness boundary; enabling numeric aggregation requires separately audited telemetry and observation definitions.

## UI and extension

The dedicated Analytics tab supports selecting the four primary defensive classes, map and view controls within the NoName design system. Estimated status is shown throughout the telemetry, KPI, spotlight and leaderboard views. Existing Capture Ratings remains operational.

Future metrics can extend the shared loaded-data controller/components once the API can return verified eligible class observations with a stable baseline, denominator and coverage metadata. The API does not turn class names or preferred classes into ratings.

## Validation

`node --test api/test/capture-ratings.test.js api/test/capture-ratings-ui.test.js api/test/defense-ratings.test.js api/test/defense-ratings-ui.test.js`: 24 passing regressions. Defense coverage includes completed-map filtering, empty/missing telemetry, brief class changes, unavailable formulas/baselines/appearances, API envelope/cache/error behavior, class/map/view/filter interactions, empty search/keyboard behavior and rejection of unsupported numeric contracts. Existing Capture formula, eligibility, sorting, filtering, charts and searchable Spotlight regressions also pass after extracting the shared control.

No class rating formula result or example is claimed verified against production data. Numeric rating/ranking/chart tests cannot establish absent telemetry; instead the foundation tests ensure such output remains unavailable. Enabling the feature's numeric phase requires new observation eligibility and denominator tests against verified collection coverage.

Visual validation inspected desktop and 600px-wide browser captures of the unavailable foundation using a temporary coverage fixture (no class ratings or synthetic production observations). Both layouts preserved usable class/filter controls and readable telemetry states. Accurate phone-width emulation was not performed. No production deployment was performed.
