"use strict";
function createFlagDeathStore(db) {
  const seen = db.prepare("SELECT artifact_sha256 FROM pickup_flag_death_rounds WHERE match_id=? AND round_number=?");
  const remove = db.prepare("DELETE FROM pickup_flag_deaths WHERE match_id=? AND round_number=?");
  const putRound = db.prepare(`INSERT INTO pickup_flag_death_rounds(match_id,round_number,map,artifact_sha256,processed_at)
    VALUES(?,?,?,?,?) ON CONFLICT(match_id,round_number) DO UPDATE SET map=excluded.map, artifact_sha256=excluded.artifact_sha256, processed_at=excluded.processed_at`);
  const putDeath = db.prepare(`INSERT INTO pickup_flag_deaths(match_id,round_number,session_id,time_ms,steam_id,player_name,x,y,z)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  const saveRound = db.transaction(input => {
    if (seen.get(input.matchId, input.round)?.artifact_sha256 === input.sha256) return false;
    remove.run(input.matchId, input.round);
    putRound.run(input.matchId, input.round, input.map, input.sha256, Math.floor(Date.now()/1000));
    const roster = new Map(input.roster.map(p => [Number(p.sessionIndex), p]));
    for (const death of input.deaths) {
      const player = roster.get(death.sessionId);
      if (!player) continue;
      putDeath.run(input.matchId, input.round, death.sessionId, death.timeMs, String(player.steamId || ""),
        String(player.playerName || "Unknown player"), death.position.x, death.position.y, death.position.z);
    }
    return true;
  });
  return { hasRound: (match, round, hash) => seen.get(match, round)?.artifact_sha256 === hash, saveRound };
}
module.exports = { createFlagDeathStore };
