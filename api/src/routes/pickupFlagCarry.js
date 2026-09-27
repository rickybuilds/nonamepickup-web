"use strict";

const express = require("express");
const { TFC_UNITS_PER_METER } = require("../pickup/flagCarry");

function createPickupFlagCarryRouter({ db, pool, logger = console }) {
  const router = express.Router();

  function steamIdsFor(playerId) {
    return [...new Set(db.prepare(`
      SELECT steam_id FROM player_steam_ids
      WHERE CAST(discord_id AS TEXT) = ? AND steam_id IS NOT NULL AND steam_id != ''
    `).all(playerId).map(row => String(row.steam_id)))];
  }

  function filtersFor(req) {
    const playerId = String(req.params.playerId || "");
    const map = String(req.query.map || "");
    const matchId = String(req.query.matchId || "");
    if (!playerId || playerId.length > 64 ||
        (map && !/^[A-Za-z0-9_.-]{1,64}$/.test(map)) ||
        (matchId && !/^[A-Za-z0-9_-]{1,64}$/.test(matchId))) return null;
    return { playerId, map, matchId };
  }

  function sqlFilters(steamIds, map, matchId) {
    const clauses = [`p.steamid IN (${steamIds.map(() => "?").join(", ")})`];
    const params = [...steamIds];
    if (map) { clauses.push("r.map = ?"); params.push(map); }
    if (matchId) { clauses.push("m.match_id = ?"); params.push(matchId); }
    return { where: clauses.join(" AND "), params };
  }

  router.get("/player/:playerId/flag-carry", async (req, res) => {
    const filters = filtersFor(req);
    if (!filters) {
      return res.status(400).json({ ok: false, error: "invalid_flag_carry_filter" });
    }

    try {
      const steamIds = steamIdsFor(filters.playerId);
      if (!steamIds.length) {
        return res.json({ ok: true, data: { milliseconds: 0, carries: 0, meters: 0, recordedRounds: 0 } });
      }
      const { where, params } = sqlFilters(steamIds, filters.map, filters.matchId);
      const [rows] = await pool.execute(`
        SELECT COALESCE(SUM(rp.flag_carry_ms), 0) AS milliseconds,
               COALESCE(SUM(rp.flag_carry_count), 0) AS carries,
               COALESCE(SUM(rp.flag_carry_distance_units), 0) AS distance_units,
               COUNT(DISTINCT r.id) AS recorded_rounds
        FROM pickup_round_players rp
        JOIN pickup_players p ON p.id = rp.player_pk
        JOIN pickup_rounds r ON r.id = rp.round_pk
        JOIN pickup_matches m ON m.id = r.match_pk
        JOIN pickup_artifacts a ON a.round_pk = r.id
          AND a.artifact_kind = 'round_replay' AND a.status = 'verified' AND a.is_primary = 1
        WHERE ${where}
          AND r.status = 'complete'
          AND r.flag_carry_processed_at IS NOT NULL
      `, params);
      const row = rows[0] || {};
      return res.json({ ok: true, data: {
        milliseconds: Number(row.milliseconds || 0),
        carries: Number(row.carries || 0),
        meters: Math.round(Number(row.distance_units || 0) / TFC_UNITS_PER_METER),
        recordedRounds: Number(row.recorded_rounds || 0)
      } });
    } catch (error) {
      logger.error?.("[pickup flag carry] profile_summary_failed", error);
      return res.status(500).json({ ok: false, error: "flag_carry_unavailable" });
    }
  });

  router.get("/player/:playerId/flag-carries", async (req, res) => {
    const filters = filtersFor(req);
    if (!filters) return res.status(400).json({ ok: false, error: "invalid_flag_carry_filter" });
    const offset = Math.max(0, Math.min(10000, Math.trunc(Number(req.query.offset) || 0)));
    try {
      const steamIds = steamIdsFor(filters.playerId);
      if (!steamIds.length) return res.json({ ok: true, data: { carries: [], hasMore: false } });
      const { where, params } = sqlFilters(steamIds, filters.map, filters.matchId);
      const [rows] = await pool.execute(`
        SELECT m.match_id, r.round_number, r.map, fc.objective_id, fc.carry_number,
               fc.start_ms, fc.end_ms, fc.distance_units
        FROM pickup_flag_carries fc
        JOIN pickup_round_players rp ON rp.round_pk = fc.round_pk AND rp.session_id = fc.session_id
        JOIN pickup_players p ON p.id = rp.player_pk
        JOIN pickup_rounds r ON r.id = fc.round_pk
        JOIN pickup_matches m ON m.id = r.match_pk
        JOIN pickup_artifacts a ON a.round_pk = r.id
          AND a.artifact_kind = 'round_replay' AND a.status = 'verified' AND a.is_primary = 1
        WHERE ${where} AND r.status = 'complete' AND r.flag_carry_processed_at IS NOT NULL
        ORDER BY r.started_at DESC, fc.start_ms DESC, fc.id DESC
        LIMIT 51 OFFSET ?
      `, [...params, offset]);
      return res.json({ ok: true, data: {
        carries: rows.slice(0, 50).map(row => ({
          matchId: row.match_id,
          round: Number(row.round_number),
          map: row.map,
          objectiveId: Number(row.objective_id),
          carryNumber: Number(row.carry_number),
          startMs: Number(row.start_ms),
          endMs: Number(row.end_ms),
          meters: Math.round(Number(row.distance_units || 0) / TFC_UNITS_PER_METER)
        })),
        hasMore: rows.length > 50
      } });
    } catch (error) {
      logger.error?.("[pickup flag carry] carry_details_failed", error);
      return res.status(500).json({ ok: false, error: "flag_carry_unavailable" });
    }
  });

  return router;
}

module.exports = { createPickupFlagCarryRouter };
