# Bootcamp skill point boards

The feature-flagged Bootcamp API exposes the website's all-time and monthly
skill-point standings at `GET /api/bootcamp/leaderboards/skill-points`.

## Scoring

Each player's current best tier for each route or drill contributes once to the
all-time score: bronze 1, silver 2, gold 3, platinum 5. Route class variants
and class-specific drill results are separate objectives, matching the
`bootcamp_tiers` identity key.

Monthly points count only tier improvements recorded during that UTC calendar
month. The score is the difference between the new tier's point value and the
previous recorded tier's value. An objective contributes once to the monthly
objective count even if it improves more than once in the same month. Month
boundaries use a half-open interval (`created_at >= start` and `< next month`)
so adjacent boards cannot overlap.

## Requests

- `GET /api/bootcamp/leaderboards/skill-points` returns the all-time board.
- `GET /api/bootcamp/leaderboards/skill-points?period=all_time` is equivalent.
- `GET /api/bootcamp/leaderboards/skill-points?period=monthly&month=2026-11`
  returns November 2026's UTC board. `month` is optional and defaults to the
  current UTC month.

Responses include `period`, `month`, `startsAt`, `endsAt`, and a `scores` array.
Each score has `steamId`, `playerName`, `points`, and `objectives`. The API
rejects unsupported periods and malformed months with HTTP 400; database errors
return a generic HTTP 503 response. Both the API mount and static website remain
disabled unless the existing Bootcamp feature flag is explicitly enabled.
