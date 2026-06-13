"use strict";

const express = require("express");

function createMatchesRouter({
  db,
  cachedFor,
  positiveInt,
  nonNegativeInt,
  maxMatchLimit,
  cleanString,
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
      const whereClause = includePending ? "" : "WHERE status='completed'";
      const cacheKey = `matches:${rawLimit}:${offset}:${includePending ? 1 : 0}`;

      const payload = cachedFor(cacheKey, 1000, () => {
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
        const out = rows.map(row => serializeMatch(row, playersByMatch));
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

      const playerStats=db.prepare(`
      SELECT
        COALESCE(r.display_name,s.display_name,s.player_key,s.steam_id) AS display_name,
        s.steam_id,
        s.player_key,
        s.team,
        s.kills,
        s.deaths,
        s.enemy_damage AS damage,
        s.team_damage,
        s.damage_taken,
        s.flag_captures AS caps,
        s.flag_touches AS touches,
        s.initial_touches,
        s.conc_jumps,
        s.flag_time_seconds,
        s.main_class
      FROM match_player_stats s
      LEFT JOIN player_steam_ids psi ON psi.steam_id=s.steam_id OR psi.steam_id=s.player_key
      LEFT JOIN ratings r ON r.player_id=psi.discord_id
      WHERE s.match_id=?
      ORDER BY s.kills DESC
    `).all(matchId);

      const classStats=db.prepare(`
      SELECT
        c.player_key,
        s.steam_id,
        COALESCE(r.display_name,s.display_name,c.player_key) AS display_name,
        c.class_name,
        SUM(c.seconds) AS seconds
      FROM match_player_classes c
      LEFT JOIN match_player_stats s ON s.match_id=c.match_id AND s.player_key=c.player_key
      LEFT JOIN player_steam_ids psi ON psi.steam_id=c.player_key OR psi.steam_id=s.steam_id
      LEFT JOIN ratings r ON r.player_id=psi.discord_id
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
      LEFT JOIN player_steam_ids psi ON psi.steam_id=w.player_key OR psi.steam_id=s.steam_id
      LEFT JOIN ratings r ON r.player_id=psi.discord_id
      WHERE w.match_id=?
      GROUP BY w.player_key,w.weapon
      ORDER BY kills DESC
      LIMIT 50
    `).all(matchId);

      let rounds=[];
      let roundPlayerStats=[];
      let roundMvps=[];

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
        roundPlayerStats=db.prepare(`
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
          WHERE match_id=?
          ORDER BY round_num, kills DESC
        `).all(matchId);
      }catch(roundError){
        const message=String(roundError?.message||"");
        if(!message.includes("no such table")){
          logRouteError("[/api/match/:matchId round player stats]",roundError);
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

      const matchMvps=[];
      for(const mvp of roundMvps){
        const identity=mvp.mvp_player_key||mvp.steam_id||mvp.mvp_display_name||"";
        let matchMvp=matchMvps.find(row=>row.identity===identity);
        if(!matchMvp){
          matchMvp={
            identity,
            mvp_display_name:mvp.mvp_display_name,
            mvp_player_key:mvp.mvp_player_key,
            steam_id:mvp.steam_id,
            rounds:[]
          };
          matchMvps.push(matchMvp);
        }
        matchMvp.rounds.push(Number(mvp.round_num||0));
      }

      res.json({
        ok:true,
        match:{
          ...match,
          player_stats:playerStats.map(p=>({
            display_name:p.display_name,
            steam_id:p.steam_id,
            player_key:p.player_key,
            team:p.team,
            main_class:p.main_class,
            kills:Number(p.kills||0),
            deaths:Number(p.deaths||0),
            damage:Number(p.damage||0),
            team_damage:Number(p.team_damage||0),
            damage_taken:Number(p.damage_taken||0),
            caps:Number(p.caps||0),
            touches:Number(p.touches||0),
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
        round_mvps:roundMvps.map(mvp=>({
          match_id:mvp.match_id,
          round_num:Number(mvp.round_num||0),
          mvp_display_name:mvp.mvp_display_name,
          mvp_player_key:mvp.mvp_player_key,
          steam_id:mvp.steam_id
        })),
        match_mvps:matchMvps.map(({identity,...mvp})=>mvp)
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
