"use strict";

const express = require("express");

function createPlayersRouter({
  db,
  cleanString,
  positiveInt,
  sendError,
  logRouteError,
  MAX_PLAYER_MATCH_LIMIT,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  parseIdList,
  cached
}) {
  const router = express.Router();
router.get("/players/search",(req,res)=>{
  try{
    const query=cleanString(req.query.q,100);
    const limit=positiveInt(req.query.limit,20,1,100);
    if(!query)return res.json({ok:true,data:[]});

    const escaped=query.replace(/[\\%_]/g,"\\$&");

    const rows=db.prepare(`
      WITH primary_steam AS (
        SELECT discord_id, MIN(steam_id) AS steam_id
        FROM player_steam_ids
        WHERE is_primary = 1
        GROUP BY discord_id
      )
      SELECT
        r.player_id AS id,
        COALESCE(r.display_name,r.player_id) AS player,
        r.rating,
        COALESCE(up.hide_elo,0) AS hide_elo,
        ps.steam_id,
        sp.steam_id64,
        sp.personaname,
        sp.profileurl,
        sp.avatar,
        sp.avatarmedium,
        sp.avatarfull,
        COUNT(DISTINCT m.match_id) AS games,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(r.player_id AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(r.player_id AS TEXT)) THEN 1
          ELSE 0 END) AS wins,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(r.player_id AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(r.player_id AS TEXT)) THEN 1
          ELSE 0 END) AS losses,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS ties
      FROM ratings r
      LEFT JOIN user_prefs up ON up.player_id=r.player_id
      LEFT JOIN primary_steam ps ON CAST(ps.discord_id AS TEXT)=CAST(r.player_id AS TEXT)
      LEFT JOIN steam_profiles sp ON sp.steam_id=ps.steam_id
      LEFT JOIN rating_changes rc ON rc.player_id=r.player_id
      LEFT JOIN matches m ON m.match_id=rc.match_id AND m.status='completed'
      WHERE CAST(r.player_id AS TEXT)=?
         OR LOWER(COALESCE(r.display_name,'')) LIKE LOWER(?) ESCAPE '\\'
      GROUP BY r.player_id
      ORDER BY
        CASE WHEN CAST(r.player_id AS TEXT)=? THEN 0
             WHEN LOWER(COALESCE(r.display_name,''))=LOWER(?) THEN 1
             ELSE 2 END,
        r.rating DESC
      LIMIT ?
    `).all(query,`%${escaped}%`,query,query,limit);

    res.setHeader("Cache-Control","public, max-age=10");
    res.json({
      ok:true,
      data:rows.map(row=>{
        const wins=Number(row.wins||0);
        const losses=Number(row.losses||0);
        const ties=Number(row.ties||0);
        const decided=wins+losses;
        return{
          id:String(row.id),
          player:row.player||String(row.id),
          elo:row.hide_elo?null:row.rating,
          hidden:!!row.hide_elo,
          wins,
          losses,
          ties,
          record:`${wins}-${losses}-${ties}`,
          win_pct:decided?Math.round((wins/decided)*100):0,
          steam_id:row.steam_id||null,
          steam_id64:row.steam_id64||null,
          personaname:row.personaname||null,
          profileurl:row.profileurl||null,
          avatar:row.avatar||null,
          avatarmedium:row.avatarmedium||null,
          avatarfull:row.avatarfull||null
        };
      })
    });
  }catch(error){
    logRouteError("[/api/players/search]",error);
    sendError(res,500,"player_search_failed");
  }
});

router.get("/steam/profile/:discordId",(req,res)=>{
  try{
    const discordId=cleanString(req.params.discordId,100);
    if(!discordId)return sendError(res,400,"invalid_player");

    const profile=db.prepare(`
      SELECT
        psi.discord_id,
        psi.steam_id,
        sp.steam_id64,
        sp.personaname,
        sp.profileurl,
        sp.avatar,
        sp.avatarmedium,
        sp.avatarfull
      FROM player_steam_ids psi
      LEFT JOIN steam_profiles sp ON sp.steam_id=psi.steam_id
      WHERE CAST(psi.discord_id AS TEXT)=?
        AND psi.is_primary=1
      ORDER BY psi.steam_id
      LIMIT 1
    `).get(discordId);

    if(!profile)return sendError(res,404,"steam_profile_not_found");

    res.setHeader("Cache-Control","public, max-age=300, stale-while-revalidate=3600");
    res.json({
      ok:true,
      data:{
        discord_id:String(profile.discord_id),
        steam_id:profile.steam_id,
        steam_id64:profile.steam_id64||null,
        personaname:profile.personaname||null,
        profileurl:profile.profileurl||null,
        avatar:profile.avatar||null,
        avatarmedium:profile.avatarmedium||null,
        avatarfull:profile.avatarfull||null
      }
    });
  }catch(error){
    logRouteError("[/api/steam/profile/:discordId]",error);
    sendError(res,500,"steam_profile_failed");
  }
});

const BREAKDOWN_FIELDS=[
  "kills",
  "deaths",
  "enemy_damage",
  "team_damage",
  "damage_taken",
  "caps",
  "touches",
  "initial_touches",
  "conc_jumps",
  "flag_time",
  "team_kills",
  "conceded_kills",
  "sentry_kills",
  "enemy_deaths",
  "team_deaths",
  "suicide_deaths",
  "self_damage",
  "objectives",
  "toss_percent"
];

function safeTableRead(fn,fallback){
  try{
    return fn();
  }catch(error){
    if(String(error?.message||"").includes("no such table"))return fallback;
    throw error;
  }
}

function metricValue(row,key){
  return Number(row?.[key]||0);
}

function emptyBreakdownTotals(){
  return BREAKDOWN_FIELDS.reduce((out,key)=>{
    out[key]=0;
    return out;
  },{});
}

function cleanMetric(value,decimals=2){
  const number=Number(value||0);
  if(!Number.isFinite(number))return 0;
  return Number(number.toFixed(decimals));
}

function makeBreakdownStats(row,sampleMatches){
  const totals=emptyBreakdownTotals();
  for(const key of BREAKDOWN_FIELDS){
    totals[key]=key==="toss_percent"
      ? cleanMetric(row?.toss_percent,1)
      : metricValue(row,key);
  }

  const matches=Number(sampleMatches||0);
  const perMatch=emptyBreakdownTotals();
  for(const key of BREAKDOWN_FIELDS){
    perMatch[key]=key==="toss_percent"
      ? totals[key]
      : matches?cleanMetric(totals[key]/matches,2):0;
  }

  return {totals,perMatch};
}

function placeholders(values){
  return values.map(() => "?").join(",");
}

function roundTeamExpression(){
  return "LOWER(REPLACE(REPLACE(REPLACE(TRIM(s.team_name),' ',''),'_',''),'-',''))";
}

const OFFICIAL_KILL_CLASS_CONFIDENCES=[
  "exact_single_class_round",
  "exact_timeline_match",
  "exact_after_pause_clamped"
];

function resolvePlayerIdentity(playerId){
  const player=db.prepare(`
    SELECT player_id,display_name
    FROM ratings
    WHERE CAST(player_id AS TEXT)=?
  `).get(playerId);

  const steamRows=safeTableRead(()=>db.prepare(`
    SELECT steam_id
    FROM player_steam_ids
    WHERE CAST(discord_id AS TEXT)=?
      AND steam_id IS NOT NULL
      AND steam_id!=''
    ORDER BY is_primary DESC, steam_id
  `).all(playerId),[]);

  const directSteam=String(playerId||"").startsWith("STEAM_")?[String(playerId)]:[];
  const steamIds=[...new Set([...steamRows.map(row=>String(row.steam_id||"")).filter(Boolean),...directSteam])];

  return{
    id:String(player?.player_id||playerId),
    name:player?.display_name||String(playerId),
    steam_id:steamIds[0]||null,
    steamIds,
    requestedId:String(playerId||"")
  };
}

function killEventIdentityWhere(identity,alias=""){
  const prefix=alias?alias+".":"";
  const clauses=[`CAST(${prefix}attacker_discord_id AS TEXT)=?`];
  const params=[identity.id];
  if(identity.steamIds.length){
    clauses.push(`(
      (${prefix}attacker_discord_id IS NULL OR ${prefix}attacker_discord_id='')
      AND ${prefix}attacker_steam_id IN (${placeholders(identity.steamIds)})
    )`);
    params.push(...identity.steamIds);
  }
  return{
    sql:"("+clauses.join(" OR ")+")",
    params
  };
}

function fastKillEventIdentityWhere(identity,alias=""){
  const prefix=alias?alias+".":"";
  const requested=String(identity.requestedId||identity.id||"");
  if(requested.startsWith("STEAM_")){
    const steamIds=identity.steamIds.length?identity.steamIds:[requested];
    return{
      sql:`${prefix}attacker_steam_id IN (${placeholders(steamIds)})`,
      params:steamIds
    };
  }
  return{
    sql:`CAST(${prefix}attacker_discord_id AS TEXT)=?`,
    params:[identity.id]
  };
}

function timedGranularQuery(label,fn){
  console.time(label);
  try{
    return fn();
  }finally{
    console.timeEnd(label);
  }
}

function ensureGranularIndexes(){
  safeTableRead(()=>{
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_mke_player_victim_full
      ON match_kill_events(attacker_discord_id, victim_discord_id, victim_steam_id, victim_key)
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_mke_player_event_order
      ON match_kill_events(attacker_discord_id, match_id, round_num, event_time_seconds, id)
    `).run();
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_mke_steam_event_fast
      ON match_kill_events(attacker_steam_id, match_id, round_num, event_time_seconds, id)
    `).run();
  },null);
}

