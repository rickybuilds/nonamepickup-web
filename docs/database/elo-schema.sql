CREATE TABLE ratings (
  player_id    TEXT PRIMARY KEY,
  display_name TEXT,
  rating       INTEGER NOT NULL
);
CREATE TABLE rating_changes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id   TEXT NOT NULL,
  player_id  TEXT NOT NULL,
  before     INTEGER,
  after      INTEGER,
  delta      INTEGER,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  ts         INTEGER,
  UNIQUE(match_id, player_id)
);
CREATE TABLE sqlite_sequence(name,seq);
CREATE TABLE matches (
  match_id       TEXT PRIMARY KEY,
  created_at     INTEGER NOT NULL,
  map_name       TEXT,
  server_name    TEXT,
  blue_ids       TEXT,
  red_ids        TEXT,
  winner         TEXT,
  status         TEXT DEFAULT 'pending',
  mode           TEXT,
  avg_blue       INTEGER,
  avg_red        INTEGER,
  hampalyzer_url TEXT,
  processed_at   INTEGER
, rng_multiplier REAL DEFAULT 1.0, bonus_elo TEXT, score_blue INTEGER, score_red  INTEGER, tfcstats_url TEXT, shuffle_history TEXT DEFAULT '[]', match_type TEXT NOT NULL DEFAULT 'pickup', player_format TEXT NOT NULL DEFAULT '4v4', expected_players INTEGER NOT NULL DEFAULT 8, scoring_mode TEXT NOT NULL DEFAULT 'rounds', team_scenarios TEXT, offense_ids TEXT);
CREATE TABLE user_prefs (
        player_id TEXT PRIMARY KEY,
        hide_elo  INTEGER NOT NULL DEFAULT 0
      );
CREATE TABLE discord_names (
  discord_id TEXT PRIMARY KEY,
  username TEXT,
  global_name TEXT,
  display_name TEXT
);
CREATE TABLE match_players (
  match_id    TEXT NOT NULL,
  player_id   TEXT NOT NULL,
  team        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  map_name    TEXT,
  status      TEXT,
  winner      TEXT,
  PRIMARY KEY (match_id, player_id)
);
CREATE TABLE web_analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER,
    ip TEXT,
    method TEXT,
    path TEXT,
    user_agent TEXT
  );
CREATE TABLE match_stat_imports (
  match_id TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'hampalyzer',
  source_url TEXT,
  imported_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  status TEXT NOT NULL DEFAULT 'ok',
  notes TEXT
);
CREATE TABLE match_player_stats (
  match_id TEXT NOT NULL,
  player_key TEXT NOT NULL,
  steam_id TEXT,
  display_name TEXT,
  team TEXT,
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,
  enemy_damage INTEGER NOT NULL DEFAULT 0,
  team_damage INTEGER NOT NULL DEFAULT 0,
  damage_taken INTEGER NOT NULL DEFAULT 0,
  flag_captures INTEGER NOT NULL DEFAULT 0,
  main_class TEXT,
  source TEXT NOT NULL DEFAULT 'hampalyzer',
  imported_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), team_kills INTEGER NOT NULL DEFAULT 0, deaths_by_enemy INTEGER NOT NULL DEFAULT 0, deaths_by_team INTEGER NOT NULL DEFAULT 0, self_damage INTEGER NOT NULL DEFAULT 0, conc_jumps INTEGER NOT NULL DEFAULT 0, flag_touches INTEGER NOT NULL DEFAULT 0, initial_touches INTEGER NOT NULL DEFAULT 0, flag_time_seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, player_key)
);
CREATE TABLE match_player_weapons (
  match_id TEXT NOT NULL,
  player_key TEXT NOT NULL,
  weapon TEXT NOT NULL,
  kills INTEGER NOT NULL DEFAULT 0, weapon_name TEXT, source TEXT NOT NULL DEFAULT 'tfcstats',
  PRIMARY KEY (match_id, player_key, weapon)
);
CREATE TABLE match_player_classes (
  match_id TEXT NOT NULL,
  player_key TEXT NOT NULL,
  class_name TEXT NOT NULL,
  round_num INTEGER, seconds INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL DEFAULT 'tfcstats',
  PRIMARY KEY (match_id, player_key, class_name, round_num)
);
CREATE TABLE IF NOT EXISTS "player_steam_ids" (
  discord_id TEXT NOT NULL,
  steam_id TEXT NOT NULL,
  display_name TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), updated_at INTEGER,
  PRIMARY KEY (discord_id, steam_id)
);
CREATE TABLE match_rounds (
      match_id TEXT NOT NULL,
      round_num INTEGER NOT NULL,
      map_name TEXT,
      duration_seconds INTEGER,
      team1_score INTEGER,
      team2_score INTEGER,
      offense_team TEXT,
      defense_team TEXT, source TEXT NOT NULL DEFAULT 'tfcstats',
      PRIMARY KEY (match_id, round_num)
    );
