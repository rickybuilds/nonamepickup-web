#!/usr/bin/env python3
"""Compare Soldier effectiveness before/after nail grenades were disabled."""

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
DEFAULT_DASHBOARD_DATA = ROOT / "analysis" / "dashboard" / "soldier_effectiveness_data.js"

POST_START = "2026-06-11 21:00:00"
POST_END = "2026-06-30 00:00:00"
EQUAL_TIME_PRE_START = "2026-05-24 18:00:00"
EQUAL_TIME_PRE_END = "2026-06-11 21:00:00"

BASE_REQUIRED = {
    "matches": {"match_id", "created_at", "map_name", "status"},
    "match_player_classes": {"match_id", "player_key", "class_name", "round_num", "seconds"},
    "match_player_round_stats": {
        "match_id",
        "player_key",
        "steam_id",
        "display_name",
        "round_num",
        "kills",
        "enemy_damage",
        "team_damage",
    },
}

OPTIONAL_COLUMNS = {
    "assists": ["assists"],
    "score": ["score"],
    "damage_taken": ["damage_taken_enemy", "damage_taken_team"],
    "captures": ["flag_captures"],
    "flag_touches": ["flag_touches"],
}

METRIC_FIELDS = [
    "soldier_rounds",
    "damage_per_round",
    "kills_per_round",
    "deaths_per_round",
    "kd",
    "damage_taken_per_round",
    "captures_per_round",
    "flag_touches_per_round",
    "team_damage_per_round",
    "friendly_damage_pct",
]

PLAYER_FIELDS = [
    "soldier_rounds",
    "team_damage_per_round",
    "damage_per_round",
    "kd",
    "kills_per_round",
    "deaths_per_round",
    "friendly_damage_pct",
]

MAP_FIELDS = [
    "soldier_rounds",
    "damage_per_round",
    "team_damage_per_round",
    "kills_per_round",
    "deaths_per_round",
    "kd",
    "friendly_damage_pct",
]


def connect_readonly(db_path: Path) -> sqlite3.Connection:
    uri = f"file:{db_path.resolve().as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = ON")
    return conn


def table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def validate_schema(conn: sqlite3.Connection) -> tuple[set[str], list[str]]:
    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")
    }
    missing_tables = sorted(set(BASE_REQUIRED) - tables)
    if missing_tables:
        raise RuntimeError(f"Missing required tables: {', '.join(missing_tables)}")

    missing = []
    for table, required in BASE_REQUIRED.items():
        columns = table_columns(conn, table)
        absent = sorted(required - columns)
        if absent:
            missing.append(f"{table}: {', '.join(absent)}")
    if missing:
        raise RuntimeError("Schema does not match expected Soldier sources: " + "; ".join(missing))

    round_columns = table_columns(conn, "match_player_round_stats")
    notes = []
    for metric, columns in OPTIONAL_COLUMNS.items():
        absent = [column for column in columns if column not in round_columns]
        if absent:
            notes.append(f"{metric} unavailable: missing {', '.join(absent)}")
    if "deaths_by_enemy" not in round_columns and "deaths" not in round_columns:
        notes.append("deaths unavailable: missing deaths/deaths_by_enemy columns")
    return round_columns, notes


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


def selected_values(match_ids: dict[str, list[str]]) -> tuple[str, dict[str, Any]]:
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
    return ",\n    ".join(values), params


