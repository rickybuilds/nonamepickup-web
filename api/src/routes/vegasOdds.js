"use strict";

const express = require("express");

function createVegasOddsRouter({ db, cleanString, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/vegasodds/:player", (req, res) => {
    try {
      const q = cleanString(req.params.player, 100);
      if (!q) return sendError(res, 400, "invalid_player");

      const player = db.prepare(`
      SELECT player_id, display_name
      FROM ratings
      WHERE player_id = ?
         OR LOWER(display_name) LIKE LOWER(?)
      LIMIT 1
    `).get(q, `%${q.toLowerCase()}%`);

      if (!player) {
        return sendError(res, 404, "player_not_found");
      }

      const rows = db.prepare(`
      SELECT
        date(datetime(m.created_at, 'unixepoch', 'localtime')) AS play_date,
        COUNT(DISTINCT m.match_id) AS games
      FROM rating_changes rc
      JOIN matches m ON m.match_id = rc.match_id
      WHERE rc.player_id = ?
        AND m.status = 'completed'
      GROUP BY play_date
      ORDER BY play_date DESC
    `).all(String(player.player_id));

      if (rows.length < 2) {
        return res.json({
          ok: true,
          player,
          enough_data: false,
          message: "Not enough history yet"
        });
      }

      const gaps = [];

      for (let i = 0; i < rows.length - 1; i++) {
        const d1 = new Date(rows[i].play_date);
        const d2 = new Date(rows[i + 1].play_date);
        const gap = Math.round((d1 - d2) / 86400000);

        if (gap > 1) gaps.push(gap);
      }

      const avgGap = gaps.length
        ? gaps.reduce((a, b) => a + b, 0) / gaps.length
        : 0;

      const lastPlayed = new Date(rows[0].play_date);
      const today = new Date();
      const daysSince = Math.floor((today - lastPlayed) / 86400000);

      const vegasLine = avgGap ? Number((avgGap - 0.5).toFixed(1)) : null;

      let status = "Unknown";

      if (daysSince === 0) status = "HE IS HERE RIGHT NOW";
      else if (daysSince <= 2) status = "HE HAS AWAKENED";
      else if (avgGap && daysSince >= avgGap) status = "DUE ANY MINUTE";
      else if (avgGap && daysSince >= avgGap * 0.75) status = "WARMING UP";
      else status = "Still vanished";

      res.json({
        ok: true,
        enough_data: true,
        player,
        last_played: rows[0].play_date,
        active_days: rows.length,
        days_since_last_played: daysSince,
        avg_gap_days: Number(avgGap.toFixed(1)),
        longest_gap_days: gaps.length ? Math.max(...gaps) : 0,
        vegas_line: vegasLine,
        games_last_active_day: rows[0].games,
        status
      });

    } catch (e) {
      logRouteError("[/api/vegasodds]", e);
      sendError(res, 500, "vegasodds_failed");
    }
  });

  return router;
}

module.exports = { createVegasOddsRouter };
