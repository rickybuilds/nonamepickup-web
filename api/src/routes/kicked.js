"use strict";

const express = require("express");

function splitNames(value, cleanString) {
  const values = Array.isArray(value)
    ? value
    : String(value || "").split(",");

  return values
    .map(name => cleanString(name, 200))
    .filter(Boolean);
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function buildKickedPayload(rows, cleanString) {
  const events = [];
  const offenders = new Map();

  for (const [sourceIndex, row] of (Array.isArray(rows) ? rows : []).entries()) {
    if (!row || typeof row !== "object") continue;

    const ids = (Array.isArray(row.ids) ? row.ids : [])
      .map(id => cleanString(id, 100))
      .filter(Boolean);
    const names = splitNames(row.names ?? row.name, cleanString);
    const playerCount = Math.max(ids.length, names.length);
    const eventPlayers = [];
    const eventIds = new Set();

    for (let index = 0; index < playerCount; index += 1) {
      const id = ids[index] || `name:${String(names[index] || "unknown").toLowerCase()}`;
      const name = names[index] || ids[index] || "Unknown";
      if (eventIds.has(id)) continue;
      eventIds.add(id);

      const player = { id, name };
      eventPlayers.push(player);

      const existing = offenders.get(id) || {
        id,
        name,
        kicks: 0,
        last_kicked_at: null,
        last_kicked_at_ms: null
      };
      const eventTime = parseTimestamp(row.timestamp);
      existing.name = name || existing.name;
      existing.kicks += 1;
      if (
        eventTime != null &&
        (existing.last_kicked_at_ms == null || eventTime >= existing.last_kicked_at_ms)
      ) {
        existing.last_kicked_at = cleanString(row.timestamp, 100);
        existing.last_kicked_at_ms = eventTime;
      }
      offenders.set(id, existing);
    }

    if (!eventPlayers.length) continue;

    events.push({
      id: sourceIndex + 1,
      timestamp: cleanString(row.timestamp, 100),
      timestamp_ms: parseTimestamp(row.timestamp),
      reason: cleanString(row.reason, 100) || "unknown",
      players: eventPlayers
    });
  }

  events.sort((a, b) => (b.timestamp_ms || 0) - (a.timestamp_ms || 0) || b.id - a.id);

  const leaderboard = [...offenders.values()]
    .sort((a, b) =>
      b.kicks - a.kicks ||
      (b.last_kicked_at_ms || 0) - (a.last_kicked_at_ms || 0) ||
      a.name.localeCompare(b.name)
    )
    .map((player, index) => ({
      rank: index + 1,
      id: player.id,
      name: player.name,
      kicks: player.kicks,
      last_kicked_at: player.last_kicked_at
    }));

  return {
    ok: true,
    generated_at: Date.now(),
    summary: {
      kick_events: events.length,
      missed_votes: events.reduce((total, event) => total + event.players.length, 0),
      unique_players: leaderboard.length
    },
    leaderboard,
    events
  };
}

function createKickedRouter({
  kickedFile,
  fs,
  cleanString,
  logRouteError
}) {
  const router = express.Router();

  router.get("/kicked", async (req, res) => {
    try {
      const raw = await fs.promises.readFile(kickedFile, "utf8");
      const rows = JSON.parse(raw || "[]");
      if (!Array.isArray(rows)) throw new Error("kicked_not_array");

      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
      res.json(buildKickedPayload(rows, cleanString));
    } catch (error) {
      logRouteError("[/api/kicked]", error);
      res.status(503).json({
        ok: false,
        error: "kicked_data_unavailable",
        summary: {
          kick_events: 0,
          missed_votes: 0,
          unique_players: 0
        },
        leaderboard: [],
        events: []
      });
    }
  });

  return router;
}

module.exports = { buildKickedPayload, createKickedRouter };
