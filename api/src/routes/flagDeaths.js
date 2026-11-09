"use strict";
const express = require("express");
function createFlagDeathRouter({ db }) {
  const router = express.Router();
  router.get("/map/:map/flag-deaths", (req, res) => {
    const map = String(req.params.map || "");
    if (!/^[a-z0-9_-]{1,64}$/i.test(map)) return res.status(400).json({ ok: false, error: "invalid_map" });
    try {
      const rounds = db.prepare("SELECT COUNT(*) AS count FROM pickup_flag_death_rounds WHERE map = ? COLLATE NOCASE").get(map).count;
      const rows = db.prepare(`WITH steam_links AS (
        SELECT steam_id, MIN(discord_id) AS discord_id, MAX(NULLIF(TRIM(display_name), '')) AS linked_name
        FROM player_steam_ids
        WHERE steam_id <> '' AND discord_id <> ''
        GROUP BY steam_id
        HAVING COUNT(DISTINCT discord_id) = 1
      )
      SELECT d.match_id AS matchId, d.round_number AS round, d.time_ms AS timeMs,
        d.steam_id AS steamId, sl.discord_id AS playerId,
        COALESCE(NULLIF(TRIM(rt.display_name), ''), sl.linked_name,
          NULLIF(TRIM(d.player_name), ''), 'Unknown player') AS playerName,
        d.x, d.y, d.z
        FROM pickup_flag_deaths d JOIN pickup_flag_death_rounds r
        ON r.match_id=d.match_id AND r.round_number=d.round_number
        LEFT JOIN steam_links sl ON sl.steam_id=d.steam_id
        LEFT JOIN ratings rt ON rt.player_id=sl.discord_id
        WHERE r.map = ? COLLATE NOCASE ORDER BY d.match_id, d.round_number, d.time_ms LIMIT 100001`).all(map);
      const truncated = rows.length > 100000;
      if (truncated) rows.pop();
      return res.json({ ok: true, rounds, truncated, deaths: rows });
    } catch (error) {
      console.error("[flag deaths] query failed", error);
      return res.status(500).json({ ok: false, error: "flag_deaths_unavailable" });
    }
  });
  return router;
}
module.exports = { createFlagDeathRouter };
