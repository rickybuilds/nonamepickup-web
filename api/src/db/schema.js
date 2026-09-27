"use strict";

function initializeSchema(db) {
  db.exec(`
  CREATE TABLE IF NOT EXISTS web_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER,
    ip TEXT,
    method TEXT,
    path TEXT,
    user_agent TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_web_analytics_ts ON web_analytics(ts);
  CREATE INDEX IF NOT EXISTS idx_web_analytics_path ON web_analytics(path);

  CREATE TABLE IF NOT EXISTS steam_profiles (
    steam_id TEXT PRIMARY KEY,
    steam_id64 TEXT,
    personaname TEXT,
    profileurl TEXT,
    avatar TEXT,
    avatarmedium TEXT,
    avatarfull TEXT,
    fetched_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_steam_profiles_steam_id64
    ON steam_profiles(steam_id64);

  CREATE TABLE IF NOT EXISTS pickup_flag_carry_rounds (
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    map TEXT NOT NULL,
    started_at_epoch INTEGER NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS pickup_flag_carry_players (
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    steam_id TEXT NOT NULL,
    carry_ms INTEGER NOT NULL DEFAULT 0,
    carry_count INTEGER NOT NULL DEFAULT 0,
    distance_units REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, round_number, session_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pickup_flag_carry_players_steam
    ON pickup_flag_carry_players(steam_id, match_id, round_number);

  CREATE TABLE IF NOT EXISTS pickup_flag_carries (
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    objective_id INTEGER NOT NULL,
    carry_number INTEGER NOT NULL,
    start_ms INTEGER NOT NULL,
    end_ms INTEGER NOT NULL,
    distance_units REAL NOT NULL,
    PRIMARY KEY (match_id, round_number, objective_id, carry_number)
  );

  CREATE INDEX IF NOT EXISTS idx_pickup_flag_carries_session
    ON pickup_flag_carries(match_id, round_number, session_id);
`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS match_kill_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id TEXT NOT NULL,
    source_url TEXT,
    round_num INTEGER NOT NULL,
    event_time_seconds INTEGER,
    event_time_text TEXT,
    attacker_key TEXT NOT NULL,
    attacker_steam_id TEXT,
    attacker_discord_id TEXT,
    attacker_name TEXT,
    attacker_team TEXT,
    attacker_role TEXT,
    attacker_class TEXT,
    attacker_class_confidence TEXT,
    weapon TEXT NOT NULL,
    victim_name TEXT,
    victim_key TEXT,
    victim_steam_id TEXT,
    victim_discord_id TEXT,
    victim_team TEXT,
    is_enemy_kill INTEGER DEFAULT 1,
    is_team_kill INTEGER DEFAULT 0,
    is_conced INTEGER DEFAULT 0,
    is_flag_carrier_kill INTEGER DEFAULT 0,
    source_confidence TEXT NOT NULL DEFAULT 'exact'
  );

  CREATE INDEX IF NOT EXISTS idx_mke_player_victim_full
    ON match_kill_events(attacker_discord_id, victim_discord_id, victim_steam_id, victim_key);
  CREATE INDEX IF NOT EXISTS idx_mke_player_event_order
    ON match_kill_events(attacker_discord_id, match_id, round_num, event_time_seconds, id);
  CREATE INDEX IF NOT EXISTS idx_mke_steam_event_fast
    ON match_kill_events(attacker_steam_id, match_id, round_num, event_time_seconds, id);
`);

  db.exec(`
  CREATE INDEX IF NOT EXISTS idx_matches_status     ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at);
  CREATE INDEX IF NOT EXISTS idx_matches_map        ON matches(map_name);
  CREATE INDEX IF NOT EXISTS idx_matches_status_created
    ON matches(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_matches_map_status_created
    ON matches(map_name, status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_rc_player          ON rating_changes(player_id);
  CREATE INDEX IF NOT EXISTS idx_rc_match           ON rating_changes(match_id);
  CREATE INDEX IF NOT EXISTS idx_rc_player_match
    ON rating_changes(player_id, match_id);

  CREATE INDEX IF NOT EXISTS idx_analytics_mps_match_player
    ON match_player_stats(match_id, player_key);
  CREATE INDEX IF NOT EXISTS idx_analytics_mprs_match_round_player
    ON match_player_round_stats(match_id, round_num, player_key);
  CREATE INDEX IF NOT EXISTS idx_analytics_mpw_weapon_match_player
    ON match_player_weapons(weapon, match_id, player_key);
  CREATE INDEX IF NOT EXISTS idx_analytics_mrm_player_match
    ON match_round_mvps(mvp_player_key, match_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_mrm_steam_match
    ON match_round_mvps(steam_id, match_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_rounds_match_round
    ON match_rounds(match_id, round_num);

`);

  db.exec(`
  CREATE TABLE IF NOT EXISTS coolest_dude_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_coolest_dude_tags_created_at
    ON coolest_dude_tags(created_at DESC, id DESC);

  DELETE FROM coolest_dude_tags
  WHERE id NOT IN (
    SELECT id
    FROM coolest_dude_tags
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  );
  `);
}

function cleanupAnalytics(db, analyticsRetentionDays) {
  db.prepare("DELETE FROM web_analytics WHERE ts < ?").run(
    Math.floor(Date.now() / 1000) - (analyticsRetentionDays * 86400)
  );
}

module.exports = { initializeSchema, cleanupAnalytics };
