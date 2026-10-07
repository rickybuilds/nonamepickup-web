"use strict";

// Noname TFC Bootcamp API.
//
// Reads the bootcamp_* tables the Bootcamp plugin writes in the speedrun
// MariaDB. Replays use the same chunked text format as speedrun ghosts, so the
// replay payload has the speedrun viewer's shape plus Bootcamp's event track.

const express = require("express");
const { speedrunQuery, checkSpeedrunDatabase } = require("../db/mariadb");
const { createHealthHandler } = require("../helpers/health");
const { cleanString: cleanText } = require("../helpers/values");
const {
  joinReplayChunks,
  parseReplayFrames,
  parseProjectileFrames,
  inferFrameInterval
} = require("../helpers/replay");
const { replayTimingWindow, summarizeProjectileUsage } = require("../helpers/projectile-usage");
const { CLASS_NAMES, formatTimeMs } = require("../speedruns/domain");

const MAX_MAP_NAME_LENGTH = 64;
const MAX_ID_LENGTH = 35;
const TIER_NAMES = ["None", "Bronze", "Silver", "Gold", "Platinum"];
const LEVELS = ["none", "permit", "licensed", "platinum"];
const LEVEL_LABELS = {
  none: "No license",
  permit: "Learner's permit",
  licensed: "TFC license",
  platinum: "Platinum license"
};
const EVENT_NAMES = {
  1: "jump",
  2: "conc_prime",
  3: "conc_throw",
  4: "conc_explode",
  5: "fire",
  6: "detpipe",
  7: "flag",
  8: "checkpoint",
  9: "finish",
  10: "weapon"
};

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function idParam(value) {
  const text = String(value || "");
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function className(classId) {
  return CLASS_NAMES[Number(classId)] || (Number(classId) ? `Class ${classId}` : "Any class");
}

function tierName(tier) {
  return TIER_NAMES[Number(tier)] || "None";
}

function isoDate(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function levelRank(level) {
  return Math.max(0, LEVELS.indexOf(level));
}

function endorsementList(text) {
  return String(text || "").split(",").map(s => s.trim()).filter(Boolean);
}

function mapRoute(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    map: row.map,
    type: row.type,
    classId: Number(row.class_id) || 0,
    className: className(row.class_id),
    targetCrit: row.target_crit || null,
    callout: row.callout || null,
    configVersion: Number(row.config_version) || 1,
    referenceRunId: num(row.reference_run_id),
    referenceTimeMs: num(row.reference_time_ms),
    referenceTimeDisplay: row.reference_time_ms ? formatTimeMs(row.reference_time_ms) : null,
    tierPercents: {
      bronze: num(row.tier_bronze_pct),
      silver: num(row.tier_silver_pct),
      gold: num(row.tier_gold_pct),
      platinum: num(row.tier_plat_pct)
    }
  };
}

function mapDrill(row) {
  return {
    id: Number(row.id),
    slug: row.slug,
    name: row.name,
    map: row.map,
    kind: row.kind,
    classId: Number(row.class_id) || 0,
    className: className(row.class_id),
    tierScores: {
      bronze: num(row.tier_bronze),
      silver: num(row.tier_silver),
      gold: num(row.tier_gold),
      platinum: num(row.tier_plat)
    }
  };
}

// Zones in the speedrun viewer's format, from a route's start/end/checkpoints.
function routeZones(route, checkpoints) {
  if (!route) return null;
  const point = (x, y, z) => ({ x: Number(x), y: Number(y), z: Number(z) });
  const startRadius = num(route.start_radius, 48);
  const startHeight = num(route.start_height, 72);
  const endIsZone = Number(route.end_kind) === 0;
  return {
    defaults: {
      radius: startRadius,
      height: startHeight,
      checkpointRadius: startRadius,
      checkpointHeight: startHeight
    },
    start: { position: point(route.start_x, route.start_y, route.start_z), radius: startRadius, height: startHeight },
    finish: {
      position: point(route.end_x, route.end_y, route.end_z),
      radius: endIsZone ? num(route.end_radius, 48) : 24,
      height: endIsZone ? num(route.end_height, 72) : 48
    },
    checkpoints: (checkpoints || []).map((cp, i) => ({
      checkpointNumber: i + 1,
      axis: 0,
      yaw: 0,
      position: point(cp.x, cp.y, cp.z),
      radius: num(cp.radius, startRadius),
      height: num(cp.height, startHeight)
    }))
  };
}

function parseEventTrack(serialized) {
  return String(serialized || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const [t, code, a, b] = part.split(",").map(Number);
      if (!Number.isFinite(t) || !Number.isFinite(code)) return null;
      return { t, code, name: EVENT_NAMES[code] || `event_${code}`, a: num(a, 0), b: num(b, 0) };
    })
    .filter(Boolean)
    .sort((x, y) => x.t - y.t);
}

