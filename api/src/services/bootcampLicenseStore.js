"use strict";

const { computeLicense, levelRank, parseEndorsements } = require("./bootcampLicense");

async function rows(connection, sql, params = []) {
  const [result] = await connection.execute(sql, params);
  return result;
}

async function recomputeBootcampLicense(connection, steamId, rules = {}) {
  await connection.beginTransaction();
  try {
    // Establish and lock the primary-key row before reading inputs so two
    // consumers cannot both emit the same license-grant event.
    await rows(connection,
      "INSERT IGNORE INTO bootcamp_licenses (steamid, level, endorsements) VALUES (?, 'none', '')",
      [steamId]);
    const previousRows = await rows(connection,
      "SELECT level, endorsements, granted_at FROM bootcamp_licenses WHERE steamid = ? FOR UPDATE",
      [steamId]);
    const previousRow = previousRows[0] || { level: "none", endorsements: "", granted_at: null };
    const drills = await rows(connection,
      "SELECT id, map, slug, kind, class_id FROM bootcamp_drills WHERE enabled = 1");
    const routes = await rows(connection,
      "SELECT id, map, slug, type, class_id FROM bootcamp_routes WHERE enabled = 1");
    const rotation = await rows(connection,
      "SELECT map, rotation_order FROM bootcamp_maps WHERE in_rotation = 1");
    const tiers = await rows(connection,
      "SELECT target_type, target_id, class_id, tier FROM bootcamp_tiers WHERE steamid = ?",
      [steamId]);
    const previous = { level: previousRow.level, endorsements: parseEndorsements(previousRow.endorsements) };
    const next = computeLicense({ drills, routes, rotation, tiers, previous, rules });
    const endorsements = next.endorsements.join(",");
    const changed = next.level !== previous.level || endorsements !== previous.endorsements.join(",");
    const rose = levelRank(next.level) > levelRank(previous.level) ||
      next.endorsements.some(item => !previous.endorsements.includes(item));

    if (changed) {
      const grantTimestamp = next.level !== "none" && levelRank(next.level) > levelRank(previous.level);
      await rows(connection, `
        UPDATE bootcamp_licenses
           SET granted_at = CASE WHEN ? = 1 THEN UTC_TIMESTAMP() ELSE ? END,
               level = ?, endorsements = ?
         WHERE steamid = ?
      `, [grantTimestamp ? 1 : 0, previousRow.granted_at, next.level, endorsements, steamId]);
    }
    if (rose) {
      const names = await rows(connection,
        "SELECT player_name FROM bootcamp_events WHERE steamid = ? AND player_name <> '' ORDER BY id DESC LIMIT 1",
        [steamId]);
      await rows(connection,
        "INSERT INTO bootcamp_events (kind, steamid, player_name, target_type) VALUES ('license', ?, ?, ?)",
        [steamId, names[0]?.player_name || steamId, next.level]);
    }
    await connection.commit();
    return { license: next, changed };
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  }
}

module.exports = { recomputeBootcampLicense };