def build_base_cte(match_ids: dict[str, list[str]], columns: set[str]) -> tuple[str, dict[str, Any]]:
    values, params = selected_values(match_ids)
    deaths_expr = "COALESCE(s.deaths_by_enemy, 0) + COALESCE(s.deaths_by_team, 0) + COALESCE(s.suicides, 0)"
    if "deaths_by_enemy" not in columns:
        deaths_expr = "COALESCE(s.deaths, 0)" if "deaths" in columns else "0"
    damage_taken_expr = "COALESCE(s.damage_taken_enemy, 0) + COALESCE(s.damage_taken_team, 0)"
    if "damage_taken_enemy" not in columns or "damage_taken_team" not in columns:
        damage_taken_expr = "NULL"
    captures_expr = "COALESCE(s.flag_captures, 0)" if "flag_captures" in columns else "NULL"
    touches_expr = "COALESCE(s.flag_touches, 0)" if "flag_touches" in columns else "NULL"
    assists_expr = "COALESCE(s.assists, 0)" if "assists" in columns else "NULL"
    score_expr = "COALESCE(s.score, 0)" if "score" in columns else "NULL"

    return f"""
WITH
selected_matches(period, match_id) AS (
  VALUES
    {values}
),
period_matches AS (
  SELECT
    sm.period,
    m.match_id,
    COALESCE(NULLIF(m.map_name, ''), '(unknown)') AS map_name
  FROM selected_matches sm
  JOIN matches m ON m.match_id = sm.match_id
  WHERE m.status = 'completed'
),
soldier_class_rounds AS (
  SELECT DISTINCT match_id, player_key, round_num
  FROM match_player_classes
  WHERE LOWER(TRIM(class_name)) = 'soldier'
    AND COALESCE(seconds, 0) > 0
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
    COALESCE(s.kills, 0) AS kills,
    {deaths_expr} AS deaths,
    COALESCE(s.enemy_damage, 0) AS damage,
    COALESCE(s.team_damage, 0) AS team_damage,
    {damage_taken_expr} AS damage_taken,
    {captures_expr} AS captures,
    {touches_expr} AS flag_touches,
    {assists_expr} AS assists,
    {score_expr} AS score
  FROM period_matches pm
  JOIN match_player_round_stats s ON s.match_id = pm.match_id
  JOIN soldier_class_rounds sc
    ON sc.match_id = s.match_id
   AND sc.player_key = s.player_key
   AND sc.round_num = s.round_num
)
""", params


def aggregate_select(group_fields: list[str], include_names: bool = False) -> str:
    group_cols = ", ".join(group_fields)
    select_group = ",\n  ".join(group_fields)
    if include_names:
        select_group += ",\n  MAX(player_name) AS player_name"
    return f"""
SELECT
  {select_group},
  COUNT(*) AS soldier_rounds,
  SUM(kills) AS kills,
  SUM(deaths) AS deaths,
  SUM(damage) AS damage,
  SUM(team_damage) AS team_damage,
  SUM(damage_taken) AS damage_taken,
  SUM(captures) AS captures,
  SUM(flag_touches) AS flag_touches,
  SUM(assists) AS assists,
  SUM(score) AS score,
  1.0 * SUM(damage) / NULLIF(COUNT(*), 0) AS damage_per_round,
  1.0 * SUM(kills) / NULLIF(COUNT(*), 0) AS kills_per_round,
  1.0 * SUM(deaths) / NULLIF(COUNT(*), 0) AS deaths_per_round,
  1.0 * SUM(kills) / NULLIF(SUM(deaths), 0) AS kd,
  1.0 * SUM(assists) / NULLIF(COUNT(*), 0) AS assists_per_round,
  1.0 * SUM(damage_taken) / NULLIF(COUNT(*), 0) AS damage_taken_per_round,
  1.0 * SUM(score) / NULLIF(COUNT(*), 0) AS score_per_round,
  1.0 * SUM(captures) / NULLIF(COUNT(*), 0) AS captures_per_round,
  1.0 * SUM(flag_touches) / NULLIF(COUNT(*), 0) AS flag_touches_per_round,
  1.0 * SUM(team_damage) / NULLIF(COUNT(*), 0) AS team_damage_per_round,
  100.0 * SUM(team_damage) / NULLIF(SUM(damage) + SUM(team_damage), 0) AS friendly_damage_pct
FROM soldier_rounds
GROUP BY {group_cols}
"""


def fetch_aggregate(
    conn: sqlite3.Connection,
    match_ids: dict[str, list[str]],
    columns: set[str],
    group_fields: list[str],
    include_names: bool = False,
) -> list[dict[str, Any]]:
    base, params = build_base_cte(match_ids, columns)
    return [dict(row) for row in conn.execute(base + aggregate_select(group_fields, include_names), params)]


def num(value: Any) -> float:
    return float(value or 0)


def pct_change(pre: Any, post: Any) -> float | None:
    pre_value = num(pre)
    post_value = num(post)
    if pre_value == 0:
        return None if post_value != 0 else 0.0
    return 100.0 * (post_value - pre_value) / pre_value


