#!/usr/bin/env python3
"""Compare Soldier gameplay before/after nail grenades were disabled."""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "elo.db"
DEFAULT_OUTPUT = ROOT / "analysis" / "output"
DEFAULT_DASHBOARD_DATA = ROOT / "analysis" / "dashboard" / "data.js"

POST_START = "2026-06-11 21:00:00"
POST_END = "2026-06-30 00:00:00"
EQUAL_TIME_PRE_START = "2026-05-24 18:00:00"
EQUAL_TIME_PRE_END = "2026-06-11 21:00:00"

REQUIRED_SCHEMA = {
    "matches": {"match_id", "created_at", "map_name", "status"},
    "match_player_classes": {"match_id", "player_key", "class_name", "round_num", "seconds"},
    "match_player_round_stats": {
        "match_id",
        "player_key",
        "steam_id",
        "display_name",
        "round_num",
        "team_name",
        "enemy_damage",
        "team_damage",
    },
    "match_flag_events": {
        "match_id",
        "round_num",
        "team",
        "team_id",
        "source",
        "flag_event_type",
        "subtype",
    },
    "match_rounds": {"match_id", "round_num", "offense_team", "defense_team"},
}

OVERALL_METRICS = [
    "matches",
    "rounds",
    "soldier_player_rounds",
    "unique_soldier_players",
    "unique_maps",
    "soldier_damage",
    "soldier_team_damage",
    "damage_per_soldier_round",
    "team_damage_per_soldier_round",
    "team_damage_per_soldier_match",
    "team_damage_pct_soldier_damage",
    "damage_per_team_damage",
    "soldier_damage_per_match",
]

MAP_METRICS = [
    "matches",
    "soldier_player_rounds",
    "unique_soldier_players",
    "soldier_damage",
    "soldier_team_damage",
    "damage_per_soldier_round",
    "team_damage_per_match",
]

PLAYER_METRICS = [
    "matches",
    "rounds",
    "damage",
    "team_damage",
    "team_damage_per_round",
    "team_damage_per_match",
    "team_damage_pct_soldier_damage",
]

OBJECTIVE_METRICS = [
    "matches",
    "soldier_player_rounds",
    "flag_touches_allowed",
    "captures_allowed",
    "flag_touches_allowed_per_match",
    "captures_allowed_per_match",
]

BASE_CTE_TEMPLATE = """
WITH
selected_matches(period, match_id) AS (
  VALUES
    {selected_values}
),
period_matches AS (
  SELECT
    sm.period,
    m.match_id,
    m.created_at,
    COALESCE(NULLIF(m.map_name, ''), '(unknown)') AS map_name
  FROM selected_matches sm
  JOIN matches m ON m.match_id = sm.match_id
  WHERE m.status = 'completed'
),
soldier_class_rounds AS (
  SELECT DISTINCT
    c.match_id,
    c.player_key,
    c.round_num
  FROM match_player_classes c
  WHERE LOWER(TRIM(c.class_name)) = 'soldier'
    AND COALESCE(c.seconds, 0) > 0
),
soldier_rounds AS (
  SELECT
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
  JOIN match_player_round_stats s
    ON s.match_id = pm.match_id
  JOIN soldier_class_rounds sc
    ON sc.match_id = s.match_id
   AND sc.player_key = s.player_key
   AND sc.round_num = s.round_num
  WHERE s.round_num IS NOT NULL
),
normalized_objective_events AS (
  SELECT
    f.match_id,
    f.round_num,
    CASE
      WHEN LOWER(TRIM(COALESCE(f.source, ''))) = 'tfcstats'
       AND (LOWER(TRIM(COALESCE(f.team, ''))) = 'blue' OR f.team_id = 1)
      THEN mr.offense_team
      WHEN LOWER(TRIM(COALESCE(f.source, ''))) = 'tfcstats'
       AND (LOWER(TRIM(COALESCE(f.team, ''))) = 'red' OR f.team_id = 2)
      THEN mr.defense_team
      ELSE f.team
    END AS event_team,
    CASE
      WHEN LOWER(TRIM(f.flag_event_type)) IN ('pickup', 'player_picked_up_flag') THEN 1
      ELSE 0
    END AS is_touch,
    CASE
      WHEN LOWER(TRIM(f.flag_event_type)) IN ('cap', 'player_captured_flag')
       AND LOWER(TRIM(COALESCE(f.subtype, ''))) != 'bonus_cap'
      THEN 1
      ELSE 0
    END AS is_capture
  FROM match_flag_events f
  LEFT JOIN match_rounds mr
    ON mr.match_id = f.match_id
   AND mr.round_num = f.round_num
  WHERE (
      LOWER(TRIM(f.flag_event_type)) = 'pickup'
      AND LOWER(TRIM(f.subtype)) = 'grabbed'
    )
    OR LOWER(TRIM(f.flag_event_type)) IN (
      'cap',
      'player_picked_up_flag',
      'player_captured_flag'
    )
),
objective_allowed AS (
  SELECT
    sr.period,
    sr.match_id,
    sr.map_name,
    sr.round_num,
    sr.player_key,
    sr.player_id,
    sr.team_name,
    SUM(COALESCE(f.is_touch, 0)) AS flag_touches_allowed,
    SUM(COALESCE(f.is_capture, 0)) AS captures_allowed
  FROM soldier_rounds sr
  LEFT JOIN normalized_objective_events f
    ON f.match_id = sr.match_id
   AND f.round_num = sr.round_num
   AND f.event_team IS NOT NULL
   AND sr.team_name IS NOT NULL
   AND LOWER(TRIM(f.event_team)) != LOWER(TRIM(sr.team_name))
  GROUP BY
    sr.period,
    sr.match_id,
    sr.map_name,
    sr.round_num,
    sr.player_key,
    sr.player_id,
    sr.team_name
)
"""

