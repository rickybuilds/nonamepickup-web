"use strict";

const { buildNnMvp, FORMULA_VERSION } = require("./nnMvp");
const { buildEloPerformance } = require("./eloPerformance");
const { NN_MVP_CUTOFF_EPOCH } = require("./canonicalMvp");

const UNAVAILABLE_RETRY_SECONDS = 5 * 60;

function loadNnMvpInputs(db, matchId) {
  const playerStats = db.prepare(`
    SELECT
      COALESCE(r.display_name, s.display_name, s.player_key, s.steam_id) AS display_name,
      s.steam_id,
      s.player_key,
      s.team,
      s.kills,
      s.deaths,
      s.team_kills,
      s.enemy_damage,
      s.team_damage,
      s.damage_taken,
      s.flag_captures,
      s.flag_touches,
      s.initial_touches,
      s.conc_jumps,
      s.flag_time_seconds,
      s.main_class
    FROM match_player_stats s
    LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id = s.player_key
    LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id = s.steam_id
    LEFT JOIN ratings r ON r.player_id = COALESCE(psi_key.discord_id, psi_sid.discord_id)
    WHERE s.match_id = ?
    ORDER BY s.kills DESC
  `).all(matchId);

  let roundPlayerStats = [];
  let flagCarrierKills = [];

  try {
    roundPlayerStats = db.prepare(`
      SELECT
        match_id,
        player_key,
        steam_id,
        display_name,
        round_num,
        team_name,
        role,
        kills,
        team_kills,
        conced_kills,
        sentry_kills,
        deaths_by_enemy,
        deaths_by_team,
        suicides,
        enemy_damage,
        team_damage,
        damage_taken_enemy,
        damage_taken_team,
        self_damage,
        conc_jumps,
        flag_captures,
        flag_touches,
        initial_touches,
        flag_time_seconds,
        objectives,
        toss_percent
      FROM match_player_round_stats
      WHERE match_id = ?
      ORDER BY round_num, kills DESC
    `).all(matchId);
  } catch (error) {
    if (!String(error?.message || "").includes("no such table")) throw error;
  }

  try {
    flagCarrierKills = db.prepare(`
      SELECT
        e.attacker_key AS player_key,
        e.attacker_steam_id AS steam_id,
        SUM(CASE WHEN e.is_enemy_kill = 1 AND e.is_flag_carrier_kill = 1 THEN 1 ELSE 0 END) AS flag_carrier_kills
      FROM match_kill_events e
      WHERE e.match_id = ?
      GROUP BY e.attacker_key, e.attacker_steam_id
    `).all(matchId);
  } catch (error) {
    if (!String(error?.message || "").includes("no such table")) throw error;
  }

  return { playerStats, roundPlayerStats, flagCarrierKills };
}

function calculateMatchNnMvp(db, matchId, suppliedInputs) {
  return buildNnMvp(suppliedInputs || loadNnMvpInputs(db, matchId));
}

function calculateMatchEloPerformance(db, matchId, suppliedInputs) {
  const match = db.prepare("SELECT blue_ids, red_ids FROM matches WHERE match_id=?").get(matchId);
  const parseIds = value => {
    try { const ids = JSON.parse(value || "[]"); return Array.isArray(ids) ? ids.map(String) : []; }
    catch { return []; }
  };
  const links = new Map();
  for (const row of db.prepare("SELECT steam_id, discord_id FROM player_steam_ids").all()) {
    const ids = links.get(row.steam_id) || new Set();
    ids.add(String(row.discord_id));
    links.set(row.steam_id, ids);
  }
  return buildEloPerformance({
    ...(suppliedInputs || loadNnMvpInputs(db, matchId)),
    blueIds: parseIds(match?.blue_ids), redIds: parseIds(match?.red_ids), links,
  });
}

function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function retrySqliteBusy(action) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return action();
    } catch (error) {
      const busy = /^SQLITE_(BUSY|LOCKED)(_|$)/.test(String(error?.code || ""));
      if (!busy || attempt === 5) throw error;
      sleepSync(100 * (2 ** (attempt - 1)));
    }
  }
  return null;
}

function storedResultMatches(row, payload) {
  const available = Boolean(payload?.available && payload?.winner);
  if (String(row.nn_mvp_formula_version || "") !== String(payload?.formula_version || FORMULA_VERSION)) return false;
  if (String(row.nn_mvp_status || "") !== (available ? "available" : "unavailable")) return false;
  if (!available) return String(row.nn_mvp_reason || "") === String(payload?.reason || "NN MVP unavailable");

  const winner = payload.winner;
  return String(row.nn_mvp_player_key || "") === String(winner.player_key || "")
    && String(row.nn_mvp_steam_id || "") === String(winner.steam_id || "")
    && String(row.nn_mvp_display_name || "") === String(winner.display_name || "")
    && Number(row.nn_mvp_final_score) === Number(winner.final_score)
    && Number(row.nn_mvp_display_score) === Number(winner.display_score);
}

