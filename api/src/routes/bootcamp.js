"use strict";

const express = require("express");
const { speedrunQuery } = require("../db/mariadb");

function bootcampEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function createBootcampRouter({ query = speedrunQuery, logRouteError = console.error } = {}) {
  const router = express.Router();
  router.get("/routes/:id/leaderboard", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
      return res.status(400).json({ error: "invalid_route_id" });
    }
    try {
      const rows = await query(`
        SELECT run_id, steamid, player_name, class_id, time_ms
          FROM (
            SELECT b.id AS run_id, b.steamid, b.player_name, b.class_id, b.time_ms,
                   ROW_NUMBER() OVER (PARTITION BY b.steamid, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
              FROM bootcamp_runs b
              JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
             WHERE b.route_id = ? AND b.valid = 1 AND b.mode = 1
               AND (b.flagged = 0 OR b.reviewed = 1)
          ) ranked
         WHERE player_rank = 1
         ORDER BY time_ms, run_id LIMIT 100
      `, [Number(req.params.id)]);
      return res.json({ runs: rows.map(row => ({
        runId: Number(row.run_id), steamId: row.steamid, playerName: row.player_name,
        classId: Number(row.class_id), timeMs: Number(row.time_ms)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/routes/:id/leaderboard]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  return router;
}

module.exports = { bootcampEnabled, createBootcampRouter };