def metric_rows(rows: list[dict[str, Any]], metrics: list[str]) -> list[dict[str, Any]]:
    by_period = {row["period"]: row for row in rows}
    pre = by_period.get("PRE", {})
    post = by_period.get("POST", {})
    return [
        {"metric": metric, "pre": pre.get(metric, 0), "post": post.get(metric, 0), "pct_change": pct_change(pre.get(metric, 0), post.get(metric, 0))}
        for metric in metrics
    ]


def pivot_rows(rows: list[dict[str, Any]], key_fields: list[str], metrics: list[str]) -> list[dict[str, Any]]:
    grouped: dict[tuple[Any, ...], dict[str, Any]] = {}
    for row in rows:
        key = tuple(row[field] for field in key_fields)
        out = grouped.setdefault(key, {field: row[field] for field in key_fields})
        period = row["period"].lower()
        for metric in metrics:
            out[f"{period}_{metric}"] = row.get(metric)
    result = []
    for out in grouped.values():
        for metric in metrics:
            out.setdefault(f"pre_{metric}", 0)
            out.setdefault(f"post_{metric}", 0)
            out[f"{metric}_pct_change"] = pct_change(out[f"pre_{metric}"], out[f"post_{metric}"])
        result.append(out)
    return result


def paired_players(player_rows: list[dict[str, Any]], min_rounds: int) -> list[dict[str, Any]]:
    rows = []
    for row in player_rows:
        if num(row.get("pre_soldier_rounds")) >= min_rounds and num(row.get("post_soldier_rounds")) >= min_rounds:
            out = {"min_rounds": min_rounds, **row}
            rows.append(out)
    rows.sort(key=lambda row: num(row["post_team_damage_per_round"]) - num(row["pre_team_damage_per_round"]))
    return rows


def add_mode(rows: list[dict[str, Any]], mode_id: str, mode_label: str) -> list[dict[str, Any]]:
    return [{"comparison_mode": mode_id, "comparison_label": mode_label, **row} for row in rows]


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def write_dashboard_data(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("window.SOLDIER_EFFECTIVENESS_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n", encoding="utf-8")


def fmt(value: Any, decimals: int = 2) -> str:
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


def analyze_mode(
    conn: sqlite3.Connection,
    mode_id: str,
    label: str,
    pre_matches: list[dict[str, Any]],
    post_matches: list[dict[str, Any]],
    columns: set[str],
) -> dict[str, Any]:
    match_ids = {"PRE": [row["match_id"] for row in pre_matches], "POST": [row["match_id"] for row in post_matches]}
    overall_raw = fetch_aggregate(conn, match_ids, columns, ["period"])
    players_raw = fetch_aggregate(conn, match_ids, columns, ["period", "player_id"], include_names=True)
    maps_raw = fetch_aggregate(conn, match_ids, columns, ["period", "map_name"])

    overall = metric_rows(overall_raw, METRIC_FIELDS)
    players = pivot_rows(players_raw, ["player_id", "player_name"], PLAYER_FIELDS)
    maps_all = pivot_rows(maps_raw, ["map_name"], MAP_FIELDS)
    maps = [row for row in maps_all if num(row.get("pre_soldier_rounds")) > 0 and num(row.get("post_soldier_rounds")) > 0]
    paired_5 = paired_players(players, 5)
    paired_10 = paired_players(players, 10)

    players.sort(key=lambda row: num(row["pre_team_damage_per_round"]) + num(row["post_team_damage_per_round"]), reverse=True)
    maps.sort(key=lambda row: num(row["post_team_damage_per_round"]) - num(row["pre_team_damage_per_round"]))

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
        "overall": overall,
        "players": players,
        "maps": maps,
        "paired_players": paired_5 + paired_10,
        "paired_players_min5": paired_5,
        "paired_players_min10": paired_10,
    }


