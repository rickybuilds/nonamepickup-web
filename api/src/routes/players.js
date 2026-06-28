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
      WHERE psi.discord_id=?
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

function safeTableRead(fn,fallback){
  try{
    return fn();
  }catch(error){
    if(String(error?.message||"").includes("no such table"))return fallback;
    throw error;
  }
}

const tableColumnCache=new Map();
function tableHasColumn(table,column){
  const cacheKey=`${table}:${column}`;
  if(tableColumnCache.has(cacheKey))return tableColumnCache.get(cacheKey);
  let hasColumn=false;
  try{
    hasColumn=db.prepare(`PRAGMA table_info(${table})`).all()
      .some(row=>String(row.name||"")===column);
  }catch(_error){
    hasColumn=false;
  }
  tableColumnCache.set(cacheKey,hasColumn);
  return hasColumn;
}

function placeholders(values){
  return values.map(() => "?").join(",");
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
    WHERE player_id=?
  `).get(playerId);

  const steamRows=safeTableRead(()=>db.prepare(`
    SELECT steam_id
    FROM player_steam_ids
    WHERE discord_id=?
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
    sql:`${prefix}attacker_discord_id=?`,
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
  return null;
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
      wins:0,
      losses:0,
      ties:0,
      officialClassKills:0,
      uncertainClassKills:0
    },
    classWeapons:[],
    classSummary:[],
    roleClassTime:[],
    filteredFlags:{
      captures:0,
      touches:0,
      initialTouches:0,
      sentryKills:0
    },
    roleWeapons:[],
    flagCarrierKills:[],
    concededKills:[],
    objectiveSummary:[],
    objectiveClassSummary:[],
    favoriteVictims:[],
    aliasHistory:[],
    matchDrilldown:[]
  };
}

