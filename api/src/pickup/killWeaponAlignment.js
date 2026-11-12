"use strict";

// Calibrate each round independently. The replay can include pre-round time
// while analytics timestamps begin at the live round start.
function alignKillWeapons(kills, events) {
  const pairKey = (attacker, victim) => attacker && victim && attacker !== victim
    ? JSON.stringify([attacker, victim]) : null;
  const pairs = new Map(), unique = new Set();
  for (const event of events) {
    const pair = pairKey(event.attacker_steam_id, event.victim_steam_id);
    const time = Number(event.event_time_seconds), weapon = String(event.weapon || "").trim();
    if (!pair || event.event_time_seconds == null || !Number.isFinite(time) || time < 0 ||
        !weapon || /^(?:unknown(?: weapon)?|weapon-0|\d+)$/i.test(weapon)) continue;
    const key = JSON.stringify([pair, time, weapon]);
    if (unique.has(key)) continue;
    unique.add(key);
    if (!pairs.has(pair)) pairs.set(pair, []);
    pairs.get(pair).push({ time, weapon, key });
  }
  const deltas = [], histogram = new Map();
  for (const kill of kills) {
    for (const event of pairs.get(pairKey(kill.attacker_steam_id, kill.steam_id)) || []) {
      const delta = event.time - kill.time_ms / 1000;
      if (Math.abs(delta) > 600) continue;
      deltas.push(delta);
      const bin = Math.round(delta);
      histogram.set(bin, (histogram.get(bin) || 0) + 1);
    }
  }
  const peaks = [...histogram.keys()].map(bin => ({ bin,
    votes: (histogram.get(bin - 1) || 0) + histogram.get(bin) + (histogram.get(bin + 1) || 0)
  })).sort((a, b) => b.votes - a.votes);
  const result = { offsetSeconds: null, matched: 0, total: kills.length, weapons: new Map(), reason: "Insufficient clock alignment evidence" };
  if (!peaks.length) return result;
  const peak = peaks[0];
  const rival = peaks.find(item => Math.abs(item.bin - peak.bin) > 3);
  if (rival && rival.votes >= peak.votes * 0.8) return { ...result, reason: "Ambiguous round clock offset" };
  const cluster = deltas.filter(delta => Math.abs(delta - peak.bin) <= 1.5).sort((a, b) => a - b);
  const offset = cluster[Math.floor(cluster.length / 2)];
  const candidates = new Map(), claims = new Map();
  for (const kill of kills) {
    const matches = (pairs.get(pairKey(kill.attacker_steam_id, kill.steam_id)) || [])
      .filter(event => Math.abs(event.time - (kill.time_ms / 1000 + offset)) <= 1.25);
    // Never assign a kill by attacker alone, or reuse an analytics event.
    if (matches.length !== 1) continue;
    candidates.set(kill, matches[0]);
    claims.set(matches[0].key, (claims.get(matches[0].key) || 0) + 1);
  }
  const weapons = new Map([...candidates].filter(([, event]) => claims.get(event.key) === 1)
    .map(([kill, event]) => [kill, event.weapon]));
  if (weapons.size < 10 || weapons.size < kills.length * 0.6) return result;
  return { offsetSeconds: offset, matched: weapons.size, total: kills.length, weapons, reason: "Aligned by both Steam IDs and round clock" };
}

function createKillWeaponRepair(db) {
  const loadKills = db.prepare("SELECT * FROM pickup_kill_locations WHERE match_id=? AND round_number=?");
  const loadEvents = db.prepare(`SELECT attacker_steam_id,victim_steam_id,event_time_seconds,weapon
    FROM match_kill_events WHERE match_id=? AND round_num=? AND is_enemy_kill=1 AND COALESCE(is_team_kill,0)=0`);
  const update = db.prepare(`UPDATE pickup_kill_locations SET weapon=?
    WHERE match_id=? AND round_number=? AND session_id=? AND time_ms=?`);
  return db.transaction((matchId, round, dryRun = false) => {
    const result = alignKillWeapons(loadKills.all(matchId, round), loadEvents.all(matchId, round));
    let changed = 0;
    for (const [kill, weapon] of result.weapons) {
      if (kill.weapon === weapon) continue;
      changed++;
      if (!dryRun) update.run(weapon, matchId, round, kill.session_id, kill.time_ms);
    }
    return { ...result, weapons: undefined, changed };
  });
}
module.exports = { alignKillWeapons, createKillWeaponRepair };
