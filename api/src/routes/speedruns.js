"use strict";

const express = require("express");
const { checkSpeedrunDatabase, speedrunQuery } = require("../db/mariadb");
const { createHealthHandler } = require("../helpers/health");

const MAX_MAP_NAME_LENGTH = 64;
const MAX_STEAM_ID_LENGTH = 35;
const MAX_DISCORD_ID_LENGTH = 32;
const CLASS_NAMES = {
  0: "Civilian",
  1: "Scout",
  2: "Sniper",
  3: "Soldier",
  4: "Demoman",
  5: "Medic",
  6: "Heavy",
  7: "Pyro",
  8: "Spy",
  9: "Engineer",
  10: "Civilian",
  11: "Civilian"
};

function createSpeedrunsRouter({ logRouteError }) {
  const router = express.Router();

  function unavailable(res) {
    return res.status(503).json({ error: "Speedrun database unavailable" });
  }

  function badRequest(res, error) {
    return res.status(400).json({ ok: false, error });
  }

  function positiveInt(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function optionalEnabled(value) {
    if (value == null || value === "") return null;
    if (String(value) === "1") return 1;
    if (String(value) === "0") return 0;
    return undefined;
  }

  function cleanText(value, maxLength) {
    return String(value ?? "").trim().slice(0, maxLength);
  }

  function escapeLike(value) {
    return String(value).replace(/[\\%_]/g, "\\$&");
  }

  function iso(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  }

  function formatTimeMs(value) {
    if (value == null) return null;
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) return null;
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    const millis = Math.floor(ms % 1000);
    return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
  }

  function className(row) {
    const existing = String(row.class_name || "").trim();
    if (existing && existing !== "-") return existing;
    const classId = row.class_id == null ? null : Number(row.class_id);
    if (classId == null || !Number.isFinite(classId)) return null;
    return CLASS_NAMES[classId] || `Class ${classId}`;
  }

  function firstValue(row, keys) {
    for (const key of keys) {
      if (row && row[key] != null && row[key] !== "") return row[key];
    }
    return null;
  }

  function normalizeFrameChunk(value) {
    if (value == null) return "";
    if (Buffer.isBuffer(value)) return value.toString("utf8");
    return String(value);
  }

  function chunkPayload(row) {
    const known = firstValue(row, ["ghost_chunk", "projectile_chunk", "chunk_data", "data", "frame_data", "frames", "payload", "chunk", "replay_data"]);
    if (known != null) return known;
    const keyPattern = /^(id|ghost_id|map|class_id|steamid|chunk_id|created_at|updated_at)$/i;
    for (const [key, value] of Object.entries(row || {})) {
      if (!keyPattern.test(key) && value != null) return value;
    }
    return "";
  }

  function parseReplayFrames(serialized) {
    return String(serialized || "")
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const cols = part.split(",").map(value => Number(value.trim()));
        if (cols.length < 8 || cols.some(value => !Number.isFinite(value))) return null;
        return {
          t: cols[0],
          x: cols[1],
          y: cols[2],
          z: cols[3],
          pitch: cols[4],
          yaw: cols[5],
          roll: cols[6],
          buttons: Math.trunc(cols[7])
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
  }

  function parseProjectileFrames(serialized) {
    return String(serialized || "")
      .split(";")
      .map(part => part.trim())
      .filter(Boolean)
      .map(part => {
        const cols = part.split(",");
        if (cols.length < 15) return null;

        const time = Number(cols[0]?.trim());
        const projectileId = Number(cols[1]?.trim());
        const state = Number(cols[2]?.trim());
        const owner = Number(cols[3]?.trim());
        const classname = String(cols[4] || "").trim();
        const model = String(cols[5] || "").trim();
        const x = Number(cols[6]?.trim());
        const y = Number(cols[7]?.trim());
        const z = Number(cols[8]?.trim());
        const pitch = Number(cols[9]?.trim());
        const yaw = Number(cols[10]?.trim());
        const roll = Number(cols[11]?.trim());
        const vx = Number(cols[12]?.trim());
        const vy = Number(cols[13]?.trim());
        const vz = Number(cols[14]?.trim());

        if (
          !Number.isFinite(time) ||
          !Number.isFinite(projectileId) ||
          !Number.isFinite(state) ||
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(z)
        ) {
          return null;
        }

        return {
          t: time,
          projectileId: Math.trunc(projectileId),
          state: Math.trunc(state),
          owner: Number.isFinite(owner) ? Math.trunc(owner) : null,
          classname,
          model,
          x,
          y,
          z,
          pitch: Number.isFinite(pitch) ? pitch : 0,
          yaw: Number.isFinite(yaw) ? yaw : 0,
          roll: Number.isFinite(roll) ? roll : 0,
          vx: Number.isFinite(vx) ? vx : 0,
          vy: Number.isFinite(vy) ? vy : 0,
          vz: Number.isFinite(vz) ? vz : 0
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.t - b.t) || (a.projectileId - b.projectileId) || (b.state - a.state));
  }

  function inferFrameInterval(frames) {
    if (!Array.isArray(frames) || frames.length < 2) return null;
    const deltas = [];
    for (let i = 1; i < frames.length; i += 1) {
      const delta = frames[i].t - frames[i - 1].t;
      if (Number.isFinite(delta) && delta > 0) deltas.push(delta);
    }
    if (!deltas.length) return null;
    deltas.sort((a, b) => a - b);
    return deltas[Math.floor(deltas.length / 2)];
  }

  function mapRun(row) {
    const timeMs = row.time_ms == null ? null : Number(row.time_ms);
    const createdAt = iso(row.created_at);
    return {
      id: row.id == null ? null : Number(row.id),
      steamId: row.steamid || null,
      discordId: row.discord_id || null,
      playerName: row.player_name || null,
      map: row.map || null,
      classId: row.class_id == null ? null : Number(row.class_id),
      className: className(row),
      timeMs,
      timeDisplay: formatTimeMs(timeMs),
      createdAt,
      created_at: createdAt,
      hasReplay: Number(row.has_replay || 0) > 0,
      has_replay: Number(row.has_replay || 0) > 0
    };
  }

  function mapProgressionPoint(row, improvementMs) {
    const timeMs = row.time_ms == null ? null : Number(row.time_ms);
    const createdAt = iso(row.created_at);
    return {
      time_ms: timeMs,
      player_name: row.player_name || null,
      steamid: row.steamid || null,
      created_at: createdAt,
      improvement_ms: improvementMs == null ? null : Number(improvementMs)
    };
  }

  function mapRecord(row, includeMap = true) {
    const bestTimeMs = row.best_time_ms == null ? null : Number(row.best_time_ms);
    const pbCreatedAt = iso(row.pb_created_at);
    const updatedAt = iso(row.updated_at);
    const achievedAt = pbCreatedAt || updatedAt;
    const worldRecordTimeMs = row.world_record_time_ms == null ? null : Number(row.world_record_time_ms);
    const wrGapMs = row.wr_gap_ms == null ? (
      bestTimeMs == null || worldRecordTimeMs == null ? null : bestTimeMs - worldRecordTimeMs
    ) : Number(row.wr_gap_ms);
    const out = {
      steamId: row.steamid || null,
      discordId: row.discord_id || null,
      playerName: row.player_name || null,
      classId: row.class_id == null ? null : Number(row.class_id),
      className: className(row),
      bestTimeMs,
      bestTimeDisplay: formatTimeMs(bestTimeMs),
      pbCreatedAt,
      pb_created_at: pbCreatedAt,
      updatedAt,
      updated_at: updatedAt,
      rank: row.record_rank == null ? null : Number(row.record_rank),
      recordRank: row.record_rank == null ? null : Number(row.record_rank),
      totalRunners: row.total_runners == null ? null : Number(row.total_runners),
      total_runners: row.total_runners == null ? null : Number(row.total_runners),
      worldRecordTimeMs,
      world_record_time_ms: worldRecordTimeMs,
      worldRecordDisplay: formatTimeMs(worldRecordTimeMs),
      wrGapMs,
      wr_gap_ms: wrGapMs,
      improvementMs: row.improvement_ms == null ? null : Number(row.improvement_ms),
      improvement_ms: row.improvement_ms == null ? null : Number(row.improvement_ms),
      achievedAt,
      achieved_at: achievedAt,
      hasReplay: Number(row.has_replay || 0) > 0,
      has_replay: Number(row.has_replay || 0) > 0
    };
    if (includeMap) out.map = row.map || null;
    return out;
  }

  function mapCard(row) {
    const worldRecordTimeMs = row.worldRecordTimeMs == null ? null : Number(row.worldRecordTimeMs);
    const lastRunAt = iso(row.lastRunAt);
    return {
      map: row.map,
      displayName: row.display_name || row.map,
      category: row.category || "other",
      difficulty: row.difficulty == null ? null : Number(row.difficulty),
      enabled: Number(row.enabled || 0) === 1,
      totalRuns: Number(row.totalRuns || 0),
      totalRunners: Number(row.totalRunners || 0),
      totalRecords: Number(row.totalRecords || 0),
      worldRecordTimeMs,
      worldRecordDisplay: formatTimeMs(worldRecordTimeMs),
      worldRecordPlayer: row.worldRecordPlayer || null,
      worldRecordSteamId: row.worldRecordSteamId || null,
      worldRecordDiscordId: row.worldRecordDiscordId || null,      
      worldRecordClassName: row.worldRecordClassName || null,
      lastRunAt,
      last_run_at: lastRunAt
    };
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
    label: "[/api/speedruns/health]",
    check: async () => {
      await checkSpeedrunDatabase();
    },
    payload: () => ({ database: process.env.SPEEDRUN_DB_NAME || "speedrun" }),
    onError: (error, req, res) => {
      logRouteError("[/api/speedruns/health]", error);
      unavailable(res);
    }
  }));

  router.get("/summary", (req, res) => runEndpoint(req, res, "[/api/speedruns/summary]", async () => {
    const [
      countRows,
      recentRuns,
      recentRecords,
      topRunners,
      popularMaps
    ] = await Promise.all([
      speedrunQuery(`
        SELECT
          (SELECT COUNT(*) FROM speedrun_maps) AS maps,
          (SELECT COUNT(*) FROM speedrun_maps WHERE enabled = 1) AS enabledMaps,
          (SELECT COUNT(*) FROM speedrun_runs) AS runs,
          (SELECT COUNT(DISTINCT steamid) FROM speedrun_runs WHERE steamid IS NOT NULL AND steamid != '') AS runners,
          (SELECT COUNT(*) FROM speedrun_records) AS records
      `),
      speedrunQuery(`
        SELECT
          r.id,
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.time_ms,
          r.created_at
        FROM speedrun_runs r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 10
      `),
      speedrunQuery(`
        SELECT
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.best_time_ms,
          r.pb_created_at,
          r.updated_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = r.map AND g.class_id = r.class_id AND g.steamid = r.steamid
            LIMIT 1
          ) AS has_replay
        FROM speedrun_records r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        ORDER BY COALESCE(r.pb_created_at, r.updated_at) DESC, r.best_time_ms ASC
        LIMIT 10
      `),
      speedrunQuery(`
        SELECT
          l.discord_id,
          COALESCE(MAX(latest.player_name), MAX(l.player_name), l.discord_id) AS player_name,
          COUNT(DISTINCT l.steamid) AS linkedSteamIds,
          COALESCE(SUM(record_stats.currentRecords), 0) AS currentRecords,
          COALESCE(SUM(run_stats.totalRuns), 0) AS totalRuns
        FROM speedrun_player_links l
        LEFT JOIN (
          SELECT steamid, COUNT(*) AS totalRuns
          FROM speedrun_runs
          WHERE steamid IS NOT NULL AND steamid != '' AND steamid != 'STEAM_ID_LAN'
          GROUP BY steamid
        ) run_stats ON run_stats.steamid = l.steamid
        LEFT JOIN (
          SELECT steamid, COUNT(*) AS currentRecords
          FROM speedrun_records
          WHERE steamid IS NOT NULL AND steamid != '' AND steamid != 'STEAM_ID_LAN'
          GROUP BY steamid
        ) record_stats ON record_stats.steamid = l.steamid
        LEFT JOIN (
          SELECT steamid, player_name
          FROM (
            SELECT steamid, player_name, ROW_NUMBER() OVER (PARTITION BY steamid ORDER BY created_at DESC, id DESC) AS rn
            FROM speedrun_runs
            WHERE steamid IS NOT NULL AND steamid != '' AND steamid != 'STEAM_ID_LAN'
          ) ranked_names
          WHERE rn = 1
        ) latest ON latest.steamid = l.steamid
        GROUP BY l.discord_id
        HAVING currentRecords > 0 OR totalRuns > 0
        ORDER BY currentRecords DESC, totalRuns DESC, player_name ASC
        LIMIT 10
      `),
      speedrunQuery(`
        SELECT
          m.map,
          COALESCE(m.display_name, m.map) AS display_name,
          m.category,
          COUNT(r.id) AS totalRuns,
          COUNT(DISTINCT r.steamid) AS totalRunners
        FROM speedrun_maps m
        LEFT JOIN speedrun_runs r ON r.map = m.map
        GROUP BY m.map, m.display_name, m.category
        HAVING totalRuns > 0
        ORDER BY totalRuns DESC, totalRunners DESC, display_name ASC
        LIMIT 10
      `)
    ]);

    const counts = countRows[0] || {};
    res.json({
      maps: Number(counts.maps || 0),
      enabledMaps: Number(counts.enabledMaps || 0),
      runs: Number(counts.runs || 0),
      runners: Number(counts.runners || 0),
      records: Number(counts.records || 0),
      recentRuns: recentRuns.map(mapRun),
      recentRecords: recentRecords.map(row => mapRecord(row)),
      topRunners: topRunners.map(row => ({
      discordId: row.discord_id,
      playerName: row.player_name || row.discord_id,
      linkedSteamIds: Number(row.linkedSteamIds || 0),
        currentRecords: Number(row.currentRecords || 0),
        totalRuns: Number(row.totalRuns || 0)
      })),
      popularMaps: popularMaps.map(row => ({
        map: row.map,
        displayName: row.display_name || row.map,
        category: row.category || "other",
        totalRuns: Number(row.totalRuns || 0),
        totalRunners: Number(row.totalRunners || 0)
      }))
    });
  }));

  router.get("/replay/:map/:classId/:steamid", (req, res) => runEndpoint(req, res, "[/api/speedruns/replay/:map/:classId/:steamid]", async () => {
    const mapName = cleanText(req.params.map, MAX_MAP_NAME_LENGTH);
    const classId = Number.parseInt(req.params.classId, 10);
    const steamid = cleanText(req.params.steamid, MAX_STEAM_ID_LENGTH);
    if (!mapName) return badRequest(res, "invalid_map");
    if (!Number.isFinite(classId) || classId < 0 || classId > 99) return badRequest(res, "invalid_class");
    if (!steamid) return badRequest(res, "invalid_steamid");

    const metadataRows = await speedrunQuery(`
      SELECT *
      FROM speedrun_ghosts
      WHERE map = ? AND class_id = ? AND steamid = ?
      LIMIT 1
    `, [mapName, classId, steamid]);
    if (!metadataRows.length) return res.status(404).json({ ok: false, error: "replay_not_found" });

    const metadata = metadataRows[0];
    const ghostId = firstValue(metadata, ["id", "ghost_id"]);
    let chunkRows = [];
    if (ghostId != null) {
      chunkRows = await speedrunQuery(`
        SELECT *
        FROM speedrun_ghost_chunks
        WHERE ghost_id = ?
        ORDER BY chunk_id ASC
      `, [ghostId]);
    }
    if (!chunkRows.length) {
      chunkRows = await speedrunQuery(`
        SELECT *
        FROM speedrun_ghost_chunks
        WHERE map = ? AND class_id = ? AND steamid = ?
        ORDER BY chunk_id ASC
      `, [mapName, classId, steamid]);
    }
    if (!chunkRows.length) return res.status(404).json({ ok: false, error: "replay_chunks_not_found" });

    const serialized = chunkRows
      .map(row => normalizeFrameChunk(chunkPayload(row)))
      .join("");
    const frames = parseReplayFrames(serialized);
    if (!frames.length) return res.status(404).json({ ok: false, error: "replay_empty" });

    let projectileFrames = [];
    try {
      const projectileRows = await speedrunQuery(`
        SELECT *
        FROM speedrun_projectile_chunks
        WHERE map = ? AND class_id = ? AND steamid = ?
        ORDER BY chunk_id ASC
      `, [mapName, classId, steamid]);

      if (projectileRows.length) {
        const projectileSerialized = projectileRows
          .map(row => normalizeFrameChunk(chunkPayload(row)))
          .join("");
        projectileFrames = parseProjectileFrames(projectileSerialized);
      }
    } catch (error) {
      projectileFrames = [];
      logRouteError("[/api/speedruns/replay/:map/:classId/:steamid] projectile load failed", error);
    }

    const metadataTimeMs = firstValue(metadata, ["ghost_time_ms", "time_ms", "best_time_ms", "duration_ms", "run_time_ms"]);
    const lastFrameTimeMs = Math.round(Math.max(0, frames[frames.length - 1].t) * 1000);
    const frameInterval = firstValue(metadata, ["frame_interval", "frameInterval", "tick_interval", "interval"]);

    res.json({
      map: metadata.map || mapName,
      classId: metadata.class_id == null ? classId : Number(metadata.class_id),
      className: className(metadata) || CLASS_NAMES[classId] || `Class ${classId}`,
      playerName: metadata.player_name || metadata.name || null,
      steamid: metadata.steamid || steamid,
      timeMs: metadataTimeMs == null ? lastFrameTimeMs : Number(metadataTimeMs),
      frameInterval: frameInterval == null ? inferFrameInterval(frames) : Number(frameInterval),
      frames,
      projectileFrames
    });
  }));

  router.get("/server-maps", (req, res) => runEndpoint(req, res, "[/api/speedruns/server-maps]", async () => {
    const rows = await speedrunQuery(`
      SELECT
        sm.map,
        GROUP_CONCAT(sm.server_key ORDER BY sm.server_key SEPARATOR ',') AS server_keys,
        MAX(sm.last_seen) AS last_seen,
        m.category,
        m.difficulty,
        m.enabled,
        m.start_x,
        m.start_y,
        m.start_z,
        m.finish_x,
        m.finish_y,
        m.finish_z,
        COALESCE(run_stats.totalRuns, 0) AS totalRuns,
        COALESCE(run_stats.totalRunners, 0) AS totalRunners,
        COALESCE(record_stats.totalRecords, 0) AS totalRecords,
        run_stats.lastRunAt,
        CASE
          WHEN m.map IS NULL THEN 'not_logged'
          WHEN m.start_x IS NULL OR m.start_y IS NULL OR m.start_z IS NULL THEN 'missing_start'
          WHEN m.finish_x IS NULL OR m.finish_y IS NULL OR m.finish_z IS NULL THEN 'missing_finish'
          ELSE 'configured'
        END AS setup_status
      FROM speedrun_server_maps sm
      LEFT JOIN speedrun_maps m ON m.map = sm.map
      LEFT JOIN (
        SELECT map, COUNT(*) AS totalRuns, COUNT(DISTINCT steamid) AS totalRunners, MAX(created_at) AS lastRunAt
        FROM speedrun_runs
        GROUP BY map
      ) run_stats ON run_stats.map = sm.map
      LEFT JOIN (
        SELECT map, COUNT(*) AS totalRecords
        FROM speedrun_records
        GROUP BY map
      ) record_stats ON record_stats.map = sm.map
      WHERE sm.exists_on_server = 1
      GROUP BY
        sm.map,
        m.map,
        m.category,
        m.difficulty,
        m.enabled,
        m.start_x,
        m.start_y,
        m.start_z,
        m.finish_x,
        m.finish_y,
        m.finish_z,
        run_stats.totalRuns,
        run_stats.totalRunners,
        run_stats.lastRunAt,
        record_stats.totalRecords
      ORDER BY sm.map ASC
    `);

    res.json(rows.map(row => {
      const lastRunAt = iso(row.lastRunAt);
      const lastSeen = iso(row.last_seen);
      const servers = String(row.server_keys || "").split(",").map(server => server.trim()).filter(Boolean);
      return {
        servers,
        server_keys: servers,
        map: row.map,
        last_seen: lastSeen,
        lastSeen,
        category: row.category || null,
        difficulty: row.difficulty == null ? null : Number(row.difficulty),
        enabled: row.enabled == null ? null : Number(row.enabled || 0) === 1,
        start: {
          x: row.start_x == null ? null : Number(row.start_x),
          y: row.start_y == null ? null : Number(row.start_y),
          z: row.start_z == null ? null : Number(row.start_z)
        },
        finish: {
          x: row.finish_x == null ? null : Number(row.finish_x),
          y: row.finish_y == null ? null : Number(row.finish_y),
          z: row.finish_z == null ? null : Number(row.finish_z)
        },
        start_x: row.start_x == null ? null : Number(row.start_x),
        start_y: row.start_y == null ? null : Number(row.start_y),
        start_z: row.start_z == null ? null : Number(row.start_z),
        finish_x: row.finish_x == null ? null : Number(row.finish_x),
        finish_y: row.finish_y == null ? null : Number(row.finish_y),
        finish_z: row.finish_z == null ? null : Number(row.finish_z),
        setup_status: row.setup_status,
        setupStatus: row.setup_status,
        totalRuns: Number(row.totalRuns || 0),
        totalRunners: Number(row.totalRunners || 0),
        totalRecords: Number(row.totalRecords || 0),
        lastRunAt,
        last_run_at: lastRunAt
      };
    }));
  }));

  router.get("/maps", (req, res) => runEndpoint(req, res, "[/api/speedruns/maps]", async () => {
    const limit = positiveInt(req.query.limit, 50, 1, 200);
    const offset = positiveInt(req.query.offset, 0, 0, 100000);
    const sort = cleanText(req.query.sort || "name", 20);
    const enabled = optionalEnabled(req.query.enabled);
    const withRecords = String(req.query.with_records || "") === "1";
    if (enabled === undefined) return badRequest(res, "invalid_enabled");

    const where = [];
    const params = [];
    const q = cleanText(req.query.q, 80);
    if (q) {
      where.push("(m.map LIKE ? ESCAPE '\\\\' OR m.display_name LIKE ? ESCAPE '\\\\')");
      const like = `%${escapeLike(q)}%`;
      params.push(like, like);
    }
    const category = cleanText(req.query.category, 32);
    if (category) {
      where.push("m.category = ?");
      params.push(category);
    }
    if (enabled !== null) {
      where.push("m.enabled = ?");
      params.push(enabled);
    }
    if (withRecords) {
      where.push("COALESCE(record_stats.totalRecords, 0) > 0");
    }

    const orderBy = {
      name: "COALESCE(m.display_name, m.map) ASC, m.map ASC",
      runs: "COALESCE(run_stats.totalRuns, 0) DESC, COALESCE(m.display_name, m.map) ASC",
      runners: "COALESCE(run_stats.totalRunners, 0) DESC, COALESCE(m.display_name, m.map) ASC",
      wr: "wr.worldRecordTimeMs IS NULL ASC, wr.worldRecordTimeMs ASC, COALESCE(m.display_name, m.map) ASC",
      difficulty: "m.difficulty ASC, COALESCE(m.display_name, m.map) ASC"
    }[sort];
    if (!orderBy) return badRequest(res, "invalid_sort");

    const rows = await speedrunQuery(`
      SELECT
        m.map,
        m.display_name,
        m.category,
        m.difficulty,
        m.enabled,
        COALESCE(run_stats.totalRuns, 0) AS totalRuns,
        COALESCE(run_stats.totalRunners, 0) AS totalRunners,
        COALESCE(record_stats.totalRecords, 0) AS totalRecords,
        run_stats.lastRunAt,
        wr.worldRecordTimeMs,
        wr.worldRecordPlayer,
        wr.worldRecordSteamId,
        wr.worldRecordDiscordId,
        wr.worldRecordClassId,
        wr.worldRecordClassName
      FROM speedrun_maps m
      LEFT JOIN (
        SELECT
          map,
          COUNT(*) AS totalRuns,
          COUNT(DISTINCT steamid) AS totalRunners,
          MAX(created_at) AS lastRunAt
        FROM speedrun_runs
        GROUP BY map
      ) run_stats ON run_stats.map = m.map
      LEFT JOIN (
        SELECT
          map,
          COUNT(*) AS totalRecords
        FROM speedrun_records
        GROUP BY map
      ) record_stats ON record_stats.map = m.map
      LEFT JOIN (
        SELECT
          ranked.map,
          ranked.best_time_ms AS worldRecordTimeMs,
          ranked.player_name AS worldRecordPlayer,
          ranked.steamid AS worldRecordSteamId,
          l.discord_id AS worldRecordDiscordId,
          ranked.class_id AS worldRecordClassId,
          ranked.class_name AS worldRecordClassName
        FROM (
          SELECT r.*, ROW_NUMBER() OVER (
            PARTITION BY r.map
            ORDER BY r.best_time_ms ASC, COALESCE(r.pb_created_at, r.updated_at) ASC, r.steamid ASC, r.class_id ASC
          ) AS rn
          FROM speedrun_records r
        ) ranked
        LEFT JOIN speedrun_player_links l
          ON l.steamid = ranked.steamid
        WHERE ranked.rn = 1
      ) wr ON wr.map = m.map
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.json(rows.map(mapCard));
  }));

  router.get("/maps/:map/progression", (req, res) => runEndpoint(req, res, "[/api/speedruns/maps/:map/progression]", async () => {
    const mapName = cleanText(req.params.map, MAX_MAP_NAME_LENGTH);
    if (!mapName) return badRequest(res, "invalid_map");

    const mapRows = await speedrunQuery(`
      SELECT map
      FROM speedrun_maps
      WHERE map = ?
      LIMIT 1
    `, [mapName]);
    if (!mapRows.length) return res.status(404).json({ ok: false, error: "map_not_found" });

    const rows = await speedrunQuery(`
      SELECT
        r.id,
        r.steamid,
        r.player_name,
        r.map,
        r.class_id,
        r.class_name,
        r.time_ms,
        r.created_at
      FROM speedrun_runs r
      WHERE r.map = ?
        AND r.class_id IS NOT NULL
        AND r.time_ms IS NOT NULL
      ORDER BY r.class_id ASC, r.created_at ASC, r.id ASC
    `, [mapName]);

    const classes = new Map();
    const bestByClass = new Map();
    for (const row of rows) {
      const classId = Number(row.class_id);
      const timeMs = Number(row.time_ms);
      if (!Number.isFinite(classId) || !Number.isFinite(timeMs)) continue;

      const previousBest = bestByClass.get(classId);
      if (previousBest == null || timeMs < previousBest) {
        bestByClass.set(classId, timeMs);
        if (!classes.has(classId)) {
          classes.set(classId, {
            class_id: classId,
            class_name: className(row) || `Class ${classId}`,
            points: []
          });
        }
        classes.get(classId).points.push(mapProgressionPoint(
          row,
          previousBest == null ? null : previousBest - timeMs
        ));
      }
    }

    res.json({
      map: mapRows[0].map,
      classes: [...classes.values()].sort((a, b) => (
        String(a.class_name || "").localeCompare(String(b.class_name || "")) ||
        Number(a.class_id || 0) - Number(b.class_id || 0)
      ))
    });
  }));

  router.get("/maps/:map", (req, res) => runEndpoint(req, res, "[/api/speedruns/maps/:map]", async () => {
    const mapName = cleanText(req.params.map, MAX_MAP_NAME_LENGTH);
    if (!mapName) return badRequest(res, "invalid_map");

    const mapRows = await speedrunQuery(`
      SELECT map, display_name, category, difficulty, enabled,
             start_x, start_y, start_z, finish_x, finish_y, finish_z
      FROM speedrun_maps
      WHERE map = ?
      LIMIT 1
    `, [mapName]);
    if (!mapRows.length) return res.status(404).json({ ok: false, error: "map_not_found" });

    const [
      summaryRows,
      leaderboard,
      recentRuns,
      progressionRows
    ] = await Promise.all([
      speedrunQuery(`
        SELECT
          (SELECT COUNT(*) FROM speedrun_runs WHERE map = ?) AS totalRuns,
          (SELECT COUNT(DISTINCT steamid) FROM speedrun_runs WHERE map = ? AND steamid IS NOT NULL AND steamid != '') AS totalRunners,
          (SELECT COUNT(*) FROM speedrun_records WHERE map = ?) AS totalRecords,
          (SELECT MAX(created_at) FROM speedrun_runs WHERE map = ?) AS lastRunAt,
          (SELECT best_time_ms FROM speedrun_records WHERE map = ? ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC, class_id ASC LIMIT 1) AS worldRecordTimeMs,
          (SELECT player_name FROM speedrun_records WHERE map = ? ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC, class_id ASC LIMIT 1) AS worldRecordPlayer,
          (SELECT steamid FROM speedrun_records WHERE map = ? ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC, class_id ASC LIMIT 1) AS worldRecordSteamId,
          (SELECT class_id FROM speedrun_records WHERE map = ? ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC, class_id ASC LIMIT 1) AS worldRecordClassId,
          (SELECT class_name FROM speedrun_records WHERE map = ? ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC, class_id ASC LIMIT 1) AS worldRecordClassName
      `, [mapName, mapName, mapName, mapName, mapName, mapName, mapName, mapName, mapName]),
      speedrunQuery(`
        SELECT
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.best_time_ms,
          r.pb_created_at,
          r.updated_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = r.map AND g.class_id = r.class_id AND g.steamid = r.steamid
            LIMIT 1
          ) AS has_replay
        FROM speedrun_records r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        WHERE r.map = ?
        ORDER BY r.best_time_ms ASC, COALESCE(r.pb_created_at, r.updated_at) ASC, r.steamid ASC, r.class_id ASC
      `, [mapName]),
      speedrunQuery(`
        SELECT
          r.id,
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.time_ms,
          r.created_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = r.map AND g.class_id = r.class_id AND g.steamid = r.steamid
            LIMIT 1
          ) AS has_replay
        FROM speedrun_runs r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        WHERE r.map = ?
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 25
      `, [mapName]),
      speedrunQuery(`
        SELECT
          r.id,
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.time_ms,
          r.created_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = r.map AND g.class_id = r.class_id AND g.steamid = r.steamid
            LIMIT 1
          ) AS has_replay
        FROM speedrun_runs r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        WHERE r.map = ?
        ORDER BY r.created_at ASC, r.id ASC
      `, [mapName])
    ]);

    let best = Infinity;
    const worldRecordProgression = [];
    for (const row of progressionRows) {
      const timeMs = Number(row.time_ms);
      if (Number.isFinite(timeMs) && timeMs < best) {
        best = timeMs;
        worldRecordProgression.push(mapRun(row));
      }
    }
    worldRecordProgression.reverse();

    const mapRow = mapRows[0];
    const summary = summaryRows[0] || {};
    const worldRecordTimeMs = summary.worldRecordTimeMs == null ? null : Number(summary.worldRecordTimeMs);
    const lastRunAt = iso(summary.lastRunAt);

    res.json({
      map: mapRow.map,
      displayName: mapRow.display_name || mapRow.map,
      category: mapRow.category || "other",
      difficulty: mapRow.difficulty == null ? null : Number(mapRow.difficulty),
      enabled: Number(mapRow.enabled || 0) === 1,
      zones: {
        start: { x: mapRow.start_x, y: mapRow.start_y, z: mapRow.start_z },
        finish: { x: mapRow.finish_x, y: mapRow.finish_y, z: mapRow.finish_z }
      },
      summary: {
        totalRuns: Number(summary.totalRuns || 0),
        totalRunners: Number(summary.totalRunners || 0),
        totalRecords: Number(summary.totalRecords || 0),
        worldRecordTimeMs,
        worldRecordDisplay: formatTimeMs(worldRecordTimeMs),
        worldRecordPlayer: summary.worldRecordPlayer || null,
        worldRecordSteamId: summary.worldRecordSteamId || null,
        worldRecordClassId: summary.worldRecordClassId == null ? null : Number(summary.worldRecordClassId),
        worldRecordClassName: summary.worldRecordClassName || null,
        lastRunAt,
        last_run_at: lastRunAt
      },
      leaderboard: leaderboard.map((row, index) => ({
        rank: index + 1,
        ...mapRecord(row, false)
      })),
      recentRuns: recentRuns.map(mapRun),
      worldRecordProgression
    });
  }));

  router.get("/players", (req, res) => runEndpoint(req, res, "[/api/speedruns/players]", async () => {
    const limit = positiveInt(req.query.limit, 50, 1, 200);
    const offset = positiveInt(req.query.offset, 0, 0, 100000);
    const sort = cleanText(req.query.sort || "records", 20);
    const where = [];
    const params = [];
    const q = cleanText(req.query.q, 80);
    if (q) {
      where.push("(l.discord_id LIKE ? ESCAPE '\\\\' OR l.steamid LIKE ? ESCAPE '\\\\' OR l.player_name LIKE ? ESCAPE '\\\\')");
      const like = `%${escapeLike(q)}%`;
      params.push(like, like, like);
    }

    const orderBy = {
      records: "currentRecords DESC, totalRuns DESC, playerName ASC",
      runs: "totalRuns DESC, currentRecords DESC, playerName ASC",
      maps: "mapsPlayed DESC, totalRuns DESC, playerName ASC",
      recent: "lastRunAt DESC, totalRuns DESC, playerName ASC"
    }[sort];
    if (!orderBy) return badRequest(res, "invalid_sort");

    const rows = await speedrunQuery(`
  SELECT
    l.discord_id AS discordId,
    COALESCE(MAX(latest.player_name), MAX(l.player_name), l.discord_id) AS playerName,
    COUNT(DISTINCT l.steamid) AS linkedSteamIds,
    COALESCE(SUM(run_stats.totalRuns), 0) AS totalRuns,
    COALESCE(SUM(run_stats.mapsPlayed), 0) AS mapsPlayed,
    COALESCE(SUM(record_stats.currentRecords), 0) AS currentRecords,
    COALESCE(SUM(top10.top10s), 0) AS top10s,
    MAX(run_stats.lastRunAt) AS lastRunAt
  FROM speedrun_player_links l
  LEFT JOIN (
    SELECT steamid, COUNT(*) AS totalRuns, COUNT(DISTINCT map) AS mapsPlayed, MAX(created_at) AS lastRunAt
    FROM speedrun_runs
    WHERE steamid IS NOT NULL AND steamid != ''
    GROUP BY steamid
  ) run_stats ON run_stats.steamid = l.steamid
  LEFT JOIN (
    SELECT steamid, COUNT(*) AS currentRecords
    FROM speedrun_records
    WHERE steamid IS NOT NULL AND steamid != ''
    GROUP BY steamid
  ) record_stats ON record_stats.steamid = l.steamid
  LEFT JOIN (
    SELECT steamid, player_name
    FROM (
      SELECT steamid, player_name, ROW_NUMBER() OVER (PARTITION BY steamid ORDER BY created_at DESC, id DESC) AS rn
      FROM speedrun_runs
      WHERE steamid IS NOT NULL AND steamid != ''
    ) ranked_names
    WHERE rn = 1
  ) latest ON latest.steamid = l.steamid
  LEFT JOIN (
    SELECT steamid, COUNT(*) AS top10s
    FROM (
      SELECT steamid, ROW_NUMBER() OVER (
        PARTITION BY map, class_id
        ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC
      ) AS record_rank
      FROM speedrun_records
    ) ranked_records
    WHERE record_rank <= 10
    GROUP BY steamid
  ) top10 ON top10.steamid = l.steamid
  ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
  GROUP BY l.discord_id
  ORDER BY ${orderBy}
  LIMIT ? OFFSET ?
`, [...params, limit, offset]);

    res.json(rows.map(row => {
      const lastRunAt = iso(row.lastRunAt);
      return {
        playerName: row.playerName || row.discordId,
        discordId: row.discordId,
        linkedSteamIds: Number(row.linkedSteamIds || 0),
        totalRuns: Number(row.totalRuns || 0),
        mapsPlayed: Number(row.mapsPlayed || 0),
        currentRecords: Number(row.currentRecords || 0),
        top10s: row.top10s == null ? null : Number(row.top10s || 0),
        lastRunAt,
        last_run_at: lastRunAt
      };
    }));
  }));

    router.get("/players/:discordId", (req, res) => runEndpoint(req, res, "[/api/speedruns/players/:discordId]", async () => {
    const discordId = cleanText(req.params.discordId, MAX_DISCORD_ID_LENGTH);
    if (!discordId) return badRequest(res, "invalid_discord_id");

    const linkedRows = await speedrunQuery(`
      SELECT steamid, player_name
      FROM speedrun_player_links
      WHERE discord_id = ?
      ORDER BY linked_at ASC, steamid ASC
    `, [discordId]);

    if (!linkedRows.length) {
      return res.status(404).json({ ok: false, error: "player_not_linked" });
    }

    const steamIds = [...new Set(linkedRows.map(row => row.steamid).filter(Boolean))];
    if (!steamIds.length) {
      return res.status(404).json({ ok: false, error: "player_not_found" });
    }

    const placeholders = steamIds.map(() => "?").join(",");

    const [
      playerRows,
      summaryRows,
      worldRecords,
      personalBests,
      recentActivity,
      mapRows,
      globalRankRows
    ] = await Promise.all([
      speedrunQuery(`
        SELECT steamid, player_name
        FROM (
          SELECT steamid, player_name, created_at AS seen_at
          FROM speedrun_runs
          WHERE steamid IN (${placeholders})
          UNION ALL
          SELECT steamid, player_name, COALESCE(pb_created_at, updated_at) AS seen_at
          FROM speedrun_records
          WHERE steamid IN (${placeholders})
        ) names
        ORDER BY seen_at DESC
        LIMIT 1
      `, [...steamIds, ...steamIds]),

      speedrunQuery(`
        SELECT
          (SELECT COUNT(*) FROM speedrun_runs WHERE steamid IN (${placeholders})) AS totalRuns,
          (SELECT COUNT(DISTINCT map) FROM speedrun_runs WHERE steamid IN (${placeholders})) AS mapsPlayed,
          (SELECT COUNT(DISTINCT map) FROM speedrun_records WHERE steamid IN (${placeholders})) AS mapsCompleted,
          (SELECT COUNT(*) FROM speedrun_records WHERE steamid IN (${placeholders})) AS currentRecords,
          (SELECT MAX(created_at) FROM speedrun_runs WHERE steamid IN (${placeholders})) AS lastRunAt,
          (SELECT COUNT(*) FROM speedrun_maps) AS totalMaps,
          (SELECT COUNT(*) FROM speedrun_maps WHERE enabled = 1) AS enabledMaps,
          (
            SELECT MIN(record_rank)
            FROM (
              SELECT steamid, ROW_NUMBER() OVER (
                PARTITION BY map, class_id
                ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC
              ) AS record_rank
              FROM speedrun_records
            ) ranked_records
            WHERE steamid IN (${placeholders})
          ) AS bestRecordRank
      `, [...steamIds, ...steamIds, ...steamIds, ...steamIds, ...steamIds, ...steamIds]),

      speedrunQuery(`
        SELECT
          steamid,
          player_name,
          map,
          class_id,
          class_name,
          best_time_ms,
          pb_created_at,
          updated_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = ranked_records.map AND g.class_id = ranked_records.class_id AND g.steamid = ranked_records.steamid
            LIMIT 1
          ) AS has_replay
        FROM (
          SELECT
            steamid,
            player_name,
            map,
            class_id,
            class_name,
            best_time_ms,
            pb_created_at,
            updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY map, class_id
              ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC
            ) AS record_rank
          FROM speedrun_records
        ) ranked_records
        WHERE record_rank = 1
          AND steamid IN (${placeholders})
        ORDER BY map ASC, class_id ASC, best_time_ms ASC
      `, steamIds),

      speedrunQuery(`
        SELECT
          ranked_records.steamid,
          ranked_records.player_name,
          ranked_records.map,
          ranked_records.class_id,
          ranked_records.class_name,
          ranked_records.best_time_ms,
          ranked_records.pb_created_at,
          ranked_records.updated_at,
          ranked_records.record_rank,
          record_stats.total_runners,
          record_stats.world_record_time_ms,
          ranked_records.best_time_ms - record_stats.world_record_time_ms AS wr_gap_ms,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = ranked_records.map AND g.class_id = ranked_records.class_id AND g.steamid = ranked_records.steamid
            LIMIT 1
          ) AS has_replay,
          (
            SELECT MIN(rr.time_ms) - ranked_records.best_time_ms
            FROM speedrun_runs rr
            WHERE rr.steamid = ranked_records.steamid
              AND rr.map = ranked_records.map
              AND rr.class_id = ranked_records.class_id
              AND rr.time_ms > ranked_records.best_time_ms
          ) AS improvement_ms
        FROM (
          SELECT
            steamid,
            player_name,
            map,
            class_id,
            class_name,
            best_time_ms,
            pb_created_at,
            updated_at,
            ROW_NUMBER() OVER (
              PARTITION BY map, class_id
              ORDER BY best_time_ms ASC, COALESCE(pb_created_at, updated_at) ASC, steamid ASC
            ) AS record_rank
          FROM speedrun_records
        ) ranked_records
        LEFT JOIN (
          SELECT
            map,
            class_id,
            COUNT(DISTINCT steamid) AS total_runners,
            MIN(best_time_ms) AS world_record_time_ms
          FROM speedrun_records
          GROUP BY map, class_id
        ) record_stats
          ON record_stats.map = ranked_records.map
         AND record_stats.class_id = ranked_records.class_id
        WHERE steamid IN (${placeholders})
        ORDER BY map ASC, class_id ASC, best_time_ms ASC
      `, steamIds),

      speedrunQuery(`
        SELECT
          r.id,
          r.steamid,
          l.discord_id,
          r.player_name,
          r.map,
          r.class_id,
          r.class_name,
          r.time_ms,
          r.created_at,
          EXISTS (
            SELECT 1 FROM speedrun_ghosts g
            WHERE g.map = r.map AND g.class_id = r.class_id AND g.steamid = r.steamid
            LIMIT 1
          ) AS has_replay
        FROM speedrun_runs r
        LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
        WHERE r.steamid IN (${placeholders})
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT 25
      `, steamIds),

      speedrunQuery(`
        SELECT map, display_name, category, enabled
        FROM speedrun_maps
        ORDER BY COALESCE(display_name, map) ASC, map ASC
      `),

      speedrunQuery(`
        SELECT ranked.global_rank, ranked.total_runners
        FROM (
          SELECT
            player_totals.discord_id,
            ROW_NUMBER() OVER (
              ORDER BY player_totals.currentRecords DESC, player_totals.totalRuns DESC, player_totals.playerName ASC
            ) AS global_rank,
            COUNT(*) OVER () AS total_runners
          FROM (
            SELECT
              l.discord_id,
              COALESCE(MAX(latest.player_name), MAX(l.player_name), l.discord_id) AS playerName,
              COALESCE(SUM(record_stats.currentRecords), 0) AS currentRecords,
              COALESCE(SUM(run_stats.totalRuns), 0) AS totalRuns
            FROM speedrun_player_links l
            LEFT JOIN (
              SELECT steamid, COUNT(*) AS currentRecords
              FROM speedrun_records
              WHERE steamid IS NOT NULL AND steamid != ''
              GROUP BY steamid
            ) record_stats ON record_stats.steamid = l.steamid
            LEFT JOIN (
              SELECT steamid, COUNT(*) AS totalRuns
              FROM speedrun_runs
              WHERE steamid IS NOT NULL AND steamid != ''
              GROUP BY steamid
            ) run_stats ON run_stats.steamid = l.steamid
            LEFT JOIN (
              SELECT steamid, player_name
              FROM (
                SELECT steamid, player_name, ROW_NUMBER() OVER (PARTITION BY steamid ORDER BY created_at DESC, id DESC) AS rn
                FROM speedrun_runs
              ) ranked_names
              WHERE rn = 1
            ) latest ON latest.steamid = l.steamid
            GROUP BY l.discord_id
            HAVING currentRecords > 0 OR totalRuns > 0
          ) player_totals
        ) ranked
        WHERE ranked.discord_id = ?
        LIMIT 1
      `, [discordId])
    ]);

    if (!playerRows.length && !personalBests.length && !recentActivity.length) {
      return res.status(404).json({ ok: false, error: "player_not_found" });
    }

    const player = playerRows[0] || personalBests[0] || recentActivity[0] || linkedRows[0] || {};
    const summary = summaryRows[0] || {};
    const globalRank = globalRankRows[0] || {};
    const lastRunAt = iso(summary.lastRunAt);

    res.json({
      player: {
        discordId,
        steamIds,
        steam_ids: steamIds,
        playerName: player.player_name || linkedRows[0].player_name || discordId
      },
      summary: {
        totalRuns: Number(summary.totalRuns || 0),
        mapsPlayed: Number(summary.mapsPlayed || 0),
        mapsCompleted: Number(summary.mapsCompleted || 0),
        totalMaps: Number(summary.totalMaps || 0),
        enabledMaps: Number(summary.enabledMaps || 0),
        currentRecords: Number(summary.currentRecords || 0),
        worldRecords: worldRecords.length,
        bestRecordRank: summary.bestRecordRank == null ? null : Number(summary.bestRecordRank),
        globalRank: globalRank.global_rank == null ? null : Number(globalRank.global_rank),
        globalRunnerCount: globalRank.total_runners == null ? null : Number(globalRank.total_runners),
        lastRunAt,
        last_run_at: lastRunAt
      },
      worldRecords: worldRecords.map(row => mapRecord(row)),
      personalBests: personalBests.map(row => mapRecord(row)),
      maps: mapRows.map(row => ({
        map: row.map,
        displayName: row.display_name || row.map,
        category: row.category || "other",
        enabled: Number(row.enabled || 0) === 1
      })),
      recentActivity: recentActivity.map(mapRun)
    });
  }));

  router.get("/recent", (req, res) => runEndpoint(req, res, "[/api/speedruns/recent]", async () => {
    const limit = positiveInt(req.query.limit, 25, 1, 100);
    const rows = await speedrunQuery(`
      SELECT
        r.id,
        r.steamid,
        l.discord_id,
        r.player_name,
        r.map,
        r.class_id,
        r.class_name,
        r.time_ms,
        r.created_at
      FROM speedrun_runs r
      LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ?
    `, [limit]);
    res.json(rows.map(mapRun));
  }));

  router.get("/records", (req, res) => runEndpoint(req, res, "[/api/speedruns/records]", async () => {
    const limit = positiveInt(req.query.limit, 100, 1, 500);
    const where = [];
    const params = [];

    const category = cleanText(req.query.category, 32);
    if (category) {
      where.push("m.category = ?");
      params.push(category);
    }

    if (req.query.class_id != null && req.query.class_id !== "") {
      const classId = Number.parseInt(req.query.class_id, 10);
      if (!Number.isFinite(classId)) return badRequest(res, "invalid_class_id");
      where.push("r.class_id = ?");
      params.push(classId);
    }

    const rows = await speedrunQuery(`
      SELECT
        r.steamid,
        l.discord_id,
        r.player_name,
        r.map,
        r.class_id,
        r.class_name,
        r.best_time_ms,
        r.pb_created_at,
        r.updated_at,
        m.display_name,
        m.category,
        m.difficulty,
        m.enabled
      FROM speedrun_records r
      LEFT JOIN speedrun_maps m ON m.map = r.map
      LEFT JOIN speedrun_player_links l ON l.steamid = r.steamid
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY r.map ASC, r.best_time_ms ASC, COALESCE(r.pb_created_at, r.updated_at) ASC
      LIMIT ?
    `, [...params, limit]);

    res.json(rows.map(row => ({
      ...mapRecord(row),
      displayName: row.display_name || row.map,
      category: row.category || "other",
      difficulty: row.difficulty == null ? null : Number(row.difficulty),
      enabled: row.enabled == null ? null : Number(row.enabled || 0) === 1
    })));
  }));

  return router;
}

module.exports = { createSpeedrunsRouter };