def print_mode(mode: dict[str, Any], notes: list[str]) -> None:
    print()
    print("=========================")
    print(mode["label"].upper())
    print("=========================")
    print(f"PRE matches:  {mode['meta']['pre_match_count']} ({mode['meta']['pre_first_match_time']} through {mode['meta']['pre_last_match_time']})")
    print(f"POST matches: {mode['meta']['post_match_count']} ({mode['meta']['post_first_match_time']} through {mode['meta']['post_last_match_time']})")
    print()
    print(f"{'Metric':36} {'PRE':>12} {'POST':>12} {'Change':>10}")
    print("-" * 74)
    for row in mode["overall"]:
        print(f"{row['metric']:36} {fmt(row['pre']):>12} {fmt(row['post']):>12} {fmt_pct(row['pct_change']):>10}")
    print()
    print("Paired players, min 5 Soldier rounds each:")
    print(f"{'Player':24} {'PRE FD/R':>10} {'POST FD/R':>10} {'FD Chg':>10} {'PRE D/R':>10} {'POST D/R':>10} {'K/D Chg':>10}")
    print("-" * 94)
    for row in mode["paired_players_min5"][:12]:
        print(
            f"{row['player_name'][:24]:24} "
            f"{fmt(row['pre_team_damage_per_round']):>10} "
            f"{fmt(row['post_team_damage_per_round']):>10} "
            f"{fmt_pct(row['team_damage_per_round_pct_change']):>10} "
            f"{fmt(row['pre_damage_per_round']):>10} "
            f"{fmt(row['post_damage_per_round']):>10} "
            f"{fmt_pct(row['kd_pct_change']):>10}"
        )
    if notes:
        print()
        print("Schema notes:")
        for note in notes:
            print(f"- {note}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare Soldier effectiveness before/after nail grenades were disabled.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    with connect_readonly(args.db) as conn:
        columns, notes = validate_schema(conn)
        post_matches = match_rows_for_window(conn, POST_START, POST_END)
        equal_time_pre = match_rows_for_window(conn, EQUAL_TIME_PRE_START, EQUAL_TIME_PRE_END)
        equal_match_pre = recent_matches_before(conn, POST_START, len(post_matches))
        modes = [
            analyze_mode(conn, "equal_time", "Equal Time", equal_time_pre, post_matches, columns),
            analyze_mode(conn, "equal_match_count", "Equal Match Count", equal_match_pre, post_matches, columns),
        ]

    all_overall: list[dict[str, Any]] = []
    all_players: list[dict[str, Any]] = []
    all_maps: list[dict[str, Any]] = []
    all_paired: list[dict[str, Any]] = []
    dashboard_modes = {}
    for mode in modes:
        all_overall.extend(add_mode(mode["overall"], mode["id"], mode["label"]))
        all_players.extend(add_mode(mode["players"], mode["id"], mode["label"]))
        all_maps.extend(add_mode(mode["maps"], mode["id"], mode["label"]))
        all_paired.extend(add_mode(mode["paired_players"], mode["id"], mode["label"]))
        dashboard_modes[mode["id"]] = {
            "label": mode["label"],
            "meta": mode["meta"],
            "overall": mode["overall"],
            "players": mode["players"],
            "maps": mode["maps"],
            "paired_players": mode["paired_players"],
            "paired_players_min5": mode["paired_players_min5"],
            "paired_players_min10": mode["paired_players_min10"],
        }

    write_csv(args.output_dir / "soldier_effectiveness_overall.csv", all_overall)
    write_csv(args.output_dir / "soldier_effectiveness_players.csv", all_players)
    write_csv(args.output_dir / "soldier_effectiveness_maps.csv", all_maps)
    write_csv(args.output_dir / "soldier_effectiveness_paired_players.csv", all_paired)
    write_dashboard_data(
        DEFAULT_DASHBOARD_DATA,
        {
            "defaultMode": "equal_time",
            "postWindow": {"start": POST_START, "endExclusive": POST_END},
            "schemaNotes": notes,
            "modes": dashboard_modes,
        },
    )

    print("Soldier effectiveness comparison")
    print(f"POST: {POST_START} through {POST_END} (exclusive)")
    print("Database opened read-only.")
    for mode in modes:
        print_mode(mode, notes)
    print()
    print(f"CSV exports written to: {args.output_dir}")
    print(f"Dashboard data written to: {DEFAULT_DASHBOARD_DATA}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
