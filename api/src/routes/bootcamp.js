"use strict";

const express = require("express");
const { speedrunQuery } = require("../db/mariadb");
const { joinReplayChunks, parseReplayFrames } = require("../helpers/replay");

function parseBootcampEvents(serialized) {
  return String(serialized || "").split(";").map(line => line.trim()).filter(Boolean).map(line => {
    const values = line.split(",");
    if (values.length !== 4 || values.some(value => !value.trim())) return null;
    const [t, code, a, b] = values.map(Number);
    if (![t, code, a, b].every(Number.isFinite) || t < 0 || !Number.isInteger(code)) return null;
    return { t, code, a, b };
  }).filter(Boolean).sort((a, b) => a.t - b.t);
}

function bootcampEnabled(value) {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

function createBootcampRouter({ query = speedrunQuery, logRouteError = console.error } = {}) {
  const router = express.Router();
  router.get("/replay/run/:id", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_run_id" });
    try {
      // One statement binds chunks to an eligible run and avoids a review or
      // route-version change between separate authorization and data queries.
      const rows = await query(`
        SELECT g.id AS ghost_id, g.run_id, g.map, g.route_id, r.name AS route_name,
               g.class_id, g.player_name, g.steamid, b.time_ms, b.config_version, g.frame_interval, g.pos_frames,
               c.track, c.chunk_id, c.data
          FROM bootcamp_public_route_ghosts g
          JOIN bootcamp_runs b ON b.id = g.run_id AND b.finalization_required = 0
          JOIN bootcamp_routes r ON r.id = g.route_id
          LEFT JOIN bootcamp_ghost_chunks c ON c.ghost_id = g.id AND c.track IN ('pos', 'event')
         WHERE g.run_id = ? ORDER BY c.track, c.chunk_id LIMIT 513
      `, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json({ error: "replay_not_found" });
      if (rows.length > 512) return res.status(422).json({ error: "replay_invalid" });
      const chunks = { pos: [], event: [] };
      let bytes = 0;
      for (const row of rows) {
        if (!Object.hasOwn(chunks, row.track) || Number(row.chunk_id) !== chunks[row.track].length)
          return res.status(422).json({ error: "replay_invalid" });
        const value = Buffer.isBuffer(row.data) ? row.data.toString("utf8") : String(row.data ?? "");
        bytes += Buffer.byteLength(value);
        if (bytes > 8 * 1024 * 1024) return res.status(422).json({ error: "replay_invalid" });
        chunks[row.track].push(value);
      }
      const frames = parseReplayFrames(joinReplayChunks(chunks.pos));
      const events = parseBootcampEvents(joinReplayChunks(chunks.event));
      const first = rows[0];
      if (frames.length < 2 || frames.length > 3600 || events.length > 512 ||
          (Number(first.pos_frames) > 0 && frames.length !== Number(first.pos_frames)))
        return res.status(422).json({ error: "replay_invalid" });
      return res.json({ source: "bootcamp", runId: Number(first.run_id), ghostId: Number(first.ghost_id),
        map: first.map, routeId: Number(first.route_id), routeName: first.route_name,
        classId: Number(first.class_id), playerName: first.player_name, steamId: first.steamid, steamid: first.steamid,
        configVersion: Number(first.config_version),
        timeMs: Number(first.time_ms), frameInterval: Number(first.frame_interval), frames, events });
    } catch (error) {
      logRouteError("[/api/bootcamp/replay/run/:id]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/maps", async (_req, res) => {
    try {
      const rows = await query(`
        SELECT m.map, COUNT(r.id) AS route_count FROM bootcamp_maps m
        JOIN bootcamp_routes r ON r.map = m.map AND r.enabled = 1
        GROUP BY m.map ORDER BY m.map LIMIT 500
      `, []);
      return res.json({ maps: rows.map(row => ({ map: row.map, routeCount: Number(row.route_count) })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/maps]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/maps/:map/routes", async (req, res) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(req.params.map))
      return res.status(400).json({ error: "invalid_map" });
    try {
      const rows = await query(`
        SELECT r.id, r.slug, r.name, r.type, r.class_id, r.config_version,
               GROUP_CONCAT(c.class_id ORDER BY c.class_id) AS allowed_classes
          FROM bootcamp_routes r LEFT JOIN bootcamp_route_classes c ON c.route_id = r.id
         WHERE r.map = ? AND r.enabled = 1
         GROUP BY r.id, r.slug, r.name, r.type, r.class_id, r.config_version
         ORDER BY r.name, r.id LIMIT 100
      `, [req.params.map]);
      return res.json({ map: req.params.map, routes: rows.map(row => ({
        id: Number(row.id), slug: row.slug, name: row.name, type: row.type,
        classId: Number(row.class_id), configVersion: Number(row.config_version),
        allowedClasses: row.allowed_classes ? String(row.allowed_classes).split(",").map(Number) :
          (Number(row.class_id) > 0 ? [Number(row.class_id)] : [])
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/maps/:map/routes]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/maps/:map/drills", async (req, res) => {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(req.params.map))
      return res.status(400).json({ error: "invalid_map" });
    try {
      const rows = await query("SELECT id, slug, name, kind, class_id FROM bootcamp_drills WHERE map = ? AND enabled = 1 ORDER BY name, id LIMIT 100", [req.params.map]);
      return res.json({ map: req.params.map, drills: rows.map(row => ({
        id: Number(row.id), slug: row.slug, name: row.name, kind: row.kind, classId: Number(row.class_id)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/maps/:map/drills]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/drills/:id/leaderboard", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_drill_id" });
    try {
      const rows = await query(`
        SELECT set_id, steamid, player_name, class_id, score, tier FROM (
          SELECT s.id AS set_id, s.steamid, s.player_name, s.class_id, s.score, s.tier,
                 ROW_NUMBER() OVER (PARTITION BY s.steamid, s.class_id ORDER BY s.score DESC, s.id) AS player_rank
            FROM bootcamp_drill_sets s JOIN bootcamp_drills d ON d.id = s.drill_id AND d.enabled = 1
           WHERE s.drill_id = ?
        ) ranked WHERE player_rank = 1 ORDER BY score DESC, set_id LIMIT 100
      `, [Number(req.params.id)]);
      return res.json({ scores: rows.map(row => ({
        setId: Number(row.set_id), steamId: row.steamid, playerName: row.player_name,
        classId: Number(row.class_id), score: Number(row.score), tier: Number(row.tier)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/drills/:id/leaderboard]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/players/:steamId", async (req, res) => {
    const steamId = req.params.steamId;
    if (!/^STEAM_[0-5]:[01]:\d{1,20}$/.test(steamId))
      return res.status(400).json({ error: "invalid_steam_id" });
    try {
      const [licenses, runs] = await Promise.all([
        query("SELECT level, endorsements, granted_at FROM bootcamp_licenses WHERE steamid = ? LIMIT 1", [steamId]),
        query(`
          SELECT run_id, route_id, map, slug, route_name, class_id, time_ms, tier
            FROM (
              SELECT b.id AS run_id, r.id AS route_id, r.map, r.slug, r.name AS route_name,
                     b.class_id, b.time_ms, b.tier,
                     ROW_NUMBER() OVER (PARTITION BY b.route_id, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
                FROM bootcamp_runs b
                JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
               WHERE b.steamid = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
                 AND (b.flagged = 0 OR b.reviewed = 1)
            ) ranked WHERE player_rank = 1 ORDER BY map, route_name, class_id LIMIT 500
        `, [steamId])
      ]);
      const license = licenses[0];
      return res.json({ steamId, license: license ? {
        level: license.level, endorsements: String(license.endorsements || "").split(",").map(value => value.trim()).filter(Boolean),
        grantedAt: license.granted_at
      } : null, personalBests: runs.map(row => ({
        runId: Number(row.run_id), routeId: Number(row.route_id), map: row.map,
        slug: row.slug, routeName: row.route_name, classId: Number(row.class_id),
        timeMs: Number(row.time_ms), tier: Number(row.tier)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/players/:steamId]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/routes/:id/leaderboard", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) {
      return res.status(400).json({ error: "invalid_route_id" });
    }
    try {
      const rows = await query(`
        SELECT run_id, steamid, player_name, class_id, time_ms, has_replay
          FROM (
            SELECT b.id AS run_id, b.steamid, b.player_name, b.class_id, b.time_ms,
                   EXISTS(SELECT 1 FROM bootcamp_public_route_ghosts g WHERE g.run_id = b.id) AS has_replay,
                   ROW_NUMBER() OVER (PARTITION BY b.steamid, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
              FROM bootcamp_runs b
              JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
             WHERE b.route_id = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
               AND (b.flagged = 0 OR b.reviewed = 1)
          ) ranked
         WHERE player_rank = 1
         ORDER BY time_ms, run_id LIMIT 100
      `, [Number(req.params.id)]);
      return res.json({ runs: rows.map(row => ({
        runId: Number(row.run_id), steamId: row.steamid, playerName: row.player_name,
        classId: Number(row.class_id), timeMs: Number(row.time_ms), hasReplay: Number(row.has_replay) === 1
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/routes/:id/leaderboard]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  return router;
}

module.exports = { bootcampEnabled, createBootcampRouter };