CREATE TABLE match_player_round_stats (
      match_id TEXT NOT NULL,
      player_key TEXT NOT NULL,
      steam_id TEXT,
      display_name TEXT,
      round_num INTEGER NOT NULL,
      team_name TEXT,
      role TEXT,
      kills INTEGER DEFAULT 0,
      team_kills INTEGER DEFAULT 0,
      conced_kills INTEGER DEFAULT 0,
      sentry_kills INTEGER DEFAULT 0,
      deaths_by_enemy INTEGER DEFAULT 0,
      deaths_by_team INTEGER DEFAULT 0,
      suicides INTEGER DEFAULT 0,
      enemy_damage INTEGER DEFAULT 0,
      team_damage INTEGER DEFAULT 0,
      damage_taken_enemy INTEGER DEFAULT 0,
      damage_taken_team INTEGER DEFAULT 0,
      self_damage INTEGER DEFAULT 0,
      conc_jumps INTEGER DEFAULT 0,
      flag_captures INTEGER DEFAULT 0,
      flag_touches INTEGER DEFAULT 0,
      initial_touches INTEGER DEFAULT 0,
      flag_time_seconds INTEGER DEFAULT 0,
      objectives INTEGER DEFAULT 0,
      toss_percent REAL, source TEXT NOT NULL DEFAULT 'tfcstats',
      PRIMARY KEY (match_id, player_key, round_num)
    );
CREATE TABLE match_round_mvps (
      match_id TEXT NOT NULL,
      round_num INTEGER NOT NULL,
      mvp_display_name TEXT,
      mvp_player_key TEXT,
      steam_id TEXT,
      PRIMARY KEY (match_id, round_num)
    );
CREATE TABLE steam_profiles (
  steam_id TEXT PRIMARY KEY,
  steam_id64 TEXT,
  personaname TEXT,
  profileurl TEXT,
  avatar TEXT,
  avatarmedium TEXT,
  avatarfull TEXT,
  fetched_at INTEGER
);
CREATE TABLE match_kill_events (
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
, weapon_name TEXT, victim_class TEXT);
CREATE TABLE match_cap_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id TEXT NOT NULL,
  source_url TEXT,
  team TEXT NOT NULL,
  cap_num INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  time_text TEXT NOT NULL,
  score_after INTEGER,
  imported_at INTEGER NOT NULL DEFAULT (strftime('%s','now')), capper_name TEXT, capper_steam_id TEXT, source TEXT NOT NULL DEFAULT 'tfcstats',
  UNIQUE(match_id, team, cap_num)
);
CREATE INDEX idx_ratings_rating ON ratings(rating DESC);
CREATE INDEX idx_changes_player_ts ON rating_changes(player_id, ts);
CREATE INDEX idx_matches_status     ON matches(status);
CREATE INDEX idx_matches_created_at ON matches(created_at);
CREATE INDEX idx_matches_map        ON matches(map_name);
CREATE INDEX idx_rc_player          ON rating_changes(player_id);
CREATE INDEX idx_rc_match           ON rating_changes(match_id);
CREATE INDEX idx_matches_status_created
ON matches(status, created_at DESC);
CREATE INDEX idx_mp_player_created
ON match_players(player_id, created_at DESC);
CREATE INDEX idx_mp_match
ON match_players(match_id);
CREATE INDEX idx_mp_map_status
ON match_players(map_name, status);
CREATE INDEX idx_mp_status_created
ON match_players(status, created_at DESC);
CREATE INDEX idx_web_analytics_ts ON web_analytics(ts);
CREATE INDEX idx_web_analytics_path ON web_analytics(path);
CREATE INDEX idx_matches_map_status_created
    ON matches(map_name, status, created_at DESC);
CREATE INDEX idx_rc_player_match
    ON rating_changes(player_id, match_id);
