"use strict";

// Match-only UI. Aggregate fields come from player_stats; CK and SG are
// summed from round records only when every recorded round is present.
window.matchDashboard = (() => {
  const num = v => v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  const sum = (rows,key) => rows.length && rows.every(r=>num(r[key])!==null) ? rows.reduce((n,r)=>n+Number(r[key]),0) : null;
  const divide = (a,b) => a===null||b===null?null:b>0?a/b:a>0?Infinity:0;
  const format = (v,digits=0) => v==null?"—":v===Infinity?"∞":Number(v).toLocaleString(undefined,{minimumFractionDigits:digits,maximumFractionDigits:digits});
  const clock = v => v===null?"—":`${Math.floor(v/60)}:${String(Math.floor(v%60)).padStart(2,"0")}`;
  const esc = v => window.nnHelpers.escapeHtml(v);
  const attr = v => window.nnHelpers.escapeAttr(v);
  const empty = v => `<p class="analytics-empty">${esc(v)}</p>`;
  const fields = [
    ["kills","K","Enemy kills"],["deaths","D","Enemy and team deaths; suicides excluded"],["kd","K/D","Enemy kills / enemy and team deaths; suicides excluded"],
    ["ck","CK","Conced kills"],["team_kills","TK","Team kills"],["sg","SG","Sentry kills"],
    ["damage","DMG","Enemy damage"],["team_damage","TDMG","Damage inflicted on teammates"],["conc_jumps","CJ","Concussion jumps"],
    ["caps","CAPS","Flag captures"],["touches","TOUCH","Flag touches"],["flag_time_seconds","TIME","Flag possession time"]
  ];
  const classFiles = {scout:"Scout",sniper:"Sniper",soldier:"Soldier",demoman:"Demoman",medic:"Medic",hwguy:"Heavy",heavy:"Heavy",hvyweapon:"Heavy",engineer:"Engineer",pyro:"Pyro",spy:"Spy",civilian:"Civilian"};
  const classLabel = k => classFiles[String(k).toLowerCase()]||String(k||"Unknown");
  const classIcon = k => classFiles[String(k).toLowerCase()]?`<img class="analytics-class-icon" src="assets/images/classes/${classFiles[String(k).toLowerCase()]}old_tfc.png" alt="" loading="lazy">`:"";
  const weaponIcon = k => `<i aria-hidden="true" class="weapon-icon ${attr(/^weapon-\d+$/.test(k)?k:"")}"></i>`;
  const weaponLabel = k => window.nnHelpers.weaponName(k);
  const metric = (r,key) => key==="flag_time_seconds"?clock(r[key]):format(r[key],key==="kd"?2:0);
  const legend = '<div class="analytics-legend"><span class="blue">Team 1</span><span class="red">Team 2</span></div>';
  const panel = (title,body,note="",wide=false) => `<section class="analytics-panel ${wide?"analytics-wide":""}"><header><h2>${title}</h2>${legend}</header>${note?`<p class="analytics-note">${note}</p>`:""}${body}</section>`;

  function roundKd(row) {
    const deaths=["deaths_by_enemy","deaths_by_team"].map(k=>num(row[k]));
    return divide(num(row.kills),deaths.some(v=>v===null)?null:deaths.reduce((a,b)=>a+b,0));
  }

  function model(match) {
    const rounds=Array.isArray(match.rounds)?match.rounds:[];
    const roundRows=Array.isArray(match.round_player_stats)?match.round_player_stats:[];
    const roundIds=[...new Set([...rounds,...roundRows].map(r=>Number(r.round_num)).filter(n=>n>0))].sort((a,b)=>a-b);
    const teams=["blue","red"].map((color,index)=>{
      const roster=(index===0?match.blueTeam:match.redTeam)||[];
      const players=roster.map(player=>{
        const stats=findStatsForPlayer(match.player_stats||[],player)||{};
        const playerRounds=roundRows.filter(r=>roundRowMatchesPlayer(r,player,stats)).sort((a,b)=>a.round_num-b.round_num);
        const complete=roundIds.length>0&&roundIds.every(id=>playerRounds.filter(r=>Number(r.round_num)===id).length===1);
        const metrics=Object.fromEntries(fields.map(([key])=>[key,num(stats[key])]));
        metrics.ck=complete?sum(playerRounds,"conced_kills"):null;
        metrics.sg=complete?sum(playerRounds,"sentry_kills"):null;
        metrics.kd=divide(metrics.kills,metrics.deaths);
        metrics.damage_taken=num(stats.damage_taken);
        metrics.initial_touches=num(stats.initial_touches);
        const gameMvp=(match.match_mvps||[]).some(mvp=>{
          const ids=[mvp.mvp_player_key,mvp.steam_id,mvp.mvp_steam_id].filter(Boolean).map(String);
          if(ids.length)return playerKeys(player,stats).some(id=>ids.includes(id));
          const name=matchNormName(mvp.mvp_display_name||"");
          return name&&name===matchNormName(stats.display_name||player.name||player.display_name||"");
        });
        return {player,stats,metrics,gameMvp,rounds:playerRounds,
          classes:rowsForPlayer(match.class_stats||[],player,stats).slice().sort((a,b)=>Number(b.seconds)-Number(a.seconds)),
          weapons:rowsForPlayer(match.weapon_stats||[],player,stats).slice().sort((a,b)=>Number(b.kills)-Number(a.kills)),
          roundWeapons:rowsForPlayer(match.round_weapon_stats||[],player,stats),
          buildings:(match.building_stats||[]).filter(r=>roundRowMatchesPlayer(r,player,stats))};
      });
      const totals=Object.fromEntries(fields.map(([key])=>[key,sum(players.map(p=>p.metrics),key)]));
      totals.kd=divide(totals.kills,totals.deaths);totals.damage_taken=sum(players.map(p=>p.metrics),"damage_taken");
      return {color,index,label:`Team ${index+1}`,players,totals,score:num(match[index===0?"score_blue":"score_red"]),winner:String(match.winner).toLowerCase()===color};
    });
    const events=(match.capTimeline||[]).filter(e=>num(e.time_seconds)!==null&&Number(e.time_seconds)>=0).slice().sort((a,b)=>Number(a.time_seconds)-Number(b.time_seconds));
    const duration=sum(rounds,"duration_seconds");
    return {match,rounds,roundIds,teams,events,duration,extent:Math.max(duration||0,...events.map(e=>Number(e.time_seconds)),1)};
  }

  function roundView(data,id) {
    if(id==="all")return data;
    const selectedRound=Number(id),roundIds=[selectedRound],rounds=data.rounds.filter(r=>Number(r.round_num)===selectedRound);
    const keys={ck:"conced_kills",sg:"sentry_kills",damage:"enemy_damage",caps:"flag_captures",touches:"flag_touches",damage_taken:"damage_taken_enemy"};
    const teams=data.teams.map(team=>{
      const players=team.players.map(p=>{
        const rows=p.rounds.filter(r=>Number(r.round_num)===selectedRound),row=rows.length===1?rows[0]:{};
        const metrics=Object.fromEntries([...fields.map(([key])=>key),"damage_taken","initial_touches"].map(key=>[key,num(row[keys[key]||key])]));
        const deaths=[num(row.deaths_by_enemy),num(row.deaths_by_team)];
        metrics.deaths=deaths.every(v=>v!==null)?deaths[0]+deaths[1]:null;metrics.kd=divide(metrics.kills,metrics.deaths);
        const taken=[num(row.damage_taken_enemy),num(row.damage_taken_team)];
        metrics.damage_taken=taken.every(v=>v!==null)?taken[0]+taken[1]:null;
        const weapons=p.roundWeapons.filter(w=>Number(w.round_num)===selectedRound).slice().sort((a,b)=>Number(b.kills)-Number(a.kills));
        // Only show shares when event counts reconcile with authoritative round kills.
        const weaponComplete=metrics.kills!==null&&(metrics.kills===0?weapons.length===0:weapons.length>0&&sum(weapons,"kills")===metrics.kills&&weapons.every(w=>typeof w.weapon==="string"&&w.weapon.trim()));
        return {...p,metrics,rounds:rows,classes:[],weapons:weaponComplete?weapons:[],weaponComplete,buildings:p.buildings.filter(r=>Number(r.round_num)===selectedRound),stats:{...p.stats,main_class:row.role},roundOnly:true};
      });
      const totals=Object.fromEntries([...fields.map(([key])=>key),"damage_taken"].map(key=>[key,sum(players.map(p=>p.metrics),key)]));
      totals.kd=divide(totals.kills,totals.deaths);
      return {...team,players,totals,score:rounds.length===1?num(rounds[0][team.index===0?"team1_score":"team2_score"]):null,winner:false,context:`Round ${selectedRound}`};
    });
    return {...data,teams,rounds,roundIds,selectedRound};
  }

  function summary(team) {
    return `<section class="analytics-team-summary ${team.color}" data-analytics-team="${team.color}" aria-label="${team.label} summary"><div class="analytics-team-score"><h2>${team.label}${team.context?` · ${team.context}`:""}${team.winner?'<span class="analytics-winner">Winner <span class="analytics-winner-trophy" aria-hidden="true">🏆</span></span>':""}</h2><strong>${format(team.score)}</strong></div><dl>${fields.filter(([k])=>k!=="team_damage").map(([key,label,description])=>`<div title="${attr(description)}"><dt>${label}</dt><dd>${metric(team.totals,key)}</dd></div>`).join("")}</dl></section>`;
  }

  function weaponBars(rows) {
    const total=sum(rows,"kills");
    return rows.length?rows.slice(0,4).map(r=>{
      const kills=num(r.kills),percent=total>0&&kills!==null?kills/total*100:null;
      return `<div class="analytics-weapon-mini" title="${attr(`${weaponLabel(r.weapon)}: ${format(kills)} kills${percent!==null?` · ${format(percent,1)}% of returned weapon kills`:""}`)}">${weaponIcon(r.weapon)}<span class="analytics-bar-track"><span style="width:${percent||0}%"></span></span><b>${percent===null?format(kills):`${format(percent)}%`}</b></div>`;
    }).join(""):empty("No weapon records");
  }

  function playerDetails(p) {
    const extras=["conced_kills","team_kills","sentry_kills","enemy_damage","team_damage","conc_jumps","flag_captures","flag_touches","initial_touches"];
    return `<div class="analytics-player-detail"><div class="analytics-detail-grid"><section><h3>Class playtime</h3>${p.classes.length?p.classes.map(c=>`<div class="analytics-detail-line"><span>${classIcon(c.class_name)}${esc(classLabel(c.class_name))}</span><b>${clock(num(c.seconds))}</b></div>`).join(""):empty(p.roundOnly?"Class playtime is only available for the full match":"No class records")}</section><section><h3>Recorded weapon kills</h3>${p.weapons.length?p.weapons.map(w=>`<div class="analytics-detail-line"><span>${weaponIcon(w.weapon)}${esc(weaponLabel(w.weapon))}</span><b>${format(num(w.kills))}</b></div>`).join(""):empty(p.roundOnly?p.weaponComplete?"No enemy weapon kills in this round":"Complete weapon kill events are unavailable for this round":"No weapon records")}</section></div>
      ${renderEngineerBuildings(p.buildings)}
      <div class="analytics-table-scroll" tabindex="0" role="region" aria-label="Player round details"><table class="analytics-detail-table"><caption>Round performance · deaths = enemy / team / suicide</caption><thead><tr><th>Round / role</th><th>K</th><th>Deaths E/T/S</th><th>K/D</th><th>CK</th><th>TK</th><th>SG</th><th>Enemy DMG</th><th>Team DMG</th><th>CJ</th><th>Caps</th><th>Touch</th><th>Initial</th><th>Flag time</th><th>Taken E/T/Self</th><th>Objectives</th><th>Toss %</th></tr></thead><tbody>${p.rounds.map(r=>`<tr><th>R${format(r.round_num)} · ${esc(r.role||"—")}</th><td>${format(num(r.kills))}</td><td>${[r.deaths_by_enemy,r.deaths_by_team,r.suicides].map(v=>format(num(v))).join(" / ")}</td><td>${format(roundKd(r),2)}</td>${extras.map(k=>`<td>${format(num(r[k]))}</td>`).join("")}<td>${clock(num(r.flag_time_seconds))}</td><td>${[r.damage_taken_enemy,r.damage_taken_team,r.self_damage].map(v=>format(num(v))).join(" / ")}</td><td>${format(num(r.objectives))}</td><td>${format(num(r.toss_percent),1)}</td></tr>`).join("")||'<tr><td colspan="17">No round records</td></tr>'}</tbody></table></div><p class="analytics-note">Damage taken: ${format(p.metrics.damage_taken)} · Initial touches: ${format(p.metrics.initial_touches)} · Full-match rating change: ${p.player.delta==null?"—":deltaText(p.player.delta)}</p></div>`;
  }

  function playerTeam(team) {
    return `<section class="analytics-player-team ${team.color}"><header><h2>${team.label} Players</h2><span>${team.players.length} players · ${team.context||"full match"}</span></header><div class="analytics-player-scroll" tabindex="0" role="region" aria-label="${team.label} player comparison"><div class="analytics-player-grid"><div class="analytics-player-columns"><span>Player / class</span><span>Combat & objectives</span><span>Weapon kills</span></div>${team.players.map(p=>{
      const primary=p.classes[0]?.class_name||p.stats.main_class;
      return `<details class="analytics-player ${p.gameMvp?"analytics-player-mvp":""}"><summary><div class="analytics-player-identity">${classIcon(String(primary||"").split(",")[0].trim())}<div>${p.gameMvp?'<span class="analytics-mvp-badge" title="Recorded game MVP">★ MVP</span>':""}<div class="analytics-player-name-line"><a class="analytics-player-name" href="player.html?id=${encodeURIComponent(p.player.id||p.stats.player_key||"")}" title="${attr(p.player.name||p.player.display_name||"Unknown")}">${playerLabel(p.player)}${pageSupporterBadge(p.player.id)}</a></div><span class="analytics-player-class" title="${attr(p.classes.map(c=>classLabel(c.class_name)).join(", "))}">${esc(p.classes.length?p.classes.slice(0,2).map(c=>classLabel(c.class_name)).join(" / "):classLabel(primary))}</span></div><span class="analytics-expand" aria-hidden="true">+</span></div><dl class="analytics-player-metrics">${fields.map(([key,label,description])=>`<div class="metric-${key}" title="${attr(description)}"><dt>${label}</dt><dd>${metric(p.metrics,key)}</dd></div>`).join("")}</dl><div class="analytics-player-weapons">${p.roundOnly&&!p.weaponComplete?empty("Round events unavailable"):p.roundOnly&&p.metrics.kills===0?empty("No enemy kills"):weaponBars(p.weapons)}</div></summary>${playerDetails(p)}</details>`;
    }).join("")||empty("No players assigned")}</div></div></section>`;
  }

  function group(team,collection,key,value) {
    const values=new Map();team.players.forEach(p=>p[collection].forEach(r=>{if(num(r[value])!==null)values.set(r[key],(values.get(r[key])||0)+Number(r[value]));}));return values;
  }
  function pair(label,values,display,icon="",filter="both") {
    const max=Math.max(1,...values.filter(Number.isFinite));
    return `<div class="analytics-pair"><div class="analytics-pair-label">${icon}<span>${esc(label)}</span></div>${values.map((v,i)=>`<div class="analytics-pair-value ${i===0?"blue":"red"}" ${filter!=="both"&&filter!==(i===0?"blue":"red")?"hidden":""}><span class="analytics-bar-track"><span style="width:${v===null?0:v===Infinity?100:Math.min(100,v/max*100)}%"></span></span><b>${display(v)}</b></div>`).join("")}</div>`;
  }
  function breakdown(data,kind,filter,full=false) {
    if(data.selectedRound&&kind==="class")return panel("Class Breakdown",empty("Round-specific class playtime is not exposed. Select All rounds to view full-match totals."),"",full);
    const isClass=kind==="class",collection=isClass?"classes":"weapons",key=isClass?"class_name":"weapon",value=isClass?"seconds":"kills";
    const complete=data.teams.map(t=>!data.selectedRound||isClass||t.players.every(p=>p.weaponComplete));
    const maps=data.teams.map((t,i)=>complete[i]?group(t,collection,key,value):new Map());
    const keys=[...new Set(maps.flatMap(m=>[...m.keys()]))].sort((a,b)=>maps.reduce((n,m)=>n+(m.get(b)||0)-(m.get(a)||0),0));
    const selected=full?keys:keys.slice(0,isClass?5:6);
    const body=selected.map(k=>pair(isClass?classLabel(k):weaponLabel(k),maps.map((m,i)=>!complete[i]?null:m.has(k)?m.get(k):data.selectedRound||data.teams[i].players.some(p=>p[collection].length)?0:null),isClass?clock:format,isClass?classIcon(k):weaponIcon(k),filter)).join("")||empty(data.selectedRound&&!complete.every(Boolean)?"Complete weapon kill events are unavailable for this round.":`No ${isClass?"class":"weapon"} records`);
    return panel(isClass?"Class Breakdown":"Weapon Usage",body+(!full&&keys.length>selected.length?`<p class="analytics-note">Top ${selected.length} of ${keys.length} · all records in player details</p>`:"")+(!isClass&&data.selectedRound&&!complete.every(Boolean)?'<p class="analytics-note">— = incomplete or unavailable round kill events</p>':""),isClass?"Pooled player class playtime":data.selectedRound?`Round ${data.selectedRound} enemy weapon kills · reconciled with round totals`:"Recorded weapon kills · not shots fired",full);
  }
  function damage(data,filter) {
    const per=(a,b)=>a!==null&&b!==null&&b>0?a/b:null;
    const specs=[["Enemy damage",t=>t.damage],["Team damage",t=>t.team_damage],["Damage taken",t=>t.damage_taken],["Damage / kill",t=>per(t.damage,t.kills)],["Damage / death",t=>per(t.damage,t.deaths)]];
    return panel("Damage Comparison",specs.map(([label,get])=>pair(label,data.teams.map(t=>get(t.totals)),v=>format(v,label.includes("/")?1:0),"",filter)).join(""),"Enemy damage and friendly damage kept separate");
  }

  const flagPaceRounds = data => {
    const pace=window.nnCaptureTimeline.build(data.match,data.events);
    return data.selectedRound?{...pace,rounds:pace.rounds.filter(r=>r.id===data.selectedRound),events:pace.events.filter(e=>e.round===data.selectedRound)}:pace;
  };
  const paceClock = window.nnCaptureTimeline.clock;

  function captures(data,filter,rounds=flagPaceRounds(data).rounds,pickups=[]) {
    if(!data.events.length)return empty("No timestamped captures recorded");
    if(rounds&&!rounds.length)return empty("Round-relative capture times unavailable: recorded round boundaries are missing.");
    const groups=rounds?rounds.map(r=>({id:r.id,events:r.events,duration:r.duration})):[{id:null,events:data.events,duration:data.extent}];
    const extent=Math.max(1,...groups.map(g=>g.duration)),visibleTeams=data.teams.filter(t=>filter==="both"||filter===t.color);
    const max=Math.max(1,...groups.flatMap(g=>(rounds?visibleTeams:data.teams).map(t=>g.events.filter(e=>capTeamClass(e.team)===t.color).length)));
    const time=e=>rounds?e.round_time_seconds:Number(e.time_seconds),displayTime=rounds?paceClock:clock;
    const timeStep=[1,5,10,15,30,60,120,180,300,600,900,1800,3600].find(step=>step>=extent/6)||Math.ceil(extent/3600/6)*3600;
    const x=s=>32+s/extent*476,y=n=>154-n/max*140;
    const countTicks=Array.from({length:max+1},(_,i)=>i);
    const timeTicks=Array.from({length:Math.floor(extent/timeStep)+1},(_,i)=>i*timeStep);
    return `<svg class="analytics-capture-chart" viewBox="0 0 520 180" role="img" aria-label="Cumulative captures on the ${rounds?"round-relative":"full match"} clock; hover or focus capture and touch markers for details">${countTicks.map(value=>`<line class="chart-grid" x1="32" x2="508" y1="${y(value)}" y2="${y(value)}"/><text x="25" y="${y(value)+4}" text-anchor="end">${format(value)}</text>`).join("")}${timeTicks.map(value=>`<text x="${x(value)}" y="174" text-anchor="${value===0?"start":extent-value<timeStep*0.1?"end":"middle"}">${displayTime(value)}</text>`).join("")}${groups.map(g=>visibleTeams.map(t=>{
      const teamEvents=g.events.filter(e=>capTeamClass(e.team)===t.color);
      if(!teamEvents.length&&!pickups.some(e=>e.color===t.color&&Number(e.round_num)===g.id))return "";
      let count=0,path=`M${x(0)},${y(0)}`;
      const flags=teamEvents.map(e=>{count++;path+=` H${x(time(e))} V${y(count)}`;const title=`${g.id?`Round ${g.id} · `:""}${t.label} · Capture ${e.cap_num||count} · ${displayTime(time(e))}${e.capper_name?` · ${e.capper_name}`:""}`;return `<g class="analytics-capture-flag ${t.color}" transform="translate(${x(time(e))} ${y(count)})" tabindex="0" role="img" data-capture="${attr(title)}" aria-label="${attr(title)}"><title>${esc(title)}</title><line x1="0" y1="-8" x2="0" y2="2"/><path d="M0 -8 H7 L5 -5 H0 Z"/></g>`;}).join("");
      const marks=pickups.filter(e=>e.color===t.color&&Number(e.round_num)===g.id&&num(e.game_time_seconds)!==null&&Number(e.game_time_seconds)>=0&&Number(e.game_time_seconds)<=g.duration).map(e=>{const seconds=Number(e.game_time_seconds),level=teamEvents.filter(cap=>time(cap)<=seconds).length,title=`Round ${g.id} · ${t.label} · Touch · ${paceClock(seconds)} · ${e.display_name||"Unknown player"}`;return `<circle class="analytics-touch-mark ${t.color}" cx="${x(seconds)}" cy="${y(level)+(t.color==="blue"?-3:3)}" r="2" tabindex="0" data-capture="${attr(title)}" aria-label="${attr(title)}"><title>${esc(title)}</title></circle>`;}).join("");
      return `<path class="${t.color}" ${g.id?`data-capture-round="${g.id}" aria-label="Round ${g.id}, ${t.label}"`:""} d="${path} H${x(g.duration)}"/>${marks}${flags}`;
    }).join("")).join("")}</svg><p class="analytics-chart-detail" aria-live="polite">Cumulative captures · ${rounds?"round clock":"match clock"}</p>`;
  }
  const roundPanel=(data,filter)=>panel("Round Performance",data.events.length?captures(data,filter):data.rounds.map(r=>pair(`Round ${r.round_num}`,[num(r.team1_score),num(r.team2_score)],format,"",filter)).join("")||empty("No round results"),data.events.length?"Cumulative captures · round-relative timestamps":"Recorded round scores");
  const comparison=(data,filter)=>panel("Team Comparison",fields.map(([key,,description])=>pair(description,data.teams.map(t=>t.totals[key]),v=>key==="flag_time_seconds"?clock(v):format(v,key==="kd"?2:0),"",filter)).join(""),`${data.selectedRound?`Round ${data.selectedRound}`:"Full match"} totals · CJ = concussion jumps`,true);
  function playerTimelineChart(data,team,selected,kind) {
    const isDamage=kind==="damage",field=isDamage?"damage":"kills",label=isDamage?"Enemy damage":"Enemy kills";
    const players=selected===null?team.players:team.players.filter((_,i)=>i===selected);
    const all=Array.isArray(data.match[isDamage?"round_damage_buckets":"round_kill_buckets"])?data.match[isDamage?"round_damage_buckets":"round_kill_buckets"]:[];
    const segments=[];let total=0,duration=0;
    for(const id of data.roundIds){
      const round=data.rounds.find(r=>Number(r.round_num)===id),length=num(round?.duration_seconds);
      if(!players.length||length===null||length<=0||!all.some(b=>Number(b.round_num)===id))return empty(`Complete ${label.toLowerCase()} events are unavailable for this selection.`);
      const values=Array.from({length:Math.ceil(length/60)},()=>0);
      for(const player of players){
        const rows=player.rounds.filter(r=>Number(r.round_num)===id);
        if(rows.length!==1)return empty(`Complete ${label.toLowerCase()} events are unavailable for this selection.`);
        const row=rows[0],expected=num(row[isDamage?"enemy_damage":"kills"]),buckets=all.filter(b=>Number(b.round_num)===id&&roundRowMatchesPlayer(b,row,row));
        if(expected===null||(buckets.length?sum(buckets,field)!==expected:expected!==0))return empty(`Complete ${label.toLowerCase()} events are unavailable for this selection.`);
        total+=expected;
        for(const b of buckets){const minute=num(b.minute),value=num(b[field]);if(minute===null||minute<0||minute>values.length||value===null||value<0)return empty(`${label} timeline unavailable.`);values[Math.min(minute,values.length-1)]+=value;}
      }
      segments.push({id,length,values,start:duration});duration+=length;
    }
    if(!segments.length)return empty("No round records available.");
    const rawStep=Math.max(1,total/4),magnitude=10**Math.floor(Math.log10(rawStep));
    const valueStep=[1,2,5,10].map(n=>n*magnitude).find(n=>n>=rawStep),axisMax=Math.max(valueStep,Math.ceil(total/valueStep)*valueStep);
    const valueTicks=Array.from({length:axisMax/valueStep+1},(_,i)=>i*valueStep);
    let cumulative=0;
    const x=s=>48+s/duration*444,y=value=>130-value/axisMax*108;
    const points=[`${x(0)},${y(0)}`,...segments.flatMap(segment=>segment.values.map((value,i)=>{cumulative+=value;return `${x(segment.start+Math.min((i+1)*60,segment.length))},${y(cumulative)}`;}))].join(" ");
    const step=[60,120,180,360,600,900,1800,3600].find(t=>t*1.01>=duration/5)||Math.max(60,Math.ceil(duration/300)*60);
    const times=Array.from({length:Math.floor(duration/step)+1},(_,i)=>i*step);
    if(duration-times[times.length-1]<step*.15&&times.length>1)times.pop();
    times.push(duration);
    const name=selected===null?team.label:(players[0].stats.display_name||players[0].player.name||players[0].player.display_name||"Player");
    const description=`${name}: ${format(total)} cumulative ${label.toLowerCase()}, grouped by minute`;
    return `<div class="analytics-player-chart"><div class="analytics-player-chart-heading"><span>${esc(name)} · ${esc(label)} over time</span><strong>${format(total)}</strong></div><svg viewBox="0 0 520 158" role="img" aria-label="${attr(description)}">${valueTicks.map(value=>`<line x1="48" x2="492" y1="${y(value)}" y2="${y(value)}"/><text x="42" y="${y(value)+4}" text-anchor="end">${format(value)}</text>`).join("")}${times.map(t=>`<text x="${x(t)}" y="150" text-anchor="${t===0?"start":t===duration?"end":"middle"}">${paceClock(t)}</text>`).join("")}${segments.slice(1).map(segment=>`<line class="analytics-round-marker" x1="${x(segment.start)}" x2="${x(segment.start)}" y1="22" y2="130"/><text class="analytics-round-marker-label" x="${x(segment.start)}" y="14" text-anchor="middle">R${segment.id} starts</text>`).join("")}<polyline class="${team.color}" points="${points}"/></svg><p class="analytics-note">Cumulative ${esc(label.toLowerCase())} · grouped by minute${segments.length>1?" · dashed line marks the start of the next round":""}</p></div>`;
  }
  function timeline(data,filter,state) {
    return `<div class="analytics-two-col">${data.teams.filter(t=>filter==="both"||filter===t.color).map(team=>{
      const selection=state[team.color],selected=selection.player,metric=selection.metric;
      const chart=`<div class="analytics-player-timeline"><div class="analytics-player-chart-controls" role="group" aria-label="Chart metric"><button type="button" data-timeline-metric="damage" data-timeline-team="${team.color}" aria-pressed="${metric==="damage"}">Enemy damage</button><button type="button" data-timeline-metric="kills" data-timeline-team="${team.color}" aria-pressed="${metric==="kills"}">Kills</button><button type="button" data-timeline-player="all" data-timeline-team="${team.color}" aria-pressed="${selected===null}">Whole team</button></div>${playerTimelineChart(data,team,selected,metric)}</div>`;
      const roundData=data.roundIds.map(id=>({id,round:data.rounds.find(r=>Number(r.round_num)===id)||{},rows:team.players.flatMap(p=>p.rounds.filter(row=>Number(row.round_num)===id))}));
      const rounds=roundData.length?`<div class="analytics-table-scroll analytics-round-table-scroll" tabindex="0" role="region" aria-label="${team.label} round comparison"><table class="analytics-detail-table analytics-round-comparison"><thead><tr><th>Player</th>${roundData.map(({id,round})=>`<th>Round ${id} <small>${clock(num(round.duration_seconds))}</small></th>`).join("")}</tr></thead><tbody><tr class="analytics-round-team-totals"><th scope="row">Team totals</th>${roundData.map(({round,rows})=>`<td><span>${esc([round.offense_team?`Offense: ${round.offense_team}`:"",round.defense_team?`Defense: ${round.defense_team}`:""].filter(Boolean).join(" · "))}</span><strong>${[["K","kills"],["DMG","enemy_damage"],["Team DMG","team_damage"],["Caps","flag_captures"],["Touches","flag_touches"]].map(([label,key])=>`${format(sum(rows,key))} ${label}`).join(" · ")}</strong></td>`).join("")}</tr>${team.players.map((player,index)=>`<tr><th scope="row"><button type="button" class="analytics-timeline-player ${team.color}" data-timeline-team="${team.color}" data-timeline-player="${index}" aria-pressed="${selected===index}">${esc(player.stats.display_name||player.player.name||player.player.display_name||"Unknown player")}</button></th>${roundData.map(({id})=>{const rows=player.rounds.filter(row=>Number(row.round_num)===id),row=rows.length===1?rows[0]:null;return row?`<td><span>${esc(row.role||"—")}</span><strong>${format(num(row.enemy_damage))} DMG · ${format(num(row.kills))} K · ${format(roundKd(row),2)} K/D</strong></td>`:'<td>—</td>';}).join("")}</tr>`).join("")}</tbody></table></div>`:empty("No round records");
      return panel(`${team.label} Round Timeline`,chart+rounds,"Select a player to update the chart");
    }).join("")}</div>`;
  }
  function pace(data,filter) {
    const {rounds,events}=flagPaceRounds(data),unassigned=events.filter(e=>e.round===null).length;
    const pickups=(Array.isArray(data.match.flag_pickups)?data.match.flag_pickups:[]).map(e=>{
      const matches=data.teams.filter(team=>team.players.some(p=>roundRowMatchesPlayer(e,p.player,p.stats)));
      const color=matches.length===1?matches[0].color:capTeamClass(e.team);
      return {...e,color};
    }).filter(e=>(!data.selectedRound||Number(e.round_num)===data.selectedRound)&&(filter==="both"||e.color===filter));
    const captureRows=events.filter(e=>filter==="both"||capTeamClass(e.team)===filter).map(e=>{
      const color=capTeamClass(e.team),time=num(e.round_time_seconds);
      const comparable=e.round!==null&&time!==null&&(color==="blue"||color==="red");
      const prior=comparable?events.filter(other=>other!==e&&other.round===e.round&&capTeamClass(other.team)===color&&num(other.round_time_seconds)!==null&&Number(other.round_time_seconds)<time):[];
      const previous=prior.length?Math.max(...prior.map(other=>Number(other.round_time_seconds))):null;
      const tied=comparable&&events.some(other=>other!==e&&other.round===e.round&&capTeamClass(other.team)===color&&num(other.round_time_seconds)===time);
      const touchRecordsAvailable=comparable&&pickups.some(p=>Number(p.round_num)===e.round);
      const windowTouches=comparable&&!tied?pickups.filter(p=>p.color===color&&Number(p.round_num)===e.round&&num(p.game_time_seconds)!==null&&Number(p.game_time_seconds)>=0&&Number(p.game_time_seconds)<=time&&(previous===null||Number(p.game_time_seconds)>previous)).slice().sort((a,b)=>Number(a.game_time_seconds)-Number(b.game_time_seconds)):[];
      const details=!comparable||tied?'<p class="analytics-note">Touch window unavailable for this capture.</p>':!touchRecordsAvailable?'<p class="analytics-note">No touch records available for this round.</p>':windowTouches.length?`<ul>${windowTouches.map(p=>`<li><time>${paceClock(num(p.game_time_seconds))}</time> ${esc(p.display_name||"Unknown player")}</li>`).join("")}</ul>`:'<p class="analytics-note">No recorded touches in this window.</p>';
      const touchCount=comparable&&!tied&&touchRecordsAvailable?format(windowTouches.length):"—";
      return `<tr class="analytics-capture-row ${color}"><td>${e.round===null?"—":`R${e.round}`}</td><td>${paceClock(e.round_time_seconds)}</td><td>${esc(capTeamLabel(e.team))}</td><td>${format(num(e.cap_num))}</td><td>${esc(e.capper_name||"Unknown player")}</td><td><details class="analytics-capture-details${touchCount==="1"?" analytics-single-touch":""}" name="flag-pace-captures"><summary aria-label="${attr(`${touchCount} recorded touches for ${e.capper_name||"Unknown player"}, capture ${format(num(e.cap_num))}`)}">${touchCount}</summary>${details}</details></td></tr>`;
    }).join("");
    return panel("Flag Pace",`<div class="analytics-pace-layout"><div class="analytics-pace-chart">${captures(data,filter,rounds,pickups)}${unassigned?empty(`${unassigned} capture(s) have no verified round boundary; their round and relative time are unavailable.`):""}</div><div class="analytics-table-scroll analytics-pace-events" tabindex="0" role="region" aria-label="Capture events"><table class="analytics-detail-table"><thead><tr><th>Round</th><th>Round time</th><th>Team</th><th>Capture</th><th>Player</th><th>Touches</th></tr></thead><tbody>${captureRows||'<tr><td colspan="6">No timestamped captures for this selection.</td></tr>'}</tbody></table></div></div>`,"Each round starts at 00:00 with zero captures · expand a touch count to see earlier touches",true);
  }
  function downloads(data) {
    return panel("Downloads & Match Sources",`<div class="analytics-download-links"><button type="button" data-export="json">Match data · JSON ↓</button><button type="button" data-export="csv">Player statistics · CSV ↓</button>${data.match.hampalyzer_url?`<a href="${attr(data.match.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">Hampalyzer ↗</a>`:""}${data.match.tfcstats_url?`<a href="${attr(data.match.tfcstats_url)}" target="_blank" rel="noopener noreferrer">TFCStats ↗</a>`:""}</div><div data-replay-links></div>`,"JSON contains the full API response; CSV uses the current team and round selection.",true);
  }

  function mount(root,match) {
    const data=model(match);let active="overview",filter="both",roundFilter="all",replays=[],replaysLoaded=false;
    const timelineState={blue:{player:null,metric:"damage"},red:{player:null,metric:"damage"}};
    const tabs=[["overview","Player Overview"],["comparison","Team Comparison"],["timeline","Round Timeline"],["pace","Flag Pace"],["weapons","Weapon Usage"],["damage","Damage"],["vision","Map Vision"],["downloads","Downloads"]];
    const enabled=id=>(id!=="vision"||replays.length>0)&&(id!=="timeline"||data.roundIds.length>0)&&(id!=="weapons"||data.teams.some(t=>t.players.some(p=>p.weapons.length||p.roundWeapons.length)));
    root.innerHTML=`<div class="analytics-nav"><div class="analytics-navigation-links"><div class="analytics-tabs" role="tablist" aria-label="Match analytics">${tabs.map(([id,label])=>`<button type="button" id="analytics-tab-${id}" data-analytics-tab="${id}" role="tab" aria-controls="analytics-content" aria-selected="${id===active}" tabindex="${id===active?0:-1}" ${enabled(id)?"":`disabled title="${id==="vision"?"Match statistics contain no positions. Checking recorded replays.":"No recorded data for this view."}"`}>${label}</button>`).join("")}</div><a class="analytics-back-link" href="matches.html">Back to Matches</a></div><div class="analytics-filter" role="group" aria-label="Team view"><span>View:</span>${[["both","Both"],["blue","Team 1"],["red","Team 2"]].map(([id,label])=>`<button type="button" data-team-filter="${id}" aria-pressed="${id===filter}">${label}</button>`).join("")}</div><div class="analytics-filter" role="group" aria-label="Round view"><span>Round:</span>${[["all","All rounds"],...data.roundIds.map(id=>[String(id),`Round ${id}`])].map(([id,label])=>`<button type="button" data-round-filter="${id}" aria-pressed="${id===roundFilter}">${label}</button>`).join("")}</div></div><div class="analytics-summaries">${data.teams.map(summary).join("")}</div><div id="analytics-content" role="tabpanel" aria-labelledby="analytics-tab-overview" tabindex="0"></div>`;
    const content=root.querySelector("#analytics-content");
    function renderReplays() {
      const holder=content.querySelector("[data-replay-links]");if(!holder)return;
      const selected=replays.filter(r=>roundFilter==="all"||r.round===Number(roundFilter));
      holder.innerHTML=selected.length?`<h3>Recorded replays & map exploration</h3><div class="analytics-download-links">${selected.map(r=>`<a href="pickup-replay.html?matchId=${encodeURIComponent(match.id||match.match_id)}&round=${r.round}">Round ${r.round} replay ↗</a>`).join("")}</div>`:empty(replaysLoaded?"No available replay was returned for this selection.":"Checking recorded replay availability…");
    }
    function render() {
      const viewData=roundView(data,roundFilter);
      root.querySelectorAll("[data-round-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.roundFilter===roundFilter)));
      root.querySelector(".analytics-summaries").innerHTML=viewData.teams.map(summary).join("");
      root.querySelectorAll("[data-analytics-tab]").forEach(b=>{const selected=b.dataset.analyticsTab===active;b.setAttribute("aria-selected",String(selected));b.tabIndex=selected?0:-1;});
      root.querySelectorAll("[data-team-filter]").forEach(b=>b.setAttribute("aria-pressed",String(b.dataset.teamFilter===filter)));
      root.querySelectorAll(".analytics-team-summary").forEach(p=>p.hidden=filter!=="both"&&p.dataset.analyticsTeam!==filter);
      root.querySelector(".analytics-summaries").classList.toggle("single-team",filter!=="both");
      content.setAttribute("aria-labelledby",`analytics-tab-${active}`);
      if(active==="overview")content.innerHTML=`<div class="analytics-players ${filter!=="both"?"single-team":""}">${viewData.teams.filter(t=>filter==="both"||filter===t.color).map(playerTeam).join("")}</div><div class="analytics-support">${breakdown(viewData,"class",filter)}${breakdown(viewData,"weapon",filter)}${damage(viewData,filter)}${roundPanel(viewData,filter)}</div>`;
      if(active==="comparison")content.innerHTML=comparison(viewData,filter);
      if(active==="timeline")content.innerHTML=timeline(viewData,filter,timelineState);
      if(active==="pace")content.innerHTML=pace(viewData,filter);
      if(active==="weapons")content.innerHTML=breakdown(viewData,"weapon",filter,true);
      if(active==="damage")content.innerHTML=damage(viewData,filter);
      if(active==="downloads"){content.innerHTML=downloads(viewData);renderReplays();}
      if(active==="vision"){content.innerHTML=panel("Map Vision",'<div data-replay-links></div>',"Explore recorded positions, objectives and player perspectives in the existing 3D replay viewer.",true);renderReplays();}
    }
    root.addEventListener("click",event=>{
      const timelineButton=event.target.closest("[data-timeline-team]");
      if(timelineButton){
        const team=timelineButton.dataset.timelineTeam,state=timelineState[team];
        if(state){
          if(timelineButton.dataset.timelineMetric)state.metric=timelineButton.dataset.timelineMetric;
          if(timelineButton.dataset.timelinePlayer!==undefined)state.player=timelineButton.dataset.timelinePlayer==="all"?null:Number(timelineButton.dataset.timelinePlayer);
          const selector=timelineButton.dataset.timelineMetric?`[data-timeline-team="${team}"][data-timeline-metric="${timelineButton.dataset.timelineMetric}"]`:`[data-timeline-team="${team}"][data-timeline-player="${timelineButton.dataset.timelinePlayer}"]`;
          render();content.querySelector(selector)?.focus();
        }
      }
      const captureRow=event.target.closest(".analytics-capture-row");
      if(captureRow&&!event.target.closest(".analytics-capture-details")){
        const details=captureRow.querySelector(".analytics-capture-details");
        if(details)details.open=!details.open;
      }
      const tab=event.target.closest("[data-analytics-tab]"),view=event.target.closest("[data-team-filter]"),round=event.target.closest("[data-round-filter]"),exportButton=event.target.closest("[data-export]");
      if(tab&&!tab.disabled){active=tab.dataset.analyticsTab;render();}
      if(view){filter=view.dataset.teamFilter;render();}
      if(round){roundFilter=round.dataset.roundFilter;render();}
      if(exportButton){
        const kind=exportButton.dataset.export,cell=v=>{const s=String(v??"");return `"${(typeof v==="string"&&/^[=+\-@\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')}"`;};
        const rows=roundView(data,roundFilter).teams.filter(t=>filter==="both"||filter===t.color).flatMap(t=>t.players.map(p=>[t.label,p.player.name||p.player.display_name,p.stats.player_key,...fields.map(([key])=>p.metrics[key])]));
        const body=kind==="json"?JSON.stringify(match,null,2):[["Team","Player","Player key",...fields.map(([key])=>key)],...rows].map(r=>r.map(cell).join(",")).join("\r\n");
        const url=URL.createObjectURL(new Blob([body],{type:kind==="json"?"application/json":"text/csv;charset=utf-8"}));
        const link=document.createElement("a");link.href=url;link.download=`${match.id||match.match_id}-${kind==="csv"?`${roundFilter==="all"?"all-rounds":`round-${roundFilter}`}-${filter}`:"match"}.${kind}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      }
    });
    root.querySelector(".analytics-tabs").addEventListener("keydown",event=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      const buttons=[...root.querySelectorAll("[data-analytics-tab]:not(:disabled)")],index=buttons.indexOf(document.activeElement);
      const next=event.key==="Home"?0:event.key==="End"?buttons.length-1:(index+(event.key==="ArrowRight"?1:-1)+buttons.length)%buttons.length;
      event.preventDefault();buttons[next].focus();active=buttons[next].dataset.analyticsTab;render();
    });
    const describe=event=>{const point=event.target.closest("[data-capture]");if(point){const detail=point.closest(".analytics-panel").querySelector(".analytics-chart-detail");if(detail)detail.textContent=point.dataset.capture;}};
    root.addEventListener("mouseover",describe);root.addEventListener("focusin",describe);
    render();
    Promise.all(data.roundIds.map(async round=>{
      try{const response=await fetch(`api/pickup-replays/viewer/${encodeURIComponent(match.id||match.match_id)}/${round}`);if(!response.ok)return null;const metadata=await response.json();return metadata.files?{round,metadata}:null;}catch{return null;}
    })).then(results=>{replays=results.filter(Boolean);replaysLoaded=true;const tab=root.querySelector('[data-analytics-tab="vision"]');tab.disabled=!replays.length;tab.title=replays.length?"Explore recorded replays":"No recorded replay positions available for this match.";renderReplays();});
  }
  return {mount};
})();
