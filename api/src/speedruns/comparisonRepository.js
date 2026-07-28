"use strict";

const COMPARISON_SNAPSHOT_SQL = `
  WITH internal_ranked AS (
    SELECT
      r.*,
      ROW_NUMBER() OVER (
        PARTITION BY r.map, r.class_id
        ORDER BY
          r.best_time_ms ASC,
          COALESCE(r.pb_created_at, r.updated_at) ASC,
          r.steamid ASC
      ) AS record_rank
    FROM speedrun_records r
    WHERE r.ruleset = ?
      AND r.best_time_ms >= ?
  ),
  internal_wr AS (
    SELECT *
    FROM internal_ranked
    WHERE record_rank = 1
  ),
  player_links AS (
    SELECT steamid, MIN(discord_id) AS discord_id
    FROM speedrun_player_links
    GROUP BY steamid
  ),
  external_candidates AS (
    SELECT
      COALESCE(map_id, map_name_normalized) AS map_key,
      source,
      source_url,
      map_name_raw,
      map_name_normalized,
      map_id,
      class_name_raw,
      class_id,
      player_name,
      time_raw,
      time_ms,
      scraped_at,
      updated_at
    FROM speedrun_external_records
    WHERE time_ms >= ?
  ),
  comparison_keys AS (
    SELECT map AS map_key, class_id FROM internal_wr
    UNION
    SELECT map_key, class_id FROM external_candidates
  )
  SELECT
    ck.map_key AS mapKey,
    ck.class_id AS classId,
    maps.map AS internalMapId,
    maps.display_name AS mapDisplayName,
    maps.category AS mapCategory,
    maps.enabled AS mapEnabled,
    iwr.steamid AS internalSteamId,
    links.discord_id AS internalDiscordId,
    iwr.player_name AS internalPlayerName,
    iwr.class_name AS internalClassName,
    iwr.best_time_ms AS internalTimeMs,
    iwr.pb_created_at AS internalAchievedAt,
    iwr.updated_at AS internalUpdatedAt,
    ext.source AS externalSource,
    ext.source_url AS externalSourceUrl,
    ext.map_name_raw AS externalMapNameRaw,
    ext.map_name_normalized AS externalMapNameNormalized,
    ext.map_id AS externalMapId,
    ext.class_name_raw AS externalClassName,
    ext.player_name AS externalPlayerName,
    ext.time_raw AS externalTimeRaw,
    ext.time_ms AS externalTimeMs,
    ext.scraped_at AS externalScrapedAt,
    ext.updated_at AS externalUpdatedAt
  FROM comparison_keys ck
  LEFT JOIN speedrun_maps maps
    ON maps.map = ck.map_key
  LEFT JOIN internal_wr iwr
    ON iwr.map = ck.map_key
   AND iwr.class_id = ck.class_id
  LEFT JOIN player_links links
    ON links.steamid = iwr.steamid
  LEFT JOIN external_candidates ext
    ON ext.map_key = ck.map_key
   AND ext.class_id = ck.class_id
  ORDER BY ck.map_key ASC, ck.class_id ASC, ext.time_ms ASC, ext.source ASC
`;

const PLAYER_RECORDS_SQL = `
  WITH player_ranked AS (
    SELECT
      records.*,
      links.discord_id,
      ROW_NUMBER() OVER (
        PARTITION BY records.map, records.class_id
        ORDER BY
          records.best_time_ms ASC,
          COALESCE(records.pb_created_at, records.updated_at) ASC,
          records.steamid ASC
      ) AS linked_rank
    FROM speedrun_records records
    JOIN speedrun_player_links links
      ON links.steamid = records.steamid
    WHERE links.discord_id = ?
      AND records.ruleset = ?
      AND records.best_time_ms >= ?
  )
  SELECT
    map,
    class_id AS classId,
    class_name AS className,
    steamid AS steamId,
    discord_id AS discordId,
    player_name AS playerName,
    best_time_ms AS timeMs,
    pb_created_at AS achievedAt,
    updated_at AS updatedAt
  FROM player_ranked
  WHERE linked_rank = 1
  ORDER BY map ASC, class_id ASC
`;

class SpeedrunComparisonRepository {
  constructor({ query }) {
    if (typeof query !== "function") throw new TypeError("query is required");
    this.query = query;
  }

  fetchComparisonRows(ruleset, minimumValidTimeMs = 1) {
    return this.query(COMPARISON_SNAPSHOT_SQL, [ruleset, minimumValidTimeMs, minimumValidTimeMs]);
  }

  fetchPlayerRecords(discordId, ruleset, minimumValidTimeMs = 1) {
    return this.query(PLAYER_RECORDS_SQL, [discordId, ruleset, minimumValidTimeMs]);
  }
}

module.exports = {
  COMPARISON_SNAPSHOT_SQL,
  PLAYER_RECORDS_SQL,
  SpeedrunComparisonRepository
};
