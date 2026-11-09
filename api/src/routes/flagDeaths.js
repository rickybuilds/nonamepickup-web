"use strict";
const express = require("express");
function createFlagDeathRouter({ db }) {
  const router = express.Router();
  router.get("/map/:map/flag-deaths", (req, res) => {
    const map = String(req.params.map || "");
    if (!/^[a-z0-9_-]{1,64}$/i.test(map)) return res.status(400).json({ ok: false, error: "invalid_map" });
    try {
      const rounds = db.prepare("SELECT COUNT(*) AS count FROM pickup_flag_death_rounds WHERE map = ? COLLATE NOCASE").get(map).count;
      const rows = db.prepare(`SELECT d.match_id AS matchId, d.round_number AS round, d.time_ms AS timeMs,
        d.steam_id AS steamId, d.player_name AS playerName, d.x, d.y, d.z
        FROM pickup_flag_deaths d JOIN pickup_flag_death_rounds r
        ON r.match_id=d.match_id AND r.round_number=d.round_number
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
