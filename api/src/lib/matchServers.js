"use strict";

const fs = require("fs");
const path = require("path");

function splitServerAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return { host: null, port: 27015 };

  const separator = raw.lastIndexOf(":");
  if (separator <= 0 || raw.includes("]:")) {
    return { host: raw, port: 27015 };
  }

  const port = Number(raw.slice(separator + 1));
  return {
    host: raw.slice(0, separator) || null,
    port: Number.isInteger(port) && port > 0 ? port : 27015
  };
}

function serverKeyFromName(name) {
  const value = String(name || "").toLowerCase();
  if (value.includes("central 2")) return "central2";
  if (value.includes("central")) return "central";
  if (value.includes("east")) return "east";
  if (value.includes("west")) return "west";
  return null;
}

function readServers(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, "servers.json"), "utf8");
    const rows = JSON.parse(raw || "[]");
    const servers = new Map();

    for (const row of Array.isArray(rows) ? rows : []) {
      const serverKey = String(row.serverKey || row.server_key || row.key || serverKeyFromName(row.name) || "")
        .trim()
        .toLowerCase();
      if (!serverKey) continue;

      const address = splitServerAddress(row.ip);
      servers.set(serverKey, {
        serverIp: address.host
      });
    }

    return servers;
  } catch {
    return new Map();
  }
}

function readMatchServers(dataDir) {
  const matches = new Map();

  try {
    const servers = readServers(dataDir);
    const files = fs.readdirSync(dataDir)
      .filter(file => /^live_[a-z0-9_-]+\.json$/i.test(file) && file !== "live_state.json");

    for (const file of files) {
      try {
        const serverKey = file.replace(/^live_/i, "").replace(/\.json$/i, "").toLowerCase();
        const live = JSON.parse(fs.readFileSync(path.join(dataDir, file), "utf8") || "{}");
        const matchId = String(live.match_id || live.matchId || "").trim();
        if (!matchId) continue;

        matches.set(matchId, {
          serverKey,
          serverIp: servers.get(serverKey)?.serverIp || null
        });
      } catch {
        // One partially written live-state file should not break the matches API.
      }
    }
  } catch {
    // Server metadata is optional; callers still return their normal match data.
  }

  return matches;
}

module.exports = {
  readMatchServers,
  serverKeyFromName,
  splitServerAddress
};