function buildGranularPlayerPayload(identity,options={}){
  const limit=positiveInt(options.limit,50,1,250);
  const matchId=options.matchId?cleanString(options.matchId,100):"";
  const mapName=options.map?cleanString(options.map,200):"";
  const includeSample=String(options.includeSample||"")==="1";
  const classFilter=options.class?cleanString(options.class,50).toLowerCase():"";
  const weaponFilter=options.weapon?cleanString(options.weapon,100):"";
  const objectiveFilter=options.objective?cleanString(options.objective,40).toLowerCase():"";
  const victimFilter=options.victim?cleanString(options.victim,120):"";
  const officialOnly=String(options.official||"")==="1";
  const identityWhere=fastKillEventIdentityWhere(identity,"e");
  const officialWhere=officialKillConfidenceWhere("e");
  const matchFilters=[];
  const matchParams=[];
  if(matchId){
    matchFilters.push("AND e.match_id=?");
    matchParams.push(matchId);
  }
  if(mapName){
    matchFilters.push("AND e.match_id IN (SELECT match_id FROM matches WHERE map_name=?)");
    matchParams.push(mapName);
  }
  if(classFilter){
    matchFilters.push("AND LOWER(COALESCE(NULLIF(e.attacker_class,''),'unknown'))=?");
    matchParams.push(classFilter);
  }
  if(weaponFilter){
    matchFilters.push("AND e.weapon=?");
    matchParams.push(weaponFilter);
  }
  if(objectiveFilter==="flag"){
    matchFilters.push("AND COALESCE(e.is_flag_carrier_kill,0)=1");
  }else if(objectiveFilter==="conced"){
    matchFilters.push("AND COALESCE(e.is_conced,0)=1");
  }
  if(victimFilter){
    matchFilters.push(`AND (
      e.victim_discord_id=?
      OR e.victim_steam_id=?
      OR e.victim_key=?
      OR e.victim_name=?
    )`);
    matchParams.push(victimFilter,victimFilter,victimFilter,victimFilter);
  }
  if(officialOnly){
    matchFilters.push(`AND ${officialWhere}`);
    matchParams.push(...OFFICIAL_KILL_CLASS_CONFIDENCES);
  }
  const matchFilter=matchFilters.join("\n        ");
  const timingPrefix=`granular:${identity.id}${mapName?":map:"+mapName:""}${matchId?":"+matchId:""}${classFilter?":class:"+classFilter:""}${weaponFilter?":weapon:"+weaponFilter:""}${objectiveFilter?":objective:"+objectiveFilter:""}${victimFilter?":victim":""}`;

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

    const sampleRecord=includeSample?timedGranularQuery(`${timingPrefix}:sampleRecord`,()=>db.prepare(`
      SELECT
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          ELSE 0 END) AS wins,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          ELSE 0 END) AS losses,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS ties
      FROM matches m
      WHERE m.status='completed'
        AND m.match_id IN (
          SELECT DISTINCT e.match_id
          FROM match_kill_events e
          WHERE ${identityWhere.sql}
            ${matchFilter}
        )
    `).get(
      identity.id,
      identity.id,
      identity.id,
      identity.id,
      ...identityWhere.params,
      ...matchParams
    )):null;

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

    const classSummary=timedGranularQuery(`${timingPrefix}:classSummary`,()=>db.prepare(`
      SELECT
        cm.class,
        COUNT(*) AS matches,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          ELSE 0 END) AS wins,
        SUM(CASE
          WHEN m.winner='BLUE' AND EXISTS(SELECT 1 FROM json_each(m.red_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          WHEN m.winner='RED' AND EXISTS(SELECT 1 FROM json_each(m.blue_ids) WHERE CAST(value AS TEXT)=CAST(? AS TEXT)) THEN 1
          ELSE 0 END) AS losses,
        SUM(CASE WHEN m.winner='TIE' THEN 1 ELSE 0 END) AS ties
      FROM (
        SELECT DISTINCT
          COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
          e.match_id
        FROM match_kill_events e
        WHERE ${identityWhere.sql}
          AND ${officialWhere}
          AND COALESCE(e.is_enemy_kill,1)=1
          ${matchFilter}
      ) cm
      JOIN matches m ON m.match_id=cm.match_id AND m.status='completed'
      GROUP BY cm.class
      ORDER BY matches DESC,cm.class
    `).all(
      identity.id,
      identity.id,
      identity.id,
      identity.id,
      ...identityWhere.params,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...matchParams
    ));

    const classTimeSteamIds=identity.steamIds.length
      ? identity.steamIds
      : (identity.steam_id?[identity.steam_id]:[]);
    const classTimeMatchFilters=[];
    const classTimeMatchParams=[];
    if(matchId){
      classTimeMatchFilters.push("AND c.match_id=?");
      classTimeMatchParams.push(matchId);
    }
    if(mapName){
      classTimeMatchFilters.push("AND c.match_id IN (SELECT match_id FROM matches WHERE map_name=?)");
      classTimeMatchParams.push(mapName);
    }
    if(classFilter){
      classTimeMatchFilters.push("AND LOWER(c.class_name)=?");
      classTimeMatchParams.push(classFilter);
    }
    if(classFilter||weaponFilter||objectiveFilter||victimFilter||officialOnly){
      classTimeMatchFilters.push(`AND c.match_id IN (
          SELECT DISTINCT e.match_id
          FROM match_kill_events e
          WHERE ${identityWhere.sql}
            ${matchFilter}
        )`);
      classTimeMatchParams.push(...identityWhere.params,...matchParams);
    }
    const classFlagCapturesExpr=tableHasColumn("match_player_classes","flag_captures")
      ? "SUM(COALESCE(c.flag_captures,0))"
      : "0";
    const classFlagTouchesExpr=tableHasColumn("match_player_classes","flag_touches")
      ? "SUM(COALESCE(c.flag_touches,0))"
      : "0";
    const roleClassTime=classTimeSteamIds.length?timedGranularQuery(`${timingPrefix}:roleClassTime`,()=>db.prepare(`
      SELECT
        CASE
          WHEN LOWER(c.class_name) IN ('medic','scout','spy') THEN 'offense'
          WHEN LOWER(c.class_name) IN ('soldier','engineer','demoman','hwguy') THEN 'defense'
          ELSE 'other'
        END AS role,
        c.class_name AS class,
        SUM(c.seconds) AS seconds,
        ${classFlagCapturesExpr} AS flag_captures,
        ${classFlagTouchesExpr} AS flag_touches,
        COUNT(DISTINCT c.match_id) AS matches
      FROM match_player_classes c
      WHERE c.player_key IN (${placeholders(classTimeSteamIds)})
        ${classTimeMatchFilters.join("\n        ")}
        AND LOWER(c.class_name) IN ('medic','scout','spy','soldier','engineer','demoman','hwguy')
      GROUP BY role,c.class_name
      ORDER BY role,seconds DESC,c.class_name
    `).all(...classTimeSteamIds,...classTimeMatchParams)):[];

    const statsMatchFilters=[];
    const statsMatchParams=[];
    if(matchId){
      statsMatchFilters.push("AND s.match_id=?");
      statsMatchParams.push(matchId);
    }
    if(mapName){
      statsMatchFilters.push("AND s.match_id IN (SELECT match_id FROM matches WHERE map_name=?)");
      statsMatchParams.push(mapName);
    }
    if(classFilter||weaponFilter||objectiveFilter||victimFilter||officialOnly){
      statsMatchFilters.push(`AND s.match_id IN (
          SELECT DISTINCT e.match_id
          FROM match_kill_events e
          WHERE ${identityWhere.sql}
            ${matchFilter}
        )`);
      statsMatchParams.push(...identityWhere.params,...matchParams);
    }
    const statsSteamIds=classTimeSteamIds;
    const canReadFilteredFlags=statsSteamIds.length
      && tableHasColumn("match_player_stats","flag_captures")
      && tableHasColumn("match_player_stats","flag_touches");
    const filteredInitialTouchesExpr=tableHasColumn("match_player_stats","initial_touches")
      ? "SUM(COALESCE(s.initial_touches,0))"
      : "0";
    const filteredFlags=canReadFilteredFlags?timedGranularQuery(`${timingPrefix}:filteredFlags`,()=>db.prepare(`
      SELECT
        SUM(COALESCE(s.flag_captures,0)) AS captures,
        SUM(COALESCE(s.flag_touches,0)) AS touches,
        ${filteredInitialTouchesExpr} AS initial_touches
      FROM match_player_stats s
      WHERE (
          s.player_key IN (${placeholders(statsSteamIds)})
          OR s.steam_id IN (${placeholders(statsSteamIds)})
        )
        ${statsMatchFilters.join("\n        ")}
    `).get(...statsSteamIds,...statsSteamIds,...statsMatchParams)):null;

    const roundStatsMatchFilters=statsMatchFilters.map(filter=>filter.replaceAll("s.","r."));
    const canReadFilteredSentryKills=statsSteamIds.length
      && tableHasColumn("match_player_round_stats","sentry_kills");
    const filteredSentryKills=canReadFilteredSentryKills?timedGranularQuery(`${timingPrefix}:filteredSentryKills`,()=>db.prepare(`
      SELECT
        SUM(COALESCE(r.sentry_kills,0)) AS sentry_kills
      FROM match_player_round_stats r
      WHERE (
          r.player_key IN (${placeholders(statsSteamIds)})
          OR r.steam_id IN (${placeholders(statsSteamIds)})
        )
        ${roundStatsMatchFilters.join("\n        ")}
    `).get(...statsSteamIds,...statsSteamIds,...statsMatchParams)):null;

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

    const objectiveSummary=timedGranularQuery(`${timingPrefix}:objectiveSummary`,()=>db.prepare(`
      SELECT
        objective,
        COUNT(DISTINCT match_id) AS matches
      FROM (
        SELECT 'flag' AS objective,e.match_id
        FROM match_kill_events e
        WHERE ${identityWhere.sql}
          AND ${officialWhere}
          AND COALESCE(e.is_flag_carrier_kill,0)=1
          ${matchFilter}
        UNION ALL
        SELECT 'conced' AS objective,e.match_id
        FROM match_kill_events e
        WHERE ${identityWhere.sql}
          AND ${officialWhere}
          AND COALESCE(e.is_conced,0)=1
          ${matchFilter}
      )
      GROUP BY objective
    `).all(
      ...identityWhere.params,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...matchParams,
      ...identityWhere.params,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...matchParams
    ));

    const objectiveClassSummary=timedGranularQuery(`${timingPrefix}:objectiveClassSummary`,()=>db.prepare(`
      SELECT
        objective,
        class,
        COUNT(DISTINCT match_id) AS matches
      FROM (
        SELECT
          'flag' AS objective,
          COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
          e.match_id
        FROM match_kill_events e
        WHERE ${identityWhere.sql}
          AND ${officialWhere}
          AND COALESCE(e.is_flag_carrier_kill,0)=1
          ${matchFilter}
        UNION ALL
        SELECT
          'conced' AS objective,
          COALESCE(NULLIF(e.attacker_class,''),'Unknown') AS class,
          e.match_id
        FROM match_kill_events e
        WHERE ${identityWhere.sql}
          AND ${officialWhere}
          AND COALESCE(e.is_conced,0)=1
          ${matchFilter}
      )
      GROUP BY objective,class
      ORDER BY objective,matches DESC,class
    `).all(
      ...identityWhere.params,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...matchParams,
      ...identityWhere.params,
      ...OFFICIAL_KILL_CLASS_CONFIDENCES,
      ...matchParams
    ));

    const favoriteVictims=timedGranularQuery(`${timingPrefix}:favoriteVictims`,()=>db.prepare(`
	  WITH victims AS (
		SELECT
		  e.victim_discord_id,
		  e.victim_steam_id,
		  e.victim_key,
		  MAX(e.victim_name) AS victim_name,
		  COUNT(*) AS kills
		FROM match_kill_events e
		WHERE ${identityWhere.sql}
		  AND COALESCE(e.is_enemy_kill,1)=1
		  ${matchFilter}
		GROUP BY e.victim_discord_id,e.victim_steam_id,e.victim_key
		ORDER BY kills DESC
		LIMIT 25
	  )
	  SELECT
		v.victim_discord_id,
		v.victim_steam_id,
		v.victim_key,
		COALESCE(
		  NULLIF(r.display_name,''),
		  NULLIF(v.victim_name,''),
		  NULLIF(v.victim_key,''),
		  'Unknown'
		) AS victim_name,
		v.kills
	  FROM victims v
	  LEFT JOIN ratings r
		ON r.player_id = v.victim_discord_id
	  ORDER BY v.kills DESC,victim_name
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
        wins:includeSample?Number(sampleRecord?.wins||0):null,
        losses:includeSample?Number(sampleRecord?.losses||0):null,
        ties:includeSample?Number(sampleRecord?.ties||0):null,
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
      classSummary:classSummary.map(row=>({
        class:row.class,
        matches:Number(row.matches||0),
        wins:Number(row.wins||0),
        losses:Number(row.losses||0),
        ties:Number(row.ties||0)
      })),
      roleClassTime:roleClassTime.map(row=>({
        role:row.role,
        class:row.class,
        seconds:Number(row.seconds||0),
        hours:Number((Number(row.seconds||0)/3600).toFixed(1)),
        flagCaptures:Number(row.flag_captures||0),
        flagTouches:Number(row.flag_touches||0),
        matches:Number(row.matches||0),
        avg_seconds_per_match:Number(row.matches||0)?Math.round(Number(row.seconds||0)/Number(row.matches||0)):0
      })),
      filteredFlags:{
        captures:Number(filteredFlags?.captures||0),
        touches:Number(filteredFlags?.touches||0),
        initialTouches:Number(filteredFlags?.initial_touches||0),
        sentryKills:Number(filteredSentryKills?.sentry_kills||0)
      },
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
      objectiveSummary:objectiveSummary.map(row=>({
        objective:row.objective,
        matches:Number(row.matches||0)
      })),
      objectiveClassSummary:objectiveClassSummary.map(row=>({
        objective:row.objective,
        class:row.class,
        matches:Number(row.matches||0)
      })),
      favoriteVictims:favoriteVictims.map(row=>({
        victimId:row.victim_discord_id||row.victim_steam_id||row.victim_key||null,
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
  console.time("GRANULAR TOTAL");
  try{
    const playerId=cleanString(req.params.id,100);
    if(!playerId)return sendError(res,400,"invalid_player");

    const identity=resolvePlayerIdentity(playerId);
    const data=buildGranularPlayerPayload(identity,{
      limit:positiveInt(req.query.limit,50,1,250),
      map:req.query.map,
      matchId:req.query.matchId,
      includeSample:req.query.includeSample,
      class:req.query.class,
      weapon:req.query.weapon,
      objective:req.query.objective,
      victim:req.query.victim,
      official:req.query.official
    });

    res.setHeader("Cache-Control","public, max-age=5, stale-while-revalidate=20");
    res.json({ok:true,data});
  }catch(error){
    logRouteError("[/api/player/:id/granular]",error);
    sendError(res,500,"player_granular_failed");
  }finally{
    console.timeEnd("GRANULAR TOTAL");
  }
});

router.get("/player/:id/granular/events",(req,res)=>{
  try{
    const playerId=cleanString(req.params.id,100);
    if(!playerId)return sendError(res,400,"invalid_player");

    const identity=resolvePlayerIdentity(playerId);
    const limit=positiveInt(req.query.limit,100,1,500);
    const offset=positiveInt(req.query.offset,0,0,100000);
    const mapName=req.query.map?cleanString(req.query.map,200):"";
    const matchId=req.query.matchId?cleanString(req.query.matchId,100):"";
    const classFilter=req.query.class?cleanString(req.query.class,50).toLowerCase():"";
    const weaponFilter=req.query.weapon?cleanString(req.query.weapon,100):"";
    const objectiveFilter=req.query.objective?cleanString(req.query.objective,40).toLowerCase():"";
    const victimFilter=req.query.victim?cleanString(req.query.victim,120):"";
    const officialOnly=req.query.official==="1";
    const identityWhere=fastKillEventIdentityWhere(identity,"e");
    const matchFilters=[];
    const matchParams=[];
    if(matchId){
      matchFilters.push("AND e.match_id=?");
      matchParams.push(matchId);
    }
    if(mapName){
      matchFilters.push("AND e.match_id IN (SELECT match_id FROM matches WHERE map_name=?)");
      matchParams.push(mapName);
    }
    if(classFilter){
      matchFilters.push("AND LOWER(COALESCE(NULLIF(e.attacker_class,''),'unknown'))=?");
      matchParams.push(classFilter);
    }
    if(weaponFilter){
      matchFilters.push("AND e.weapon=?");
      matchParams.push(weaponFilter);
    }
    if(objectiveFilter==="flag"){
      matchFilters.push("AND COALESCE(e.is_flag_carrier_kill,0)=1");
    }else if(objectiveFilter==="conced"){
      matchFilters.push("AND COALESCE(e.is_conced,0)=1");
    }
    if(victimFilter){
      matchFilters.push(`AND (
        e.victim_discord_id=?
        OR e.victim_steam_id=?
        OR e.victim_key=?
        OR e.victim_name=?
      )`);
      matchParams.push(victimFilter,victimFilter,victimFilter,victimFilter);
    }
    if(officialOnly){
      matchFilters.push(`AND ${officialKillConfidenceWhere("e")}`);
      matchParams.push(...OFFICIAL_KILL_CLASS_CONFIDENCES);
    }
    const matchFilter=matchFilters.join("\n          ");
    const timingPrefix=`granular:${identity.id}:events${mapName?":map:"+mapName:""}${matchId?":"+matchId:""}${classFilter?":class:"+classFilter:""}${weaponFilter?":weapon:"+weaponFilter:""}${objectiveFilter?":objective:"+objectiveFilter:""}${victimFilter?":victim":""}`;

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

    const historyRows=db.prepare(`
      SELECT
        rc.match_id,
        rc.before,
        rc.after,
        rc.delta,
        rc.ts,
        m.winner,
        m.blue_ids,
        m.red_ids
      FROM rating_changes rc
      LEFT JOIN matches m ON m.match_id=rc.match_id
      WHERE rc.player_id=?
        AND m.status='completed'
      ORDER BY rc.ts ASC
    `).all(discordId);

    let peakElo=Number(player.rating||0);
    let bestStreak=0;
    let currentStreak=0;
    let firstMatchTs=null;
    let lastMatchTs=null;

    for(const row of historyRows){
      peakElo=Math.max(peakElo,Number(row.after||row.before||0));

      if(!firstMatchTs)firstMatchTs=Number(row.ts||0);
      lastMatchTs=Number(row.ts||0)||lastMatchTs;

      let team=null;
      try{
        const blueIds=parseIdList(row.blue_ids);
        const redIds=parseIdList(row.red_ids);
        if(blueIds.includes(discordId))team="BLUE";
        else if(redIds.includes(discordId))team="RED";
      }catch{}

      if(team&&row.winner===team){
        currentStreak++;
        bestStreak=Math.max(bestStreak,currentStreak);
      }else if(row.winner&&row.winner!=="TIE"){
        currentStreak=0;
      }
    }

    const activeWeeks=firstMatchTs&&lastMatchTs
      ? Math.max(1,(lastMatchTs-firstMatchTs)/604800)
      : 1;
    const eloWindowGames=Math.min(20,historyRows.length);
    const eloWindowStart=eloWindowGames
      ? historyRows[historyRows.length-eloWindowGames]
      : null;
    const eloWindowCurrent=historyRows.length
      ? Number(historyRows[historyRows.length-1]?.after??player.rating??0)
      : Number(player.rating||0);
    const eloWindowBaseline=eloWindowStart
      ? Number(eloWindowStart.before??eloWindowStart.after??eloWindowCurrent)
      : eloWindowCurrent;
    const eloWindowDelta=eloWindowCurrent-eloWindowBaseline;

    const rankRow=db.prepare(`
      SELECT COUNT(*)+1 AS rank
      FROM ratings r
      LEFT JOIN user_prefs up ON up.player_id=r.player_id
      WHERE COALESCE(up.hide_elo,0)=0
        AND r.rating > ?
    `).get(player.rating||0);

    const hStats=steamId?db.prepare(`
      WITH player_rows AS (
        SELECT
          match_id,
          kills,
          deaths,
          enemy_damage,
          team_damage,
          damage_taken,
          flag_captures,
          flag_touches,
          initial_touches,
          flag_time_seconds,
          conc_jumps
        FROM match_player_stats
        WHERE steam_id=?
        UNION ALL
        SELECT
          match_id,
          kills,
          deaths,
          enemy_damage,
          team_damage,
          damage_taken,
          flag_captures,
          flag_touches,
          initial_touches,
          flag_time_seconds,
          conc_jumps
        FROM match_player_stats
        WHERE player_key=?
          AND COALESCE(steam_id,'')<>?
      )
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
      FROM player_rows
    `).get(steamId,steamId,steamId):null;

    const classRows=steamId?db.prepare(`
      SELECT class_name,
            SUM(seconds) AS seconds,
            COUNT(DISTINCT match_id) AS matches
      FROM match_player_classes
      WHERE player_key=?
      GROUP BY class_name
      ORDER BY seconds DESC
    `).all(steamId):[];

    let mvpGames=0;
    if(steamId){
      try{
        const mvpRow=db.prepare(`
          WITH mvp_rows AS (
            SELECT match_id
            FROM match_round_mvps
            WHERE mvp_player_key=?
            UNION ALL
            SELECT match_id
            FROM match_round_mvps
            WHERE steam_id=?
              AND COALESCE(mvp_player_key,'')<>?
          )
          SELECT COUNT(DISTINCT match_id) AS mvp_games
          FROM mvp_rows
        `).get(steamId,steamId,steamId);
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
    const pugsPerWeek=games?Number((games/activeWeeks).toFixed(1)):0;
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
          elo_window:{
            games:eloWindowGames,
            delta:player.hide_elo?null:eloWindowDelta
          },
          peak_elo:peakElo,
          best_streak:bestStreak,
          pugs_per_week:pugsPerWeek,
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
        favorite_class:classRows[0]?.class_name||null
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
      SELECT DISTINCT ${matchColumns("m")}
      FROM rating_changes rc
      JOIN matches m ON m.match_id = rc.match_id
      WHERE rc.player_id = ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(pid, limit);

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
        WITH top_delta AS (
          SELECT r.player_id,
                 COUNT(*) AS games,
                 SUM(r.delta) AS delta
          FROM rating_changes r
          JOIN matches m ON m.match_id = r.match_id
          WHERE m.status='completed' AND m.created_at >= ?
          GROUP BY r.player_id
          HAVING games > 0
          ORDER BY delta DESC
          LIMIT 20
        )
        SELECT td.player_id,
               MAX(rt.display_name) as display_name,
               MAX(rt.rating)       as current_rating,
               up.hide_elo,
               td.games as games,
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
               td.delta as delta
        FROM top_delta td
        JOIN rating_changes r ON r.player_id = td.player_id
        JOIN matches m ON m.match_id = r.match_id
        LEFT JOIN ratings rt ON rt.player_id = td.player_id
        LEFT JOIN user_prefs up ON up.player_id = td.player_id
        WHERE m.status='completed' AND m.created_at >= ?
        GROUP BY td.player_id
        ORDER BY td.delta DESC
        LIMIT 20
      `).all(cutoff, cutoff);

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
