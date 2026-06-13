"use strict";

const express = require("express");

function createCompareRouter({
  compareProfileStmt,
  compareMatchesStmt,
  cleanString,
  parseIdList,
  loadMatchPlayers,
  safePublicUrl,
  sendError,
  logRouteError
}) {
  const router = express.Router();

  router.get("/compare", (req, res) => {
    try {
      const p1 = cleanString(req.query.p1, 100);
      const p2 = cleanString(req.query.p2, 100);

      if (!p1 || !p2) return sendError(res, 400, "missing_players");
      if (p1 === p2) return sendError(res, 400, "same_player");

      const player1 = compareProfileStmt.get(p1);
      const player2 = compareProfileStmt.get(p2);

      if (!player1 || !player2) {
        return sendError(res, 404, "player_not_found");
      }

      const rows = compareMatchesStmt.all(p1, p2);

      const stats = {
        teammate: { gp: 0, w: 0, l: 0, t: 0, win_pct: 0 },
        opponent: { gp: 0, p1_w: 0, p2_w: 0, t: 0, p1_win_pct: 0, p2_win_pct: 0 }
      };

      const returnedMatchData = [];
      let matchCount = 0;

      for (const m of rows) {
        const blueIds = new Set(parseIdList(m.blue_ids));
        const redIds = new Set(parseIdList(m.red_ids));
        const p1Team = blueIds.has(p1) ? "BLUE" : redIds.has(p1) ? "RED" : null;
        const p2Team = blueIds.has(p2) ? "BLUE" : redIds.has(p2) ? "RED" : null;
        if (!p1Team || !p2Team) continue;

        const relation = p1Team === p2Team ? "teammate" : "opponent";
        const winner = String(m.winner || "").toUpperCase();

        let result = "â€”";

        if (relation === "teammate") {
          stats.teammate.gp++;

          if (winner === "TIE") {
            stats.teammate.t++;
            result = "Tie together";
          } else if (winner === p1Team) {
            stats.teammate.w++;
            result = "Won together";
          } else if (winner) {
            stats.teammate.l++;
            result = "Lost together";
          }
        } else {
          stats.opponent.gp++;

          if (winner === "TIE") {
            stats.opponent.t++;
            result = "Tie";
          } else if (winner === p1Team) {
            stats.opponent.p1_w++;
            result = `${player1.display_name || p1} win`;
          } else if (winner === p2Team) {
            stats.opponent.p2_w++;
            result = `${player2.display_name || p2} win`;
          }
        }

        matchCount += 1;
        if (returnedMatchData.length < 25) {
          returnedMatchData.push({
            row: m,
            blueIds,
            redIds,
            winner,
            relation,
            result
          });
        }
      }

      const playersByMatch = loadMatchPlayers(
        returnedMatchData.map(item => item.row),
        { includeRatings: false }
      );
      const matches = returnedMatchData.map(item => {
        const players = playersByMatch.get(String(item.row.match_id)) || [];
        const blueTeam = [];
        const redTeam = [];

        for (const p of players) {
          const entry = {
            id: String(p.id),
            name: p.name,
            before: p.before,
            after: p.after,
            delta: p.delta
          };

          if (item.blueIds.has(entry.id)) blueTeam.push(entry);
          else if (item.redIds.has(entry.id)) redTeam.push(entry);
        }

        return {
          id: item.row.match_id,
          created_at: item.row.created_at,
          map_name: item.row.map_name,
          winner: item.winner,
          relation: item.relation,
          result: item.result,
          score_blue: item.row.score_blue ?? null,
          score_red: item.row.score_red ?? null,
          blueTeam,
          redTeam,
          hampalyzer_url: safePublicUrl(item.row.hampalyzer_url)
        };
      });

      if (stats.teammate.gp) {
        stats.teammate.win_pct = Math.round((stats.teammate.w / stats.teammate.gp) * 100);
      }

      if (stats.opponent.gp) {
        stats.opponent.p1_win_pct = Math.round((stats.opponent.p1_w / stats.opponent.gp) * 100);
        stats.opponent.p2_win_pct = Math.round((stats.opponent.p2_w / stats.opponent.gp) * 100);
      }

      res.json({
        ok: true,
        data: {
          players: {
            p1: {
              id: String(player1.player_id),
              name: player1.display_name || String(player1.player_id),
              elo: player1.hide_elo ? null : player1.rating,
              hidden: !!player1.hide_elo
            },
            p2: {
              id: String(player2.player_id),
              name: player2.display_name || String(player2.player_id),
              elo: player2.hide_elo ? null : player2.rating,
              hidden: !!player2.hide_elo
            }
          },
          stats,
          matches,
          count: matchCount
        }
      });
    } catch (e) {
      logRouteError("[/api/compare]", e);
      sendError(res, 500, "compare_failed");
    }
  });

  return router;
}

module.exports = { createCompareRouter };