function officialKillConfidenceWhere(alias=""){
  const prefix=alias?alias+".":"";
  return `${prefix}attacker_class_confidence IN (${placeholders(OFFICIAL_KILL_CLASS_CONFIDENCES)})`;
}

function killEventSourceConfidence(confidence){
  return OFFICIAL_KILL_CLASS_CONFIDENCES.includes(String(confidence||""))?"official":"uncertain";
}

function mapKillDrilldownRow(row){
  return{
    id:Number(row.id||0),
    matchId:row.match_id,
    map:row.map_name||null,
    created_at:row.created_at||null,
    round:Number(row.round_num||0),
    eventTimeSeconds:row.event_time_seconds===null?null:Number(row.event_time_seconds||0),
    eventTimeText:row.event_time_text||null,
    weapon:row.weapon,
    victim:{
      name:row.victim_name||null,
      key:row.victim_key||null,
      discord_id:row.victim_discord_id||null,
      steam_id:row.victim_steam_id||null,
      team:row.victim_team||null
    },
    attacker:{
      name:row.attacker_name||null,
      team:row.attacker_team||null,
      role:row.attacker_role||null,
      class:row.attacker_class||null,
      classConfidence:row.attacker_class_confidence||null,
      classAttribution:killEventSourceConfidence(row.attacker_class_confidence)
    },
    flags:{
      enemyKill:!!row.is_enemy_kill,
      teamKill:!!row.is_team_kill,
      conced:!!row.is_conced,
      flagCarrierKill:!!row.is_flag_carrier_kill
    },
    sourceConfidence:row.source_confidence||null,
    sourceUrl:row.source_url||null
  };
}

function emptyGranularPayload(identity,granularAvailable=false){
  return{
    player:{
      id:identity.id,
      name:identity.name,
      steam_id:identity.steam_id
    },
    source:{
      table:"match_kill_events",
      granularAvailable,
      officialClassConfidences:OFFICIAL_KILL_CLASS_CONFIDENCES,
      uncertainClassConfidences:[
        "unknown_timeline_gap",
        "victim_name_unresolved"
      ]
    },
    sample:{
      kills:0,
      enemyKills:0,
      teamKills:0,
      concededKills:0,
      flagCarrierKills:0,
      matches:0,
      rounds:0,
      officialClassKills:0,
      uncertainClassKills:0
    },
    classWeapons:[],
    roleWeapons:[],
    flagCarrierKills:[],
    concededKills:[],
    favoriteVictims:[],
    aliasHistory:[],
    matchDrilldown:[]
  };
}

