CREATE TABLE IF NOT EXISTS speedrun_external_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  source VARCHAR(64) NOT NULL,
  source_url VARCHAR(512) NOT NULL,
  map_name_raw VARCHAR(128) NOT NULL,
  map_name_normalized VARCHAR(128) NOT NULL,
  map_id VARCHAR(128) NULL,
  class_name_raw VARCHAR(64) NOT NULL,
  class_id SMALLINT UNSIGNED NOT NULL,
  player_name VARCHAR(128) NULL,
  time_raw VARCHAR(64) NOT NULL,
  time_ms INT UNSIGNED NOT NULL,
  scraped_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_record_source_map_class
    (source, map_name_normalized, class_id),
  KEY idx_external_record_map_id (map_id),
  KEY idx_external_record_time (time_ms)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
