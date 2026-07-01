-- Soldier effectiveness comparison analysis.
--
-- Read-only companion SQL for analysis/soldier_effectiveness_compare.py.
-- It keeps the same two comparison modes as soldier_ng_compare.py:
--
--   equal_time:
--     POST 2026-06-11 21:00:00 through 2026-06-30 00:00:00, exclusive
--     PRE  2026-05-24 18:00:00 through 2026-06-11 21:00:00, exclusive
--
--   equal_match_count:
--     POST same as above
--     PRE  same number of most recent completed matches before POST start
--
-- Soldier rows are selected via match_player_classes, then effectiveness
-- metrics are aggregated from match_player_round_stats.

WITH
constants AS (
  SELECT
    '2026-06-11 21:00:00' AS post_start,
    '2026-06-30 00:00:00' AS post_end,
    '2026-05-24 18:00:00' AS equal_time_pre_start,
    '2026-06-11 21:00:00' AS equal_time_pre_end
),
post_matches AS (
  SELECT m.match_id, m.created_at
  FROM matches m CROSS JOIN constants c
  WHERE m.status = 'completed'
    AND m.created_at >= unixepoch(c.post_start, 'utc')
    AND m.created_at < unixepoch(c.post_end, 'utc')
),
post_count AS (
  SELECT COUNT(*) AS n FROM post_matches
),
equal_match_pre AS (
  SELECT match_id, created_at
  FROM (
    SELECT
      m.match_id,
      m.created_at,
      ROW_NUMBER() OVER (ORDER BY m.created_at DESC) AS rn
    FROM matches m CROSS JOIN constants c
    WHERE m.status = 'completed'
      AND m.created_at < unixepoch(c.post_start, 'utc')
  )
  WHERE rn <= (SELECT n FROM post_count)
),
selected_matches AS (
  SELECT 'equal_time' AS comparison_mode, 'Equal Time' AS comparison_label, 'POST' AS period, match_id FROM post_matches
  UNION ALL
  SELECT 'equal_time', 'Equal Time', 'PRE', m.match_id
  FROM matches m CROSS JOIN constants c
  WHERE m.status = 'completed'
    AND m.created_at >= unixepoch(c.equal_time_pre_start, 'utc')
    AND m.created_at < unixepoch(c.equal_time_pre_end, 'utc')
  UNION ALL
  SELECT 'equal_match_count', 'Equal Match Count', 'POST', match_id FROM post_matches
  UNION ALL
  SELECT 'equal_match_count', 'Equal Match Count', 'PRE', match_id FROM equal_match_pre
),
period_matches AS (
  SELECT sm.comparison_mode, sm.comparison_label, sm.period, m.match_id, COALESCE(NULLIF(m.map_name, ''), '(unknown)') AS map_name
  FROM selected_matches sm
  JOIN matches m ON m.match_id = sm.match_id
),
soldier_class_rounds AS (
  SELECT DISTINCT match_id, player_key, round_num
  FROM match_player_classes
  WHERE LOWER(TRIM(class_name)) = 'soldier'
    AND COALESCE(seconds, 0) > 0
),
soldier_rounds AS (
  SELECT
    pm.comparison_mode,
    pm.comparison_label,
    pm.period,
    pm.match_id,
    pm.map_name,
    s.round_num,
    COALESCE(NULLIF(s.steam_id, ''), NULLIF(s.player_key, '')) AS player_id,
    COALESCE(NULLIF(s.display_name, ''), NULLIF(s.steam_id, ''), s.player_key, 'Unknown') AS player_name,
    COALESCE(s.kills, 0) AS kills,
    COALESCE(s.deaths_by_enemy, 0) + COALESCE(s.deaths_by_team, 0) + COALESCE(s.suicides, 0) AS deaths,
    COALESCE(s.enemy_damage, 0) AS damage,
    COALESCE(s.team_damage, 0) AS team_damage,
    COALESCE(s.damage_taken_enemy, 0) + COALESCE(s.damage_taken_team, 0) AS damage_taken,
    COALESCE(s.flag_captures, 0) AS captures,
    COALESCE(s.flag_touches, 0) AS flag_touches
  FROM period_matches pm
  JOIN match_player_round_stats s ON s.match_id = pm.match_id
  JOIN soldier_class_rounds sc
    ON sc.match_id = s.match_id
   AND sc.player_key = s.player_key
   AND sc.round_num = s.round_num
),
overall AS (
  SELECT
    comparison_mode,
    comparison_label,
    period,
    COUNT(*) AS soldier_rounds,
    1.0 * SUM(damage) / NULLIF(COUNT(*), 0) AS damage_per_round,
    1.0 * SUM(kills) / NULLIF(COUNT(*), 0) AS kills_per_round,
    1.0 * SUM(deaths) / NULLIF(COUNT(*), 0) AS deaths_per_round,
    1.0 * SUM(kills) / NULLIF(SUM(deaths), 0) AS kd,
    1.0 * SUM(damage_taken) / NULLIF(COUNT(*), 0) AS damage_taken_per_round,
    1.0 * SUM(captures) / NULLIF(COUNT(*), 0) AS captures_per_round,
    1.0 * SUM(flag_touches) / NULLIF(COUNT(*), 0) AS flag_touches_per_round,
    1.0 * SUM(team_damage) / NULLIF(COUNT(*), 0) AS team_damage_per_round,
    100.0 * SUM(team_damage) / NULLIF(SUM(damage) + SUM(team_damage), 0) AS friendly_damage_pct
  FROM soldier_rounds
  GROUP BY comparison_mode, comparison_label, period
)
SELECT * FROM overall
ORDER BY comparison_mode, period;

-- Player, paired-player, and map outputs use the same CTE block and replace
-- the final GROUP BY with:
--   period, player_id
--   period, map_name
-- The Python script pivots PRE/POST and filters paired players to minimum
-- Soldier rounds of 5+ and 10+ in both periods.
