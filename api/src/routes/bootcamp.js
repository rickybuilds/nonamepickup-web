"use strict";

const express = require("express");
const { createHash, timingSafeEqual } = require("node:crypto");
const { speedrunQuery, getSpeedrunPool } = require("../db/mariadb");
const { joinReplayChunks, parseReplayFrames } = require("../helpers/replay");
const { TRACKS, encodeBootcampTftr } = require("../helpers/bootcampTftr");
const { bootcampReplayCacheKey } = require("../services/bootcampReplayCache");
const { recomputeBootcampLicense } = require("../services/bootcampLicenseStore");

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

const BOOTCAMP_CLASSES = ["", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "HWGuy", "Pyro", "Spy", "Engineer", "Civilian"];
function bootcampClassName(value) {
  return BOOTCAMP_CLASSES[Number(value)] || "Any class";
}
function bootcampTimeDisplay(value) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  const seconds = ms / 1000;
  return seconds >= 60
    ? String(Math.floor(seconds / 60)) + ":" + (seconds % 60).toFixed(3).padStart(6, "0")
    : seconds.toFixed(3);
}
function bootcampRouteView(row) {
  const referenceTimeMs = row.reference_time_ms == null ? null : Number(row.reference_time_ms);
  return {
    id: Number(row.id), slug: row.slug, name: row.name, map: row.map, type: row.type,
    classId: Number(row.class_id), className: bootcampClassName(row.class_id),
    callout: row.callout || "", targetCrit: row.target_crit || "",
    configVersion: Number(row.config_version), referenceRunId: row.reference_run_id == null ? null : Number(row.reference_run_id),
    referenceTimeMs, referenceTimeDisplay: referenceTimeMs == null ? null : bootcampTimeDisplay(referenceTimeMs),
    tierPercents: {
      bronze: Number(row.tier_bronze_pct), silver: Number(row.tier_silver_pct),
      gold: Number(row.tier_gold_pct), platinum: Number(row.tier_plat_pct)
    },
    checkpoints: Number(row.checkpoints || 0),
    endKind: ["zone", "entity", "flag"][Number(row.end_kind)] || "zone"
  };
}
function bootcampDrillView(row) {
  return {
    id: Number(row.id), slug: row.slug, name: row.name, map: row.map,
    kind: row.kind, classId: Number(row.class_id), className: bootcampClassName(row.class_id),
    tierScores: {
      bronze: Number(row.tier_bronze), silver: Number(row.tier_silver),
      gold: Number(row.tier_gold), platinum: Number(row.tier_plat)
    },
    sets: Number(row.sets || 0), bestScore: row.best_score == null ? null : Number(row.best_score)
  };
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

function createBootcampRouter({ query = speedrunQuery, connectionFactory = () => getSpeedrunPool().getConnection(), sidecarCache = null, logRouteError = console.error, findDiscordIdBySteam = () => null, adminUser = process.env.BOOTCAMP_ADMIN_USER, adminPassword = process.env.BOOTCAMP_ADMIN_PASSWORD, discordServiceToken = process.env.BOOTCAMP_DISCORD_API_TOKEN } = {}) {
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

  function requireDiscordService(req, res, next) {
    if (!discordServiceToken) return res.status(503).json({ error: "bootcamp_service_not_configured" });
    const [scheme, supplied = ""] = String(req.get("authorization") || "").split(/\s+/, 2);
    const expected = Buffer.from(String(discordServiceToken));
    const actual = Buffer.from(scheme === "Bearer" ? supplied : "");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      return res.status(401).json({ error: "bootcamp_service_unauthorized" });
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
  router.get("/replay/run/:id/metadata", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_run_id" });
    try {
      const rows = await query(`
        /* bootcamp replay metadata */
        SELECT b.id AS run_id, g.id AS ghost_id, g.map, g.route_id, r.name AS route_name,
               g.class_id, g.player_name, g.steamid, b.time_ms, b.config_version,
               g.frame_interval, g.pos_frames AS frame_count
          FROM bootcamp_ghosts g
          JOIN bootcamp_runs b ON b.id = g.run_id AND b.ghost_id = g.id AND b.route_id = g.route_id
               AND b.map = g.map AND b.class_id = g.class_id
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version
         WHERE b.id = ? AND g.is_complete = 1 AND b.valid = 1 AND b.mode = 1
           AND (b.flagged = 0 OR b.reviewed = 1) AND b.finalization_required = 0
         LIMIT 1
      `, [Number(req.params.id)]);
      if (!rows.length) return res.status(404).json({ error: "replay_not_found" });
      const row = rows[0];
      res.set("Cache-Control", "no-store");
      return res.json({ source: "bootcamp", runId: Number(row.run_id), ghostId: Number(row.ghost_id),
        map: row.map, routeId: Number(row.route_id), routeName: row.route_name, classId: Number(row.class_id),
        playerName: row.player_name, steamid: row.steamid, timeMs: Number(row.time_ms),
        configVersion: Number(row.config_version), frameInterval: Number(row.frame_interval), frameCount: Number(row.frame_count) });
    } catch (error) {
      logRouteError("[/api/bootcamp/replay/run/:id/metadata]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/replay/run/:id/tftr", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_run_id" });
    try {
      // Match the same public route-run authority as the existing JSON replay
      // endpoint; pending reviews and stale route versions never get sidecars.
      const records = await query(`
        /* tftr sidecar */
        SELECT g.id, g.run_id, g.map, g.route_id, g.class_id, g.frame_interval,
               g.pos_frames, g.proj_frames, g.input_frames, g.cmd_frames, g.event_frames,
               g.spool_pos_sha, g.spool_proj_sha, g.spool_input_sha, g.spool_cmd_sha, g.spool_event_sha,
               g.tier_tag, g.is_complete, b.time_ms, b.config_version
          FROM bootcamp_ghosts g
          JOIN bootcamp_runs b ON b.id = g.run_id AND b.ghost_id = g.id AND b.route_id = g.route_id
               AND b.map = g.map AND b.class_id = g.class_id
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version
         WHERE b.id = ? AND g.is_complete = 1 AND b.valid = 1 AND b.mode = 1
           AND (b.flagged = 0 OR b.reviewed = 1) AND b.finalization_required = 0
         LIMIT 1
      `, [Number(req.params.id)]);
      if (!records.length) return res.status(404).json({ error: "replay_not_found" });
      const record = records[0];
      let sidecar;
      const cacheKey = bootcampReplayCacheKey(record);
      if (sidecarCache) {
        try {
          const cached = await sidecarCache.get(cacheKey);
          if (cached) sidecar = { data: cached, sha256: createHash("sha256").update(cached).digest("hex") };
        } catch (error) {
          logRouteError("[/api/bootcamp/replay/run/:id/tftr cache read]", error);
        }
      }
      if (!sidecar) {
        const chunkRows = await query(`
          SELECT track, chunk_id, data FROM bootcamp_ghost_chunks
           WHERE ghost_id = ? AND track IN ('pos', 'proj', 'input', 'cmd', 'event')
           ORDER BY FIELD(track, 'pos', 'proj', 'input', 'cmd', 'event'), chunk_id
           LIMIT 2560
        `, [Number(record.id)]);
        const tracks = Object.fromEntries(TRACKS.map(track => [track, []]));
        for (const row of chunkRows) {
          if (!Object.hasOwn(tracks, row.track)) return res.status(422).json({ error: "replay_invalid" });
          tracks[row.track].push(row);
        }
        try { sidecar = encodeBootcampTftr(record, tracks); }
        catch (error) {
          if (error.status === 422) return res.status(422).json({ error: "replay_invalid", reason: error.message });
          throw error;
        }
        if (sidecar.data && sidecarCache) {
          try { await sidecarCache.put(cacheKey, sidecar.data); }
          catch (error) { logRouteError("[/api/bootcamp/replay/run/:id/tftr cache write]", error); }
        }
      }
      if (!sidecar.data) return res.status(406).json({ error: "tftr_sidecar_unavailable", reason: sidecar.reason });
      res.set("Content-Type", "application/vnd.nn.ghost-sidecar");
      res.set("Content-Disposition", `attachment; filename="bootcamp-run-${Number(record.run_id)}.tftr"`);
      res.set("X-TFTR-Version", "1");
      res.set("X-TFTR-SHA256", sidecar.sha256);
      res.set("Cache-Control", "no-store");
      return res.status(200).send(sidecar.data);
    } catch (error) {
      logRouteError("[/api/bootcamp/replay/run/:id/tftr]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
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
  router.get("/leaderboards/skill-points", async (req, res) => {
    const period = req.query.period === undefined ? "all_time" : String(req.query.period);
    if (!["all_time", "monthly"].includes(period))
      return res.status(400).json({ error: "invalid_period" });

    let month = null, startsAt = null, endsAt = null;
    if (period === "monthly") {
      month = req.query.month === undefined
        ? new Date().toISOString().slice(0, 7)
        : String(req.query.month);
      const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
      if (!match || Number(match[1]) < 2000 || Number(match[1]) > 9998)
        return res.status(400).json({ error: "invalid_month" });
      const year = Number(match[1]), monthIndex = Number(match[2]) - 1;
      const start = new Date(0);
      start.setUTCFullYear(year, monthIndex, 1);
      start.setUTCHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setUTCMonth(end.getUTCMonth() + 1);
      const sqlDate = value => `${value.getUTCFullYear().toString().padStart(4, "0")}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")} 00:00:00`;
      startsAt = sqlDate(start);
      endsAt = sqlDate(end);
    }

    try {
      const rows = period === "all_time" ? await query(`
        SELECT t.steamid,
               COALESCE((SELECT e.player_name FROM bootcamp_events e WHERE e.steamid = t.steamid
                          ORDER BY e.created_at DESC, e.id DESC LIMIT 1), '') AS player_name,
               SUM(CASE t.tier WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 5 ELSE 0 END) AS points,
               COUNT(*) AS objectives
          FROM bootcamp_tiers t
         GROUP BY t.steamid
        HAVING points > 0
         ORDER BY points DESC, t.steamid ASC LIMIT 100
      `, []) : await query(`
        WITH tier_progress AS (
          SELECT e.id, e.steamid, e.player_name, e.target_type, e.target_id, e.map, e.class_id,
                 e.tier, e.created_at,
                 COALESCE(LAG(e.tier) OVER (
                   PARTITION BY e.steamid, e.target_type, e.target_id, e.map, e.class_id
                   ORDER BY e.created_at, e.id
                 ), 0) AS previous_tier
            FROM bootcamp_events e
           WHERE e.kind = 'tier_up' AND e.target_type IN ('route', 'drill')
        )
        SELECT totals.steamid,
               COALESCE((SELECT e.player_name FROM bootcamp_events e WHERE e.steamid = totals.steamid
                          ORDER BY e.created_at DESC, e.id DESC LIMIT 1), '') AS player_name,
               totals.points, totals.objectives
          FROM (
            SELECT steamid,
                   SUM((CASE tier WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 5 ELSE 0 END) -
                       (CASE previous_tier WHEN 1 THEN 1 WHEN 2 THEN 2 WHEN 3 THEN 3 WHEN 4 THEN 5 ELSE 0 END)) AS points,
                   COUNT(DISTINCT target_type, target_id, map, class_id) AS objectives
              FROM tier_progress
             WHERE created_at >= ? AND created_at < ? AND tier > previous_tier
             GROUP BY steamid
            HAVING points > 0
          ) totals
         ORDER BY totals.points DESC, totals.steamid ASC LIMIT 100
      `, [startsAt, endsAt]);
      return res.json({ period, month, startsAt, endsAt, scores: rows.map(row => ({
        steamId: row.steamid, playerName: row.player_name || "",
        points: Number(row.points), objectives: Number(row.objectives)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/leaderboards/skill-points]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/integrations/discord/events/cursor", requireDiscordService, async (_req, res) => {
    try {
      const rows = await query("SELECT COALESCE(MAX(id), 0) AS latest_id FROM bootcamp_events", []);
      return res.json({ latestId: Number(rows[0]?.latest_id || 0) });
    } catch (error) {
      logRouteError("[/api/bootcamp/integrations/discord/events/cursor]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/integrations/discord/events", requireDiscordService, async (req, res) => {
    const afterText = req.query.after_id === undefined ? "0" : String(req.query.after_id);
    const limitText = req.query.limit === undefined ? "100" : String(req.query.limit);
    if (!/^(?:0|[1-9]\d*)$/.test(afterText) || !Number.isSafeInteger(Number(afterText)) ||
        !/^(?:[1-9]\d?|1\d\d|200)$/.test(limitText))
      return res.status(400).json({ error: "invalid_event_cursor" });
    try {
      const rows = await query(`
        SELECT e.id, e.kind, e.steamid, e.player_name, e.target_type, e.target_id,
               COALESCE(r.name, d.name) AS target_name, COALESCE(r.map, d.map, e.map) AS map,
               e.class_id, e.tier, e.value_ms, e.created_at,
               (SELECT b.id FROM bootcamp_runs b
                 WHERE e.kind = 'record' AND b.steamid = e.steamid AND b.route_id = e.target_id
                   AND b.time_ms = e.value_ms AND b.valid = 1 AND b.mode = 1
                 ORDER BY b.id DESC LIMIT 1) AS replay_run_id
          FROM bootcamp_events e
          LEFT JOIN bootcamp_routes r ON e.target_type = 'route' AND r.id = e.target_id
          LEFT JOIN bootcamp_drills d ON e.target_type = 'drill' AND d.id = e.target_id
         WHERE e.id > ? ORDER BY e.id LIMIT ?
      `, [Number(afterText), Number(limitText)]);
      return res.json({ events: rows.map(row => ({
        id: Number(row.id), kind: row.kind, steamId: row.steamid, playerName: row.player_name || "",
        targetType: row.target_type || "", targetId: row.target_id == null ? null : Number(row.target_id),
        targetName: row.target_name || "", map: row.map || "", classId: row.class_id == null ? null : Number(row.class_id),
        tier: row.tier == null ? null : Number(row.tier), valueMs: row.value_ms == null ? null : Number(row.value_ms),
        replayRunId: row.replay_run_id == null ? null : Number(row.replay_run_id), createdAt: row.created_at
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/integrations/discord/events]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.post("/integrations/discord/licenses/recompute", requireDiscordService, async (req, res) => {
    if (!req.is("application/json") || !req.body || Object.keys(req.body).length !== 1 ||
        typeof req.body.steamId !== "string" || !/^STEAM_[0-5]:[01]:\d{1,20}$/.test(req.body.steamId))
      return res.status(400).json({ error: "invalid_license_request" });
    let connection;
    try {
      connection = await connectionFactory();
      const rules = (() => {
        try { return JSON.parse(process.env.BOOTCAMP_LICENSE_RULES || "{}"); }
        catch { return {}; }
      })();
      const result = await recomputeBootcampLicense(connection, req.body.steamId, rules);
      return res.json({ steamId: req.body.steamId, ...result });
    } catch (error) {
      logRouteError("[/api/bootcamp/integrations/discord/licenses/recompute]", error);
      return res.status(503).json({ error: "bootcamp_license_unavailable" });
    } finally {
      connection?.release();
    }
  });
  router.post("/integrations/discord/licenses/cosign", requireDiscordService, async (req, res) => {
    if (!req.is("application/json") || !req.body || Object.keys(req.body).length !== 2 ||
        typeof req.body.steamId !== "string" || !/^STEAM_[0-5]:[01]:\d{1,20}$/.test(req.body.steamId) ||
        typeof req.body.mentorDiscordId !== "string" || !/^\d{17,20}$/.test(req.body.mentorDiscordId))
      return res.status(400).json({ error: "invalid_license_cosign_request" });
    try {
      // The single-row upsert is atomic: the same mentor can retry safely,
      // while a different mentor cannot replace an existing attestation.
      await query(`
        INSERT INTO bootcamp_licenses (steamid, level, endorsements, cosigned_by)
        VALUES (?, 'none', '', ?)
        ON DUPLICATE KEY UPDATE cosigned_by = IF(
          cosigned_by IS NULL OR cosigned_by = VALUES(cosigned_by),
          VALUES(cosigned_by), cosigned_by
        )
      `, [req.body.steamId, req.body.mentorDiscordId]);
      const rows = await query("SELECT cosigned_by FROM bootcamp_licenses WHERE steamid = ? LIMIT 1", [req.body.steamId]);
      if (String(rows[0]?.cosigned_by || "") !== req.body.mentorDiscordId)
        return res.status(409).json({ error: "license_already_cosigned" });
      return res.json({ cosigned: true, steamId: req.body.steamId, mentorDiscordId: req.body.mentorDiscordId });
    } catch (error) {
      logRouteError("[/api/bootcamp/integrations/discord/licenses/cosign]", error);
      return res.status(503).json({ error: "bootcamp_license_cosign_unavailable" });
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
  router.get("/maps/:map", async (req, res) => {
    const map = req.params.map;
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(map))
      return res.status(400).json({ error: "invalid_map" });
    try {
      const [maps, routes, drills, points, records] = await Promise.all([
        query("SELECT m.map, m.config_version, m.in_rotation, m.rotation_order FROM bootcamp_maps m WHERE m.map = ? LIMIT 1", [map]),
        query(`
          SELECT r.id, r.slug, r.name, r.map, r.type, r.class_id, r.callout, r.target_crit, r.config_version,
                 CASE WHEN ref.run_id IS NULL THEN NULL ELSE r.reference_run_id END AS reference_run_id,
                 r.tier_bronze_pct, r.tier_silver_pct, r.tier_gold_pct, r.tier_plat_pct,
                 r.end_kind,
                 (SELECT COUNT(*) FROM bootcamp_runs b WHERE b.route_id = r.id AND b.config_version = r.config_version
                    AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
                    AND (b.flagged = 0 OR b.reviewed = 1)) AS runs,
                 (SELECT COUNT(DISTINCT b.steamid) FROM bootcamp_runs b WHERE b.route_id = r.id AND b.config_version = r.config_version
                    AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
                    AND (b.flagged = 0 OR b.reviewed = 1)) AS runners,
                 ref.time_ms AS reference_time_ms
            FROM bootcamp_routes r
            LEFT JOIN bootcamp_public_route_ghosts ref ON ref.run_id = r.reference_run_id AND ref.route_id = r.id
           WHERE r.map = ? AND r.enabled = 1 ORDER BY r.name, r.id LIMIT 100
        `, [map]),
        query(`
          SELECT d.id, d.slug, d.name, d.map, d.kind, d.class_id,
                 d.tier_bronze, d.tier_silver, d.tier_gold, d.tier_plat,
                 (SELECT COUNT(*) FROM bootcamp_drill_sets s WHERE s.drill_id = d.id AND s.finalization_required = 0
                    AND (s.recording_token IS NULL OR EXISTS (SELECT 1 FROM bootcamp_finalized_drill_sets f WHERE f.drill_set_id = s.id))) AS sets,
                 (SELECT MAX(s.score) FROM bootcamp_drill_sets s WHERE s.drill_id = d.id AND s.finalization_required = 0
                    AND (s.recording_token IS NULL OR EXISTS (SELECT 1 FROM bootcamp_finalized_drill_sets f WHERE f.drill_set_id = s.id))) AS best_score
            FROM bootcamp_drills d WHERE d.map = ? AND d.enabled = 1 ORDER BY d.name, d.id LIMIT 100
        `, [map]),
        query("SELECT kind, COUNT(*) AS n FROM bootcamp_points WHERE map = ? GROUP BY kind", [map]),
        query(`
          SELECT run_id, steamid, player_name, route_id, class_id, time_ms, has_replay FROM (
            SELECT b.id AS run_id, b.steamid, b.player_name, b.route_id, b.class_id, b.time_ms,
                   EXISTS(SELECT 1 FROM bootcamp_public_route_ghosts g WHERE g.run_id = b.id) AS has_replay,
                   ROW_NUMBER() OVER (PARTITION BY b.route_id, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
              FROM bootcamp_runs b
              JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version AND r.enabled = 1
             WHERE b.map = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
               AND (b.flagged = 0 OR b.reviewed = 1)
          ) current_runs WHERE player_rank = 1 ORDER BY time_ms, run_id LIMIT 500
        `, [map])
      ]);
      if (!maps.length) return res.status(404).json({ error: "map_not_found" });
      const recordByRoute = new Map();
      for (const row of records) {
        if (!recordByRoute.has(Number(row.route_id))) recordByRoute.set(Number(row.route_id), row);
      }
      const pointCounts = Object.fromEntries(points.map(row => [row.kind, Number(row.n)]));
      return res.json({
        map: maps[0].map, configVersion: Number(maps[0].config_version),
        inRotation: Number(maps[0].in_rotation) === 1, rotationOrder: Number(maps[0].rotation_order),
        points: pointCounts,
        routes: routes.map(row => {
          const route = bootcampRouteView(row);
          const record = recordByRoute.get(route.id);
          return { ...route, runs: Number(row.runs), runners: Number(row.runners), record: record ? {
            runId: Number(record.run_id), steamId: record.steamid, steamid: record.steamid,
            playerName: record.player_name || record.steamid, classId: Number(record.class_id),
            className: bootcampClassName(record.class_id), timeMs: Number(record.time_ms),
            timeDisplay: bootcampTimeDisplay(record.time_ms), hasReplay: Number(record.has_replay) === 1
          } : null };
        }),
        drills: drills.map(row => bootcampDrillView(row))
      });
    } catch (error) {
      logRouteError("[/api/bootcamp/maps/:map]", error);
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
  router.get("/routes/:id", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_route_id" });
    const routeId = Number(req.params.id);
    try {
      const routes = await query(`
        SELECT r.id, r.slug, r.name, r.map, r.type, r.class_id, r.callout, r.target_crit, r.config_version,
               CASE WHEN ref.run_id IS NULL THEN NULL ELSE r.reference_run_id END AS reference_run_id,
               ref.time_ms AS reference_time_ms, r.tier_bronze_pct, r.tier_silver_pct, r.tier_gold_pct,
               r.tier_plat_pct, r.end_kind
          FROM bootcamp_routes r
          LEFT JOIN bootcamp_public_route_ghosts ref ON ref.run_id = r.reference_run_id AND ref.route_id = r.id
         WHERE r.id = ? AND r.enabled = 1 LIMIT 1
      `, [routeId]);
      if (!routes.length) return res.status(404).json({ error: "route_not_found" });
      const route = routes[0];
      const [checkpoints, board, recent, legacy] = await Promise.all([
        query("SELECT idx FROM bootcamp_route_checkpoints WHERE route_id = ? ORDER BY idx LIMIT 32", [routeId]),
        query(`
          SELECT run_id, steamid, player_name, class_id, time_ms, tier, has_replay, flagged, reviewed, created_at FROM (
            SELECT b.id AS run_id, b.steamid, b.player_name, b.class_id, b.time_ms, b.tier,
                   EXISTS(SELECT 1 FROM bootcamp_public_route_ghosts g WHERE g.run_id = b.id) AS has_replay,
                   b.flagged, b.reviewed, b.created_at,
                   ROW_NUMBER() OVER (PARTITION BY b.steamid, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
              FROM bootcamp_runs b
              JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map AND r.config_version = b.config_version AND r.enabled = 1
             WHERE b.route_id = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
               AND (b.flagged = 0 OR b.reviewed = 1)
          ) published WHERE player_rank = 1 ORDER BY time_ms, run_id LIMIT 100
        `, [routeId]),
        query(`
          SELECT b.id AS run_id, b.steamid, b.player_name, b.class_id, b.mode, b.time_ms, b.valid,
                 b.invalid_reason, b.tier, EXISTS(SELECT 1 FROM bootcamp_public_route_ghosts g WHERE g.run_id = b.id) AS has_replay,
                 b.created_at
            FROM bootcamp_runs b JOIN bootcamp_routes r ON r.id = b.route_id AND r.map = b.map
             AND r.config_version = b.config_version AND r.enabled = 1
           WHERE b.route_id = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
             AND (b.flagged = 0 OR b.reviewed = 1)
           ORDER BY b.id DESC LIMIT 25
        `, [routeId]),
        query(`SELECT COUNT(*) AS legacy_run_count FROM bootcamp_runs b
                WHERE b.route_id = ? AND b.config_version < ? AND b.valid = 1 AND b.mode = 1
                  AND b.finalization_required = 0 AND (b.flagged = 0 OR b.reviewed = 1)`, [routeId, Number(route.config_version)])
      ]);
      const leaderboard = board.map((row, index) => ({
        rank: index + 1, runId: Number(row.run_id), steamid: row.steamid, steamId: row.steamid,
        playerName: row.player_name || row.steamid, classId: Number(row.class_id), className: bootcampClassName(row.class_id),
        timeMs: Number(row.time_ms), timeDisplay: bootcampTimeDisplay(row.time_ms), tier: Number(row.tier),
        hasReplay: Number(row.has_replay) === 1, pendingReview: Number(row.flagged) === 1 && Number(row.reviewed) !== 1,
        createdAt: row.created_at
      }));
      return res.json({ route: { ...bootcampRouteView(route), checkpoints: checkpoints.length },
        leaderboard, recentRuns: recent.map(row => ({
          runId: Number(row.run_id), steamid: row.steamid, steamId: row.steamid,
          playerName: row.player_name || row.steamid, classId: Number(row.class_id), className: bootcampClassName(row.class_id),
          mode: "ranked", timeMs: Number(row.time_ms), timeDisplay: bootcampTimeDisplay(row.time_ms),
          valid: true, invalidReason: null, tier: Number(row.tier), hasReplay: Number(row.has_replay) === 1,
          createdAt: row.created_at
        })), legacyRuns: Number(legacy[0]?.legacy_run_count || 0) });
    } catch (error) {
      logRouteError("[/api/bootcamp/routes/:id]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/players/:steamId", async (req, res) => {
    const steamId = req.params.steamId;
    if (!/^STEAM_[0-5]:[01]:\d{1,20}$/.test(steamId))
      return res.status(400).json({ error: "invalid_steam_id" });
    try {
      const [licenses, runs, drillBests] = await Promise.all([
        query("SELECT level, endorsements, granted_at, cosigned_by FROM bootcamp_licenses WHERE steamid = ? LIMIT 1", [steamId]),
        query(`
          SELECT run_id, route_id, map, slug, route_name, player_name, class_id, time_ms, tier, has_replay
            FROM (
              SELECT b.id AS run_id, r.id AS route_id, r.map, r.slug, r.name AS route_name,
                     b.player_name, b.class_id, b.time_ms, b.tier,
                     EXISTS(SELECT 1 FROM bootcamp_public_route_ghosts g WHERE g.run_id = b.id) AS has_replay,
                     ROW_NUMBER() OVER (PARTITION BY b.route_id, b.class_id ORDER BY b.time_ms, b.id) AS player_rank
                FROM bootcamp_runs b
                JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
               WHERE b.steamid = ? AND b.valid = 1 AND b.mode = 1 AND b.finalization_required = 0
                 AND (b.flagged = 0 OR b.reviewed = 1)
            ) ranked WHERE player_rank = 1 ORDER BY map, route_name, class_id LIMIT 500
        `, [steamId]),
        query(`
          SELECT set_id, player_name, drill_id, map, slug, drill_name, kind, class_id, score, tier FROM (
            SELECT s.id AS set_id, d.id AS drill_id, d.map, d.slug, d.name AS drill_name, d.kind,
                   s.player_name, s.class_id, s.score, s.tier,
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
      const playerName = runs[0]?.player_name || drillBests[0]?.player_name || steamId;
      let discordId = null;
      if (typeof findDiscordIdBySteam === "function") {
        try {
          discordId = findDiscordIdBySteam(steamId) || null;
        } catch (error) {
          // Keep Bootcamp profiles available if the optional shared identity lookup fails.
          logRouteError("[/api/bootcamp/players/:steamId identity]", error);
        }
      }
      return res.json({ steamId, playerName, player: { playerName, steamIds: [steamId], discordId }, license: license ? {
        level: license.level, endorsements: String(license.endorsements || "").split(",").map(value => value.trim()).filter(Boolean),
        grantedAt: license.granted_at, cosignedBy: license.cosigned_by || null
      } : null, personalBests: runs.map(row => ({
        runId: Number(row.run_id), routeId: Number(row.route_id), playerName: row.player_name || steamId, map: row.map,
        slug: row.slug, routeName: row.route_name, classId: Number(row.class_id),
        timeMs: Number(row.time_ms), timeDisplay: bootcampTimeDisplay(row.time_ms),
        hasReplay: Number(row.has_replay) === 1, tier: Number(row.tier)
      })), drillBests: drillBests.map(row => ({
        setId: Number(row.set_id), drillId: Number(row.drill_id), playerName: row.player_name || steamId, map: row.map, slug: row.slug,
        drillName: row.drill_name, kind: row.kind, classId: Number(row.class_id),
        score: Number(row.score), tier: Number(row.tier)
      })) });
    } catch (error) {
      logRouteError("[/api/bootcamp/players/:steamId]", error);
      return res.status(503).json({ error: "bootcamp_database_unavailable" });
    }
  });
  router.get("/drills/:id", async (req, res) => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id)))
      return res.status(400).json({ error: "invalid_drill_id" });
    const drillId = Number(req.params.id);
    try {
      const drills = await query(`
        SELECT d.id, d.slug, d.name, d.map, d.kind, d.class_id, d.tier_bronze, d.tier_silver,
               d.tier_gold, d.tier_plat
          FROM bootcamp_drills d WHERE d.id = ? AND d.enabled = 1 LIMIT 1
      `, [drillId]);
      if (!drills.length) return res.status(404).json({ error: "drill_not_found" });
      const rows = await query(`
        SELECT set_id, steamid, player_name, class_id, score, tier, ghost_id, details_json, created_at FROM (
          SELECT s.id AS set_id, s.steamid, s.player_name, s.class_id, s.score, s.tier, s.ghost_id,
                 s.details_json, s.created_at,
                 ROW_NUMBER() OVER (PARTITION BY s.steamid, s.class_id ORDER BY s.score DESC, s.id) AS player_rank
            FROM bootcamp_drill_sets s
            JOIN bootcamp_drills d ON d.id = s.drill_id AND d.map = s.map AND d.enabled = 1
           WHERE s.drill_id = ? AND s.finalization_required = 0
             AND (s.recording_token IS NULL OR EXISTS (
               SELECT 1 FROM bootcamp_finalized_drill_sets f
               JOIN bootcamp_ghosts g ON g.id = s.ghost_id AND g.drill_set_id = s.id AND g.is_complete = 1
                    AND g.pos_frames >= 2 AND g.map = s.map AND g.steamid = s.steamid AND g.class_id = s.class_id
               WHERE f.drill_set_id = s.id AND EXISTS (
                 SELECT 1 FROM bootcamp_ghost_chunks c WHERE c.ghost_id = g.id AND c.track = 'pos' AND c.chunk_id = 0
               )
             ))
        ) published WHERE player_rank = 1 ORDER BY score DESC, set_id LIMIT 100
      `, [drillId]);
      const leaderboard = rows.map((row, index) => {
        let details = null;
        try { details = row.details_json ? JSON.parse(row.details_json) : null; } catch { /* malformed legacy details are omitted */ }
        return { rank: index + 1, setId: Number(row.set_id), steamid: row.steamid, steamId: row.steamid,
          playerName: row.player_name || row.steamid, classId: Number(row.class_id),
          className: bootcampClassName(row.class_id), score: Number(row.score), tier: Number(row.tier),
          ghostId: row.ghost_id == null ? null : Number(row.ghost_id), details, createdAt: row.created_at };
      });
      return res.json({ drill: bootcampDrillView(drills[0]), leaderboard });
    } catch (error) {
      logRouteError("[/api/bootcamp/drills/:id]", error);
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
