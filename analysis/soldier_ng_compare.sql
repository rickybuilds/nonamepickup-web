-- Soldier nail grenade comparison analysis.
--
-- This SQL mirrors analysis/soldier_ng_compare.py. It is intended for read-only
-- use against data/elo.db and supports two comparison modes:
--
--   equal_time:
--     POST 2026-06-11 21:00:00 through 2026-06-30 00:00:00, exclusive
--     PRE  2026-05-24 18:00:00 through 2026-06-11 21:00:00, exclusive
--
--   equal_match_count:
--     POST same as above
--     PRE  same number of most recent completed matches before POST start
--
-- Times are interpreted as local match-log time through SQLite's 'utc'
-- modifier, matching the Python script.
--
-- Authoritative sources chosen after schema inspection:
--   matches                    match metadata and timestamps
--   match_player_classes       per-round Soldier membership
--   match_player_round_stats   per-player, per-round damage/team data
--   match_flag_events          objective events, normalized to round teams
--   match_rounds               offense/defense team mapping for TFCStats rows

-- OVERALL
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
    s.player_key,
    COALESCE(NULLIF(s.steam_id, ''), NULLIF(s.player_key, '')) AS player_id,
    COALESCE(NULLIF(s.display_name, ''), NULLIF(s.steam_id, ''), s.player_key, 'Unknown') AS player_name,
    s.team_name,
    COALESCE(s.enemy_damage, 0) AS damage,
    COALESCE(s.team_damage, 0) AS team_damage
  FROM period_matches pm
  JOIN match_player_round_stats s ON s.match_id = pm.match_id
  JOIN soldier_class_rounds sc
    ON sc.match_id = s.match_id
   AND sc.player_key = s.player_key
   AND sc.round_num = s.round_num
)
SELECT
  comparison_mode,
  comparison_label,
  period,
  COUNT(DISTINCT match_id) AS matches,
  COUNT(DISTINCT match_id || ':' || round_num) AS rounds,
  COUNT(*) AS soldier_player_rounds,
  COUNT(DISTINCT player_id) AS unique_soldier_players,
  COUNT(DISTINCT map_name) AS unique_maps,
  SUM(damage) AS soldier_damage,
  SUM(team_damage) AS soldier_team_damage,
  1.0 * SUM(damage) / NULLIF(COUNT(*), 0) AS damage_per_soldier_round,
  1.0 * SUM(team_damage) / NULLIF(COUNT(*), 0) AS team_damage_per_soldier_round,
  1.0 * SUM(team_damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS team_damage_per_soldier_match,
  100.0 * SUM(team_damage) / NULLIF(SUM(damage), 0) AS team_damage_pct_soldier_damage
FROM soldier_rounds
GROUP BY comparison_mode, comparison_label, period
ORDER BY comparison_mode, period;

-- BY MAP
-- Reuse the CTE block above and replace the final SELECT with:
-- SELECT comparison_mode, comparison_label, period, map_name,
--        COUNT(DISTINCT match_id) AS matches,
--        COUNT(*) AS soldier_player_rounds,
--        COUNT(DISTINCT player_id) AS unique_soldier_players,
--        SUM(damage) AS soldier_damage,
--        SUM(team_damage) AS soldier_team_damage,
--        1.0 * SUM(damage) / NULLIF(COUNT(*), 0) AS damage_per_soldier_round,
--        1.0 * SUM(team_damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS team_damage_per_match
-- FROM soldier_rounds
-- GROUP BY comparison_mode, comparison_label, period, map_name;

-- BY PLAYER
-- Reuse the CTE block above and replace the final SELECT with:
-- SELECT comparison_mode, comparison_label, period, player_id, MAX(player_name) AS player_name,
--        COUNT(DISTINCT match_id) AS matches,
--        COUNT(*) AS rounds,
--        SUM(damage) AS damage,
--        SUM(team_damage) AS team_damage,
--        1.0 * SUM(team_damage) / NULLIF(COUNT(*), 0) AS team_damage_per_round,
--        1.0 * SUM(team_damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS team_damage_per_match,
--        100.0 * SUM(team_damage) / NULLIF(SUM(damage), 0) AS team_damage_pct_soldier_damage
-- FROM soldier_rounds
-- GROUP BY comparison_mode, comparison_label, period, player_id;

-- OBJECTIVES
-- Reuse the same cohort CTE block, then add:
-- normalized_objective_events AS (...)
-- objective_allowed AS (...)
-- The Python script contains the full normalized objective CTE used for exports.
