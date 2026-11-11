"use strict";
const {loadDiscordDisplayNames}=require('./discordDisplayNames');

const CLASSES = [
  { id: "soldier", label: "Soldier" }, { id: "demoman", label: "Demoman" },
  { id: "hwguy", label: "HWGuy" }, { id: "engineer", label: "Engineer" }
];
const SUSPICIOUS = new Set(["scout", "medic", "spy"]);
const SOURCES = [
  ["match_player_classes", "Round-level class seconds used for estimated participation."],
  ["match_player_round_stats", "Round-level role and team used for estimated defensive role."],
  ["match_rounds", "Round duration, offense/defense teams and scores used for estimated concessions."],
  ["match_role_events", "Isolated role/class events have no verified initial state, transition completeness or coverage contract."],
  ["match_cap_events", "Capture timestamps alone cannot attribute concessions to verified defensive-class windows."],
  ["match_capture_events", "Capture timestamps alone cannot attribute concessions to verified defensive-class windows."],
  ["match_tfcstats_events", "Event class snapshots do not prove uninterrupted defensive participation."],
  ["match_kill_events", "Classes at combat events cannot identify class/role participation between events."]
];

function loadDefenseRatings(db) {
  const maps = db.prepare(`SELECT map_name AS map, COUNT(*) AS completedMatches
    FROM matches WHERE status='completed' AND map_name IS NOT NULL
      AND TRIM(map_name) != '' AND map_name != '(unknown)'
    GROUP BY map_name ORDER BY completedMatches DESC, map_name COLLATE NOCASE`).all()
    .map(row => ({ map: row.map, completedMatches: Number(row.completedMatches),
      games: null, baseline: null, players: [], observations: [], status: "unavailable" }));
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const sources = SOURCES.map(([id, limitation]) => {
    const available = tables.has(id);
    const columns = available ? new Set(db.prepare(`PRAGMA table_info(${id})`).all().map(row => row.name)) : new Set();
    return { id, available, limitation,
      rows: available ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${id}`).get().count) : null,
      completedMatchCount: columns.has("match_id") ? Number(db.prepare(`SELECT COUNT(DISTINCT s.match_id) AS count
        FROM ${id} s JOIN matches m ON m.match_id=s.match_id WHERE m.status='completed'`).get().count) : null
    };
  });
  const coverage = { completedMatches: Number(db.prepare("SELECT COUNT(*) AS count FROM matches WHERE status='completed'").get().count) };
  if (!["match_player_classes", "match_player_round_stats", "match_rounds"].every(name => tables.has(name))) {
    return { status: "unavailable", reason: "Verified defensive role and class participation intervals are not available.", classes: CLASSES.map(item => ({ ...item })), maps,
      eligibleAppearances: null, qualifyingPlayers: null, coverage: { ...coverage, sources },
      methodology: { unit: "verified defensive-class participation", baseline: "unavailable", formula: "Defense rating = map defensive team conceded/round - player defensive team conceded/round",
        missing: ["Verified initial class, team and defensive role for each player session.", "Complete timestamped class, team, role and substitution transitions with explicit coverage validation.", "An audited verified observation unit before promoting estimates to verified ratings."] } };
  }
  const identities = new Set();
  const discordNames=loadDiscordDisplayNames(db);
  const profileIds = new Map();
  for (const table of ["player_steam_ids", "player_identities"]) if (tables.has(table)) {
    for (const row of db.prepare(`SELECT steam_id FROM ${table} WHERE steam_id IS NOT NULL`).all()) identities.add(String(row.steam_id));
  }
  if(tables.has('player_steam_ids')) {
    const columns=db.prepare('PRAGMA table_info(player_steam_ids)').all().map(r=>r.name);
    if(columns.includes('discord_id')) for(const row of db.prepare('SELECT steam_id, MIN(discord_id) AS id FROM player_steam_ids GROUP BY steam_id HAVING COUNT(DISTINCT discord_id)=1').all()) profileIds.set(String(row.steam_id),String(row.id));
  }
  // Capture counts are taken from the offense roster's round statistics, never score/10.
  const roundColumns=db.prepare('PRAGMA table_info(match_player_round_stats)').all().map(r=>r.name);
  const captures=new Map();
  if(roundColumns.includes('flag_captures')) for(const row of db.prepare(`SELECT match_id,round_num,team_name,
    SUM(flag_captures) AS caps, COUNT(*) AS participants,
    SUM(CASE WHEN flag_captures IS NULL OR flag_captures<0 OR flag_captures!=CAST(flag_captures AS INTEGER) THEN 1 ELSE 0 END) AS invalid
    FROM match_player_round_stats GROUP BY match_id,round_num,team_name`).all()) captures.set(`${row.match_id}|${row.round_num}|${row.team_name}`,row);
  const exclusions={identity:0,roster:0,invalidDuration:0,suspiciousClass:0,dominance:0,coverage:0,captureData:0};
  const matchColumns=db.prepare('PRAGMA table_info(matches)').all().map(r=>r.name),rosters=new Map();
  if(matchColumns.includes('blue_ids')&&matchColumns.includes('red_ids')) for(const match of db.prepare("SELECT match_id,blue_ids,red_ids FROM matches WHERE status='completed'").all()) {
    try {const blue=JSON.parse(match.blue_ids),red=JSON.parse(match.red_ids);const ids=[...blue,...red].map(String);rosters.set(match.match_id,Array.isArray(blue)&&Array.isArray(red)&&blue.length&&red.length&&new Set(ids).size===ids.length?new Set(ids):null);}catch{rosters.set(match.match_id,null);}
  }
  const rows = db.prepare(`SELECT r.match_id,r.player_key,r.display_name,r.round_num,r.team_name,r.role,c.class_name,c.seconds,
      rr.duration_seconds,rr.team1_score,rr.team2_score,rr.offense_team,rr.defense_team,m.map_name,m.created_at
    FROM match_player_round_stats r JOIN match_player_classes c ON c.match_id=r.match_id AND c.player_key=r.player_key AND c.round_num=r.round_num
    JOIN match_rounds rr ON rr.match_id=r.match_id AND rr.round_num=r.round_num JOIN matches m ON m.match_id=r.match_id AND m.status='completed'
    WHERE m.map_name IS NOT NULL AND TRIM(m.map_name) != '' AND m.map_name != '(unknown)' AND c.seconds IS NOT NULL AND c.seconds >= 0`).all();
  const groups = new Map();
  for (const row of rows) { const key=`${row.match_id}|${row.player_key}|${row.round_num}`; if(!groups.has(key)) groups.set(key,{...row,classes:new Map()}); const g=groups.get(key); const name=String(row.class_name||'').toLowerCase(); g.classes.set(name,(g.classes.get(name)||0)+Number(row.seconds)); }
  const byMapClass = new Map(), qualifyingPlayers = new Set(), seenAppearances = new Set(); let eligibleAppearances=0, linkedObservations=0;
  for (const g of groups.values()) {
    const role=String(g.role||'').toLowerCase(); if(!g.defense_team || String(g.team_name)!==String(g.defense_team)) continue;
    const total=[...g.classes.values()].reduce((sum,s)=>sum+s,0), duration=Number(g.duration_seconds);
    if(!identities.has(String(g.player_key))){exclusions.identity++;continue;}
    if(rosters.has(g.match_id)&&!rosters.get(g.match_id)?.has(profileIds.get(String(g.player_key)))){exclusions.roster++;continue;}
    if(!total||!Number.isFinite(duration)||duration<=0||total>duration+2){exclusions.invalidDuration++;continue;}
    if ([...g.classes].some(([name,s])=>SUSPICIOUS.has(name)&&(s>=120||s/total>.5))){exclusions.suspiciousClass++;continue;}
    const dominant=[...g.classes].sort((a,b)=>b[1]-a[1])[0];
    if(!dominant||dominant[1]/total<.7){exclusions.dominance++;continue;}
    if(total/duration<.7){exclusions.coverage++;continue;}
    const capture=captures.get(`${g.match_id}|${g.round_num}|${g.offense_team}`);
    const roster=rosters.get(g.match_id);
    if(!capture||capture.invalid||!Number.isInteger(capture.caps)||capture.caps<0||g.offense_team===g.defense_team||(roster&&capture.participants<roster.size/2)){exclusions.captureData++;continue;}
    for (const item of CLASSES) {
      if(!role.includes(item.id)) continue; const seconds=g.classes.get(item.id)||0; if(!seconds || seconds/total<.7 || total/duration<.7) continue;
      const key=`${g.map_name}|${item.id}`; if(!byMapClass.has(key)) byMapClass.set(key,{map:g.map_name,classId:item.id,rounds:new Map(),players:new Map()}); const b=byMapClass.get(key);
      const roundKey=`${g.match_id}|${g.round_num}|${g.team_name}`, conceded=Number(capture.caps);
      if(!b.rounds.has(roundKey))b.rounds.set(roundKey,{matchId:String(g.match_id),roundNum:Number(g.round_num),createdAt:Number(g.created_at)||null,conceded,team:g.team_name,playerIds:[]});
      const profileId=profileIds.get(String(g.player_key))||null;
      const playerId=profileId||String(g.player_key);
      // Linked Steam accounts belong to one Discord player. Count a shared round once.
      const appearanceKey=`${key}|${roundKey}|${playerId}`;
      if(seenAppearances.has(appearanceKey))continue;
      seenAppearances.add(appearanceKey);
      b.rounds.get(roundKey).playerIds.push(playerId);
      if(!b.players.has(playerId)) b.players.set(playerId,{id:playerId,profileId,player:profileId?(discordNames.get(profileId)||`Discord user ${profileId}`):'Unlinked player',games:0,conceded:0}); const p=b.players.get(playerId); p.games++; p.conceded+=conceded;
      eligibleAppearances++; qualifyingPlayers.add(playerId);
    }
  }
  const classMaps=new Map(); for(const b of byMapClass.values()){const observations=[...b.rounds.values()].sort((a,z)=>(a.createdAt??Infinity)-(z.createdAt??Infinity)||a.matchId.localeCompare(z.matchId)); const baseline=observations.length?observations.reduce((s,o)=>s+o.conceded,0)/observations.length:null; classMaps.set(`${b.map}|${b.classId}`,{games:observations.length,baseline,observations,players:[...b.players.values()].map(p=>({...p,conceded:p.conceded/p.games,defense:baseline-p.conceded/p.games,estimated:true})).sort((a,z)=>z.defense-a.defense||z.games-a.games||a.player.localeCompare(z.player)),status:observations.length?'estimated':'unavailable'}); linkedObservations+=observations.length; }
  const outputMaps=maps.map(map=>{const classes={}; for(const item of CLASSES) classes[item.id]=classMaps.get(`${map.map}|${item.id}`)||{games:0,baseline:null,players:[],observations:[],status:'unavailable'}; return {...map,status:Object.values(classes).some(v=>v.status==='estimated')?'estimated':'unavailable',classes};});
  if(!eligibleAppearances) return {status:'unavailable',reason:'No defensive player-round records satisfy the estimated-role, class-dominance, coverage, identity, and anomaly checks.',classes:CLASSES.map(item=>({...item})),maps:outputMaps,eligibleAppearances:0,qualifyingPlayers:0,coverage:{...coverage,linkedRows:rows.length,linkedObservations,exclusions,sources},methodology:{unit:'estimated defensive player-round appearance',baseline:'unavailable',formula:'Defense rating = map defensive team conceded/round - player defensive team conceded/round',threshold:{dominantClass:.7,classTimeCoverage:.7},missing:['No qualifying estimated observations.']}};
  return {status:'estimated',reason:'Estimated defensive ratings use round-level defensive role and class-duration records. They are not verified continuous class intervals.',classes:CLASSES.map(item=>({...item})),maps:outputMaps,eligibleAppearances,qualifyingPlayers:qualifyingPlayers.size,coverage:{...coverage,linkedRows:rows.length,linkedObservations,exclusions,sources},methodology:{unit:'estimated defensive player-round appearance',baseline:'map defensive team conceded/round',formula:'Estimated defense rating = map defensive team conceded/round - player defensive team conceded/round',threshold:{dominantClass:.7,classTimeCoverage:.7},anomalyFlags:'Scout, Medic, or Spy >=120 seconds or >50% of recorded class time is excluded and retained for diagnostics.',missing:['Continuous timestamped class transitions and an audited verified participation interval.'],estimated:true}};
}
module.exports = { loadDefenseRatings };