function buildGranularPlayerPayload(identity,options={}){
  const limit=positiveInt(options.limit,50,1,250);
  const matchId=options.matchId?cleanString(options.matchId,100):"";
  const includeSample=String(options.includeSample||"")==="1";
  const identityWhere=fastKillEventIdentityWhere(identity,"e");
  const officialWhere=officialKillConfidenceWhere("e");
  const matchFilter=matchId?"AND e.match_id=?":"";
  const matchParams=matchId?[matchId]:[];
  const timingPrefix=`granular:${identity.id}${matchId?":"+matchId:""}`;

  return safeTableRead(()=>{
    ensureGranularIndexes();
    const sample=includeSample?timedGranularQuery(`${timingPrefix}:sample`,()=>db.prepare(`
      SELECT
        COUNT(*) AS kills,
        SUM(CASE WHEN COALESCE(e.is_enemy_kill,0)=1 THEN 1 ELSE 0 END) AS enemyKills,
        SUM(CASE WHEN COALESCE(e.is_team_kill,0)=1 THEN 1 ELSE 0 END) AS teamKills,
        SUM(CASE WHEN COALESCE(e.is_conced,0)=1 THEN 1 ELSE 0 END) AS concededKills,
        SUM(CASE WHEN COALESCE(e.is_flag_carrier_kill,0)=1 THEN 1 ELSE 0 END) AS flagCarrierKills,
        SUM(CASE WHEN ${officialWhere} THEN 1 ELSE 0 END) AS officialClassKills,
        SUM(CASE WHEN NOT (${officialWhere}) THEN 1 ELSE 0 END) AS uncertainClassKills
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        ${matchFilter}
    `).get(
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...identityWhere.params,
      ...matchParams
    )):null;

    const sampleDistinct=includeSample?timedGranularQuery(`${timingPrefix}:sampleDistinct`,()=>db.prepare(`
      SELECT
        COUNT(DISTINCT e.match_id) AS matches,
        COUNT(DISTINCT e.match_id || ':' || e.round_num) AS rounds
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        ${matchFilter}
    `).get(...identityWhere.params,...matchParams)):null;

    const classWeapons=timedGranularQuery(`${timingPrefix}:classWeapons`,()=>db.prepare(`
      SELECT
        COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
        e.weapon,
        COUNT(*) AS kills,
        COUNT(DISTINCT e.match_id) AS matchesWithKill
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        AND ${officialWhere}
        AND COALESCE(e.is_enemy_kill,1)=1
        ${matchFilter}
      GROUP BY class,e.weapon
      ORDER BY kills DESC,class,e.weapon
      LIMIT ?
    `).all(...identityWhere.params,...OFFICIAL_KILL_CLASS_CONFIDENCES,...matchParams,limit));

    const roleWeapons=timedGranularQuery(`${timingPrefix}:roleWeapons`,()=>db.prepare(`
      SELECT
        COALESCE(NULLIF(e.attacker_role,''),'unknown') AS role,
        COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
        e.weapon,
        COUNT(*) AS kills
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        AND ${officialWhere}
        AND COALESCE(e.is_enemy_kill,1)=1
        ${matchFilter}
      GROUP BY role,class,e.weapon
      ORDER BY role,kills DESC,class,e.weapon
      LIMIT ?
    `).all(...identityWhere.params,...OFFICIAL_KILL_CLASS_CONFIDENCES,...matchParams,limit));

    const flagCarrierKills=timedGranularQuery(`${timingPrefix}:flagCarrierKills`,()=>db.prepare(`
      SELECT
        COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
        e.weapon,
        COUNT(*) AS kills,
        COUNT(DISTINCT e.match_id) AS matchesWithKill
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        AND ${officialWhere}
        AND COALESCE(e.is_flag_carrier_kill,0)=1
        ${matchFilter}
      GROUP BY class,e.weapon
      ORDER BY kills DESC,class,e.weapon
      LIMIT ?
    `).all(...identityWhere.params,...OFFICIAL_KILL_CLASS_CONFIDENCES,...matchParams,limit));

    const concededKills=timedGranularQuery(`${timingPrefix}:concededKills`,()=>db.prepare(`
      SELECT
        COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
        e.weapon,
        COUNT(*) AS kills,
        COUNT(DISTINCT e.match_id) AS matchesWithKill
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        AND ${officialWhere}
        AND COALESCE(e.is_conced,0)=1
        ${matchFilter}
      GROUP BY class,e.weapon
      ORDER BY kills DESC,class,e.weapon
      LIMIT ?
    `).all(...identityWhere.params,...OFFICIAL_KILL_CLASS_CONFIDENCES,...matchParams,limit));

    const favoriteVictims=timedGranularQuery(`${timingPrefix}:favoriteVictims`,()=>db.prepare(`
      SELECT
        e.victim_discord_id,
        e.victim_steam_id,
        e.victim_key,
        COALESCE(NULLIF(MAX(e.victim_name),''),NULLIF(MIN(e.victim_name),''),NULLIF(e.victim_key,''),'Unknown') AS victim_name,
        COUNT(*) AS kills
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        AND COALESCE(e.is_enemy_kill,1)=1
        ${matchFilter}
      GROUP BY e.victim_discord_id,e.victim_steam_id,e.victim_key
      ORDER BY kills DESC,victim_name
      LIMIT 25
    `).all(...identityWhere.params,...matchParams));

    const aliasHistory=timedGranularQuery(`${timingPrefix}:aliasHistory`,()=>db.prepare(`
      SELECT
        COALESCE(NULLIF(e.attacker_name,''),'Unknown') AS name,
        COUNT(*) AS kills
      FROM match_kill_events e
      WHERE ${identityWhere.sql}
        ${matchFilter}
      GROUP BY name
      ORDER BY kills DESC,name
      LIMIT 25
    `).all(...identityWhere.params,...matchParams));

    const drilldown=timedGranularQuery(`${timingPrefix}:matchDrilldown`,()=>db.prepare(`
      SELECT
        e.id,
        e.match_id,
        e.source_url,
        e.round_num,
        e.event_time_seconds,
        e.event_time_text,
        e.attacker_name,
        e.attacker_team,
        e.attacker_role,
        e.attacker_class,
        e.attacker_class_confidence,
        e.weapon,
        e.victim_name,
        e.victim_key,
        e.victim_steam_id,
        e.victim_discord_id,
        e.victim_team,
        e.is_enemy_kill,
        e.is_team_kill,
        e.is_conced,
        e.is_flag_carrier_kill,
        e.source_confidence,
        m.map_name,
        m.created_at
      FROM match_kill_events e
      LEFT JOIN matches m ON m.match_id=e.match_id
      WHERE ${identityWhere.sql}
        ${matchFilter}
      ORDER BY COALESCE(m.created_at,0) DESC,e.match_id DESC,e.round_num,e.event_time_seconds,e.id
      LIMIT ?
    `).all(...identityWhere.params,...matchParams,limit));

    return{
      ...emptyGranularPayload(identity,true),
      sample:{
        kills:includeSample?Number(sample?.kills||0):null,
        enemyKills:includeSample?Number(sample?.enemyKills||0):null,
        teamKills:includeSample?Number(sample?.teamKills||0):null,
        concededKills:includeSample?Number(sample?.concededKills||0):null,
        flagCarrierKills:includeSample?Number(sample?.flagCarrierKills||0):null,
        matches:includeSample?Number(sampleDistinct?.matches||0):null,
        rounds:includeSample?Number(sampleDistinct?.rounds||0):null,
        officialClassKills:includeSample?Number(sample?.officialClassKills||0):null,
        uncertainClassKills:includeSample?Number(sample?.uncertainClassKills||0):null
      },
      classWeapons:classWeapons.map(row=>({
        class:row.class,
        weapon:row.weapon,
        kills:Number(row.kills||0),
        matchesWithKill:Number(row.matchesWithKill||0),
        killsPerMatch:Number(row.matchesWithKill||0)>0
          ? Number(row.kills||0)/Number(row.matchesWithKill||0)
          : 0
      })),
      roleWeapons:roleWeapons.map(row=>({
        role:row.role,
        class:row.class,
        weapon:row.weapon,
        kills:Number(row.kills||0)
      })),
      flagCarrierKills:flagCarrierKills.map(row=>({
        class:row.class,
        weapon:row.weapon,
        kills:Number(row.kills||0),
        matchesWithKill:Number(row.matchesWithKill||0),
        killsPerMatch:Number(row.matchesWithKill||0)>0
          ? Number(row.kills||0)/Number(row.matchesWithKill||0)
          : 0
      })),
      concededKills:concededKills.map(row=>({
        class:row.class,
        weapon:row.weapon,
        kills:Number(row.kills||0),
        matchesWithKill:Number(row.matchesWithKill||0),
        killsPerMatch:Number(row.matchesWithKill||0)>0
          ? Number(row.kills||0)/Number(row.matchesWithKill||0)
          : 0
      })),
      favoriteVictims:favoriteVictims.map(row=>({
        victimDiscordId:row.victim_discord_id||null,
        victimSteamId:row.victim_steam_id||null,
        victimKey:row.victim_key||null,
        victimName:row.victim_name,
        kills:Number(row.kills||0)
      })),
      aliasHistory:aliasHistory.map(row=>({
        name:row.name,
        kills:Number(row.kills||0)
      })),
      matchDrilldown:drilldown.map(mapKillDrilldownRow)
    };
  },emptyGranularPayload(identity,false));
}