OVERALL_SELECT = """
SELECT
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
  100.0 * SUM(team_damage) / NULLIF(SUM(damage), 0) AS team_damage_pct_soldier_damage,
  1.0 * SUM(damage) / NULLIF(SUM(team_damage), 0) AS damage_per_team_damage,
  1.0 * SUM(damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS soldier_damage_per_match
FROM soldier_rounds
GROUP BY period
ORDER BY period
"""

MAP_SELECT = """
SELECT
  period,
  map_name,
  COUNT(DISTINCT match_id) AS matches,
  COUNT(*) AS soldier_player_rounds,
  COUNT(DISTINCT player_id) AS unique_soldier_players,
  SUM(damage) AS soldier_damage,
  SUM(team_damage) AS soldier_team_damage,
  1.0 * SUM(damage) / NULLIF(COUNT(*), 0) AS damage_per_soldier_round,
  1.0 * SUM(team_damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS team_damage_per_match
FROM soldier_rounds
GROUP BY period, map_name
ORDER BY map_name, period
"""

PLAYER_SELECT = """
SELECT
  period,
  player_id,
  MAX(player_name) AS player_name,
  COUNT(DISTINCT match_id) AS matches,
  COUNT(*) AS rounds,
  SUM(damage) AS damage,
  SUM(team_damage) AS team_damage,
  1.0 * SUM(team_damage) / NULLIF(COUNT(*), 0) AS team_damage_per_round,
  1.0 * SUM(team_damage) / NULLIF(COUNT(DISTINCT match_id), 0) AS team_damage_per_match,
  100.0 * SUM(team_damage) / NULLIF(SUM(damage), 0) AS team_damage_pct_soldier_damage
FROM soldier_rounds
GROUP BY period, player_id
ORDER BY player_name, period
"""

OBJECTIVE_SELECT = """
SELECT
  period,
  COUNT(DISTINCT match_id) AS matches,
  COUNT(*) AS soldier_player_rounds,
  SUM(flag_touches_allowed) AS flag_touches_allowed,
  SUM(captures_allowed) AS captures_allowed,
  1.0 * SUM(flag_touches_allowed) / NULLIF(COUNT(DISTINCT match_id), 0) AS flag_touches_allowed_per_match,
  1.0 * SUM(captures_allowed) / NULLIF(COUNT(DISTINCT match_id), 0) AS captures_allowed_per_match
FROM objective_allowed
GROUP BY period
ORDER BY period
"""


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def validate_schema(conn: sqlite3.Connection) -> None:
    tables = {
        row["name"]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table', 'view')"
        )
    }
    missing_tables = sorted(set(REQUIRED_SCHEMA) - tables)
    if missing_tables:
        raise RuntimeError(f"Missing required tables: {', '.join(missing_tables)}")

    problems = []
    for table, required_columns in REQUIRED_SCHEMA.items():
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}
        missing = sorted(required_columns - columns)
        if missing:
            problems.append(f"{table}: missing {', '.join(missing)}")
    if problems:
        raise RuntimeError("Schema does not match expected analysis sources: " + "; ".join(problems))


