-- Apply once to the pickup MariaDB database before deploying replay carry summaries.
ALTER TABLE pickup_rounds
  ADD COLUMN flag_carry_processed_at DATETIME(3) NULL;

ALTER TABLE pickup_round_players
  ADD COLUMN flag_carry_ms BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN flag_carry_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN flag_carry_distance_units DOUBLE NOT NULL DEFAULT 0;

CREATE TABLE pickup_flag_carries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  round_pk BIGINT UNSIGNED NOT NULL,
  session_id INT UNSIGNED NOT NULL,
  objective_id INT UNSIGNED NOT NULL,
  carry_number INT UNSIGNED NOT NULL,
  start_ms INT UNSIGNED NOT NULL,
  end_ms INT UNSIGNED NOT NULL,
  distance_units DOUBLE NOT NULL,
  UNIQUE KEY uq_pickup_flag_carry (round_pk, objective_id, carry_number),
  KEY idx_pickup_flag_carry_round_session (round_pk, session_id)
);
