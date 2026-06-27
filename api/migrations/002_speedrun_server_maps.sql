CREATE TABLE IF NOT EXISTS speedrun_server_maps (
  server_key VARCHAR(64) NOT NULL,
  map VARCHAR(128) NOT NULL,
  exists_on_server TINYINT(1) NOT NULL DEFAULT 1,
  last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (server_key, map),
  INDEX idx_map (map)
);
