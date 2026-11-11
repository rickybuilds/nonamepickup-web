"use strict";
function createKillLocationStore(db) {
  const seen = db.prepare("SELECT artifact_sha256 FROM pickup_kill_rounds WHERE match_id=? AND round_number=?");
  const invalidWeapon = db.prepare(`SELECT 1 FROM pickup_kill_locations WHERE match_id=? AND round_number=?
    AND TRIM(weapon)<>'' AND TRIM(weapon) NOT GLOB '*[^0-9]*' LIMIT 1`);
  const hasRound = (match, round, hash) => seen.get(match, round)?.artifact_sha256 === hash && !invalidWeapon.get(match, round);
  const remove = db.prepare("DELETE FROM pickup_kill_locations WHERE match_id=? AND round_number=?");
  const putRound = db.prepare(`INSERT INTO pickup_kill_rounds(match_id,round_number,map,artifact_sha256,processed_at)
    VALUES(?,?,?,?,?) ON CONFLICT(match_id,round_number) DO UPDATE SET map=excluded.map,
    artifact_sha256=excluded.artifact_sha256,processed_at=excluded.processed_at`);
  const putKill = db.prepare(`INSERT INTO pickup_kill_locations
    (match_id,round_number,session_id,time_ms,steam_id,player_name,attacker_steam_id,attacker_name,
     attacker_team,victim_team,weapon,x,y,z) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const saveRound = db.transaction(input => {
    if (hasRound(input.matchId, input.round, input.sha256)) return false;
    remove.run(input.matchId, input.round);
    putRound.run(input.matchId, input.round, input.map, input.sha256, Math.floor(Date.now() / 1000));
    const roster = new Map(input.roster.map(player => [Number(player.sessionIndex), player]));
    for (const kill of input.kills) {
      const victim = roster.get(kill.sessionId), attacker = roster.get(kill.attackerSession);
      if (!victim || !attacker) continue;
      putKill.run(input.matchId, input.round, kill.sessionId, kill.timeMs,
        String(victim.steamId || ""), String(victim.playerName || "Unknown player"),
        String(attacker.steamId || ""), String(attacker.playerName || "Unknown player"),
        kill.attackerTeam, kill.victimTeam, kill.weapon, kill.position.x, kill.position.y, kill.position.z);
    }
    return true;
  });
  return { hasRound, saveRound };
}
module.exports = { createKillLocationStore };