CREATE INDEX idx_mps_player ON match_player_stats(player_key);
CREATE INDEX idx_mps_match ON match_player_stats(match_id);
CREATE INDEX idx_mps_steam ON match_player_stats(steam_id);
CREATE INDEX idx_mpw_weapon ON match_player_weapons(weapon);
CREATE INDEX idx_mpc_class ON match_player_classes(class_name);
CREATE INDEX idx_steam_profiles_steam_id64
  ON steam_profiles(steam_id64);
CREATE INDEX idx_mke_attacker
ON match_kill_events(attacker_steam_id);
CREATE INDEX idx_mke_victim
ON match_kill_events(victim_steam_id);
CREATE INDEX idx_mke_match_round
ON match_kill_events(match_id, round_num);
CREATE INDEX idx_mke_weapon
ON match_kill_events(weapon);
CREATE INDEX idx_mke_class_weapon
ON match_kill_events(attacker_class, weapon);
CREATE INDEX idx_mke_attacker_discord ON match_kill_events(attacker_discord_id);
CREATE INDEX idx_mke_victim_discord ON match_kill_events(victim_discord_id);
CREATE INDEX idx_mke_player_class_weapon
ON match_kill_events(attacker_discord_id, attacker_class, weapon);
CREATE INDEX idx_mke_player_role_class_weapon
ON match_kill_events(attacker_discord_id, attacker_role, attacker_class, weapon);
CREATE INDEX idx_mke_player_flag_class_weapon
ON match_kill_events(attacker_discord_id, is_flag_carrier_kill, attacker_class, weapon);
CREATE INDEX idx_mke_player_conced_class_weapon
ON match_kill_events(attacker_discord_id, is_conced, attacker_class, weapon);
CREATE INDEX idx_mke_player_victim
ON match_kill_events(attacker_discord_id, victim_discord_id);
CREATE INDEX idx_mke_player_alias
ON match_kill_events(attacker_discord_id, attacker_name);
CREATE INDEX idx_mke_player_victim_full
ON match_kill_events(attacker_discord_id, victim_discord_id, victim_steam_id, victim_key);
CREATE INDEX idx_mke_player_event_order
ON match_kill_events(attacker_discord_id, match_id, round_num, event_time_seconds, id);
CREATE INDEX idx_mke_steam_event_fast
      ON match_kill_events(attacker_steam_id, match_id, round_num, event_time_seconds, id)
    ;
CREATE INDEX idx_match_cap_events_match
ON match_cap_events(match_id);
CREATE INDEX idx_match_cap_events_time
ON match_cap_events(match_id, time_seconds);
CREATE INDEX idx_match_cap_events_capper ON match_cap_events(capper_steam_id);
CREATE VIEW match_results AS
SELECT
  match_id, created_at, map_name, server_name,
  blue_ids, red_ids, COALESCE(winner, '') AS winner,
  processed_at, status, mode, avg_blue, avg_red
FROM matches
/* match_results(match_id,created_at,map_name,server_name,blue_ids,red_ids,winner,processed_at,status,mode,avg_blue,avg_red) */;
CREATE TABLE sqlite_stat1(tbl,idx,stat);
CREATE INDEX idx_mke_favorite_victims_fast
ON match_kill_events(
  attacker_discord_id,
  is_enemy_kill,
  victim_discord_id,
  victim_steam_id,
  victim_key
);
CREATE TABLE tfcstats_imports (
      match_id TEXT PRIMARY KEY,
      pickup_id INTEGER,
      url_title TEXT,
      source_url TEXT,
      imported_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      pickup_bytes INTEGER DEFAULT 0,
      events_bytes INTEGER DEFAULT 0,
      event_count INTEGER DEFAULT 0,
      damage_event_count INTEGER DEFAULT 0,
      imported_mode TEXT NOT NULL DEFAULT 'clean_no_raw_json'
    );
CREATE TABLE match_tfcstats_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      pickup_id INTEGER,
      round_id INTEGER,
      round_num INTEGER,
      game_time INTEGER,
      type TEXT,
      subtype TEXT,
      meta TEXT,
      weapon_id INTEGER,
      weapon_name TEXT,
      player_from_id INTEGER,
      player_from_steam_id TEXT,
      player_from_name TEXT,
      player_from_class_id INTEGER,
      player_from_class TEXT,
      player_from_team_id INTEGER,
      player_to_id INTEGER,
      player_to_steam_id TEXT,
      player_to_name TEXT,
      player_to_class_id INTEGER,
      player_to_class TEXT,
      player_to_team_id INTEGER,
      conceded INTEGER,
      value TEXT
    );
