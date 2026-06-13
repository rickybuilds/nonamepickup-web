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