router.get("/player/:id/granular",(req,res)=>{
  try{
    const playerId=cleanString(req.params.id,100);
    if(!playerId)return sendError(res,400,"invalid_player");

    const identity=resolvePlayerIdentity(playerId);
    const data=buildGranularPlayerPayload(identity,{
      limit:positiveInt(req.query.limit,50,1,250),
      matchId:req.query.matchId,
      includeSample:req.query.includeSample
    });

    res.setHeader("Cache-Control","public, max-age=5, stale-while-revalidate=20");
    res.json({ok:true,data});
  }catch(error){
    logRouteError("[/api/player/:id/granular]",error);
    sendError(res,500,"player_granular_failed");
  }
});

router.get("/player/:id/granular/events",(req,res)=>{
  try{
    const playerId=cleanString(req.params.id,100);
    if(!playerId)return sendError(res,400,"invalid_player");

    const identity=resolvePlayerIdentity(playerId);
    const limit=positiveInt(req.query.limit,100,1,500);
    const offset=positiveInt(req.query.offset,0,0,100000);
    const matchId=req.query.matchId?cleanString(req.query.matchId,100):"";
    const identityWhere=fastKillEventIdentityWhere(identity,"e");
    const matchFilter=matchId?"AND e.match_id=?":"";
    const matchParams=matchId?[matchId]:[];
    const timingPrefix=`granular:${identity.id}:events${matchId?":"+matchId:""}`;

    const data=safeTableRead(()=>{
      ensureGranularIndexes();

      const rows=timedGranularQuery(`${timingPrefix}:matchDrilldown`,()=>db.prepare(`
        SELECT
          e.id,
          e.match_id,
          e.source_url,
          e.round_num,
          e.event_time_seconds,
          e.event_time_text,
          e.attacker_name,
          e.attacker_team,
          e.attacker_role,
          e.attacker_class,
          e.attacker_class_confidence,
          e.weapon,
          e.victim_name,
          e.victim_key,
          e.victim_steam_id,
          e.victim_discord_id,
          e.victim_team,
          e.is_enemy_kill,
          e.is_team_kill,
          e.is_conced,
          e.is_flag_carrier_kill,
          e.source_confidence,
          m.map_name,
          m.created_at
        FROM match_kill_events e
        LEFT JOIN matches m ON m.match_id=e.match_id
        WHERE ${identityWhere.sql}
          ${matchFilter}
        ORDER BY COALESCE(m.created_at,0) DESC,e.match_id DESC,e.round_num,e.event_time_seconds,e.id
        LIMIT ? OFFSET ?
      `).all(...identityWhere.params,...matchParams,limit+1,offset));

      const hasMore=rows.length>limit;
      const pageRows=hasMore?rows.slice(0,limit):rows;

      return{
        player:{
          id:identity.id,
          name:identity.name,
          steam_id:identity.steam_id
        },
        total:null,
        hasMore,
        limit,
        offset,
        events:pageRows.map(mapKillDrilldownRow)
      };
    },{
      player:{
        id:identity.id,
        name:identity.name,
        steam_id:identity.steam_id
      },
      total:null,
      hasMore:false,
      limit,
      offset,
      events:[]
    });

    res.setHeader("Cache-Control","public, max-age=5, stale-while-revalidate=20");
    res.json({ok:true,data});
  }catch(error){
    logRouteError("[/api/player/:id/granular/events]",error);
    sendError(res,500,"player_granular_events_failed");
  }
});