// Steam IDs for a player id: a Steam ID (plus anything linked to the same
// Discord account) or a Discord id.
async function resolveSteamIds(id) {
  if (/^STEAM_/i.test(id)) {
    const rows = await speedrunQuery(
      `SELECT l2.steamid, l2.discord_id
         FROM speedrun_player_links l1
         JOIN speedrun_player_links l2 ON l2.discord_id = l1.discord_id
        WHERE l1.steamid = ?`, [id]
    ).catch(() => []);
    const steamIds = new Set([id, ...rows.map(r => r.steamid)]);
    return { steamIds: [...steamIds], discordId: rows[0]?.discord_id || null };
  }
  if (/^\d{15,22}$/.test(id)) {
    const rows = await speedrunQuery("SELECT steamid FROM speedrun_player_links WHERE discord_id = ?", [id]).catch(() => []);
    return { steamIds: rows.map(r => r.steamid), discordId: id };
  }
  return { steamIds: [], discordId: null };
}

function placeholders(list) {
  return list.map(() => "?").join(",");
}

function createBootcampRouter({ logRouteError }) {
  const router = express.Router();

  function unavailable(res) {
    return res.status(503).json({ error: "Bootcamp data unavailable" });
  }

  function badRequest(res, error) {
    return res.status(400).json({ ok: false, error });
  }

  async function runEndpoint(req, res, label, handler) {
    try {
      await handler(req, res);
    } catch (error) {
      logRouteError(label, error);
      unavailable(res);
    }
  }

  router.get("/health", createHealthHandler({
    label: "[/api/bootcamp/health]",
    check: async () => {
      await checkSpeedrunDatabase();
      await speedrunQuery("SELECT 1 FROM bootcamp_maps LIMIT 1");
    },
    payload: () => ({ database: process.env.SPEEDRUN_DB_NAME || "speedrun" }),
    onError: (error, req, res) => {
      logRouteError("[/api/bootcamp/health]", error);
      unavailable(res);
    }
  }));

  /* -------------------------------------------------------------------------
     Summary
     ------------------------------------------------------------------------- */
  router.get("/summary", (req, res) => runEndpoint(req, res, "[/api/bootcamp/summary]", async () => {
    const [counts, maps, records, tierUps, licenses, licenseCounts, challenge] = await Promise.all([
      speedrunQuery(`
        SELECT
          (SELECT COUNT(*) FROM bootcamp_maps) AS maps,
          (SELECT COUNT(*) FROM bootcamp_maps WHERE in_rotation = 1) AS rotation_maps,
          (SELECT COUNT(*) FROM bootcamp_routes WHERE enabled = 1) AS routes,
          (SELECT COUNT(*) FROM bootcamp_runs WHERE valid = 1 AND mode = 1) AS runs,
          (SELECT COUNT(DISTINCT steamid) FROM bootcamp_runs) AS runners,
          (SELECT COUNT(*) FROM bootcamp_drill_sets) AS drill_sets,
          (SELECT COUNT(*) FROM bootcamp_lessons) AS lessons
      `),
      speedrunQuery(`
        SELECT m.map, m.in_rotation, m.rotation_order,
               (SELECT COUNT(*) FROM bootcamp_routes r WHERE r.map = m.map AND r.enabled = 1) AS routes,
               (SELECT COUNT(*) FROM bootcamp_points p WHERE p.map = m.map) AS points,
               (SELECT COUNT(*) FROM bootcamp_runs b WHERE b.map = m.map AND b.valid = 1 AND b.mode = 1) AS runs
          FROM bootcamp_maps m
         ORDER BY m.in_rotation DESC, m.rotation_order ASC, m.map ASC
      `),
      speedrunQuery(`
        SELECT e.id, e.steamid, e.player_name, e.map, e.target_id, e.value_ms, e.created_at,
               r.name AS route_name, l.discord_id,
               (SELECT b.id FROM bootcamp_runs b WHERE b.route_id = e.target_id AND b.steamid = e.steamid AND b.time_ms = e.value_ms ORDER BY b.id DESC LIMIT 1) AS run_id
          FROM bootcamp_events e
          LEFT JOIN bootcamp_routes r ON r.id = e.target_id
          LEFT JOIN speedrun_player_links l ON l.steamid = e.steamid
         WHERE e.kind = 'record'
         ORDER BY e.id DESC LIMIT 10
      `),
      speedrunQuery(`
        SELECT e.id, e.steamid, e.player_name, e.map, e.target_type, e.target_id, e.tier, e.created_at,
               COALESCE(r.name, d.name) AS target_name
          FROM bootcamp_events e
          LEFT JOIN bootcamp_routes r ON e.target_type = 'route' AND r.id = e.target_id
          LEFT JOIN bootcamp_drills d ON e.target_type = 'drill' AND d.id = e.target_id
         WHERE e.kind = 'tier_up' AND e.tier >= 3
         ORDER BY e.id DESC LIMIT 10
      `),
      speedrunQuery(`
        SELECT e.id, e.steamid, e.player_name, e.target_type AS level, e.created_at
          FROM bootcamp_events e
         WHERE e.kind = 'license'
         ORDER BY e.id DESC LIMIT 10
      `),
      speedrunQuery("SELECT level, COUNT(*) AS n FROM bootcamp_licenses GROUP BY level"),
      speedrunQuery(`
        SELECT c.id, c.title, c.target_type, c.target_id, c.starts_at, c.ends_at,
               COALESCE(r.name, d.name) AS target_name, COALESCE(r.map, d.map) AS map
          FROM bootcamp_challenges c
          LEFT JOIN bootcamp_routes r ON c.target_type = 'route' AND r.id = c.target_id
          LEFT JOIN bootcamp_drills d ON c.target_type = 'drill' AND d.id = c.target_id
         WHERE NOW() BETWEEN c.starts_at AND c.ends_at
         ORDER BY c.starts_at DESC LIMIT 1
      `)
    ]);

    const c = counts[0] || {};
    const byLevel = Object.fromEntries(licenseCounts.map(row => [row.level, Number(row.n)]));
    res.json({
      maps: Number(c.maps || 0),
      rotationMaps: Number(c.rotation_maps || 0),
      routes: Number(c.routes || 0),
      runs: Number(c.runs || 0),
      runners: Number(c.runners || 0),
      drillSets: Number(c.drill_sets || 0),
      lessons: Number(c.lessons || 0),
      licenses: {
        permit: byLevel.permit || 0,
        licensed: byLevel.licensed || 0,
        platinum: byLevel.platinum || 0
      },
      mapList: maps.map(row => ({
        map: row.map,
        inRotation: Boolean(row.in_rotation),
        rotationOrder: Number(row.rotation_order || 0),
        routes: Number(row.routes || 0),
        points: Number(row.points || 0),
        runs: Number(row.runs || 0)
      })),
      recentRecords: records.map(row => ({
        steamid: row.steamid,
        discordId: row.discord_id || null,
        playerName: row.player_name || row.steamid,
        map: row.map,
        routeId: Number(row.target_id),
        routeName: row.route_name || `Route ${row.target_id}`,
        timeMs: Number(row.value_ms),
        timeDisplay: formatTimeMs(row.value_ms),
        runId: num(row.run_id),
        createdAt: isoDate(row.created_at)
      })),
      recentTierUps: tierUps.map(row => ({
        steamid: row.steamid,
        playerName: row.player_name || row.steamid,
        map: row.map,
        targetType: row.target_type,
        targetId: Number(row.target_id),
        targetName: row.target_name || `${row.target_type} ${row.target_id}`,
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        createdAt: isoDate(row.created_at)
      })),
      recentLicenses: licenses.map(row => ({
        steamid: row.steamid,
        playerName: row.player_name || row.steamid,
        level: row.level,
        levelLabel: LEVEL_LABELS[row.level] || row.level,
        createdAt: isoDate(row.created_at)
      })),
      challenge: challenge[0] ? {
        id: Number(challenge[0].id),
        title: challenge[0].title,
        targetType: challenge[0].target_type,
        targetId: Number(challenge[0].target_id),
        targetName: challenge[0].target_name,
        map: challenge[0].map,
        startsAt: isoDate(challenge[0].starts_at),
        endsAt: isoDate(challenge[0].ends_at)
      } : null
    });
  }));

  /* -------------------------------------------------------------------------
     Map
     ------------------------------------------------------------------------- */
  router.get("/maps/:map", (req, res) => runEndpoint(req, res, "[/api/bootcamp/maps/:map]", async () => {
    const map = cleanText(req.params.map, MAX_MAP_NAME_LENGTH);
    if (!map) return badRequest(res, "invalid_map");

    const [mapRows, routes, drills, points, records] = await Promise.all([
      speedrunQuery("SELECT map, config_version, in_rotation, rotation_order FROM bootcamp_maps WHERE map = ?", [map]),
      speedrunQuery(`
        SELECT r.*, ref.time_ms AS reference_time_ms,
               (SELECT COUNT(*) FROM bootcamp_runs b WHERE b.route_id = r.id AND b.valid = 1 AND b.mode = 1 AND b.config_version = r.config_version) AS runs,
               (SELECT COUNT(DISTINCT b.steamid) FROM bootcamp_runs b WHERE b.route_id = r.id AND b.config_version = r.config_version) AS runners
          FROM bootcamp_routes r
          LEFT JOIN bootcamp_runs ref ON ref.id = r.reference_run_id
         WHERE r.map = ? AND r.enabled = 1
         ORDER BY r.id
      `, [map]),
      speedrunQuery(`
        SELECT d.*,
               (SELECT COUNT(*) FROM bootcamp_drill_sets s WHERE s.drill_id = d.id) AS sets,
               (SELECT MAX(s.score) FROM bootcamp_drill_sets s WHERE s.drill_id = d.id) AS best_score
          FROM bootcamp_drills d
         WHERE d.map = ? AND d.enabled = 1
         ORDER BY d.id
      `, [map]),
      speedrunQuery("SELECT kind, COUNT(*) AS n FROM bootcamp_points WHERE map = ? GROUP BY kind", [map]),
      speedrunQuery(`
        SELECT b.route_id, b.id AS run_id, b.steamid, b.player_name, b.class_id, b.time_ms
          FROM bootcamp_runs b
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
          JOIN (
            SELECT b2.route_id, MIN(b2.time_ms) AS best
              FROM bootcamp_runs b2
              JOIN bootcamp_routes r2 ON r2.id = b2.route_id AND r2.config_version = b2.config_version
             WHERE b2.map = ? AND b2.valid = 1 AND b2.mode = 1
             GROUP BY b2.route_id
          ) best ON best.route_id = b.route_id AND best.best = b.time_ms
         WHERE b.map = ? AND b.valid = 1 AND b.mode = 1
         ORDER BY b.id ASC
      `, [map, map])
    ]);

    if (!mapRows.length) return res.status(404).json({ ok: false, error: "map_not_found" });
    const recordByRoute = new Map();
    for (const row of records)
      if (!recordByRoute.has(Number(row.route_id))) recordByRoute.set(Number(row.route_id), row);

    res.json({
      map,
      configVersion: Number(mapRows[0].config_version || 1),
      inRotation: Boolean(mapRows[0].in_rotation),
      rotationOrder: Number(mapRows[0].rotation_order || 0),
      points: Object.fromEntries(points.map(row => [row.kind, Number(row.n)])),
      routes: routes.map(row => {
        const rec = recordByRoute.get(Number(row.id));
        return {
          ...mapRoute(row),
          runs: Number(row.runs || 0),
          runners: Number(row.runners || 0),
          record: rec ? {
            runId: Number(rec.run_id),
            steamid: rec.steamid,
            playerName: rec.player_name || rec.steamid,
            classId: Number(rec.class_id),
            className: className(rec.class_id),
            timeMs: Number(rec.time_ms),
            timeDisplay: formatTimeMs(rec.time_ms)
          } : null
        };
      }),
      drills: drills.map(row => ({
        ...mapDrill(row),
        sets: Number(row.sets || 0),
        bestScore: num(row.best_score)
      }))
    });
  }));

  /* -------------------------------------------------------------------------
     Route
     ------------------------------------------------------------------------- */
  router.get("/routes/:id", (req, res) => runEndpoint(req, res, "[/api/bootcamp/routes/:id]", async () => {
    const id = idParam(req.params.id);
    if (!id) return badRequest(res, "invalid_route_id");

    const routeRows = await speedrunQuery(`
      SELECT r.*, ref.time_ms AS reference_time_ms
        FROM bootcamp_routes r
        LEFT JOIN bootcamp_runs ref ON ref.id = r.reference_run_id
       WHERE r.id = ?
    `, [id]);
    if (!routeRows.length) return res.status(404).json({ ok: false, error: "route_not_found" });
    const route = routeRows[0];

    const [checkpoints, board, recent, legacy] = await Promise.all([
      speedrunQuery("SELECT idx, x, y, z, radius, height FROM bootcamp_route_checkpoints WHERE route_id = ? ORDER BY idx", [id]),
      // Best current-version ranked run per player and class.
      speedrunQuery(`
        SELECT b.id, b.steamid, b.player_name, b.class_id, b.time_ms, b.tier, b.ghost_id, b.flagged, b.reviewed, b.created_at, l.discord_id
          FROM bootcamp_runs b
          JOIN (
            SELECT steamid, class_id, MIN(time_ms) AS best
              FROM bootcamp_runs
             WHERE route_id = ? AND valid = 1 AND mode = 1 AND config_version = ?
             GROUP BY steamid, class_id
          ) best ON best.steamid = b.steamid AND best.class_id = b.class_id AND best.best = b.time_ms
          LEFT JOIN speedrun_player_links l ON l.steamid = b.steamid
         WHERE b.route_id = ? AND b.valid = 1 AND b.mode = 1 AND b.config_version = ?
         ORDER BY b.time_ms ASC, b.id ASC
         LIMIT 100
      `, [id, route.config_version, id, route.config_version]),
      speedrunQuery(`
        SELECT b.id, b.steamid, b.player_name, b.class_id, b.mode, b.time_ms, b.valid, b.invalid_reason, b.tier, b.ghost_id, b.created_at
          FROM bootcamp_runs b
         WHERE b.route_id = ? AND b.config_version = ?
         ORDER BY b.id DESC
         LIMIT 25
      `, [id, route.config_version]),
      speedrunQuery("SELECT COUNT(*) AS n FROM bootcamp_runs WHERE route_id = ? AND config_version < ?", [id, route.config_version])
    ]);

    // One row per player (their best class), ranked.
    const seen = new Set();
    const leaderboard = [];
    for (const row of board) {
      const key = `${row.steamid}:${row.class_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      leaderboard.push({
        rank: leaderboard.length + 1,
        runId: Number(row.id),
        steamid: row.steamid,
        discordId: row.discord_id || null,
        playerName: row.player_name || row.steamid,
        classId: Number(row.class_id),
        className: className(row.class_id),
        timeMs: Number(row.time_ms),
        timeDisplay: formatTimeMs(row.time_ms),
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        hasReplay: Boolean(row.ghost_id),
        pendingReview: Boolean(row.flagged) && !row.reviewed,
        createdAt: isoDate(row.created_at)
      });
    }

    res.json({
      route: { ...mapRoute(route), checkpoints: checkpoints.length, endKind: ["zone", "entity", "flag"][Number(route.end_kind)] || "zone" },
      zones: routeZones(route, checkpoints),
      leaderboard,
      recentRuns: recent.map(row => ({
        runId: Number(row.id),
        steamid: row.steamid,
        playerName: row.player_name || row.steamid,
        classId: Number(row.class_id),
        className: className(row.class_id),
        mode: Number(row.mode) === 1 ? "ranked" : "practice",
        timeMs: Number(row.time_ms),
        timeDisplay: formatTimeMs(row.time_ms),
        valid: Boolean(row.valid),
        invalidReason: row.invalid_reason || null,
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        hasReplay: Boolean(row.ghost_id),
        createdAt: isoDate(row.created_at)
      })),
      legacyRuns: Number(legacy[0]?.n || 0)
    });
  }));

  /* -------------------------------------------------------------------------
     Drill
     ------------------------------------------------------------------------- */
  router.get("/drills/:id", (req, res) => runEndpoint(req, res, "[/api/bootcamp/drills/:id]", async () => {
    const id = idParam(req.params.id);
    if (!id) return badRequest(res, "invalid_drill_id");
    const drills = await speedrunQuery("SELECT * FROM bootcamp_drills WHERE id = ?", [id]);
    if (!drills.length) return res.status(404).json({ ok: false, error: "drill_not_found" });

    const rows = await speedrunQuery(`
      SELECT s.id, s.steamid, s.player_name, s.class_id, s.score, s.tier, s.ghost_id, s.details_json, s.created_at, l.discord_id
        FROM bootcamp_drill_sets s
        JOIN (
          SELECT steamid, MAX(score) AS best FROM bootcamp_drill_sets WHERE drill_id = ? GROUP BY steamid
        ) best ON best.steamid = s.steamid AND best.best = s.score
        LEFT JOIN speedrun_player_links l ON l.steamid = s.steamid
       WHERE s.drill_id = ?
       ORDER BY s.score DESC, s.id ASC
       LIMIT 100
    `, [id, id]);

    const seen = new Set();
    const leaderboard = [];
    for (const row of rows) {
      if (seen.has(row.steamid)) continue;
      seen.add(row.steamid);
      let details = null;
      try { details = row.details_json ? JSON.parse(row.details_json) : null; } catch { details = null; }
      leaderboard.push({
        rank: leaderboard.length + 1,
        setId: Number(row.id),
        steamid: row.steamid,
        discordId: row.discord_id || null,
        playerName: row.player_name || row.steamid,
        classId: Number(row.class_id),
        className: className(row.class_id),
        score: num(row.score, 0),
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        ghostId: num(row.ghost_id),
        details,
        createdAt: isoDate(row.created_at)
      });
    }
    res.json({ drill: mapDrill(drills[0]), leaderboard });
  }));

  /* -------------------------------------------------------------------------
     Player (license card)
     ------------------------------------------------------------------------- */
  router.get("/players/:id", (req, res) => runEndpoint(req, res, "[/api/bootcamp/players/:id]", async () => {
    const id = cleanText(req.params.id, MAX_ID_LENGTH);
    if (!id) return badRequest(res, "invalid_player_id");
    const { steamIds, discordId } = await resolveSteamIds(id);
    if (!steamIds.length) return res.status(404).json({ ok: false, error: "player_not_found" });
    const marks = placeholders(steamIds);

    const [licenses, tiers, lessons, pbs, names] = await Promise.all([
      speedrunQuery(`SELECT steamid, level, endorsements, granted_at, cosigned_by FROM bootcamp_licenses WHERE steamid IN (${marks})`, steamIds),
      speedrunQuery(`
        SELECT t.target_type, t.target_id, t.map, t.class_id, t.tier, t.achieved_at,
               COALESCE(r.name, d.name) AS target_name, COALESCE(r.slug, d.slug) AS target_slug, d.kind AS drill_kind
          FROM bootcamp_tiers t
          LEFT JOIN bootcamp_routes r ON t.target_type = 'route' AND r.id = t.target_id
          LEFT JOIN bootcamp_drills d ON t.target_type = 'drill' AND d.id = t.target_id
         WHERE t.steamid IN (${marks})
         ORDER BY t.map, t.target_type, target_name
      `, steamIds),
      speedrunQuery(`SELECT lesson, MIN(completion_ms) AS completion_ms, MIN(completed_at) AS completed_at FROM bootcamp_lessons WHERE steamid IN (${marks}) GROUP BY lesson ORDER BY lesson`, steamIds),
      speedrunQuery(`
        SELECT b.route_id, r.name AS route_name, r.map, MIN(b.time_ms) AS best
          FROM bootcamp_runs b
          JOIN bootcamp_routes r ON r.id = b.route_id AND r.config_version = b.config_version
         WHERE b.steamid IN (${marks}) AND b.valid = 1 AND b.mode = 1
         GROUP BY b.route_id, r.name, r.map
         ORDER BY r.map, r.name
      `, steamIds),
      speedrunQuery(`
        SELECT player_name FROM (
          SELECT player_name, created_at FROM bootcamp_runs WHERE steamid IN (${marks})
          UNION ALL
          SELECT player_name, created_at FROM bootcamp_drill_sets WHERE steamid IN (${marks})
        ) x WHERE player_name <> '' ORDER BY created_at DESC LIMIT 1
      `, [...steamIds, ...steamIds])
    ]);

    // Best license across linked Steam IDs.
    let license = { level: "none", endorsements: [], grantedAt: null, cosignedBy: null };
    for (const row of licenses) {
      const better = levelRank(row.level) > levelRank(license.level);
      license = {
        level: better ? row.level : license.level,
        endorsements: [...new Set([...license.endorsements, ...endorsementList(row.endorsements)])].sort(),
        grantedAt: better ? isoDate(row.granted_at) : license.grantedAt,
        cosignedBy: license.cosignedBy || row.cosigned_by || null
      };
    }

    // Tier grid: best tier per target across Steam IDs and classes.
    const grid = new Map();
    for (const row of tiers) {
      const key = `${row.target_type}:${row.target_id}`;
      const prev = grid.get(key);
      if (prev && prev.tier >= Number(row.tier)) continue;
      grid.set(key, {
        targetType: row.target_type,
        targetId: Number(row.target_id),
        targetName: row.target_name || `${row.target_type} ${row.target_id}`,
        targetSlug: row.target_slug || null,
        drillKind: row.drill_kind || null,
        map: row.map,
        classId: Number(row.class_id),
        className: className(row.class_id),
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        achievedAt: isoDate(row.achieved_at)
      });
    }

    // PB run ids for replay links
    const pbRows = [];
    for (const row of pbs) {
      const run = await speedrunQuery(
        `SELECT id, tier, ghost_id FROM bootcamp_runs WHERE route_id = ? AND steamid IN (${marks}) AND time_ms = ? AND valid = 1 AND mode = 1 ORDER BY id LIMIT 1`,
        [row.route_id, ...steamIds, row.best]
      );
      pbRows.push({
        routeId: Number(row.route_id),
        routeName: row.route_name,
        map: row.map,
        timeMs: Number(row.best),
        timeDisplay: formatTimeMs(row.best),
        runId: run[0] ? Number(run[0].id) : null,
        tier: run[0] ? Number(run[0].tier) : 0,
        tierName: tierName(run[0]?.tier),
        hasReplay: Boolean(run[0]?.ghost_id)
      });
    }

    res.json({
      player: {
        id,
        discordId,
        steamIds,
        playerName: names[0]?.player_name || steamIds[0]
      },
      license: { ...license, levelLabel: LEVEL_LABELS[license.level] || license.level },
      tiers: [...grid.values()],
      lessons: lessons.map(row => ({
        lesson: row.lesson,
        completionMs: Number(row.completion_ms || 0),
        completionDisplay: formatTimeMs(row.completion_ms || 0),
        completedAt: isoDate(row.completed_at)
      })),
      personalBests: pbRows
    });
  }));

  /* -------------------------------------------------------------------------
     Review queue: records and platinum runs flagged for a replay check.
     Admins clear them in game with /tt_review <run_id> ok|reject.
     ------------------------------------------------------------------------- */
  router.get("/review", (req, res) => runEndpoint(req, res, "[/api/bootcamp/review]", async () => {
    const rows = await speedrunQuery(`
      SELECT b.id, b.steamid, b.player_name, b.map, b.route_id, r.name AS route_name, b.class_id, b.time_ms, b.tier,
             b.ghost_id, b.client_fps_max, b.created_at,
             (SELECT MIN(o.time_ms) FROM bootcamp_runs o WHERE o.route_id = b.route_id AND o.class_id = b.class_id
                AND o.valid = 1 AND o.mode = 1 AND o.config_version = b.config_version AND o.id <> b.id) AS previous_best
        FROM bootcamp_runs b
        JOIN bootcamp_routes r ON r.id = b.route_id
       WHERE b.flagged = 1 AND b.reviewed = 0
       ORDER BY b.id DESC
       LIMIT 100
    `);
    res.json({
      runs: rows.map(row => ({
        runId: Number(row.id),
        steamid: row.steamid,
        playerName: row.player_name || row.steamid,
        map: row.map,
        routeId: Number(row.route_id),
        routeName: row.route_name,
        classId: Number(row.class_id),
        className: className(row.class_id),
        timeMs: Number(row.time_ms),
        timeDisplay: formatTimeMs(row.time_ms),
        previousBestMs: num(row.previous_best),
        previousBestDisplay: row.previous_best ? formatTimeMs(row.previous_best) : null,
        tier: Number(row.tier),
        tierName: tierName(row.tier),
        hasReplay: Boolean(row.ghost_id),
        fpsMax: num(row.client_fps_max),
        createdAt: isoDate(row.created_at)
      }))
    });
  }));

  /* -------------------------------------------------------------------------
     Replays
     ------------------------------------------------------------------------- */
  async function replayForGhost(ghost, runRow, routeRow) {
    const ghostId = Number(ghost.id);
    const chunks = await speedrunQuery(
      "SELECT track, data FROM bootcamp_ghost_chunks WHERE ghost_id = ? AND track IN ('pos', 'proj', 'event') ORDER BY track, chunk_id",
      [ghostId]
    );
    const byTrack = { pos: [], proj: [], event: [] };
    for (const row of chunks) byTrack[row.track]?.push(row.data);

    const frames = parseReplayFrames(joinReplayChunks(byTrack.pos));
    if (frames.length < 2) return { status: 404, error: "replay_empty" };
    const projectileFrames = parseProjectileFrames(joinReplayChunks(byTrack.proj));
    const events = parseEventTrack(joinReplayChunks(byTrack.event));

    let zones = null;
    if (routeRow) {
      const checkpoints = await speedrunQuery(
        "SELECT idx, x, y, z, radius, height FROM bootcamp_route_checkpoints WHERE route_id = ? ORDER BY idx",
        [routeRow.id]
      );
      zones = routeZones(routeRow, checkpoints);
    }

    const lastFrameMs = Math.round(Math.max(0, frames[frames.length - 1].t) * 1000);
    const timeMs = runRow ? Number(runRow.time_ms) : (Number(ghost.time_ms) || lastFrameMs);
    const timing = replayTimingWindow(frames, timeMs, zones?.finish);
    const classId = Number(ghost.class_id);

    return {
      status: 200,
      payload: {
        source: "bootcamp",
        runId: runRow ? Number(runRow.id) : null,
        ghostId,
        drillSetId: num(ghost.drill_set_id),
        kind: ghost.kind,
        map: ghost.map,
        routeId: routeRow ? Number(routeRow.id) : null,
        routeName: routeRow ? routeRow.name : null,
        routeSlug: routeRow ? routeRow.slug : null,
        classId,
        className: CLASS_NAMES[classId] || `Class ${classId}`,
        playerName: ghost.player_name || null,
        steamid: ghost.steamid || null,
        timeMs,
        tier: runRow ? Number(runRow.tier) : Number(ghost.tier_tag || 0),
        frameInterval: num(ghost.frame_interval) ?? inferFrameInterval(frames),
        zones,
        frames,
        projectileEvents: projectileFrames,
        projectileFrames,
        projectileUsage: summarizeProjectileUsage(projectileFrames, timing),
        events
      }
    };
  }

  function sendReplay(res, result) {
    if (result.status !== 200) return res.status(result.status).json({ ok: false, error: result.error });
    return res.json(result.payload);
  }

  router.get("/replay/run/:runId", (req, res) => runEndpoint(req, res, "[/api/bootcamp/replay/run/:runId]", async () => {
    const runId = idParam(req.params.runId);
    if (!runId) return badRequest(res, "invalid_run_id");
    const runs = await speedrunQuery("SELECT * FROM bootcamp_runs WHERE id = ?", [runId]);
    if (!runs.length || !runs[0].ghost_id) return res.status(404).json({ ok: false, error: "replay_not_found" });
    const ghosts = await speedrunQuery("SELECT * FROM bootcamp_ghosts WHERE id = ? AND is_complete = 1", [runs[0].ghost_id]);
    if (!ghosts.length) return res.status(404).json({ ok: false, error: "replay_not_found" });
    const routes = await speedrunQuery("SELECT * FROM bootcamp_routes WHERE id = ?", [runs[0].route_id]);
    return sendReplay(res, await replayForGhost(ghosts[0], runs[0], routes[0] || null));
  }));

  router.get("/replay/ghost/:ghostId", (req, res) => runEndpoint(req, res, "[/api/bootcamp/replay/ghost/:ghostId]", async () => {
    const ghostId = idParam(req.params.ghostId);
    if (!ghostId) return badRequest(res, "invalid_ghost_id");
    const ghosts = await speedrunQuery("SELECT * FROM bootcamp_ghosts WHERE id = ? AND is_complete = 1", [ghostId]);
    if (!ghosts.length) return res.status(404).json({ ok: false, error: "replay_not_found" });
    const ghost = ghosts[0];
    const runs = ghost.run_id ? await speedrunQuery("SELECT * FROM bootcamp_runs WHERE id = ?", [ghost.run_id]) : [];
    const routes = ghost.route_id ? await speedrunQuery("SELECT * FROM bootcamp_routes WHERE id = ?", [ghost.route_id]) : [];
    return sendReplay(res, await replayForGhost(ghost, runs[0] || null, routes[0] || null));
  }));

  return router;
}

module.exports = {
  createBootcampRouter,
  // exported for unit checks
  routeZones,
  parseEventTrack,
  mapRoute
};
