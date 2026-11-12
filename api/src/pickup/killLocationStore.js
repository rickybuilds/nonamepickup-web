"use strict";
function createKillLocationStore(db) {
  const seen = db.prepare("SELECT artifact_sha256 FROM pickup_kill_rounds WHERE match_id=? AND round_number=?");
  const invalidWeapon = db.prepare(`SELECT 1 FROM pickup_kill_locations WHERE match_id=? AND round_number=?
    AND (LOWER(TRIM(weapon)) IN ('unknown','unknown weapon')
      OR (TRIM(weapon)<>'' AND TRIM(weapon) NOT GLOB '*[^0-9]*')) LIMIT 1`);
  const hasRound = (match, round, hash) => seen.get(match, round)?.artifact_sha256 === hash && !invalidWeapon.get(match, round);
  const remove = db.prepare("DELETE FROM pickup_kill_locations WHERE match_id=? AND round_number=?");
  const putRound = db.prepare(`INSERT INTO pickup_kill_rounds(match_id,round_number,map,artifact_sha256,processed_at)
    VALUES(?,?,?,?,?) ON CONFLICT(match_id,round_number) DO UPDATE SET map=excluded.map,
    artifact_sha256=excluded.artifact_sha256,processed_at=excluded.processed_at`);
  const putKill = db.prepare(`INSERT INTO pickup_kill_locations
    (match_id,round_number,session_id,time_ms,steam_id,player_name,attacker_steam_id,attacker_name,
     attacker_team,victim_team,weapon,x,y,z) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const knownWeapon = db.prepare(`SELECT weapon FROM match_kill_events
    WHERE match_id=? AND round_num=? AND event_time_seconds BETWEEN ? AND ?
      AND ((attacker_steam_id=? AND victim_steam_id=?) OR
           (attacker_name=? AND victim_name=?))
      AND TRIM(COALESCE(weapon,''))<>''
    ORDER BY ABS(event_time_seconds-?) LIMIT 1`);
  const knownWeaponByAttacker = db.prepare(`SELECT weapon FROM match_kill_events
    WHERE match_id=? AND round_num=? AND event_time_seconds BETWEEN ? AND ?
      AND LOWER(TRIM(attacker_name))=LOWER(TRIM(?))
      AND TRIM(COALESCE(weapon,''))<>''
    ORDER BY ABS(event_time_seconds-?) LIMIT 1`);
  const unknownWeapon = value => {
    const text = String(value || '').trim();
    return !text || /^unknown(?: weapon)?$/i.test(text) || /^\d+$/.test(text);
  };
  const saveRound = db.transaction(input => {
    if (hasRound(input.matchId, input.round, input.sha256)) return false;
    remove.run(input.matchId, input.round);
    putRound.run(input.matchId, input.round, input.map, input.sha256, Math.floor(Date.now() / 1000));
    const roster = new Map(input.roster.map(player => [Number(player.sessionIndex), player]));
    for (const kill of input.kills) {
      const victim = roster.get(kill.sessionId), attacker = roster.get(kill.attackerSession);
      if (!victim || !attacker) continue;
      let weapon = kill.weapon;
      if (unknownWeapon(weapon)) {
        const second = Math.floor(Number(kill.timeMs) / 1000);
        const matchKill = knownWeapon.get(input.matchId, input.round, Math.max(0, second - 2), second + 2,
          String(attacker.steamId || ''), String(victim.steamId || ''), String(attacker.playerName || ''),
          String(victim.playerName || ''), second);
        if (matchKill?.weapon) weapon = matchKill.weapon;
        else {
          const attackerKill = knownWeaponByAttacker.get(input.matchId, input.round,
            Math.max(0, second - 3), second + 3, String(attacker.playerName || ''), second);
          if (attackerKill?.weapon) weapon = attackerKill.weapon;
        }
      }
      putKill.run(input.matchId, input.round, kill.sessionId, kill.timeMs,
        String(victim.steamId || ""), String(victim.playerName || "Unknown player"),
        String(attacker.steamId || ""), String(attacker.playerName || "Unknown player"),
        kill.attackerTeam, kill.victimTeam, weapon || "unknown", kill.position.x, kill.position.y, kill.position.z);
    }
    return true;
  });
  return { hasRound, saveRound };
}
module.exports = { createKillLocationStore };
