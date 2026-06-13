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
`);
}

function cleanupAnalytics(db, analyticsRetentionDays) {
  db.prepare("DELETE FROM web_analytics WHERE ts < ?").run(
    Math.floor(Date.now() / 1000) - (analyticsRetentionDays * 86400)
  );
}

module.exports = { initializeSchema, cleanupAnalytics };
