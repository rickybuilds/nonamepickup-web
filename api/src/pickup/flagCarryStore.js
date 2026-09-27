"use strict";

function createFlagCarryStore(db) {
  const existing = db.prepare(`
    SELECT artifact_sha256 FROM pickup_flag_carry_rounds
    WHERE match_id = ? AND round_number = ?
  `);
  const roundInsert = db.prepare(`
    INSERT INTO pickup_flag_carry_rounds
      (match_id, round_number, map, started_at_epoch, artifact_sha256, processed_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(match_id, round_number) DO UPDATE SET
      map = excluded.map,
      started_at_epoch = excluded.started_at_epoch,
      artifact_sha256 = excluded.artifact_sha256,
      processed_at = excluded.processed_at
  `);
  const deletePlayers = db.prepare(`
    DELETE FROM pickup_flag_carry_players WHERE match_id = ? AND round_number = ?
  `);
  const deleteCarries = db.prepare(`
    DELETE FROM pickup_flag_carries WHERE match_id = ? AND round_number = ?
  `);
  const playerInsert = db.prepare(`
    INSERT INTO pickup_flag_carry_players
      (match_id, round_number, session_id, steam_id, carry_ms, carry_count, distance_units)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const carryInsert = db.prepare(`
    INSERT INTO pickup_flag_carries
      (match_id, round_number, session_id, objective_id, carry_number,
       start_ms, end_ms, distance_units)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveRound = db.transaction(input => {
    const round = Number(input.round);
    if (existing.get(input.matchId, round)?.artifact_sha256 === input.sha256) return false;
    roundInsert.run(input.matchId, round, input.map, input.startedAtEpoch,
      input.sha256, Math.floor(Date.now() / 1000));
    deletePlayers.run(input.matchId, round);
    deleteCarries.run(input.matchId, round);
    for (const player of input.roster) {
      const sessionId = Number(player.sessionIndex);
      const summary = input.flagCarryBySession?.get(sessionId);
      playerInsert.run(input.matchId, round, sessionId, String(player.steamId || ""),
        summary?.milliseconds || 0, summary?.carries || 0, summary?.distanceUnits || 0);
    }
    for (const carry of input.flagCarries || []) {
      carryInsert.run(input.matchId, round, carry.sessionId, carry.objectiveId,
        carry.carryNumber, carry.startMs, carry.endMs, carry.distanceUnits);
    }
    return true;
  });

  return {
    hasRound(matchId, round, sha256) {
      return existing.get(matchId, round)?.artifact_sha256 === sha256;
    },
    saveRound
  };
}

module.exports = { createFlagCarryStore };