function persistMatchNnMvp(db, matchId, payload, computedAt = Math.floor(Date.now() / 1000)) {
  const current = db.prepare(`
    SELECT
      nn_mvp_player_key,
      nn_mvp_steam_id,
      nn_mvp_display_name,
      nn_mvp_final_score,
      nn_mvp_display_score,
      nn_mvp_formula_version,
      nn_mvp_status,
      nn_mvp_reason
    FROM matches
    WHERE match_id = ?
  `).get(matchId);
  if (!current) throw new Error(`Match not found: ${matchId}`);
  if (storedResultMatches(current, payload)) return { changes: 0, unchanged: true };

  const available = Boolean(payload?.available && payload?.winner);
  const winner = available ? payload.winner : {};
  const formulaVersion = payload?.formula_version || FORMULA_VERSION;
  const status = available ? "available" : "unavailable";
  const reason = available ? null : String(payload?.reason || "NN MVP unavailable");

  return retrySqliteBusy(() => db.transaction(() => db.prepare(`
    UPDATE matches
    SET nn_mvp_player_key = ?,
        nn_mvp_steam_id = ?,
        nn_mvp_display_name = ?,
        nn_mvp_final_score = ?,
        nn_mvp_display_score = ?,
        nn_mvp_formula_version = ?,
        nn_mvp_status = ?,
        nn_mvp_reason = ?,
        nn_mvp_computed_at = ?
    WHERE match_id = ?
  `).run(
    available ? winner.player_key || null : null,
    available ? winner.steam_id || null : null,
    available ? winner.display_name || null : null,
    available ? Number(winner.final_score) : null,
    available ? Number(winner.display_score) : null,
    formulaVersion,
    status,
    reason,
    computedAt,
    matchId
  ))());
}

function hampalyzerIdentities(db, matchId) {
  try {
    return db.prepare(`
      SELECT
        MAX(mvp_display_name) AS display_name,
        MAX(mvp_player_key) AS player_key,
        MAX(steam_id) AS steam_id
      FROM match_round_mvps
      WHERE match_id = ?
      GROUP BY COALESCE(
        NULLIF(mvp_player_key, ''),
        NULLIF(steam_id, ''),
        LOWER(TRIM(mvp_display_name))
      )
    `).all(matchId);
  } catch (error) {
    if (String(error?.message || "").includes("no such table")) return [];
    throw error;
  }
}

function touchUnavailableAttempt(db, matchId, computedAt) {
  return retrySqliteBusy(() => db.prepare(`
    UPDATE matches
    SET nn_mvp_computed_at = ?
    WHERE match_id = ? AND nn_mvp_status = 'unavailable'
  `).run(computedAt, matchId));
}

function syncPendingNnMvps(db, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Math.floor(Date.now() / 1000);
  const limit = Math.max(1, Math.min(1_000_000, Math.trunc(Number(options.limit) || 100)));
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  const retryBefore = now - UNAVAILABLE_RETRY_SECONDS;
  const rows = db.prepare(`
    SELECT *
    FROM matches
    WHERE status = 'completed'
      AND created_at >= ?
      AND (
        ? = 1
        OR nn_mvp_formula_version IS NULL
        OR nn_mvp_formula_version != ?
        OR nn_mvp_status IS NULL
        OR (nn_mvp_status = 'unavailable' AND COALESCE(nn_mvp_computed_at, 0) <= ?)
      )
    ORDER BY
      CASE WHEN nn_mvp_formula_version IS NULL OR nn_mvp_status IS NULL THEN 0 ELSE 1 END,
      COALESCE(nn_mvp_computed_at, 0),
      created_at,
      match_id
    LIMIT ?
  `).all(NN_MVP_CUTOFF_EPOCH, force ? 1 : 0, FORMULA_VERSION, retryBefore, limit);

  const summary = {
    processed: 0,
    changed: 0,
    unchanged: 0,
    unavailable: 0,
    failed: 0,
    changes: []
  };

  for (const row of rows) {
    const matchId = String(row.match_id);
    try {
      const payload = calculateMatchNnMvp(db, matchId);
      const changed = !storedResultMatches(row, payload);
      const proposed = payload?.available ? payload.winner : null;
      const record = {
        match_id: matchId,
        created_at: Number(row.created_at),
        hampalyzer: hampalyzerIdentities(db, matchId),
        previous: row.nn_mvp_status === "available" ? {
          player_key: row.nn_mvp_player_key,
          steam_id: row.nn_mvp_steam_id,
          display_name: row.nn_mvp_display_name,
          final_score: row.nn_mvp_final_score,
          display_score: row.nn_mvp_display_score
        } : null,
        proposed,
        available: Boolean(payload?.available && proposed),
        reason: payload?.available ? null : payload?.reason || "NN MVP unavailable",
        changed
      };

      summary.processed += 1;
      if (record.available) {
        if (changed) summary.changed += 1;
        else summary.unchanged += 1;
      } else {
        summary.unavailable += 1;
      }
      summary.changes.push(record);

      if (!dryRun && changed) persistMatchNnMvp(db, matchId, payload, now);
      else if (!dryRun && !record.available) touchUnavailableAttempt(db, matchId, now);
    } catch (error) {
      summary.processed += 1;
      summary.failed += 1;
      summary.changes.push({ match_id: matchId, failed: true, error: String(error?.message || error) });
    }
  }

  return summary;
}

module.exports = {
  UNAVAILABLE_RETRY_SECONDS,
  loadNnMvpInputs,
  calculateMatchNnMvp,
  calculateMatchEloPerformance,
  persistMatchNnMvp,
  syncPendingNnMvps
};
