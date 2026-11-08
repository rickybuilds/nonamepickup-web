"use strict";

const express = require("express");
const { timingSafeEqual } = require("node:crypto");
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

function procedureChanged(result) {
  if (Array.isArray(result)) return result.some(procedureChanged);
  return Boolean(result && typeof result === "object" && Number(result.changed) === 1);
}

function decodeReplay(rows) {
  if (!rows.length) return { error: "replay_not_found", status: 404 };
  if (rows.length > 512) return { error: "replay_invalid", status: 422 };
  const chunks = { pos: [], event: [] };
  let bytes = 0;
  for (const row of rows) {
    if (!Object.hasOwn(chunks, row.track) || Number(row.chunk_id) !== chunks[row.track].length)
      return { error: "replay_invalid", status: 422 };
    const value = Buffer.isBuffer(row.data) ? row.data.toString("utf8") : String(row.data ?? "");
    bytes += Buffer.byteLength(value);
    if (bytes > 8 * 1024 * 1024) return { error: "replay_invalid", status: 422 };
    chunks[row.track].push(value);
  }
  const frames = parseReplayFrames(joinReplayChunks(chunks.pos));
  const events = parseBootcampEvents(joinReplayChunks(chunks.event));
  const first = rows[0];
  if (frames.length < 2 || frames.length > 3600 || events.length > 512 ||
      (Number(first.pos_frames) > 0 && frames.length !== Number(first.pos_frames)))
    return { error: "replay_invalid", status: 422 };
  return { replay: { source: "bootcamp", runId: Number(first.run_id), ghostId: Number(first.ghost_id),
    map: first.map, routeId: Number(first.route_id), routeName: first.route_name,
    classId: Number(first.class_id), playerName: first.player_name, steamId: first.steamid, steamid: first.steamid,
    configVersion: Number(first.config_version), timeMs: Number(first.time_ms),
    frameInterval: Number(first.frame_interval), frames, events } };
}