// Player Breakdown - aggregate Hampalyzer totals for the future breakdown UI.
router.get("/player/:id/breakdown",(req,res)=>{
  try{
    const playerId=cleanString(req.params.id,100);
    if(!playerId)return sendError(res,400,"invalid_player");

    const player=db.prepare(`
      SELECT player_id,display_name
      FROM ratings
      WHERE player_id=?
    `).get(playerId);

    if(!player)return sendError(res,404,"player_not_found");

    const steamRows=safeTableRead(()=>db.prepare(`
      SELECT steam_id
      FROM player_steam_ids
      WHERE CAST(discord_id AS TEXT)=?
        AND steam_id IS NOT NULL
        AND steam_id!=''
      ORDER BY is_primary DESC, steam_id
    `).all(playerId),[]);

    const steamIds=[...new Set(steamRows.map(row=>String(row.steam_id||"")).filter(Boolean))];
    const identityKeys=[...new Set([...steamIds,playerId].filter(Boolean))];
    const identitySql=placeholders(identityKeys);
    const identityParams=[...identityKeys,...identityKeys];
    const identityWhere=`(s.steam_id IN (${identitySql}) OR s.player_key IN (${identitySql}))`;
    const classWeaponSql=placeholders(identityKeys);

    const matchTotals=safeTableRead(()=>db.prepare(`
      SELECT
        COUNT(DISTINCT s.match_id) AS matches,
        SUM(s.kills) AS kills,
        SUM(s.deaths) AS deaths,
        SUM(s.enemy_damage) AS enemy_damage,
        SUM(s.team_damage) AS team_damage,
        SUM(s.damage_taken) AS damage_taken,
        SUM(s.flag_captures) AS caps,
        SUM(s.flag_touches) AS touches,
        SUM(s.initial_touches) AS initial_touches,
        SUM(s.conc_jumps) AS conc_jumps,
        SUM(s.flag_time_seconds) AS flag_time
      FROM match_player_stats s
      JOIN matches m ON m.match_id=s.match_id AND m.status='completed'
      WHERE ${identityWhere}
    `).get(...identityParams),{matches:0});

    function roundTotals(extraWhere="",extraParams=[]){
      return safeTableRead(()=>db.prepare(`
        SELECT
          COUNT(DISTINCT s.match_id) AS matches,
          COUNT(*) AS rounds,
          SUM(s.kills) AS kills,
          SUM(COALESCE(s.deaths_by_enemy,0)+COALESCE(s.deaths_by_team,0)+COALESCE(s.suicides,0)) AS deaths,
          SUM(s.enemy_damage) AS enemy_damage,
          SUM(s.team_damage) AS team_damage,
          SUM(COALESCE(s.damage_taken_enemy,0)+COALESCE(s.damage_taken_team,0)) AS damage_taken,
          SUM(s.flag_captures) AS caps,
          SUM(s.flag_touches) AS touches,
          SUM(s.initial_touches) AS initial_touches,
          SUM(s.conc_jumps) AS conc_jumps,
          SUM(s.flag_time_seconds) AS flag_time,
          SUM(s.team_kills) AS team_kills,
          SUM(s.conced_kills) AS conceded_kills,
          SUM(s.sentry_kills) AS sentry_kills,
          SUM(s.deaths_by_enemy) AS enemy_deaths,
          SUM(s.deaths_by_team) AS team_deaths,
          SUM(s.suicides) AS suicide_deaths,
          SUM(s.self_damage) AS self_damage,
          SUM(s.objectives) AS objectives,
          AVG(NULLIF(s.toss_percent,0)) AS toss_percent
        FROM match_player_round_stats s
        JOIN matches m ON m.match_id=s.match_id AND m.status='completed'
        JOIN match_rounds mr ON mr.match_id=s.match_id AND mr.round_num=s.round_num
        WHERE ${identityWhere}
          ${extraWhere}
      `).get(...identityParams,...extraParams),{matches:0,rounds:0});
    }

    const normalizedTeam=roundTeamExpression();
    const roundOverall=roundTotals();
    const roundFilters={
      offense:roundTotals("AND LOWER(TRIM(s.team_name))=LOWER(TRIM(mr.offense_team))"),
      defense:roundTotals("AND LOWER(TRIM(s.team_name))=LOWER(TRIM(mr.defense_team))"),
      teamA:roundTotals(`AND ${normalizedTeam} IN ('a','teama')`),
      teamB:roundTotals(`AND ${normalizedTeam} IN ('b','teamb')`)
    };

    const teamNameRows=safeTableRead(()=>db.prepare(`
      SELECT
        s.team_name,
        COUNT(*) AS rounds,
        COUNT(DISTINCT s.match_id) AS matches
      FROM match_player_round_stats s
      JOIN matches m ON m.match_id=s.match_id AND m.status='completed'
      WHERE ${identityWhere}
      GROUP BY s.team_name
      ORDER BY rounds DESC
    `).all(...identityParams),[]);

    const overallStats={
      ...roundOverall,
      ...matchTotals,
      team_kills:metricValue(roundOverall,"team_kills"),
      conceded_kills:metricValue(roundOverall,"conceded_kills"),
      sentry_kills:metricValue(roundOverall,"sentry_kills"),
      enemy_deaths:metricValue(roundOverall,"enemy_deaths"),
      team_deaths:metricValue(roundOverall,"team_deaths"),
      suicide_deaths:metricValue(roundOverall,"suicide_deaths"),
      self_damage:metricValue(roundOverall,"self_damage"),
      objectives:metricValue(roundOverall,"objectives"),
      toss_percent:metricValue(roundOverall,"toss_percent")
    };

    const totalClassSeconds=safeTableRead(()=>db.prepare(`
      SELECT SUM(c.seconds) AS seconds
      FROM match_player_classes c
      JOIN matches m ON m.match_id=c.match_id AND m.status='completed'
      WHERE c.player_key IN (${classWeaponSql})
    `).get(...identityKeys),{seconds:0});

    const classRows=safeTableRead(()=>db.prepare(`
      SELECT
        c.class_name,
        SUM(c.seconds) AS seconds,
        COUNT(DISTINCT c.match_id) AS matches
      FROM match_player_classes c
      JOIN matches m ON m.match_id=c.match_id AND m.status='completed'
      WHERE c.player_key IN (${classWeaponSql})
      GROUP BY c.class_name
      ORDER BY seconds DESC
    `).all(...identityKeys),[]);

    const weaponRows=safeTableRead(()=>db.prepare(`
      SELECT
        w.weapon,
        SUM(w.kills) AS kills,
        COUNT(DISTINCT w.match_id) AS matches
      FROM match_player_weapons w
      JOIN matches m ON m.match_id=w.match_id AND m.status='completed'
      WHERE w.player_key IN (${classWeaponSql})
      GROUP BY w.weapon
      ORDER BY kills DESC
    `).all(...identityKeys),[]);

    const matchSample=Number(matchTotals?.matches||0);
    const roundMatches=Number(roundOverall?.matches||0);
    const rounds=Number(roundOverall?.rounds||0);
    const hasRoundSplits=(Number(roundFilters.offense?.rounds||0)+Number(roundFilters.defense?.rounds||0))>0;
    const splitSamples={
      overall:{
        matches:roundMatches,
        rounds
      },
      offense:{
        matches:Number(roundFilters.offense?.matches||0),
        rounds:Number(roundFilters.offense?.rounds||0)
      },
      defense:{
        matches:Number(roundFilters.defense?.matches||0),
        rounds:Number(roundFilters.defense?.rounds||0)
      },
      teamA:{
        matches:Number(roundFilters.teamA?.matches||0),
        rounds:Number(roundFilters.teamA?.rounds||0)
      },
      teamB:{
        matches:Number(roundFilters.teamB?.matches||0),
        rounds:Number(roundFilters.teamB?.rounds||0)
      }
    };
    const totalSeconds=Number(totalClassSeconds?.seconds||0);

    res.setHeader("Cache-Control","public, max-age=5, stale-while-revalidate=20");
    res.json({
      ok:true,
      data:{
        player:{
          id:String(player.player_id),
          name:player.display_name||String(player.player_id),
          steam_id:steamIds[0]||null
        },
        sample:{
          matches:matchSample,
          roundMatches,
          rounds,
          hasRoundSplits,
          splits:splitSamples,
          teamNames:teamNameRows.map(row=>({
            name:row.team_name||"",
            matches:Number(row.matches||0),
            rounds:Number(row.rounds||0)
          }))
        },
        modes:["totals","per_match"],
        filters:["overall","offense","defense"],
        stats:{
          overall:makeBreakdownStats(overallStats,matchSample),
          offense:makeBreakdownStats(roundFilters.offense,Number(roundFilters.offense?.matches||0)),
          defense:makeBreakdownStats(roundFilters.defense,Number(roundFilters.defense?.matches||0))
        },
        classes:classRows.map(row=>{
          const seconds=Number(row.seconds||0);
          const matches=Number(row.matches||0);
          return{
            class:row.class_name,
            seconds,
            hours:cleanMetric(seconds/3600,1),
            pct:totalSeconds?cleanMetric((seconds/totalSeconds)*100,1):0,
            matches,
            avgSecondsPerMatch:matches?cleanMetric(seconds/matches,1):0
          };
        }),
        weapons:weaponRows.map(row=>{
          const kills=Number(row.kills||0);
          const matches=Number(row.matches||0);
          return{
            weapon:row.weapon,
            kills,
            killsPerMatch:matches?cleanMetric(kills/matches,2):0
          };
        }),
        unavailable:{
          offenseDefense:!hasRoundSplits,
          weaponDamage:true,
          classCombat:true
        }
      }
    });
  }catch(error){
    logRouteError("[/api/player/:id/breakdown]",error);
    sendError(res,500,"player_breakdown_failed");
  }
});

