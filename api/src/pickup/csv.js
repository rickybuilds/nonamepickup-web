"use strict";

const { pickupError } = require("./errors");

function parseCsv(text, label) {
  if (typeof text !== "string" || text.includes("\0")) {
    throw pickupError(422, "invalid_csv", { quarantine: true });
  }

  const records = [];
  let record = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === "\"" && field.length === 0) {
      quoted = true;
    } else if (char === ",") {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field.replace(/\r$/, ""));
      records.push(record);
      record = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (quoted) throw pickupError(422, "invalid_csv", { quarantine: true });
  if (field.length || record.length) {
    record.push(field.replace(/\r$/, ""));
    records.push(record);
  }
  while (records.length && records[records.length - 1].every(value => value === "")) records.pop();
  if (!records.length) throw pickupError(422, `empty_${label}`, { quarantine: true });

  const headers = records.shift().map(value => value.trim().toLowerCase());
  if (!headers.length || headers.some((value, index) => !value || headers.indexOf(value) !== index)) {
    throw pickupError(422, "invalid_csv_headers", { quarantine: true });
  }

  return records.map((values, rowIndex) => {
    if (values.length !== headers.length) {
      throw pickupError(422, "invalid_csv_row", { quarantine: true });
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index]]));
  });
}

function firstValue(row, names) {
  for (const name of names) {
    if (Object.hasOwn(row, name) && row[name] !== "") return row[name];
  }
  return null;
}

function optionalInteger(value, code) {
  if (value == null || value === "") return null;
  if (!/^-?\d+$/.test(String(value))) throw pickupError(422, code, { quarantine: true });
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw pickupError(422, code, { quarantine: true });
  return parsed;
}

function boundedInteger(value, code, { min = 0, max = 0xffffffff, fallback = null } = {}) {
  const parsed = optionalInteger(value, code);
  if (parsed == null) return fallback;
  if (parsed < min || parsed > max) {
    throw pickupError(422, code, { quarantine: true });
  }
  return parsed;
}

function booleanValue(value, code) {
  if (value == null || value === "") return false;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw pickupError(422, code, { quarantine: true });
}

function normalizeRoster(rows) {
  if (rows.length < 1 || rows.length > 256) {
    throw pickupError(422, "invalid_roster_session_count", { quarantine: true });
  }
  const sessions = rows.map((row, index) => {
    const steamId = firstValue(row, ["steam_id", "steamid", "authid"]);
    const playerName = firstValue(row, ["player_name", "name"]);
    const isBot = booleanValue(firstValue(row, ["is_bot", "bot"]), "invalid_roster_bot");
    if (!steamId ||
        (!/^STEAM_[0-5]:[01]:\d{1,20}$/i.test(steamId) &&
         !(isBot && /^(BOT|HLTV)(?::[A-Za-z0-9_-]{1,24})?$/i.test(steamId))) ||
        !playerName ||
        playerName.length > 64 ||
        /[\0-\x1f\x7f]/.test(playerName)) {
      throw pickupError(422, "invalid_roster_player", { quarantine: true });
    }
    const teamNumber = boundedInteger(
      firstValue(row, ["team_number", "initial_team", "team"]),
      "invalid_roster_team",
      { max: 4 }
    );
    const sessionIndex = boundedInteger(
      firstValue(row, ["session_index", "session_id", "session"]),
      "invalid_roster_session",
      { min: 1, fallback: index + 1 }
    );

    return {
      steamId,
      playerName,
      sessionIndex,
      initialSlot: boundedInteger(
        firstValue(row, ["initial_slot", "slot"]),
        "invalid_roster_slot",
        { max: 255 }
      ),
      teamNumber,
      teamName: ({ 1: "Blue", 2: "Red", 3: "Yellow", 4: "Green" })[teamNumber] || null,
      primaryClassId: boundedInteger(
        firstValue(row, ["primary_class_id", "class_id"]),
        "invalid_roster_class",
        { max: 255 }
      ),
      isBot,
      joinedMs: boundedInteger(
        firstValue(row, ["joined_ms", "connected_ms"]),
        "invalid_roster_timestamp"
      ),
      leftMs: boundedInteger(
        firstValue(row, ["left_ms", "disconnected_ms"]),
        "invalid_roster_timestamp"
      ),
      kills: boundedInteger(firstValue(row, ["kills"]), "invalid_roster_stat", { fallback: 0 }),
      deaths: boundedInteger(firstValue(row, ["deaths"]), "invalid_roster_stat", { fallback: 0 }),
      assists: boundedInteger(firstValue(row, ["assists"]), "invalid_roster_stat", { fallback: 0 }),
      suicides: boundedInteger(firstValue(row, ["suicides"]), "invalid_roster_stat", { fallback: 0 }),
      damageDealt: boundedInteger(
        firstValue(row, ["damage_dealt"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      damageTaken: boundedInteger(
        firstValue(row, ["damage_taken"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      flagPickups: boundedInteger(
        firstValue(row, ["flag_pickups"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      flagDrops: boundedInteger(
        firstValue(row, ["flag_drops"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      flagCaptures: boundedInteger(
        firstValue(row, ["flag_captures"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      flagReturns: boundedInteger(
        firstValue(row, ["flag_returns"]),
        "invalid_roster_stat",
        { fallback: 0 }
      ),
      source: row
    };
  });
  const sessionKeys = new Set();
  for (const session of sessions) {
    const key = String(session.sessionIndex);
    if (sessionKeys.has(key)) {
      throw pickupError(422, "duplicate_roster_session", { quarantine: true });
    }
    sessionKeys.add(key);
  }
  return sessions;
}

module.exports = { parseCsv, normalizeRoster };