function createBootcampRouter({ query = speedrunQuery, logRouteError = console.error, adminUser = process.env.BOOTCAMP_ADMIN_USER, adminPassword = process.env.BOOTCAMP_ADMIN_PASSWORD } = {}) {
  const router = express.Router();
  function requireBootcampAdmin(req, res, next) {
    if (!adminUser || !adminPassword) return res.status(503).json({ error: "bootcamp_admin_not_configured" });
    const [scheme, encoded = ""] = String(req.get("authorization") || "").split(/\s+/, 2);
    let suppliedUser = "", suppliedPassword = "";
    try {
      if (scheme === "Basic") [suppliedUser, suppliedPassword] = Buffer.from(encoded, "base64").toString("utf8").split(/:(.*)/s, 2);
    } catch { /* malformed authorization is treated as a failed login */ }
    const safeEqual = (left, right) => {
      const a = Buffer.from(String(left)), b = Buffer.from(String(right));
      return a.length === b.length && timingSafeEqual(a, b);
    };
    if (!safeEqual(suppliedUser, adminUser) || !safeEqual(suppliedPassword, adminPassword)) {
      res.set("WWW-Authenticate", 'Basic realm="TFC Bootcamp review"');
      return res.status(401).json({ error: "bootcamp_admin_unauthorized" });
    }
    res.set("Cache-Control", "no-store");
    return next();
  }

  router.get("/admin/reviews", requireBootcampAdmin, async (req, res) => {
    const limitText = req.query.limit === undefined ? "50" : String(req.query.limit);
    if (!/^(?:[1-9]\d?|100)$/.test(limitText)) return res.status(400).json({ error: "invalid_limit" });
    try {
      const rows = await query(`
        SELECT b.id AS run_id, b.steamid, b.player_name, b.map, b.route_id, r.name AS route_name,
               b.class_id, b.time_ms, b.tier, b.config_version, b.created_at, g.id AS ghost_id
          FROM bootcamp_runs b
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version
          JOIN bootcamp_ghosts g ON g.id = b.ghost_id AND g.run_id = b.id AND g.route_id = b.route_id
               AND g.map = b.map AND g.class_id = b.class_id AND g.is_complete = 1
         WHERE b.flagged = 1 AND b.reviewed = 0 AND b.valid = 1 AND b.mode = 1
           AND b.finalization_required = 0
         ORDER BY b.created_at, b.id LIMIT ?
      `, [Number(limitText)]);
      return res.json({ reviews: rows.map(row => ({ runId: Number(row.run_id), steamId: row.steamid,
        playerName: row.player_name, map: row.map, routeId: Number(row.route_id), routeName: row.route_name,
        classId: Number(row.class_id), timeMs: Number(row.time_ms), tier: Number(row.tier),
        configVersion: Number(row.config_version), createdAt: row.created_at, ghostId: Number(row.ghost_id) })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/admin/reviews]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });

  router.post("/admin/reviews/:id", requireBootcampAdmin, async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_run_id" });
    if (!req.is("application/json") || !req.body || Object.keys(req.body).length !== 1 ||
        !["approve", "reject"].includes(req.body.verdict)) return res.status(400).json({ error: "invalid_review_verdict" });
    const runId = Number(req.params.id), approve = req.body.verdict === "approve" ? 1 : 0;
    try {
      // The procedure atomically commits review, tier changes and events. This
      // eligibility guard prevents direct IDs from bypassing the visible queue.
      const eligible = await query(`
        SELECT b.id FROM bootcamp_runs b
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version
          JOIN bootcamp_ghosts g ON g.id = b.ghost_id AND g.run_id = b.id AND g.route_id = b.route_id
               AND g.map = b.map AND g.class_id = b.class_id AND g.is_complete = 1
         WHERE b.id = ? AND b.flagged = 1 AND b.reviewed = 0 AND b.valid = 1 AND b.mode = 1
           AND b.finalization_required = 0 LIMIT 1
      `, [runId]);
      if (!eligible.length) return res.status(409).json({ error: "review_not_pending" });
      const result = await query("CALL bootcamp_review_run(?, ?)", [runId, approve]);
      if (!procedureChanged(result)) return res.status(409).json({ error: "review_not_pending" });
      return res.json({ reviewed: true, runId, verdict: req.body.verdict });
    } catch (error) {
      logRouteError("[/api/bootcamp/admin/reviews/:id]", error);
      return res.status(503).json({ error: "bootcamp_review_unavailable" });
    }
  });

  async function sendReplay(req, res, admin) {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_run_id" });
    try {
      // One statement binds chunks to an eligible run and avoids a review or
      // route-version change between separate authorization and data queries.
      const rows = await query(`
        SELECT g.id AS ghost_id, g.run_id, g.map, g.route_id, r.name AS route_name,
               g.class_id, g.player_name, g.steamid, b.time_ms, b.config_version, g.frame_interval, g.pos_frames,
               c.track, c.chunk_id, c.data
          FROM ${admin ? "bootcamp_ghosts" : "bootcamp_public_route_ghosts"} g
          JOIN bootcamp_runs b ON b.id = g.run_id AND b.ghost_id = g.id AND b.finalization_required = 0
          JOIN bootcamp_routes r ON r.id = g.route_id AND r.id = b.route_id AND r.map = b.map
          LEFT JOIN bootcamp_ghost_chunks c ON c.ghost_id = g.id AND c.track IN ('pos', 'event')
         WHERE g.run_id = ? ${admin ? "AND g.route_id = b.route_id AND g.map = b.map AND g.class_id = b.class_id AND g.is_complete = 1 AND b.flagged = 1 AND b.reviewed = 0 AND b.valid = 1 AND b.mode = 1 AND r.config_version = b.config_version" : ""}
         ORDER BY c.track, c.chunk_id LIMIT 513
      `, [Number(req.params.id)]);
      const result = decodeReplay(rows);
      if (result.error) return res.status(result.status).json({ error: result.error });
      return res.json(result.replay);
    } catch (error) {
      logRouteError(`[${admin ? "admin/" : ""}/api/bootcamp/replay/run/:id]`, error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  }
  router.get("/replay/run/:id", (req, res) => sendReplay(req, res, false));
  router.get("/admin/reviews/:id/replay", requireBootcampAdmin, (req, res) => sendReplay(req, res, true));
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
  router.get("/challenge/current", async (_req, res) => {
    try {
      const rows = await query(`
        SELECT c.id, DATE_FORMAT(c.starts_at, '%Y-%m-%d') AS week_start, COALESCE(r.map, d.map) AS map, c.target_type,
               c.target_id, c.title, DATE_FORMAT(c.starts_at, '%Y-%m-%d %H:%i:%s') AS starts_at,
               DATE_FORMAT(c.ends_at, '%Y-%m-%d %H:%i:%s') AS ends_at,
               COALESCE(r.name, d.name) AS target_name
          FROM bootcamp_challenges c
          LEFT JOIN bootcamp_routes r ON c.target_type = 'route' AND r.id = c.target_id AND r.enabled = 1
          LEFT JOIN bootcamp_drills d ON c.target_type = 'drill' AND d.id = c.target_id AND d.enabled = 1
         WHERE c.starts_at <= UTC_TIMESTAMP() AND c.ends_at > UTC_TIMESTAMP()
           AND ((c.target_type = 'route' AND r.id IS NOT NULL) OR (c.target_type = 'drill' AND d.id IS NOT NULL))
         ORDER BY c.starts_at DESC, c.id DESC LIMIT 1
      `, []);
      const row = rows[0];
      if (!row) return res.json({ challenge: null, standings: [] });
      const challenge = { id: Number(row.id), weekStart: row.week_start, map: row.map,
        targetType: row.target_type, targetId: Number(row.target_id), title: row.title,
        startsAt: row.starts_at, endsAt: row.ends_at, targetName: row.target_name };
      const args = [challenge.targetId, row.starts_at, row.ends_at];
      const sql = challenge.targetType === "route" ? `
        SELECT steamid, player_name, class_id, time_ms AS result, run_id AS result_id FROM (
          SELECT b.steamid, b.player_name, b.class_id, b.time_ms, b.id AS run_id,
                 ROW_NUMBER() OVER (PARTITION BY b.steamid, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
            FROM bootcamp_runs b
            JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version AND r.enabled = 1
           WHERE b.route_id = ? AND b.created_at >= ? AND b.created_at < ? AND b.valid = 1 AND b.mode = 1
             AND b.finalization_required = 0 AND (b.flagged = 0 OR b.reviewed = 1)
        ) ranked WHERE player_rank = 1 ORDER BY result, result_id LIMIT 100
      ` : `
        SELECT steamid, player_name, class_id, score AS result, set_id AS result_id FROM (
          SELECT s.steamid, s.player_name, s.class_id, s.score, s.id AS set_id,
                 ROW_NUMBER() OVER (PARTITION BY s.steamid, s.class_id ORDER BY s.score DESC, s.id) AS player_rank
            FROM bootcamp_drill_sets s JOIN bootcamp_drills d ON d.id = s.drill_id AND d.map = s.map AND d.enabled = 1
           WHERE s.drill_id = ? AND s.created_at >= ? AND s.created_at < ? AND s.finalization_required = 0
             AND (s.recording_token IS NULL OR EXISTS (
               SELECT 1 FROM bootcamp_finalized_drill_sets f
               JOIN bootcamp_ghosts g ON g.id = s.ghost_id AND g.drill_set_id = s.id AND g.is_complete = 1
                    AND g.pos_frames >= 2 AND g.map = s.map AND g.steamid = s.steamid AND g.class_id = s.class_id
               WHERE f.drill_set_id = s.id AND EXISTS (
                 SELECT 1 FROM bootcamp_ghost_chunks c WHERE c.ghost_id = g.id AND c.track = 'pos' AND c.chunk_id = 0
               )
             ))
        ) ranked WHERE player_rank = 1 ORDER BY result DESC, result_id LIMIT 100
      `;
      const scores = await query(sql, args);
      return res.json({ challenge, standings: scores.map(score => ({ steamId: score.steamid,
        playerName: score.player_name, classId: Number(score.class_id),
        timeMs: challenge.targetType === "route" ? Number(score.result) : null,
        score: challenge.targetType === "drill" ? Number(score.result) : null, resultId: Number(score.result_id) })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/challenge/current]", error);
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
           WHERE s.drill_id = ? AND s.finalization_required = 0
             AND (s.recording_token IS NULL OR EXISTS (
               SELECT 1 FROM bootcamp_finalized_drill_sets f
               JOIN bootcamp_ghosts g ON g.id = s.ghost_id AND g.drill_set_id = s.id
                    AND g.is_complete = 1 AND g.pos_frames >= 2 AND g.map = s.map
                    AND g.steamid = s.steamid AND g.class_id = s.class_id
               WHERE f.drill_set_id = s.id AND EXISTS (
                 SELECT 1 FROM bootcamp_ghost_chunks c WHERE c.ghost_id = g.id AND c.track = 'pos' AND c.chunk_id = 0
               )
             ))
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
      const [licenses, runs, drillBests] = await Promise.all([
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
        `, [steamId]),
        query(`
          SELECT set_id, drill_id, map, slug, drill_name, kind, class_id, score, tier FROM (
            SELECT s.id AS set_id, d.id AS drill_id, d.map, d.slug, d.name AS drill_name, d.kind,
                   s.class_id, s.score, s.tier,
                   ROW_NUMBER() OVER (PARTITION BY s.drill_id, s.class_id ORDER BY s.score DESC, s.id) AS player_rank
              FROM bootcamp_drill_sets s
              JOIN bootcamp_drills d ON d.id = s.drill_id AND d.map = s.map
             WHERE s.steamid = ? AND s.finalization_required = 0
               AND (s.recording_token IS NULL OR EXISTS (
                 SELECT 1 FROM bootcamp_finalized_drill_sets f
                 JOIN bootcamp_ghosts g ON g.id = s.ghost_id AND g.drill_set_id = s.id
                      AND g.is_complete = 1 AND g.pos_frames >= 2 AND g.map = s.map
                      AND g.steamid = s.steamid AND g.class_id = s.class_id
                 WHERE f.drill_set_id = s.id AND EXISTS (
                   SELECT 1 FROM bootcamp_ghost_chunks c WHERE c.ghost_id = g.id AND c.track = 'pos' AND c.chunk_id = 0
                 )
               ))
          ) ranked WHERE player_rank = 1 ORDER BY map, drill_name, class_id LIMIT 500
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
      })), drillBests: drillBests.map(row => ({
        setId: Number(row.set_id), drillId: Number(row.drill_id), map: row.map, slug: row.slug,
        drillName: row.drill_name, kind: row.kind, classId: Number(row.class_id),
        score: Number(row.score), tier: Number(row.tier)
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