CREATE INDEX idx_tfcstats_events_match ON match_tfcstats_events(match_id, round_num, game_time);
CREATE INDEX idx_tfcstats_events_type ON match_tfcstats_events(type, subtype, meta);
CREATE INDEX idx_tfcstats_events_from ON match_tfcstats_events(player_from_steam_id);
CREATE INDEX idx_tfcstats_events_to ON match_tfcstats_events(player_to_steam_id);
CREATE TABLE match_capture_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'tfcstats',
      pickup_id INTEGER,
      round_id INTEGER,
      round_num INTEGER,
      cap_number INTEGER,
      game_time_seconds INTEGER,
      capper_player_id INTEGER,
      capper_steam_id TEXT,
      capper_name TEXT,
      capper_team_id INTEGER,
      capper_team TEXT,
      cap_type TEXT,
      meta TEXT,
      conceded INTEGER
    );
CREATE INDEX idx_capture_match_time ON match_capture_events(match_id, round_num, game_time_seconds);
CREATE INDEX idx_capture_capper ON match_capture_events(capper_steam_id);
CREATE TABLE match_flag_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      pickup_id INTEGER,
      round_id INTEGER,
      round_num INTEGER,
      game_time_seconds INTEGER,
      event_time_text TEXT,
      flag_event_type TEXT NOT NULL,
      subtype TEXT,
      meta TEXT,
      player_id INTEGER,
      player_key TEXT,
      steam_id TEXT,
      display_name TEXT,
      team_id INTEGER,
      team TEXT,
      class_id INTEGER,
      class_name TEXT,
      conceded INTEGER DEFAULT 0,
      value TEXT
    , source TEXT NOT NULL DEFAULT 'tfcstats', source_url TEXT, other_display_name TEXT, other_player_key TEXT, other_steam_id TEXT, touches INTEGER, source_confidence TEXT);
CREATE INDEX idx_flag_events_match_time ON match_flag_events(match_id, round_num, game_time_seconds);
CREATE INDEX idx_flag_events_player ON match_flag_events(steam_id);
CREATE INDEX idx_flag_events_type ON match_flag_events(flag_event_type, subtype, meta);
CREATE TABLE match_role_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      pickup_id INTEGER,
      round_id INTEGER,
      round_num INTEGER,
      game_time_seconds INTEGER,
      event_time_text TEXT,
      player_id INTEGER,
      player_key TEXT,
      steam_id TEXT,
      display_name TEXT,
      team_id INTEGER,
      team TEXT,
      class_id INTEGER,
      class_name TEXT,
      role_value TEXT,
      subtype TEXT,
      meta TEXT
    );
CREATE INDEX idx_role_events_match_time ON match_role_events(match_id, round_num, game_time_seconds);
CREATE INDEX idx_role_events_player ON match_role_events(steam_id);
CREATE TABLE match_engineer_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      match_id TEXT NOT NULL,
      pickup_id INTEGER,
      round_id INTEGER,
      round_num INTEGER,
      game_time_seconds INTEGER,
      event_time_text TEXT,
      engineer_event_type TEXT NOT NULL,
      subtype TEXT,
      meta TEXT,
      player_id INTEGER,
      player_key TEXT,
      steam_id TEXT,
      display_name TEXT,
      team_id INTEGER,
      team TEXT,
      class_id INTEGER,
      class_name TEXT,
      target_player_id INTEGER,
      target_steam_id TEXT,
      target_name TEXT,
      target_team_id INTEGER,
      target_team TEXT,
      target_class_id INTEGER,
      target_class_name TEXT,
      weapon_id INTEGER,
      weapon TEXT,
      value TEXT
    );
