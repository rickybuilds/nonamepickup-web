# Global Speedrun Comparison Engine

## Architecture review

The existing speedrun API is mounted at `/api/speedruns` and reads MariaDB
through `src/db/mariadb.js`. `routes/speedruns.js` owns the current map,
record, replay, progression, player, and leaderboard endpoints. Internal world
records are derived from `speedrun_records` with `ROW_NUMBER()` ordered by
time, achievement timestamp, and Steam ID. Map and player pages consume those
API responses and contain their own rendering logic.

The comparison engine does not change those responses or any browser code.
It establishes a separate backend boundary that future pages, bots, and
announcements can consume.

## Permanent component boundaries

```text
Consumer (API / Discord / announcement / future page)
                         |
                         v
             ExternalBaselineService
              |        |         |
              |        |         +-- comparison models and delta rules
              |        +------------ 30-second snapshot cache
              +--------------------- SpeedrunComparisonRepository
                                            |
                                            v
                                         MariaDB
                         speedrun_records + speedrun_external_records
```

- `domain.js` is the shared source for class names and time formatting.
- `comparisonRepository.js` contains all comparison SQL.
- `comparisonModels.js` defines normalized internal, external, time, source,
  player, map, difference, and comparison objects.
- `externalBaselineService.js` groups flat SQL rows, determines leaders,
  calculates deltas, caches snapshots, and provides consumer-oriented methods.
- `routes/speedrunComparisons.js` performs HTTP validation and serialization
  only. It contains no ranking SQL or rendering logic.

The importer remains independent and unchanged.

## Comparison semantics

`difference.signedMilliseconds` is always from the internal perspective:

```text
internal time - fastest external time
```

- Negative: internal is ahead.
- Positive: internal is behind.
- Zero: tied.
- `null`: one side has no record.

Each comparison includes:

- canonical map and class;
- current internal WR, if present;
- every external source baseline;
- fastest external baseline;
- fastest overall record;
- all tied fastest-overall leaders;
- signed and absolute difference;
- status: `internal_faster`, `external_faster`, `tied`, `no_internal`,
  `no_external`, or `no_records`;
- fastest external owner.

## Record eligibility

`MIN_VALID_RUN_TIME_MS` defines the minimum completion time that can participate
in public speedrun records. It defaults to `2000` milliseconds. Internal runs,
internal records, and imported external baselines below the threshold remain in
MariaDB for auditing, but are excluded before ranking, counting, progression,
comparison snapshots, player summaries, and candidate announcement checks.

Candidate comparisons expose `eligible` and `minimumValidTimeMs`; an ineligible
candidate never receives a delta or `beatsExternal` result.

## Service interface

The reusable service exposes:

- `getMapClass(map, classId)`
- `getMap(map)`
- `getFastestExternal(map, classId)`
- `getExternalBaselines(map, classId)`
- `getSummary()`
- `getLeaderboard(filters)`
- `getExternalOnlyMaps(pagination)`
- `getMapsWithoutInternalRecords(pagination)`
- `getPlayerSummary(discordId)`
- `compareCandidate({ map, classId, timeMs })`
- `invalidate()`

Discord and announcement code should instantiate the same repository/service
classes and call these methods. They must not query
`speedrun_external_records` directly.

## HTTP API

### `GET /api/speedruns/comparisons/summary`

Returns engine-wide counts, including internal/external wins, missing records,
maps with no internal records, and external-only maps.

### `GET /api/speedruns/comparisons/leaderboard`

Query parameters:

- `status`: one comparison status;
- `source`: external source ID;
- `q`: map search;
- `sort=gap`: largest absolute gaps first;
- `limit`: 1–500;
- `offset`: non-negative page offset.

### `GET /api/speedruns/comparisons/maps/:map`

Returns every class comparison for one map.

### `GET /api/speedruns/comparisons/maps/:map/classes/:classId`

Returns one canonical map/class comparison.

### `GET /api/speedruns/comparisons/external-only`

Returns paginated maps that are external-only, grouped across classes and
sources.

### `GET /api/speedruns/comparisons/missing-internal`

Returns maps with external baselines but no internal record in any class. This
includes both matched `speedrun_maps` entries and external-only maps.

### `GET /api/speedruns/comparisons/players/:discordId`

Compares each linked player PB against the fastest external baseline and
summarizes ahead, behind, tied, missing-baseline, and internal-WR counts.

## SQL and performance

No new SQL view or migration is required. A view would either hardcode the
active ruleset or still require additional grouping in every consumer.
Instead, one repository query:

1. ranks internal records once with a window function;
2. selects the internal WR for every map/class;
3. maps external records through `map_id`, retaining external-only keys;
4. unions the internal and external key spaces;
5. returns a flat, ordered result set for service-level grouping.

This avoids N+1 behavior. A complete comparison snapshot is a few thousand
rows, appropriate for the current dataset. Player summaries issue one
additional set-based query for all linked player records and use the cached
snapshot for baseline lookup.

Recommended supporting indexes already exist or are supplied by the source
schemas:

- `speedrun_external_records` unique key on
  `(source, map_name_normalized, class_id)`;
- `speedrun_external_records(map_id)`;
- internal record keys used throughout the existing speedrun API.

## Caching

The service caches both the in-flight promise and completed snapshot for 30
seconds. Concurrent HTTP requests therefore share one MariaDB query.
`SPEEDRUN_COMPARISON_CACHE_TTL_MS` can configure 1–300 seconds.

External imports run out of process, so TTL expiry is the cross-process
invalidation mechanism. In-process writers or future event consumers can call
`service.invalidate()` immediately.

## Extension points

- Add source labels in `comparisonModels.js`; source rows are otherwise
  data-driven.
- Add historical snapshots without changing current comparison consumers.
- Use `compareCandidate` before Discord/AMXX announcements.
- Add aggregate statistics by filtering the cached comparison snapshot.
- Add Redis or another shared cache behind the service if the API becomes
  multi-process.
- Add a materialized summary table only if dataset size makes the current
  set-based snapshot query measurably expensive.
