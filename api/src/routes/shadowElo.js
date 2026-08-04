"use strict";

const express = require("express");
const compression = require("compression");

function createShadowEloRouter({ db, positiveInt, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/shadow-elo", compression({ threshold: 1024 }), (req, res) => {
    try {
      const limit = positiveInt(req.query.limit, 20, 10, 100);
      const table = db.prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'elo_shadow_results'
      `).get();

      if (!table) return sendError(res, 404, "shadow_elo_unavailable");

      const columns = db.prepare("PRAGMA table_info(elo_shadow_results)").all().map(row => row.name);
      if (!columns.includes("payload_json")) return sendError(res, 500, "shadow_elo_payload_missing");

      const hasMatchId = columns.includes("match_id");
      const orderColumn = ["created_at", "ts", "id"].find(name => columns.includes(name));
      const orderBy = orderColumn ? `\"${orderColumn}\" DESC, rowid DESC` : "rowid DESC";

      const ratedMatches = db.prepare(`
        SELECT m.match_id, m.map_name, m.winner, m.blue_ids, m.red_ids, m.created_at
        FROM matches m
        WHERE m.status = 'completed'
          AND EXISTS (
            SELECT 1 FROM rating_changes rc WHERE rc.match_id = m.match_id
          )
        ORDER BY m.created_at DESC, m.match_id DESC
        LIMIT ?
      `).all(limit);
      const ratedIds = ratedMatches.map(row => String(row.match_id));

      let rows = [];
      if (hasMatchId && ratedIds.length) {
        const ratedPlaceholders = ratedIds.map(() => "?").join(",");
        rows = db.prepare(`
          SELECT * FROM (
            SELECT rowid AS _shadow_rowid, *,
                   ROW_NUMBER() OVER (PARTITION BY match_id ORDER BY ${orderBy}) AS _match_rank
            FROM elo_shadow_results
            WHERE match_id IN (${ratedPlaceholders})
          )
          WHERE _match_rank = 1
        `).all(...ratedIds);
      } else if (!hasMatchId) {
        rows = db.prepare(`
            SELECT rowid AS _shadow_rowid, *
            FROM elo_shadow_results
            ORDER BY ${orderBy}
            LIMIT ?
          `).all(limit);
      }

      const parsedSnapshots = rows.map(row => {
        let payload = null;
        try {
          payload = JSON.parse(row.payload_json);
        } catch {
          payload = null;
        }

        const matchId = String(
          row.match_id ?? payload?.match_id ?? payload?.matchId ?? payload?.match?.id ?? ""
        );
        const createdAt = Number(
          row.created_at ?? row.ts ?? payload?.created_at ?? payload?.timestamp ?? 0
        );

        return {
          snapshot_id: String(row.id ?? row._shadow_rowid),
          match_id: matchId,
          created_at: Number.isFinite(createdAt) ? createdAt : 0,
          payload
        };
      }).filter(snapshot => snapshot.payload && snapshot.match_id);
      const seenMatchIds = new Set();
      const snapshots = parsedSnapshots.filter(snapshot => {
        if (seenMatchIds.has(snapshot.match_id)) return false;
        seenMatchIds.add(snapshot.match_id);
        return true;
      }).slice(0, limit);

      const snapshotsById = new Map(snapshots.map(snapshot => [snapshot.match_id, snapshot]));
      const selectedMatches = ratedMatches.length ? ratedMatches : snapshots.map(snapshot => ({
        match_id: snapshot.match_id,
        created_at: snapshot.created_at
      }));
      const ids = [...new Set(selectedMatches.map(match => String(match.match_id)))];
      const changesById = new Map();

      if (ids.length) {
        const placeholders = ids.map(() => "?").join(",");
        const changeRows = db.prepare(`
          SELECT rc.match_id, rc.player_id, rc.before, rc.after, rc.delta,
                 COALESCE(r.display_name, CAST(rc.player_id AS TEXT)) AS display_name
          FROM rating_changes rc
          LEFT JOIN ratings r ON r.player_id = rc.player_id
          WHERE rc.match_id IN (${placeholders})
          ORDER BY rc.ts, rc.player_id
        `).all(...ids);
        for (const row of changeRows) {
          const key = String(row.match_id);
          const list = changesById.get(key) || [];
          list.push({
            player_id: String(row.player_id),
            display_name: row.display_name,
            before: row.before == null ? null : Number(row.before),
            after: row.after == null ? null : Number(row.after),
            delta: Number(row.delta || 0)
          });
          changesById.set(key, list);
        }
      }

      const data = selectedMatches.slice().reverse().map(match => {
        const matchId = String(match.match_id);
        const snapshot = snapshotsById.get(matchId) || {
          snapshot_id: null,
          match_id: matchId,
          created_at: Number(match.created_at || 0),
          payload: {}
        };
        return {
          ...snapshot,
          created_at: snapshot.created_at || Number(match.created_at || 0),
          map_name: match.map_name || null,
          winner: match.winner || null,
          blue_ids: match.blue_ids || null,
          red_ids: match.red_ids || null,
          v1_changes: changesById.get(matchId) || [],
          simulation_data_available: Boolean(snapshotsById.get(matchId))
        };
      });

      res.setHeader("Cache-Control", "private, no-store");
      res.json({
        ok: true,
        data,
        limit,
        games_selected: data.length,
        simulation_data_available: data.filter(game => game.simulation_data_available).length,
        allocation_only: true
      });
    } catch (error) {
      logRouteError("[/api/shadow-elo]", error);
      sendError(res, 500, "shadow_elo_failed");
    }
  });

  return router;
}

module.exports = { createShadowEloRouter };