CREATE INDEX idx_engineer_events_match_time ON match_engineer_events(match_id, round_num, game_time_seconds);
CREATE INDEX idx_engineer_events_player ON match_engineer_events(steam_id);
CREATE INDEX idx_engineer_events_type ON match_engineer_events(engineer_event_type);
CREATE TABLE match_damage_summary (
      match_id TEXT NOT NULL,
      pickup_id INTEGER,
      round_num INTEGER,
      attacker_key TEXT,
      attacker_steam_id TEXT,
      attacker_name TEXT,
      attacker_team TEXT,
      attacker_class TEXT,
      victim_key TEXT,
      victim_steam_id TEXT,
      victim_name TEXT,
      victim_team TEXT,
      victim_class TEXT,
      weapon TEXT,
      weapon_name TEXT,
      weapon_id INTEGER,
      damage_type TEXT,
      damage_total INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      first_time_seconds INTEGER,
      last_time_seconds INTEGER,
      PRIMARY KEY (
        match_id, round_num, attacker_key, victim_key, weapon, damage_type, attacker_class, victim_class
      )
    );
CREATE INDEX idx_damage_summary_attacker ON match_damage_summary(attacker_steam_id);
CREATE INDEX idx_damage_summary_victim ON match_damage_summary(victim_steam_id);
CREATE INDEX idx_damage_summary_match ON match_damage_summary(match_id, round_num);
CREATE INDEX idx_damage_summary_weapon ON match_damage_summary(weapon);
CREATE INDEX idx_analytics_mprs_match_round_player
    ON match_player_round_stats(match_id, round_num, player_key);
CREATE INDEX idx_analytics_mpw_weapon_match_player
    ON match_player_weapons(weapon, match_id, player_key);
CREATE INDEX idx_analytics_mrm_player_match
    ON match_round_mvps(mvp_player_key, match_id);
CREATE INDEX idx_analytics_mrm_steam_match
    ON match_round_mvps(steam_id, match_id);
CREATE INDEX idx_flag_events_source_match
ON match_flag_events(source, match_id);
CREATE INDEX idx_flag_events_match_source_time
ON match_flag_events(match_id, source, round_num, game_time_seconds);
CREATE INDEX idx_flag_events_other_steam
ON match_flag_events(other_steam_id);
CREATE TABLE pickup_mutes (
  discord_id TEXT PRIMARY KEY,
  muted_by TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
, guild_id TEXT);
CREATE TABLE one_v_one_challenges (
          challenge_id TEXT PRIMARY KEY,
          challenger_discord_id TEXT NOT NULL,
          challenged_discord_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          accepted_at INTEGER,
          cancelled_at INTEGER,
          cancellation_reason TEXT
        );
CREATE TABLE one_v_one_matches (
          match_id TEXT PRIMARY KEY,
          challenger_discord_id TEXT NOT NULL,
          challenged_discord_id TEXT NOT NULL,
          player1_steam_id TEXT NOT NULL,
          player2_steam_id TEXT NOT NULL,
          server_key TEXT,
          server_ip TEXT,
          kill_goal INTEGER,
          rounds_required INTEGER NOT NULL DEFAULT 1,
          winner_steam_id TEXT,
          loser_steam_id TEXT,
          winner_score INTEGER,
          loser_score INTEGER,
          duration_seconds INTEGER,
          scoring_mode TEXT NOT NULL DEFAULT 'kill_goal',
          status TEXT NOT NULL DEFAULT 'pending',
          challenge_created_at INTEGER,
          accepted_at INTEGER,
          reserved_at INTEGER,
          started_at INTEGER,
          completed_at INTEGER,
          cancelled_at INTEGER,
          cancellation_reason TEXT,
          FOREIGN KEY (match_id) REFERENCES matches(match_id)
        );
CREATE INDEX idx_matches_match_type ON matches(match_type, created_at);
CREATE INDEX idx_1v1_player1 ON one_v_one_matches(player1_steam_id, completed_at);
CREATE INDEX idx_1v1_player2 ON one_v_one_matches(player2_steam_id, completed_at);
CREATE TABLE steam_alias_history (
    steam_id TEXT NOT NULL,
    alias TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (steam_id, alias)
);
CREATE INDEX idx_alias_history_steam
ON steam_alias_history(steam_id);
CREATE INDEX idx_alias_history_alias
ON steam_alias_history(alias);
CREATE TABLE steam_ip_history (
    steam_id TEXT NOT NULL,
    ip TEXT NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    times_seen INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (steam_id, ip)
);
CREATE INDEX idx_ip_history_steam
ON steam_ip_history(steam_id);
CREATE INDEX idx_ip_history_ip
ON steam_ip_history(ip);
CREATE TABLE player_identities (
    steam_id TEXT PRIMARY KEY,

    discord_id TEXT,

    current_name TEXT,
    current_ip TEXT,
    current_server TEXT,

    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,

    last_connect_at INTEGER,
    last_disconnect_at INTEGER,

    connection_count INTEGER NOT NULL DEFAULT 0,

    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
    updated_at INTEGER
);
CREATE INDEX idx_player_identities_discord
ON player_identities(discord_id);
CREATE INDEX idx_player_identities_ip
ON player_identities(current_ip);
CREATE INDEX idx_analytics_mps_match_player
    ON match_player_stats(match_id, player_key);