// Player Card V3 - Elo + Hampalyzer
router.get("/player/:discordId/v3",(req,res)=>{
  try{
    const discordId=cleanString(req.params.discordId,100);
    if(!discordId)return sendError(res,400,"invalid_player");

    const player=db.prepare(`
      SELECT r.player_id,r.display_name,r.rating,COALESCE(up.hide_elo,0) AS hide_elo
      FROM ratings r
      LEFT JOIN user_prefs up ON up.player_id=r.player_id
      WHERE r.player_id=?
    `).get(discordId);

    if(!player)return sendError(res,404,"player_not_found");

    const steam=db.prepare(`
      SELECT
        psi.*,
        sp.steam_id64,
        sp.personaname,
        sp.profileurl,
        sp.avatar,
        sp.avatarmedium,
        sp.avatarfull
      FROM player_steam_ids psi
      LEFT JOIN steam_profiles sp ON sp.steam_id=psi.steam_id
      WHERE CAST(psi.discord_id AS TEXT)=?
      ORDER BY psi.is_primary DESC, psi.steam_id
      LIMIT 1
    `).get(discordId);

    const steamId=steam?.steam_id||null;

    const record=db.prepare(`
      SELECT
        COUNT(DISTINCT rc.match_id) AS games,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)) THEN 1
          ELSE 0 END) AS wins,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(rc.player_id AS TEXT)) THEN 1
          ELSE 0 END) AS losses,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS ties
      FROM rating_changes rc
      JOIN matches m ON m.match_id=rc.match_id
      WHERE rc.player_id=? AND m.status='completed'
    `).get(discordId);

    const classMapRows=steamId?db.prepare(`
      SELECT
        m.map_name AS map,
        c.class_name,
        SUM(c.seconds) AS seconds,
        COUNT(DISTINCT c.match_id) AS matches
      FROM match_player_classes c
      JOIN matches m ON m.match_id=c.match_id
      WHERE c.player_key=?
        AND m.map_name IS NOT NULL
        AND m.map_name!=''
      GROUP BY m.map_name,c.class_name
      ORDER BY m.map_name,seconds DESC
    `).all(steamId):[];

    const rankRow=db.prepare(`
      SELECT COUNT(*)+1 AS rank
      FROM ratings r
      LEFT JOIN user_prefs up ON up.player_id=r.player_id
      WHERE COALESCE(up.hide_elo,0)=0
        AND r.rating > ?
    `).get(player.rating||0);

    const hStats=steamId?db.prepare(`
      SELECT
        COUNT(DISTINCT match_id) AS matches,
        SUM(kills) AS kills,
        SUM(deaths) AS deaths,
        SUM(enemy_damage) AS damage,
        SUM(team_damage) AS team_damage,
        SUM(damage_taken) AS damage_taken,
        SUM(flag_captures) AS caps,
        SUM(flag_touches) AS touches,
        SUM(initial_touches) AS initial_touches,
        SUM(flag_time_seconds) AS flag_time,
        SUM(conc_jumps) AS conc_jumps
      FROM match_player_stats
      WHERE steam_id=? OR player_key=?
    `).get(steamId,steamId):null;

    const classRows=steamId?db.prepare(`
      SELECT class_name,
            SUM(seconds) AS seconds,
            COUNT(DISTINCT match_id) AS matches
      FROM match_player_classes
      WHERE player_key=?
      GROUP BY class_name
      ORDER BY seconds DESC
    `).all(steamId):[];

    const weaponRows=steamId?db.prepare(`
      SELECT weapon AS weapon_class,
            SUM(kills) AS kills
      FROM match_player_weapons
      WHERE player_key=?
      GROUP BY weapon
      ORDER BY kills DESC
      LIMIT 10
    `).all(steamId):[];

    let mvpGames=0;
    if(steamId){
      try{
        const mvpRow=db.prepare(`
          SELECT COUNT(DISTINCT match_id) AS mvp_games
          FROM match_round_mvps
          WHERE mvp_player_key=? OR steam_id=?
        `).get(steamId,steamId);
        mvpGames=Number(mvpRow?.mvp_games||0);
      }catch(mvpError){
        if(!String(mvpError?.message||"").includes("no such table")){
          logRouteError("[/api/player/:discordId/v3 mvps]",mvpError);
        }
      }
    }

    const wins=Number(record?.wins||0);
    const losses=Number(record?.losses||0);
    const ties=Number(record?.ties||0);
    const games=wins+losses+ties;
    const decided=wins+losses;

    const kills=Number(hStats?.kills||0);
    const deaths=Number(hStats?.deaths||0);
    const hMatches=Number(hStats?.matches||0);
    const totalClassSeconds=classRows.reduce((s,r)=>s+Number(r.seconds||0),0);

    res.setHeader(
      "Cache-Control",
      "public, max-age=1, stale-while-revalidate=2"
    );

    res.json({
      ok:true,
      data:{
        player:{
          id:String(player.player_id),
          name:player.display_name||String(player.player_id),
          steam_id:steamId,
          steam_link:steam||null,
          steam_id64:steam?.steam_id64||null,
          personaname:steam?.personaname||null,
          profileurl:steam?.profileurl||null,
          avatar:steam?.avatar||null,
          avatarmedium:steam?.avatarmedium||null,
          avatarfull:steam?.avatarfull||null
        },
        ratings:{
          elo:player.hide_elo?null:player.rating,
          hidden:!!player.hide_elo,
          rank:player.hide_elo?null:Number(rankRow?.rank||0),
          wins,
          losses,
          ties,
          games,
          record:`${wins}-${losses}-${ties}`,
          win_pct:decided?Math.round((wins/decided)*100):0
        },
        hampalyzer:{
          linked:!!steamId,
          matches:hMatches,
          kills,
          deaths,
          kdr:deaths?Number((kills/deaths).toFixed(2)):kills,
          damage:Number(hStats?.damage||0),
          team_damage:Number(hStats?.team_damage||0),
          damage_taken:Number(hStats?.damage_taken||0),
          caps:Number(hStats?.caps||0),
          touches:Number(hStats?.touches||0),
          initial_touches:Number(hStats?.initial_touches||0),
          flag_time:Number(hStats?.flag_time||0),
          conc_jumps:Number(hStats?.conc_jumps||0),
          mvp_games:mvpGames
        },
        classes:classRows.map(r=>{
          const seconds=Number(r.seconds||0);
          return{
            class:r.class_name,
            seconds,
            hours:Number((seconds/3600).toFixed(1)),
            pct:totalClassSeconds?Number(((seconds/totalClassSeconds)*100).toFixed(1)):0,
            matches:Number(r.matches||0),
            avg_seconds_per_match:r.matches?Math.round(seconds/Number(r.matches)):0
          };
        }),
        class_maps:classMapRows.map(r=>{
        const seconds=Number(r.seconds||0);
        const matches=Number(r.matches||0);
        return{
          map:r.map,
          class:r.class_name,
          seconds,
          hours:Number((seconds/3600).toFixed(1)),
          matches,
          avg_seconds_per_match:matches?Math.round(seconds/matches):0
        };
      }),
        favorite_class:classRows[0]?.class_name||null,
        weapons:weaponRows.map(r=>({
          weapon_class:r.weapon_class,
          kills:Number(r.kills||0)
        }))
      }
    });
  }catch(e){
    logRouteError("[/api/player/:discordId/v3]",e);
    sendError(res,500,"player_v3_failed");
  }
});