def match_rows_for_window(conn: sqlite3.Connection, start: str, end: str) -> list[dict[str, Any]]:
    return [
        dict(row)
        for row in conn.execute(
            """
            SELECT match_id, created_at, datetime(created_at, 'unixepoch', 'localtime') AS local_time, map_name
            FROM matches
            WHERE status = 'completed'
              AND created_at >= unixepoch(:start, 'utc')
              AND created_at < unixepoch(:end, 'utc')
            ORDER BY created_at
            """,
            {"start": start, "end": end},
        )
    ]


def recent_matches_before(conn: sqlite3.Connection, before: str, limit: int) -> list[dict[str, Any]]:
    rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT match_id, created_at, datetime(created_at, 'unixepoch', 'localtime') AS local_time, map_name
            FROM matches
            WHERE status = 'completed'
              AND created_at < unixepoch(:before, 'utc')
            ORDER BY created_at DESC
            LIMIT :limit
            """,
            {"before": before, "limit": limit},
        )
    ]
    rows.reverse()
    return rows


def cohort_sql(match_ids: dict[str, list[str]], select_sql: str) -> tuple[str, dict[str, Any]]:
    params: dict[str, Any] = {}
    values = []
    index = 0
    for period in ("PRE", "POST"):
        for match_id in match_ids[period]:
            period_key = f"period_{index}"
            match_key = f"match_{index}"
            values.append(f"(:{period_key}, :{match_key})")
            params[period_key] = period
            params[match_key] = match_id
            index += 1
    if not values:
        raise RuntimeError("No selected matches found for analysis")
    return BASE_CTE_TEMPLATE.format(selected_values=",\n    ".join(values)) + select_sql, params


def fetch_rows(conn: sqlite3.Connection, match_ids: dict[str, list[str]], select_sql: str) -> list[dict[str, Any]]:
    sql, params = cohort_sql(match_ids, select_sql)
    return [dict(row) for row in conn.execute(sql, params).fetchall()]


def num(value: Any) -> float:
    return float(value or 0)


def pct_change(pre: Any, post: Any) -> float | None:
    pre_value = num(pre)
    post_value = num(post)
    if pre_value == 0:
        return None if post_value != 0 else 0.0
    return 100.0 * (post_value - pre_value) / pre_value


def pivot_period_rows(rows: list[dict[str, Any]], key_fields: list[str], metric_fields: list[str]) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row[field] for field in key_fields)
        out = grouped.setdefault(key, {field: row[field] for field in key_fields})
        period = row["period"].lower()
        for metric in metric_fields:
            out[f"{period}_{metric}"] = row.get(metric)

    for out in grouped.values():
        for metric in metric_fields:
            pre_key = f"pre_{metric}"
            post_key = f"post_{metric}"
            out.setdefault(pre_key, 0)
            out.setdefault(post_key, 0)
            out[f"{metric}_pct_change"] = pct_change(out[pre_key], out[post_key])
    return list(grouped.values())


def metric_comparison_rows(rows: list[dict[str, Any]], metric_fields: list[str]) -> list[dict[str, Any]]:
    by_period = {row["period"]: row for row in rows}
    pre = by_period.get("PRE", {})
    post = by_period.get("POST", {})
    return [
        {
            "metric": metric,
            "pre": pre.get(metric, 0),
            "post": post.get(metric, 0),
            "pct_change": pct_change(pre.get(metric, 0), post.get(metric, 0)),
        }
        for metric in metric_fields
    ]


def add_mode(rows: list[dict[str, Any]], mode_id: str, mode_label: str) -> list[dict[str, Any]]:
    return [{"comparison_mode": mode_id, "comparison_label": mode_label, **row} for row in rows]


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if fieldnames is None:
        seen = []
        for row in rows:
            for key in row:
                if key not in seen:
                    seen.append(key)
        fieldnames = seen
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_dashboard_data(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "window.SOLDIER_NG_DATA = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )


def fmt(value: Any, decimals: int = 1) -> str:
    if value is None:
        return "n/a"
    try:
        number = float(value)
    except (TypeError, ValueError):
        return str(value)
    if abs(number - round(number)) < 0.000001:
        return f"{int(round(number)):,}"
    return f"{number:,.{decimals}f}"


def fmt_pct(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):+.1f}%"


def print_section(title: str) -> None:
    print()
    print("=========================")
    print(title)
    print("=========================")


def print_metric_table(rows: list[dict[str, Any]]) -> None:
    print(f"{'Metric':42} {'PRE':>14} {'POST':>14} {'Change':>12}")
    print("-" * 86)
    for row in rows:
        print(
            f"{row['metric']:42} "
            f"{fmt(row['pre']):>14} "
            f"{fmt(row['post']):>14} "
            f"{fmt_pct(row['pct_change']):>12}"
        )


def print_rows(rows: list[dict[str, Any]], columns: list[tuple[str, str, int]], limit: int | None = None) -> None:
    shown = rows if limit is None else rows[:limit]
    header = " ".join(label.ljust(abs(width)) if width < 0 else label.rjust(width) for label, _, width in columns)
    print(header)
    print("-" * len(header))
    for row in shown:
        cells = []
        for _, key, width in columns:
            value = row.get(key)
            text = fmt_pct(value) if key.endswith("_pct_change") else fmt(value)
            if isinstance(value, str):
                text = value
            cells.append(text.ljust(abs(width)) if width < 0 else text.rjust(width))
        print(" ".join(cells))


def analyze_mode(
    conn: sqlite3.Connection,
    mode_id: str,
    label: str,
    pre_matches: list[dict[str, Any]],
    post_matches: list[dict[str, Any]],
) -> dict[str, Any]:
    match_ids = {
        "PRE": [row["match_id"] for row in pre_matches],
        "POST": [row["match_id"] for row in post_matches],
    }

    overall_raw = fetch_rows(conn, match_ids, OVERALL_SELECT)
    maps_raw = fetch_rows(conn, match_ids, MAP_SELECT)
    players_raw = fetch_rows(conn, match_ids, PLAYER_SELECT)
    objectives_raw = fetch_rows(conn, match_ids, OBJECTIVE_SELECT)

    overall_rows = metric_comparison_rows(overall_raw, OVERALL_METRICS)
    map_rows = pivot_period_rows(maps_raw, ["map_name"], MAP_METRICS)
    player_rows = pivot_period_rows(players_raw, ["player_id", "player_name"], PLAYER_METRICS)
    objective_rows = metric_comparison_rows(objectives_raw, OBJECTIVE_METRICS)

    map_rows.sort(key=lambda row: num(row["post_soldier_team_damage"]) - num(row["pre_soldier_team_damage"]))
    player_rows.sort(key=lambda row: num(row["pre_team_damage"]) + num(row["post_team_damage"]), reverse=True)

    return {
        "id": mode_id,
        "label": label,
        "meta": {
            "pre_match_count": len(pre_matches),
            "post_match_count": len(post_matches),
            "pre_first_match_time": pre_matches[0]["local_time"] if pre_matches else None,
            "pre_last_match_time": pre_matches[-1]["local_time"] if pre_matches else None,
            "post_first_match_time": post_matches[0]["local_time"] if post_matches else None,
            "post_last_match_time": post_matches[-1]["local_time"] if post_matches else None,
            "post_start": POST_START,
            "post_end_exclusive": POST_END,
        },
        "overall": overall_rows,
        "maps": map_rows,
        "players": player_rows,
        "objectives": objective_rows,
    }


def print_mode_report(mode: dict[str, Any], player_limit: int) -> None:
    meta = mode["meta"]
    print_section(mode["label"].upper())
    print(f"PRE matches:  {meta['pre_match_count']} ({meta['pre_first_match_time']} through {meta['pre_last_match_time']})")
    print(f"POST matches: {meta['post_match_count']} ({meta['post_first_match_time']} through {meta['post_last_match_time']})")

    print_section("OVERALL")
    print_metric_table(mode["overall"])

    print_section("BY MAP")
    print_rows(
        mode["maps"],
        [
            ("Map", "map_name", -24),
            ("PRE TD", "pre_soldier_team_damage", 10),
            ("POST TD", "post_soldier_team_damage", 10),
            ("TD Chg", "soldier_team_damage_pct_change", 10),
            ("PRE Dmg", "pre_soldier_damage", 10),
            ("POST Dmg", "post_soldier_damage", 10),
            ("Dmg/R Chg", "damage_per_soldier_round_pct_change", 10),
        ],
    )

    print_section("BY PLAYER")
    print_rows(
        mode["players"],
        [
            ("Player", "player_name", -24),
            ("PRE TD", "pre_team_damage", 10),
            ("POST TD", "post_team_damage", 10),
            ("TD Chg", "team_damage_pct_change", 10),
            ("PRE Rds", "pre_rounds", 9),
            ("POST Rds", "post_rounds", 9),
            ("FD % Chg", "team_damage_pct_soldier_damage_pct_change", 10),
        ],
        limit=None if player_limit == 0 else player_limit,
    )

    print_section("OBJECTIVES")
    print_metric_table(mode["objectives"])

    print_section("SUMMARY")
    overall = {row["metric"]: row for row in mode["overall"]}
    objectives = {row["metric"]: row for row in mode["objectives"]}
    td = overall["soldier_team_damage"]
    td_round = overall["team_damage_per_soldier_round"]
    dmg_round = overall["damage_per_soldier_round"]
    fd_pct = overall["team_damage_pct_soldier_damage"]
    caps = objectives["captures_allowed_per_match"]
    print(f"Friendly damage changed from {fmt(td['pre'])} to {fmt(td['post'])} ({fmt_pct(td['pct_change'])}).")
    print(f"Friendly damage per Soldier round changed from {fmt(td_round['pre'])} to {fmt(td_round['post'])} ({fmt_pct(td_round['pct_change'])}).")
    print(f"Damage per Soldier round changed from {fmt(dmg_round['pre'])} to {fmt(dmg_round['post'])} ({fmt_pct(dmg_round['pct_change'])}).")
    print(f"Friendly damage as % of Soldier damage changed from {fmt(fd_pct['pre'])}% to {fmt(fd_pct['post'])}% ({fmt_pct(fd_pct['pct_change'])}).")
    print(f"Allowed captures per match changed from {fmt(caps['pre'])} to {fmt(caps['post'])} ({fmt_pct(caps['pct_change'])}).")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Soldier metrics before/after nail grenades were disabled.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help="Path to elo.db")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT, help="Directory for CSV exports")
    parser.add_argument("--player-limit", type=int, default=0, help="Limit terminal player rows; 0 prints all")
    args = parser.parse_args()

    with connect_readonly(args.db) as conn:
        validate_schema(conn)
        post_matches = match_rows_for_window(conn, POST_START, POST_END)
        equal_time_pre = match_rows_for_window(conn, EQUAL_TIME_PRE_START, EQUAL_TIME_PRE_END)
        equal_match_pre = recent_matches_before(conn, POST_START, len(post_matches))

        modes = [
            analyze_mode(conn, "equal_time", "Equal Time", equal_time_pre, post_matches),
            analyze_mode(conn, "equal_match_count", "Equal Match Count", equal_match_pre, post_matches),
        ]

    all_overall = []
    all_maps = []
    all_players = []
    all_objectives = []
    dashboard_modes = {}
    for mode in modes:
        all_overall.extend(add_mode(mode["overall"], mode["id"], mode["label"]))
        all_maps.extend(add_mode(mode["maps"], mode["id"], mode["label"]))
        all_players.extend(add_mode(mode["players"], mode["id"], mode["label"]))
        all_objectives.extend(add_mode(mode["objectives"], mode["id"], mode["label"]))
        dashboard_modes[mode["id"]] = {
            "label": mode["label"],
            "meta": mode["meta"],
            "overall": mode["overall"],
            "maps": mode["maps"],
            "players": mode["players"],
            "objectives": mode["objectives"],
        }

    write_csv(args.output_dir / "overall.csv", all_overall)
    write_csv(args.output_dir / "maps.csv", all_maps)
    write_csv(args.output_dir / "players.csv", all_players)
    write_csv(args.output_dir / "objectives.csv", all_objectives)
    write_dashboard_data(
        DEFAULT_DASHBOARD_DATA,
        {
            "defaultMode": "equal_time",
            "postWindow": {"start": POST_START, "endExclusive": POST_END},
            "modes": dashboard_modes,
        },
    )

    print("Soldier nail grenade comparison")
    print(f"POST: {POST_START} through {POST_END} (exclusive)")
    print(f"Equal Time PRE: {EQUAL_TIME_PRE_START} through {EQUAL_TIME_PRE_END} (exclusive)")
    print("Equal Match Count PRE: same number of most recent completed matches before POST.")
    print("Database opened read-only; Soldier rounds are selected from match_player_classes.")

    for mode in modes:
        print_mode_report(mode, args.player_limit)

    print()
    print(f"CSV exports written to: {args.output_dir}")
    print(f"Dashboard data written to: {DEFAULT_DASHBOARD_DATA}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