CREATE INDEX idx_analytics_rounds_match_round
    ON match_rounds(match_id, round_num);
CREATE INDEX idx_changes_match ON rating_changes(match_id);
CREATE TABLE pickup_replay_recordings (
        server_key TEXT NOT NULL,
        match_id TEXT NOT NULL,
        round_number INTEGER NOT NULL CHECK(round_number BETWEEN 1 AND 9999),
        desired_state TEXT NOT NULL,
        observed_state TEXT NOT NULL DEFAULT 'unknown',
        start_attempts INTEGER NOT NULL DEFAULT 0,
        stop_attempts INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        start_requested_at INTEGER,
        started_at INTEGER,
        stop_requested_at INTEGER,
        stopped_at INTEGER,
        last_response TEXT,
        last_error TEXT,
        PRIMARY KEY (server_key, match_id, round_number)
      );
CREATE INDEX idx_pickup_replay_server_updated
        ON pickup_replay_recordings(server_key, updated_at DESC);
CREATE TABLE elo_shadow_results (
        match_id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'pending',
        calculation_version TEXT NOT NULL DEFAULT 'elo-shadow-v1',
        formula_version TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        reason TEXT,
        api_player_count INTEGER,
        payload_json TEXT,
        created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
        calculated_at INTEGER,
        posted_at INTEGER
      , live_mode TEXT NOT NULL DEFAULT 'shadow', live_applied INTEGER NOT NULL DEFAULT 0, pending_json TEXT);
CREATE INDEX idx_elo_shadow_status ON elo_shadow_results(status, updated_at);
CREATE TABLE coolest_dude_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
CREATE INDEX idx_coolest_dude_tags_created_at
    ON coolest_dude_tags(created_at DESC, id DESC);
CREATE TABLE ip_geolocation (
    ip TEXT PRIMARY KEY,
    country_code TEXT,
    country TEXT,
    region TEXT,
    city TEXT,
    latitude REAL,
    longitude REAL,
    timezone TEXT,
    source TEXT NOT NULL DEFAULT 'dbip-lite-city',
    database_version TEXT,
    status TEXT NOT NULL DEFAULT 'no_match',
    looked_up_at INTEGER NOT NULL
  );
CREATE INDEX idx_ip_geolocation_status
    ON ip_geolocation(status);
CREATE INDEX idx_ip_geolocation_country
    ON ip_geolocation(country_code, status);
CREATE TABLE pickup_replay_live_clips (
      server_key TEXT NOT NULL,
      match_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      cap_time REAL NOT NULL,
      posted_at INTEGER NOT NULL,
      PRIMARY KEY (server_key, match_id, round_number, cap_time)
    );
CREATE TABLE pickup_replay_auto_clips (
      server_key TEXT NOT NULL,
      match_id TEXT NOT NULL,
      round_number INTEGER NOT NULL,
      posted_at INTEGER NOT NULL,
      PRIMARY KEY (server_key, match_id, round_number)
    );
CREATE TABLE pickup_flag_carry_rounds (
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    map TEXT NOT NULL,
    started_at_epoch INTEGER NOT NULL,
    artifact_sha256 TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (match_id, round_number)
  );
CREATE TABLE pickup_flag_carry_players (
    match_id TEXT NOT NULL,
    round_number INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    steam_id TEXT NOT NULL,
    carry_ms INTEGER NOT NULL DEFAULT 0,
    carry_count INTEGER NOT NULL DEFAULT 0,
    distance_units REAL NOT NULL DEFAULT 0,
    PRIMARY KEY (match_id, round_number, session_id)
  );
CREATE INDEX idx_pickup_flag_carry_players_steam
    ON pickup_flag_carry_players(steam_id, match_id, round_number);
CREATE TABLE pickup_flag_carries (
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
CREATE INDEX idx_pickup_flag_carries_session
    ON pickup_flag_carries(match_id, round_number, session_id);
