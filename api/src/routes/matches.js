"use strict";

const express = require("express");
const {
  loadNnMvpInputs,
  calculateMatchNnMvp,
  calculateMatchEloPerformance,
  persistMatchNnMvp
} = require("../lib/nnMvpStore");
const { canonicalMvpSource } = require("../lib/canonicalMvp");
const { readMatchServers } = require("../lib/matchServers");
const { readMatchBuildings } = require("../lib/matchBuildings");

function createMatchesRouter({
  db,
  cachedFor,
  positiveInt,
  nonNegativeInt,
  maxMatchLimit,
  cleanString,
  dataDir,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  sendError,
  logRouteError
}) {
  const router = express.Router();

  // FIXED: default limit of 100 instead of unbounded
  router.get("/matches", (req, res) => {
    try {
      const rawLimit = positiveInt(req.query.limit, 100, 1, maxMatchLimit);
      const offset = nonNegativeInt(req.query.offset, 0, 1_000_000);
      const includePending = req.query.includePending === "1";
      const whereClause = includePending
        ? "WHERE match_type = 'pickup' AND player_format = '4v4' AND expected_players = 8"
        : "WHERE status = 'completed' AND match_type = 'pickup' AND player_format = '4v4' AND expected_players = 8";
      const cacheKey = `matches:${rawLimit}:${offset}:${includePending ? 1 : 0}`;

      const payload = cachedFor(cacheKey, 1000, () => {
        const matchServers = readMatchServers(dataDir);
        const total = db.prepare(`SELECT COUNT(*) as c FROM matches ${whereClause}`).get().c;
        const sql = `
        SELECT ${matchColumns("m")}
        FROM matches AS m
        ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `;
        const rows = db.prepare(sql).all(rawLimit, offset);
        const playersByMatch = loadMatchPlayers(rows);
        const out = rows.map(row => {
          const match = serializeMatch(row, playersByMatch);
          const server = matchServers.get(String(row.match_id));
          return {
            ...match,
            serverKey: server?.serverKey || null,
            serverIp: server?.serverIp || null
          };
        });
        return { ok: true, data: out, count: out.length, total, offset, limit: rawLimit };
      });

      res.setHeader("Cache-Control", "public, max-age=1, stale-while-revalidate=2");
      res.json(payload);
    } catch (e) {
      logRouteError("[/api/matches]", e);
      sendError(res, 500, "matches_failed");
    }
  });

  router.get("/match/:matchId",(req,res)=>{
    try{
      const matchId=cleanString(req.params.matchId,100);

      const row=db.prepare(`
      SELECT ${matchColumns("m")}
      FROM matches m
      WHERE m.match_id=?
      LIMIT 1
    `).get(matchId);

      if(!row)return sendError(res,404,"match_not_found");

      const playersByMatch=loadMatchPlayers([row]);
      const match=serializeMatch(row,playersByMatch);

      const nnInputs=loadNnMvpInputs(db,matchId);
      const playerStats=nnInputs.playerStats;

      const classStats=db.prepare(`
      SELECT
        c.player_key,
        s.steam_id,
        COALESCE(r.display_name,s.display_name,c.player_key) AS display_name,
        c.class_name,
        SUM(c.seconds) AS seconds
      FROM match_player_classes c
      LEFT JOIN match_player_stats s ON s.match_id=c.match_id AND s.player_key=c.player_key
      LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id=c.player_key
      LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id=s.steam_id
      LEFT JOIN ratings r ON r.player_id=COALESCE(psi_key.discord_id,psi_sid.discord_id)
      WHERE c.match_id=?
      GROUP BY c.player_key,c.class_name
      ORDER BY seconds DESC
    `).all(matchId);

      const weaponStats=db.prepare(`
      SELECT
        w.player_key,
        s.steam_id,
        COALESCE(r.display_name,s.display_name,w.player_key) AS display_name,
        w.weapon,
        SUM(w.kills) AS kills
      FROM match_player_weapons w
      LEFT JOIN match_player_stats s ON s.match_id=w.match_id AND s.player_key=w.player_key
      LEFT JOIN player_steam_ids psi_key ON psi_key.steam_id=w.player_key
      LEFT JOIN player_steam_ids psi_sid ON psi_sid.steam_id=s.steam_id
      LEFT JOIN ratings r ON r.player_id=COALESCE(psi_key.discord_id,psi_sid.discord_id)
      WHERE w.match_id=?
      GROUP BY w.player_key,w.weapon
      ORDER BY kills DESC
      LIMIT 50
    `).all(matchId);

      let rounds=[];
      let roundPlayerStats=nnInputs.roundPlayerStats;
      let roundMvps=[];
      const flagCarrierKills=nnInputs.flagCarrierKills;
      let capTimeline=[];
      let roundWeaponStats=[];

      // Event rows retain round information that match_player_weapons totals lack.
      // Keep the existing full-match weapon response unchanged for other pages.
      try{
        roundWeaponStats=db.prepare(`
          SELECT
            round_num,
            attacker_key AS player_key,
            attacker_steam_id AS steam_id,
            MAX(attacker_name) AS display_name,
            weapon,
            COUNT(*) AS kills
          FROM match_kill_events
          WHERE match_id=? AND round_num>0
            AND is_enemy_kill=1 AND COALESCE(is_team_kill,0)=0
          GROUP BY round_num,attacker_key,attacker_steam_id,weapon
          ORDER BY round_num,kills DESC,player_key,weapon
        `).all(matchId);
      }catch(weaponEventError){
        if(!String(weaponEventError?.message||"").includes("no such table")){
          logRouteError("[/api/match/:matchId round weapons]",weaponEventError);
        }
      }

      try{
        rounds=db.prepare(`
          SELECT
            round_num,
            map_name,
            duration_seconds,
            team1_score,
            team2_score,
            offense_team,
            defense_team
          FROM match_rounds
          WHERE match_id=?
          ORDER BY round_num
        `).all(matchId);
      }catch(roundError){
        const message=String(roundError?.message||"");
        if(!message.includes("no such table")){
          logRouteError("[/api/match/:matchId rounds]",roundError);
        }
      }

      try{
        roundMvps=db.prepare(`
          SELECT
            match_id,
            round_num,
            mvp_display_name,
            mvp_player_key,
            steam_id
          FROM match_round_mvps
          WHERE match_id=?
          ORDER BY round_num
        `).all(matchId);
      }catch(roundError){
        const message=String(roundError?.message||"");
        if(!message.includes("no such table")){
          logRouteError("[/api/match/:matchId round mvps]",roundError);
        }
      }

      try{
        capTimeline=db.prepare(`
          WITH joined_caps AS (
            SELECT
              c.id AS cap_event_id,
              c.team,
              c.cap_num,
              c.time_seconds,
              c.time_text,
              c.score_after,
              c.capper_name AS fallback_capper_name,
              c.capper_steam_id AS fallback_capper_steam_id,
              h.display_name AS hamp_capper_name,
              h.steam_id AS hamp_capper_steam_id,
              h.touches AS hamp_touches,
              ROW_NUMBER() OVER (
                PARTITION BY c.id
                ORDER BY ABS(h.game_time_seconds - c.time_seconds), h.id
              ) AS rn
            FROM match_cap_events c
            LEFT JOIN match_flag_events h
              ON h.match_id = c.match_id
            AND h.source = 'hampalyzer'
            AND h.flag_event_type = 'cap'
            AND h.game_time_seconds BETWEEN c.time_seconds - 45 AND c.time_seconds + 45
            WHERE c.match_id=?
          )
          SELECT
            team,
            cap_num,
            time_seconds,
            time_text,
            score_after,
            COALESCE(hamp_capper_name, fallback_capper_name) AS capper_name,
            COALESCE(hamp_capper_steam_id, fallback_capper_steam_id) AS capper_steam_id,
            hamp_touches AS touches
          FROM joined_caps
          WHERE rn=1
          ORDER BY time_seconds
        `).all(matchId);
      }catch(capEventError){
        const message=String(capEventError?.message||"");
        if(!message.includes("no such table")){
          logRouteError("[/api/match/:matchId cap timeline]",capEventError);
        }
      }

      const nnMvp=calculateMatchNnMvp(db,matchId,{playerStats,roundPlayerStats,flagCarrierKills});
      const eloPerformance=calculateMatchEloPerformance(db,matchId,{playerStats,roundPlayerStats,flagCarrierKills});
      const mvpSource=canonicalMvpSource(match.created_at);
      if(mvpSource==="nn"&&String(match.status||"")==="completed"){
        persistMatchNnMvp(db,matchId,nnMvp);
      }

      const matchMvpsByIdentity=new Map();
      for(const mvp of roundMvps){
        const identity=mvp.mvp_player_key||mvp.steam_id||mvp.mvp_display_name||"";
        let matchMvp=matchMvpsByIdentity.get(identity);
        if(!matchMvp){
          matchMvp={
            identity,
            mvp_display_name:mvp.mvp_display_name,
            mvp_player_key:mvp.mvp_player_key,
            steam_id:mvp.steam_id,
            rounds:[]
          };
          matchMvpsByIdentity.set(identity,matchMvp);
        }
        matchMvp.rounds.push(Number(mvp.round_num||0));
      }
      const hampalyzerMatchMvps=Array.from(matchMvpsByIdentity.values());
      const matchMvps=mvpSource==="nn"
        ?(nnMvp?.available&&nnMvp.winner?[{
          mvp_display_name:nnMvp.winner.display_name,
          mvp_player_key:nnMvp.winner.player_key,
          steam_id:nnMvp.winner.steam_id,
          final_score:nnMvp.winner.final_score,
          display_score:nnMvp.winner.display_score,
          rounds:[]
        }]:[])
        :hampalyzerMatchMvps;

      res.json({
        ok:true,
        match:{
          ...match,
          building_stats:readMatchBuildings(db,matchId,logRouteError),
          player_stats:playerStats.map(p=>({
            display_name:p.display_name,
            steam_id:p.steam_id,
            player_key:p.player_key,
            team:p.team,
            main_class:p.main_class,
            kills:Number(p.kills||0),
            deaths:Number(p.deaths||0),
            team_kills:Number(p.team_kills||0),
            damage:Number(p.enemy_damage||0),
            team_damage:Number(p.team_damage||0),
            damage_taken:Number(p.damage_taken||0),
            caps:Number(p.flag_captures||0),
            touches:Number(p.flag_touches||0),
            initial_touches:Number(p.initial_touches||0),
            conc_jumps:Number(p.conc_jumps||0),
            flag_time_seconds:Number(p.flag_time_seconds||0)
          })),
          class_stats:classStats.map(c=>({
          display_name:c.display_name,
          player_key:c.player_key,
          steam_id:c.steam_id,
          class_name:c.class_name,
          seconds:Number(c.seconds||0)
        })),
        weapon_stats:weaponStats.map(w=>({
          display_name:w.display_name,
          player_key:w.player_key,
          steam_id:w.steam_id,
          weapon:w.weapon,
          kills:Number(w.kills||0)
        })),
        round_weapon_stats:roundWeaponStats.map(w=>({
          round_num:Number(w.round_num),
          player_key:w.player_key,
          steam_id:w.steam_id,
          display_name:w.display_name,
          weapon:w.weapon,
          kills:Number(w.kills)
        })),
        rounds:rounds.map(r=>({
          round_num:Number(r.round_num||0),
          map_name:r.map_name,
          duration_seconds:Number(r.duration_seconds||0),
          team1_score:Number(r.team1_score||0),
          team2_score:Number(r.team2_score||0),
          offense_team:r.offense_team,
          defense_team:r.defense_team
        })),
        round_player_stats:roundPlayerStats.map(p=>({
          match_id:p.match_id,
          player_key:p.player_key,
          steam_id:p.steam_id,
          display_name:p.display_name,
          round_num:Number(p.round_num||0),
          team_name:p.team_name,
          role:p.role,
          kills:Number(p.kills||0),
          team_kills:Number(p.team_kills||0),
          conced_kills:Number(p.conced_kills||0),
          sentry_kills:Number(p.sentry_kills||0),
          deaths_by_enemy:Number(p.deaths_by_enemy||0),
          deaths_by_team:Number(p.deaths_by_team||0),
          suicides:Number(p.suicides||0),
          enemy_damage:Number(p.enemy_damage||0),
          team_damage:Number(p.team_damage||0),
          damage_taken_enemy:Number(p.damage_taken_enemy||0),
          damage_taken_team:Number(p.damage_taken_team||0),
          self_damage:Number(p.self_damage||0),
          conc_jumps:Number(p.conc_jumps||0),
          flag_captures:Number(p.flag_captures||0),
          flag_touches:Number(p.flag_touches||0),
          initial_touches:Number(p.initial_touches||0),
          flag_time_seconds:Number(p.flag_time_seconds||0),
          objectives:Number(p.objectives||0),
          toss_percent:Number(p.toss_percent||0)
        })),
        round_mvps:(mvpSource==="nn"?[]:roundMvps).map(mvp=>({
          match_id:mvp.match_id,
          round_num:Number(mvp.round_num||0),
          mvp_display_name:mvp.mvp_display_name,
          mvp_player_key:mvp.mvp_player_key,
          steam_id:mvp.steam_id
        })),
        capTimeline:capTimeline.map(event=>({
          team:event.team,
          cap_num:Number(event.cap_num||0),
          time_seconds:Number(event.time_seconds||0),
          time_text:event.time_text,
          score_after:event.score_after,
		  capper_name:event.capper_name || null,
      capper_steam_id:event.capper_steam_id || null,
      touches:event.touches == null ? null : Number(event.touches)
        })),
        match_mvps:matchMvps.map(({identity,...mvp})=>mvp),
        mvp_source:mvpSource,
        nn_mvp:nnMvp,
        elo_performance:eloPerformance
        }
      });
    }catch(e){
      logRouteError("[/api/match/:matchId]",e);
      sendError(res,500,"match_failed");
    }
  });

  return router;
}

module.exports = { createMatchesRouter };
