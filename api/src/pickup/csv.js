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

function normalizeRoster(rows) {
  if (rows.length < 1 || rows.length > 256) {
    throw pickupError(422, "invalid_roster_session_count", { quarantine: true });
  }
  const sessions = rows.map((row, index) => {
    const steamId = firstValue(row, ["steam_id", "steamid", "authid"]);
    const playerName = firstValue(row, ["player_name", "name"]);
    if (!steamId ||
        !/^STEAM_[0-5]:[01]:\d{1,20}$/i.test(steamId) ||
        !playerName ||
        playerName.length > 128 ||
        /[\0-\x1f\x7f]/.test(playerName)) {
      throw pickupError(422, "invalid_roster_player", { quarantine: true });
    }
    const teamNumber = optionalInteger(firstValue(row, ["team_number", "team"]), "invalid_roster_team");
    if (teamNumber != null && (teamNumber < 0 || teamNumber > 4)) {
      throw pickupError(422, "invalid_roster_team", { quarantine: true });
    }
    const sessionIndex = optionalInteger(
      firstValue(row, ["session_index", "session_id", "session"]),
      "invalid_roster_session"
    ) ?? index + 1;
    if (sessionIndex < 1) throw pickupError(422, "invalid_roster_session", { quarantine: true });

    return {
      steamId,
      playerName,
      sessionIndex,
      teamNumber,
      teamName: ({ 1: "Blue", 2: "Red", 3: "Yellow", 4: "Green" })[teamNumber] || null,
      joinedAtEpoch: optionalInteger(
        firstValue(row, ["joined_at_epoch", "connected_at_epoch", "started_at_epoch"]),
        "invalid_roster_timestamp"
      ),
      leftAtEpoch: optionalInteger(
        firstValue(row, ["left_at_epoch", "disconnected_at_epoch", "ended_at_epoch"]),
        "invalid_roster_timestamp"
      ),
      source: row
    };
  });
  const sessionKeys = new Set();
  for (const session of sessions) {
    const key = `${session.steamId.toUpperCase()}\0${session.sessionIndex}`;
    if (sessionKeys.has(key)) {
      throw pickupError(422, "duplicate_roster_session", { quarantine: true });
    }
    sessionKeys.add(key);
  }
  return sessions;
}

module.exports = { parseCsv, normalizeRoster };
