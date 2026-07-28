"use strict";

const { normalizeMapName, recordKey } = require("./normalizer");

const CREATE_TABLE_SQL = `
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
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
`;

const UPSERT_SQL = `
  INSERT INTO speedrun_external_records (
    source, source_url, map_name_raw, map_name_normalized, map_id,
    class_name_raw, class_id, player_name, time_raw, time_ms, scraped_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE
    updated_at = IF(
      NOT (source_url <=> VALUES(source_url))
      OR NOT (map_name_raw <=> VALUES(map_name_raw))
      OR NOT (map_id <=> VALUES(map_id))
      OR NOT (class_name_raw <=> VALUES(class_name_raw))
      OR NOT (player_name <=> VALUES(player_name))
      OR NOT (time_raw <=> VALUES(time_raw))
      OR NOT (time_ms <=> VALUES(time_ms)),
      CURRENT_TIMESTAMP(3),
      updated_at
    ),
    source_url = VALUES(source_url),
    map_name_raw = VALUES(map_name_raw),
    map_id = VALUES(map_id),
    class_name_raw = VALUES(class_name_raw),
    player_name = VALUES(player_name),
    time_raw = VALUES(time_raw),
    time_ms = VALUES(time_ms),
    scraped_at = VALUES(scraped_at)
`;

function sameStoredRecord(existing, incoming) {
  return (
    String(existing.source_url || "") === String(incoming.source_url || "") &&
    String(existing.map_name_raw || "") === String(incoming.map_name_raw || "") &&
    String(existing.map_id || "") === String(incoming.map_id || "") &&
    String(existing.class_name_raw || "") === String(incoming.class_name_raw || "") &&
    String(existing.player_name || "") === String(incoming.player_name || "") &&
    String(existing.time_raw || "") === String(incoming.time_raw || "") &&
    Number(existing.time_ms) === Number(incoming.time_ms)
  );
}

class ExternalRecordRepository {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.logger = options.logger || console;
  }

  async initialize() {
    await this.pool.query("SELECT 1 AS ok");
    await this.pool.query(CREATE_TABLE_SQL);
  }

  async loadMapLookup() {
    try {
      const [rows] = await this.pool.query("SELECT map FROM speedrun_maps");
      const lookup = new Map();
      for (const row of rows) {
        const internalMapName = String(row.map || "").trim();
        if (internalMapName) lookup.set(normalizeMapName(internalMapName), internalMapName);
      }
      return lookup;
    } catch (error) {
      if (error.code !== "ER_NO_SUCH_TABLE" && error.errno !== 1146) throw error;
      this.logger.warn?.("[external-baseline] speedrun_maps is missing; map_id will remain NULL");
      return new Map();
    }
  }

  async loadExisting() {
    const [rows] = await this.pool.query(`
      SELECT source, source_url, map_name_raw, map_name_normalized, map_id,
             class_name_raw, class_id, player_name, time_raw, time_ms
      FROM speedrun_external_records
    `);
    return new Map(rows.map(row => [recordKey(row), row]));
  }

  async upsert(records, options = {}) {
    const mapLookup = options.mapLookup || await this.loadMapLookup();
    const existing = options.existing || await this.loadExisting();
    const scrapedAt = options.scrapedAt || new Date();
    const summary = { processed: records.length, inserted: 0, updated: 0, unchanged: 0, failed: 0 };

    for (const record of records) {
      const stored = {
        ...record,
        map_id: mapLookup.get(record.map_name_normalized) || null
      };
      const previous = existing.get(recordKey(stored));

      try {
        await this.pool.execute(UPSERT_SQL, [
          stored.source,
          stored.source_url,
          stored.map_name_raw,
          stored.map_name_normalized,
          stored.map_id,
          stored.class_name_raw,
          stored.class_id,
          stored.player_name,
          stored.time_raw,
          stored.time_ms,
          scrapedAt
        ]);

        if (!previous) summary.inserted += 1;
        else if (sameStoredRecord(previous, stored)) summary.unchanged += 1;
        else summary.updated += 1;
        existing.set(recordKey(stored), stored);
      } catch (error) {
        summary.failed += 1;
        this.logger.error?.(
          `[external-baseline] failed upsert ${stored.source}/${stored.map_name_normalized}/${stored.class_id}: ${error.message}`
        );
      }
    }

    return summary;
  }
}

module.exports = {
  CREATE_TABLE_SQL,
  UPSERT_SQL,
  sameStoredRecord,
  ExternalRecordRepository
};
