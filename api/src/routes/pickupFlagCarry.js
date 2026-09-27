"use strict";

const express = require("express");
const { TFC_UNITS_PER_METER } = require("../pickup/flagCarry");

function createPickupFlagCarryRouter({ db, logger = console }) {
  const router = express.Router();

  function filtersFor(req) {
    const playerId = String(req.params.playerId || "");
    const map = String(req.query.map || "");
    const matchId = String(req.query.matchId || "");
    if (!playerId || playerId.length > 64 ||
        (map && !/^[A-Za-z0-9_.-]{1,64}$/.test(map)) ||
        (matchId && !/^[A-Za-z0-9_-]{1,64}$/.test(matchId))) return null;
    return { playerId, map, matchId };
  }

  function sqlFilters(filters) {
    const clauses = [`EXISTS (
      SELECT 1 FROM player_steam_ids psi
      WHERE CAST(psi.discord_id AS TEXT) = ? AND psi.steam_id = rp.steam_id
    )`];
    const params = [filters.playerId];
    if (filters.map) { clauses.push("r.map = ?"); params.push(filters.map); }
    if (filters.matchId) { clauses.push("r.match_id = ?"); params.push(filters.matchId); }
    return { where: clauses.join(" AND "), params };
  }

  router.get("/player/:playerId/flag-carry", (req, res) => {
    const filters = filtersFor(req);
    if (!filters) return res.status(400).json({ ok: false, error: "invalid_flag_carry_filter" });
    try {
      const { where, params } = sqlFilters(filters);
      const row = db.prepare(`
        SELECT COALESCE(SUM(rp.carry_ms), 0) AS milliseconds,
               COALESCE(SUM(rp.carry_count), 0) AS carries,
               COALESCE(SUM(rp.distance_units), 0) AS distance_units,
               COUNT(DISTINCT r.match_id || '/' || r.round_number) AS recorded_rounds
        FROM pickup_flag_carry_players rp
        JOIN pickup_flag_carry_rounds r
          ON r.match_id = rp.match_id AND r.round_number = rp.round_number
        WHERE ${where}
      `).get(...params) || {};
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

  router.get("/player/:playerId/flag-carry-matches", (req, res) => {
    const filters = filtersFor(req);
    if (!filters) return res.status(400).json({ ok: false, error: "invalid_flag_carry_filter" });
    const offset = Math.max(0, Math.min(10000, Math.trunc(Number(req.query.offset) || 0)));
    try {
      const { where, params } = sqlFilters(filters);
      const rows = db.prepare(`
        SELECT r.match_id, GROUP_CONCAT(DISTINCT r.map) AS maps,
               COUNT(DISTINCT r.round_number) AS rounds,
               SUM(rp.carry_count) AS carries,
               SUM(rp.carry_ms) AS milliseconds,
               SUM(rp.distance_units) AS distance_units,
               MAX(r.started_at_epoch) AS latest_round_epoch
        FROM pickup_flag_carry_players rp
        JOIN pickup_flag_carry_rounds r
          ON r.match_id = rp.match_id AND r.round_number = rp.round_number
        WHERE ${where}
        GROUP BY r.match_id
        HAVING SUM(rp.carry_count) > 0
        ORDER BY latest_round_epoch DESC, r.match_id DESC
        LIMIT 6 OFFSET ?
      `).all(...params, offset);
      return res.json({ ok: true, data: {
        matches: rows.slice(0, 5).map(row => ({
          matchId: row.match_id,
          maps: row.maps || "",
          rounds: Number(row.rounds || 0),
          carries: Number(row.carries || 0),
          milliseconds: Number(row.milliseconds || 0),
          meters: Math.round(Number(row.distance_units || 0) / TFC_UNITS_PER_METER)
        })),
        hasMore: rows.length > 5
      } });
    } catch (error) {
      logger.error?.("[pickup flag carry] match_list_failed", error);
      return res.status(500).json({ ok: false, error: "flag_carry_unavailable" });
    }
  });

  router.get("/player/:playerId/flag-carries", (req, res) => {
    const filters = filtersFor(req);
    if (!filters) return res.status(400).json({ ok: false, error: "invalid_flag_carry_filter" });
    const offset = Math.max(0, Math.min(10000, Math.trunc(Number(req.query.offset) || 0)));
    try {
      const { where, params } = sqlFilters(filters);
      const rows = db.prepare(`
        SELECT r.match_id, r.round_number, r.map, fc.objective_id, fc.carry_number,
               fc.start_ms, fc.end_ms, fc.distance_units
        FROM pickup_flag_carries fc
        JOIN pickup_flag_carry_players rp
          ON rp.match_id = fc.match_id AND rp.round_number = fc.round_number
          AND rp.session_id = fc.session_id
        JOIN pickup_flag_carry_rounds r
          ON r.match_id = fc.match_id AND r.round_number = fc.round_number
        WHERE ${where}
        ORDER BY r.started_at_epoch DESC, fc.start_ms DESC,
                 fc.objective_id DESC, fc.carry_number DESC
        LIMIT 51 OFFSET ?
      `).all(...params, offset);
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