// Recent matches for player
router.get("/player/:id/recent", (req, res) => {
  const pid = cleanString(req.params.id, 100);
  const limit = positiveInt(req.query.limit, 50, 1, MAX_PLAYER_MATCH_LIMIT);
  if (!pid) return sendError(res, 400, "invalid_player");

  try {
    const matches = db.prepare(`
      SELECT ${matchColumns("m")}
      FROM matches m
      WHERE EXISTS (
        SELECT 1 FROM json_each(m.blue_ids)
        WHERE CAST(value AS TEXT) = ?
      ) OR EXISTS (
        SELECT 1 FROM json_each(m.red_ids)
        WHERE CAST(value AS TEXT) = ?
      )
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(pid, pid, limit);

    const adminRows = db.prepare(`
      SELECT match_id, ts, before, after, delta
      FROM rating_changes
      WHERE player_id = ?
        AND (match_id LIKE 'admin-%' OR match_id LIKE 'admin-set-%')
      ORDER BY ts DESC
      LIMIT 5
    `).all(pid);

    const playersByMatch = loadMatchPlayers(matches, { includeRatings: false });
    const out = matches.map(row => {
      const serialized = serializeMatch(row, playersByMatch, { includeTfcstats: false });
      const player =
        serialized.blueTeam.find(entry => String(entry.id) === pid) ||
        serialized.redTeam.find(entry => String(entry.id) === pid);
      return {
        ...serialized,
        before: player?.before ?? null,
        after: player?.after ?? null,
        delta: player?.delta ?? 0
      };
    });

    for (const a of adminRows) {
      out.unshift({
        id: a.match_id,
        created_at: a.ts,
        map_name: "(Admin Adjustment)",
        winner: "—",
        status: "admin",
        before: a.before,
        after: a.after,
        delta: a.delta,
        blueTeam: [],
        redTeam: [],
        hampalyzer_url: null,
        score_blue: null,
        score_red: null
      });
    }

    out.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    res.json({ ok: true, data: out.slice(0, limit) });
  } catch (err) {
    logRouteError("[recent]", err);
    sendError(res, 500, "player_recent_failed");
  }
});

// Player per-map stats
router.get("/player/:id/permap", (req, res) => {
  try {
    const pid = cleanString(req.params.id, 100);
    if (!pid) return sendError(res, 400, "invalid_player");

    const rows = db.prepare(`
      SELECT r.match_id, r.before, r.after, r.delta,
             m.map_name, m.winner, m.status, m.blue_ids, m.red_ids
      FROM rating_changes r
      LEFT JOIN matches m ON m.match_id = r.match_id
      WHERE r.player_id = ?
        AND m.status IN ('in_progress','completed')
        AND m.map_name IS NOT NULL AND m.map_name != '(unknown)'
    `).all(pid);

    const box = new Map();
    for (const r of rows) {
      const key = r.map_name || "(unknown)";
      const b = box.get(key) || { map: key, gp: 0, w: 0, l: 0, t: 0, sumDelta: 0 };

      let team = null;
      try {
        const blueIds = parseIdList(r.blue_ids);
        const redIds = parseIdList(r.red_ids);
        if (blueIds.includes(pid)) team = "BLUE";
        else if (redIds.includes(pid)) team = "RED";
      } catch {}

      if (r.winner) {
        if (r.winner === "TIE") b.t += 1;
        else if (team && r.winner === team) b.w += 1;
        else if (team && r.winner !== team && r.winner !== "In Progress") b.l += 1;
      }

      b.gp += 1;
      b.sumDelta += Number(r.delta) || 0;
      box.set(key, b);
    }

    const out = Array.from(box.values()).map(b => {
      const avgDelta = b.gp ? Math.round(b.sumDelta / b.gp) : 0;
      const decided = b.w + b.l;
      const winPct   = decided ? Math.round((b.w / decided) * 100) : 0;
      return { map: b.map, gp: b.gp, w: b.w, l: b.l, t: b.t, win_pct: winPct, avg_delta: avgDelta };
    });

    out.sort((a,b) => b.gp - a.gp || b.win_pct - a.win_pct || a.map.localeCompare(b.map));
    res.json({ ok: true, data: out, count: out.length });
  } catch (e) {
    logRouteError("[player permap]", e);
    sendError(res, 500, "player_permap_failed");
  }
});

// Top players
// ✅ FIXED: removed N+1 query — rating now comes from the main JOIN instead of a per-row lookup
// ✅ CACHED: results reused for 30s
router.get("/topplayers", (req, res) => {
  try {
    const days = positiveInt(req.query.days, 30, 1, 3650);
    const cutoff = Math.floor(Date.now() / 1000) - (days * 86400);
    const cacheKey = `topplayers_${days}`;

    const out = cached(cacheKey, () => {
      const rows = db.prepare(`
        SELECT r.player_id,
               MAX(rt.display_name) as display_name,
               MAX(rt.rating)       as current_rating,
               up.hide_elo,
               COUNT(*) as games,
               SUM(CASE
                     WHEN m.winner='BLUE' AND EXISTS (
                       SELECT 1 FROM json_each(m.blue_ids)
                       WHERE CAST(value AS TEXT) = CAST(r.player_id AS TEXT)
                     ) THEN 1
                     WHEN m.winner='RED' AND EXISTS (
                       SELECT 1 FROM json_each(m.red_ids)
                       WHERE CAST(value AS TEXT) = CAST(r.player_id AS TEXT)
                     ) THEN 1
                     ELSE 0
                   END) as wins,
               SUM(CASE
                     WHEN m.winner='BLUE' AND EXISTS (
                       SELECT 1 FROM json_each(m.red_ids)
                       WHERE CAST(value AS TEXT) = CAST(r.player_id AS TEXT)
                     ) THEN 1
                     WHEN m.winner='RED' AND EXISTS (
                       SELECT 1 FROM json_each(m.blue_ids)
                       WHERE CAST(value AS TEXT) = CAST(r.player_id AS TEXT)
                     ) THEN 1
                     ELSE 0
                   END) as losses,
               SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) as ties,
               SUM(r.delta) as delta
        FROM rating_changes r
        JOIN matches m ON m.match_id = r.match_id
        LEFT JOIN ratings rt ON rt.player_id = r.player_id
        LEFT JOIN user_prefs up ON up.player_id = r.player_id
        WHERE m.status='completed' AND m.created_at >= ?
        GROUP BY r.player_id
        HAVING games > 0
        ORDER BY delta DESC
        LIMIT 20
      `).all(cutoff);

      // ✅ current_rating comes from the JOIN above — no extra query per row
      return rows.map((r, i) => ({
        rank: i + 1,
        id: String(r.player_id),
        player: r.display_name || String(r.player_id),
        record: `${r.wins}-${r.losses}-${r.ties}`,
        delta: r.delta || 0,
        current: r.hide_elo ? null : (r.current_rating ?? null),
        hidden: !!r.hide_elo
      }));
    });

    res.json({ ok: true, data: out });
  } catch (e) {
    logRouteError("[/api/topplayers]", e);
    sendError(res, 500, "topplayers_failed");
  }
});


  return router;
}

module.exports = { createPlayersRouter };
