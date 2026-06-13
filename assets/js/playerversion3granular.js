// =============================================
// NoName TFC Pickups Player V3 Granular
// Map-filtered class identity version
// Path: /assets/js/playerversion3granular.js
// =============================================

console.log("[PlayerV3] JS loaded");

let eloChartV3=null;
let mapDonutChartV3=null;
let selectedClassIndex=0;
let selectedClassMap="__all";
let currentClasses=[];
let currentClassMaps=[];
let currentHampa=null;
const playerFormatSeconds=window.nnHelpers.formatSeconds;
const playerNormName=window.nnHelpers.normName;
const playerWeaponName=window.nnHelpers.weaponName;

async function fetchJSON(url){
  console.log("[PlayerV3] fetch",url);
  try{
    const res=await fetch(url,{cache:"no-store"});
    console.log("[PlayerV3] response",url,res.status);
    if(!res.ok)throw new Error("HTTP "+res.status);
    return await res.json();
  }catch(e){
    console.error("[PlayerV3] failed",url,e);
    return{ok:false,data:null,error:String(e)};
  }
}

function qs(id){return document.getElementById(id);}
function setText(id,value){const el=qs(id);if(el)el.textContent=value;}
function setHtml(id,value){const el=qs(id);if(el)el.innerHTML=value;}

function escapeHtml(str){
  if(typeof window.nnHelpers?.escapeHtml==="function")return window.nnHelpers.escapeHtml(str);
  return String(str??"").replace(/[&<>"']/g,function(m){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m];
  });
}

function fmt(n){
  const v=Number(n||0);
  return Number.isFinite(v)?v.toLocaleString():"-";
}

function compact(n){
  const v=Number(n||0);
  if(!Number.isFinite(v))return"-";
  if(Math.abs(v)>=1000000)return (v/1000000).toFixed(v>=10000000?1:2)+"M";
  if(Math.abs(v)>=1000)return v.toLocaleString();
  return String(v);
}

function eloTierRank(elo){
  const e=Number(elo||0);
  if(e>=3600)return"S";
  if(e>=3201)return"10";
  if(e>=3011)return"9";
  if(e>=2731)return"8";
  if(e>=2461)return"7";
  if(e>=2001)return"6";
  if(e>=1641)return"5";
  if(e>=1391)return"4";
  if(e>=1051)return"3";
  if(e>=721)return"2";
  if(e>=300)return"1";
  return"-";
}

function relativeTime(ts){
  const diff=Math.max(0,Math.floor(Date.now()/1000)-Number(ts||0));
  if(diff<3600)return Math.max(1,Math.floor(diff/60))+" min ago";
  if(diff<86400){
    const h=Math.floor(diff/3600);
    return h+" hour"+(h===1?"":"s")+" ago";
  }
  const d=Math.floor(diff/86400);
  return d+" day"+(d===1?"":"s")+" ago";
}

function playerInitial(name){
  return String(name||"?").trim().charAt(0).toUpperCase()||"?";
}

function classDisplayName(name){
  const s=String(name||"unknown");
  return s.charAt(0).toUpperCase()+s.slice(1);
}

function getPlayerTeam(match,playerId){
  const isBlue=(match.blueTeam||[]).some(p=>String(p.id)===String(playerId));
  const isRed=(match.redTeam||[]).some(p=>String(p.id)===String(playerId));
  if(isBlue)return"BLUE";
  if(isRed)return"RED";
  return null;
}

function getPlayerResult(match,playerId){
  const winner=String(match.winner||"").toUpperCase();
  const team=getPlayerTeam(match,playerId);
  if(winner==="TIE")return"Tie";
  if(team&&winner===team)return"Win";
  if(team&&["BLUE","RED"].includes(winner))return"Loss";
  return"-";
}

function fitPlayerName(){
  const el=qs("player-name-v3");
  if(!el)return;
  let size=64;
  el.style.lineHeight="1.08";
  el.style.fontSize=size+"px";
  while(el.scrollWidth>el.clientWidth&&size>24){
    size--;
    el.style.fontSize=size+"px";
  }
}

function statTile(label,value,sub){
  return '<div class="stat-tile"><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong>'+(sub?'<span class="sub">'+escapeHtml(sub)+'</span>':"")+'</div>';
}

async function loadPlayerV3(){
  console.log("[PlayerV3] loadPlayerV3 called");

  const playerId=new URLSearchParams(window.location.search).get("id");
  console.log("[PlayerV3] playerId",playerId);

  if(!playerId){
    setText("player-name-v3","No player selected");
    return;
  }

  const enc=encodeURIComponent(playerId);

  const v3=await fetchJSON("/api/player/"+enc+"/v3");
  console.log("[PlayerV3] v3 payload",v3);

  if(!v3.ok||!v3.data){
    setText("player-name-v3","Player not found");
    setHtml("combat-stats",'<div class="empty-v3">V3 API failed. Check console.</div>');
    return;
  }

  const recent=await fetchJSON("/api/player/"+enc+"/recent?limit=300");
  console.log("[PlayerV3] recent payload",recent);

  const permap=await fetchJSON("/api/player/"+enc+"/permap");
  console.log("[PlayerV3] permap payload",permap);

  const data=v3.data;
  const player=data.player||{};
  const ratings=data.ratings||{};
  const h=data.hampalyzer||{};
  currentHampa=h;
  currentClasses=Array.isArray(data.classes)?data.classes:[];
  currentClassMaps=Array.isArray(data.class_maps)?data.class_maps:[];
  const weapons=Array.isArray(data.weapons)?data.weapons:[];

  const allRecentRows=Array.isArray(recent.data)?recent.data:[];
  const recentRows=allRecentRows.filter(m=>
    m.status!=="admin" &&
    !String(m.id||"").startsWith("admin-") &&
    !String(m.id||"").startsWith("admin-set-") &&
    !String(m.id||"").startsWith("seed-") &&
    !String(m.map_name||"").includes("Admin Adjustment")
  );

  const playerName=player.name||playerId;
  const playerBadge=window.supporterBadge?window.supporterBadge(playerId):"";
  const supporterHtml=playerBadge?'<span class="supporter-badge" title="Server Supporter">'+playerBadge+'</span>':"";

  setHtml("player-name-v3",escapeHtml(playerName)+supporterHtml);
  requestAnimationFrame(fitPlayerName);
  window.addEventListener("resize",fitPlayerName);

  const avatarUrl=player.avatarfull||player.avatarmedium||player.avatar||"";
  const avatarFallback='<span class="nn-avatar-fallback">'+escapeHtml(playerInitial(playerName))+'</span>';
  const avatarImage=avatarUrl
    ? '<img src="'+escapeAttr(avatarUrl)+'" alt="" referrerpolicy="no-referrer" onerror="this.remove()">'
    : "";
  setHtml("player-mark",avatarFallback+avatarImage);
  setHtml("player-elo-line",ratings.hidden
    ? 'Current Elo: <strong>Hidden</strong> <span>Rank: <strong>Hidden</strong></span>'
    : 'Current Elo: <strong>'+Number(ratings.elo||0)+'</strong> <span>Rank: <strong>'+eloTierRank(ratings.elo)+'</strong></span>'
  );
  setHtml("player-record-line",'Record: <strong>'+escapeHtml(ratings.record||"-")+'</strong> <span>| Win%: <b class="good">'+(ratings.win_pct??0)+'%</b></span>');
  setText("steam-line",player.steam_id?"SteamID: "+player.steam_id:"SteamID: Not linked");

  setText("kpi-matches",fmt(ratings.games));
  setText("kpi-wins",fmt(ratings.wins));
  setText("kpi-losses",fmt(ratings.losses));
  setText("kpi-ties",fmt(ratings.ties));
  setText("kpi-winpct",(ratings.win_pct??0)+"%");
  const mvpGames=Number(h.mvp_games||0);
  const mvpPct=ratings.games>0? Math.round((mvpGames/ratings.games)*100): 0;
  document.getElementById("kpi-mvps").innerHTML = `${fmt(mvpGames)} <span class="kpi-subpct gold">(${mvpPct}%)</span>`;
  setText("kpi-kdr",h.linked?(h.kdr??"-"):"-");
  setText("kpi-kills",h.linked?compact(h.kills):"-");
  setText("kpi-damage",h.linked?compact(h.damage):"-");

  const permapRows=Array.isArray(permap.data)?permap.data:[];
  renderMapExtremes(permapRows);
  renderCoachingCard(data,recentRows,permapRows);
  renderCombat(h);
  renderFlag(h);
  renderWeapons(weapons);
  renderMapClassPicker(currentClasses,currentClassMaps);
  renderClassBrowser(getSelectedMapClasses(),h);
  renderClassMatrix(getSelectedMapClasses());

  const eloValues=recentRows
    .map(m=>({elo:Number(m.after??m.rating),delta:Number(m.delta??0),ts:Number(m.created_at||0)}))
    .filter(v=>Number.isFinite(v.elo))
    .reverse();

  renderEloChartV3(eloValues,!!ratings.hidden);
  renderRecentMatches(recentRows,playerId,!!ratings.hidden);
  renderMapFrequency(permapRows);
  renderActivityHeatmaps(recentRows);
  renderRelationshipLists(recentRows,playerId);

  console.log("[PlayerV3] render complete");
}

function formatMatchDate(ts){
  const d=new Date(Number(ts||0)*1000);
  if(!Number.isFinite(d.getTime()))return"-";
  return d.toLocaleString([],{
    month:"short",
    day:"numeric",
    year:"numeric",
    hour:"numeric",
    minute:"2-digit"
  });
}

function renderCombat(h){
  if(!h.linked){
    setHtml("combat-stats",'<div class="empty-v3">No linked Hampalyzer stats yet</div>');
    return;
  }
  setHtml("combat-stats",[
    statTile("Kills",fmt(h.kills)),
    statTile("Deaths",fmt(h.deaths)),
    statTile("KDR",String(h.kdr??"-")),
    statTile("Enemy Damage",fmt(h.damage)),
    statTile("Damage Taken",fmt(h.damage_taken)),
    statTile("Team Damage",fmt(h.team_damage))
  ].join(""));
}

function renderFlag(h){
  if(!h.linked){
    setHtml("flag-stats",'<div class="empty-v3">No flag stats yet</div>');
    return;
  }
  setHtml("flag-stats",[
    statTile("Caps",fmt(h.caps)),
    statTile("Touches",fmt(h.touches)),
    statTile("Initial Touches",fmt(h.initial_touches)),
    statTile("Flag Time",playerFormatSeconds(h.flag_time)),
    statTile("Conc Jumps",fmt(h.conc_jumps)),
    statTile("Tracked Matches",fmt(h.matches))
  ].join(""));
}

function renderWeapons(weapons){
  if(!weapons.length){
    setHtml("top-weapons",'<div class="empty-v3">No weapon data yet</div>');
    return;
  }

  const totalKills=weapons.reduce(
    (sum,w)=>sum+Number(w.kills||0),
    0
  );

  setHtml("top-weapons",weapons.map(w=>{
    const kills=Number(w.kills||0);
    const pct=totalKills
      ? ((kills/totalKills)*100).toFixed(1)
      : "0.0";

    return (
      '<div class="weapon-row" title="'+escapeHtml(playerWeaponName(w.weapon_class))+'">'+
        '<span><i class="weapon-icon '+escapeHtml(w.weapon_class||"")+'"></i></span>'+
        '<span class="weapon-name">'+escapeHtml(playerWeaponName(w.weapon_class))+'</span>'+
        '<strong>'+fmt(kills)+' <small>'+pct+'%</small></strong>'+
      '</div>'
    );
  }).join(""));
}

function normalizeClassRows(rows){
  const totalSeconds=rows.reduce((s,r)=>s+Number(r.seconds||0),0);
  return rows
    .map(r=>{
      const seconds=Number(r.seconds||0);
      return{
        class:r.class||r.class_name||"unknown",
        seconds,
        hours:Number(r.hours ?? (seconds/3600)),
        pct:totalSeconds?Number(((seconds/totalSeconds)*100).toFixed(1)):Number(r.pct||0),
        matches:Number(r.matches||0),
        avg_seconds_per_match:Number(r.avg_seconds_per_match||0)
      };
    })
    .sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0));
}

function getTopMapRows(){
  if(!currentClassMaps.length)return[];
  const byMap=new Map();

  for(const row of currentClassMaps){
    const map=String(row.map||"Unknown");
    const rec=byMap.get(map)||{map,seconds:0,matches:0,classes:new Map()};
    const seconds=Number(row.seconds||0);
    rec.seconds+=seconds;
    rec.matches=Math.max(rec.matches,Number(row.matches||0));

    const cls=String(row.class||row.class_name||"unknown");
    rec.classes.set(cls,(rec.classes.get(cls)||0)+seconds);

    byMap.set(map,rec);
  }

  return [...byMap.values()].map(m=>{
    const topClasses=[...m.classes.entries()]
      .sort((a,b)=>b[1]-a[1])
      .slice(0,2)
      .map(x=>x[0]);

    return{
      map:m.map,
      seconds:m.seconds,
      hours:m.seconds/3600,
      matches:m.matches,
      top_classes:topClasses
    };
  }).sort((a,b)=>b.seconds-a.seconds);
}

function getSelectedMapClasses(){
  if(selectedClassMap==="__all"||!currentClassMaps.length)return normalizeClassRows(currentClasses);

  const rows=currentClassMaps
    .filter(r=>String(r.map||"")===selectedClassMap)
    .map(r=>({
      class:r.class||r.class_name||"unknown",
      seconds:Number(r.seconds||0),
      hours:Number(r.hours ?? (Number(r.seconds||0)/3600)),
      matches:Number(r.matches||0),
      avg_seconds_per_match:Number(r.avg_seconds_per_match||0)
    }));

  return normalizeClassRows(rows);
}

function renderMapClassPicker(classes,classMaps){
  const el=qs("map-class-picker");
  if(!el)return;

  const topMaps=getTopMapRows().slice(0,9);
  const allSeconds=normalizeClassRows(classes).reduce((s,r)=>s+Number(r.seconds||0),0);
  const allTop=normalizeClassRows(classes)[0];

  let buttons=[
    {
      key:"__all",
      name:"All Maps",
      meta:playerFormatSeconds(allSeconds)+" tracked",
      top:normalizeClassRows(classes).slice(0,2).map(c=>classDisplayName(c.class)).join("/")
    },
    ...topMaps.map(m=>({
      key:m.map,
      name:m.map,
      meta:playerFormatSeconds(m.seconds)+" / "+fmt(m.matches)+" matches",
      top:m.top_classes.map(classDisplayName).join("/")
    }))
  ];

  if(!topMaps.length&&classes.length){
    buttons=[{
      key:"__all",
      name:"All Maps",
      meta:"No map split returned",
      top:normalizeClassRows(classes).slice(0,2).map(c=>classDisplayName(c.class)).join("/")
    }];
  }

  el.innerHTML=buttons.map(btn=>
    '<button class="map-class-button '+(selectedClassMap===btn.key?"active":"")+'" data-map="'+escapeHtml(btn.key)+'">'+
      '<span><b class="map-class-name">'+escapeHtml(btn.name)+'</b><small class="map-class-meta">'+escapeHtml(btn.meta)+'</small></span>'+
      '<b class="map-class-top">'+escapeHtml(btn.top)+'</b>'+
    '</button>'
  ).join("");

  el.querySelectorAll(".map-class-button").forEach(btn=>{
    btn.addEventListener("click",()=>{
      selectedClassMap=btn.dataset.map||"__all";
      selectedClassIndex=0;
      renderMapClassPicker(currentClasses,currentClassMaps);
      const rows=getSelectedMapClasses();
      renderClassBrowser(rows,currentHampa);
      renderClassMatrix(rows);
    });
  });
}

function renderClassBrowser(classes,h){
  const tabs=qs("class-tabs");
  const detail=qs("class-detail");
  if(!tabs||!detail)return;

  if(!classes.length){
    tabs.innerHTML="";
    detail.innerHTML='<div class="empty-v3">No class detail yet</div>';
    return;
  }

  selectedClassIndex=Math.min(selectedClassIndex,classes.length-1);

  tabs.innerHTML=classes.map((c,i)=>
    '<button class="class-tab '+(i===selectedClassIndex?"active":"")+'" data-index="'+i+'">'+
      escapeHtml(classDisplayName(c.class))+
    '</button>'
  ).join("");

  tabs.querySelectorAll(".class-tab").forEach(btn=>{
    btn.addEventListener("click",()=>{
      selectedClassIndex=Number(btn.dataset.index||0);
      renderClassBrowser(getSelectedMapClasses(),currentHampa);
    });
  });

  renderClassDetail(classes[selectedClassIndex],classes,h);
}

function renderClassDetail(c,classes,h){
  const el=qs("class-detail");
  if(!el||!c)return;

  const rank=classes.findIndex(x=>x.class===c.class)+1;
  const matches=Number(c.matches||0);
  const seconds=Number(c.seconds||0);
  const avgSeconds=Number(c.avg_seconds_per_match||0)||Math.round(seconds/Math.max(1,matches||1));
  const totalHours=classes.reduce((s,x)=>s+Number(x.hours||0),0);
  const share=Number(c.pct||0);
  const className=classDisplayName(c.class);
  const mapLabel=selectedClassMap==="__all"?"All Maps":selectedClassMap;

  el.innerHTML=
    '<div class="class-detail-head">'+
      '<div class="class-detail-title">'+
        '<strong>'+escapeHtml(className)+'</strong>'+
        '<small>'+escapeHtml(mapLabel)+'</small>'+
        '<span>'+escapeHtml(className)+' accounts for '+share.toFixed(1)+'% of tracked class time in this filter.</span>'+
      '</div>'+
      '<div class="class-detail-rank">#'+rank+'</div>'+
    '</div>'+
    '<div class="class-detail-grid">'+
      '<div class="class-metric"><span>Hours</span><strong>'+Number(c.hours||0).toFixed(1)+'H</strong></div>'+
      '<div class="class-metric"><span>Time Share</span><strong>'+share.toFixed(1)+'%</strong></div>'+
      '<div class="class-metric"><span>Matches</span><strong>'+(matches?fmt(matches):"-")+'</strong></div>'+
      '<div class="class-metric"><span>Avg / Match</span><strong>'+playerFormatSeconds(avgSeconds)+'</strong></div>'+
    '</div>'+
    '<div class="class-bar-track"><i class="class-bar-fill" style="width:'+Math.min(100,share)+'%"></i></div>'+
    '<div class="class-map-summary">'+
      '<div class="class-map-pill"><span>Filter</span><strong>'+escapeHtml(mapLabel)+'</strong></div>'+
      '<div class="class-map-pill"><span>Class Time</span><strong>'+playerFormatSeconds(seconds)+'</strong></div>'+
      '<div class="class-map-pill"><span>Total Filter Time</span><strong>'+totalHours.toFixed(1)+'H</strong></div>'+
    '</div>';
}

function renderClassMatrix(classes){
  if(!classes.length){
    setHtml("class-time-matrix",'<div class="empty-v3">No class matrix yet</div>');
    return;
  }
  setHtml("class-time-matrix",classes.slice(0,5).map(c=>
    '<div class="class-matrix-row">'+
      '<span>'+escapeHtml(classDisplayName(c.class))+'</span>'+
      '<b class="hrs">'+Number(c.hours||0).toFixed(1)+'H</b>'+
      '<div class="class-bar-track"><i class="class-bar-fill" style="width:'+Math.min(100,Number(c.pct||0))+'%"></i></div>'+
      '<b class="pct">'+Number(c.pct||0).toFixed(1)+'%</b>'+
    '</div>'
  ).join(""));
}

function renderEloChartV3(eloValues,hidden){
  const canvas=qs("elo-chart-v3");
  if(!canvas||typeof Chart==="undefined")return;
  if(hidden){
    canvas.parentElement.innerHTML='<div class="empty-v3">Elo history hidden</div>';
    return;
  }
  if(!eloValues.length)return;
  if(eloChartV3)eloChartV3.destroy();

  eloChartV3=new Chart(canvas.getContext("2d"),{
    type:"line",
    data:{
      labels:eloValues.map((_,i)=>i+1),
      datasets:[{
        label:"Elo",
        data:eloValues.map(x=>x.elo),
        borderColor:"#0ea5e9",
        backgroundColor:"rgba(14,165,233,.15)",
        borderWidth:3,
        tension:.32,
        fill:true,
        pointRadius:1.8,
        pointHoverRadius:5
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      interaction:{mode:"index",intersect:false},
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:function(context){
          const point=eloValues[context.dataIndex];
          const d=point.delta>0?"+"+point.delta:point.delta;
          return["Elo: "+point.elo.toLocaleString(),"Delta Elo: "+d];
        }}}
      },
      scales:{
        y:{grid:{color:"rgba(148,163,184,.13)"},ticks:{color:"#9ca3af"}},
        x:{grid:{color:"rgba(148,163,184,.10)"},ticks:{color:"#9ca3af",maxTicksLimit:8}}
      }
    }
  });
}

function renderRecentMatches(rows,playerId,hidden){
  setHtml("recent-match-list",rows.slice(0,100).map(m=>{
    const result=getPlayerResult(m,playerId);
    const cls=result.toLowerCase();
    const delta=Number(m.delta||0);
    const deltaCls=delta>0?"delta-pos":delta<0?"delta-neg":"";
    const deltaText=hidden?"Hidden":(delta?(delta>0?"+":"")+delta:"-");

  return '<div class="recent-match-row">'+
    '<span class="recent-time">'+relativeTime(m.created_at)+'</span>'+
    '<a class="map recent-map" href="map.html?map='+encodeURIComponent(m.map_name||"")+'">'+escapeHtml(m.map_name||"Unknown")+'</a>'+
    '<button class="match-id-pill" data-match-id="'+escapeAttr(m.match_id||m.id)+'">'+escapeHtml(m.match_id||m.id||"-")+'</button>'+
    '<span class="recent-score">'+(m.score_blue??"?")+" - "+(m.score_red??"?")+'</span>'+
    '<span class="'+cls+' recent-result">'+result+'</span>'+
    '<span class="'+deltaCls+' recent-delta">'+deltaText+'</span>'+
  '</div>';
  }).join("")||'<div class="empty-v3">No recent matches</div>');
}

function buildCoachingMetrics(data,recentRows,permapRows){
  const completedRecent=(Array.isArray(recentRows)?recentRows:[]).filter(row=>{
    const id=String(row.id||row.match_id||"");
    const mapName=String(row.map_name||"");
    return String(row.status||"").toLowerCase()==="completed"&&
      !id.startsWith("admin-")&&
      !id.startsWith("admin-set-")&&
      !id.startsWith("seed-")&&
      !mapName.includes("Admin Adjustment");
  });

  function resultRate(rows){
    const results=rows.map(row=>getPlayerResult(row,data.player?.id)).filter(result=>result!=="-");
    const wins=results.filter(result=>result==="Win").length;
    return{
      games:results.length,
      wins,
      losses:results.filter(result=>result==="Loss").length,
      ties:results.filter(result=>result==="Tie").length,
      winPct:results.length?Math.round((wins/results.length)*100):null
    };
  }

  const last10Rows=completedRecent.slice(0,10);
  const previous10Rows=completedRecent.slice(10,20);
  const recent10=resultRate(last10Rows);
  const previous10=resultRate(previous10Rows);
  const recentDeltas=last10Rows
    .map(row=>row.delta)
    .filter(value=>value!==null&&value!==undefined&&Number.isFinite(Number(value)))
    .map(Number);
  const avgRecentDelta=recentDeltas.length
    ? recentDeltas.reduce((sum,value)=>sum+value,0)/recentDeltas.length
    : null;

  const mapExtremes=selectMapExtremes(permapRows,5);
  const h=data.hampalyzer||{};
  const hMatches=Number(h.matches||0);
  const damage=Number(h.damage||0);
  const damageTaken=Number(h.damage_taken||0);
  const teamDamage=Number(h.team_damage||0);
  const classes=(Array.isArray(data.classes)?data.classes:[])
    .map(row=>({
      name:String(row.class||row.class_name||"Unknown"),
      pct:Number(row.pct||0)
    }))
    .sort((a,b)=>b.pct-a.pct);
  const topClass=classes[0]||null;

  return{
    completedRecentCount:completedRecent.length,
    recent10,
    previous10,
    trendComparisonReady:completedRecent.length>=20&&recent10.games===10&&previous10.games===10,
    recentWinPctChange:recent10.winPct!==null&&previous10.winPct!==null
      ? recent10.winPct-previous10.winPct
      : null,
    avgRecentDelta,
    recentDeltaCount:recentDeltas.length,
    mapExtremes,
    hMatches,
    kdr:Number(h.kdr||0),
    damageRatio:damageTaken>0?damage/damageTaken:null,
    teamDamageRatio:damage>0?teamDamage/damage:null,
    topClass,
    classesAbove10:classes.filter(row=>row.pct>10).length
  };
}

function generateCoachingInsights(metrics){
  const insights=[];

  if(metrics.recent10.games>=10&&metrics.recent10.winPct>=60){
    insights.push({
      type:"strength",
      title:"Positive momentum",
      explanation:"Recent results are trending well. Keep leaning on the decisions and roles that are producing wins.",
      supportingMetric:"Last 10: "+metrics.recent10.wins+"-"+metrics.recent10.losses+"-"+metrics.recent10.ties+" ("+metrics.recent10.winPct+"%)",
      priority:100
    });
  }else if(metrics.recent10.games>=10&&metrics.recent10.winPct<=40){
    insights.push({
      type:"focus",
      title:"Recent form review",
      explanation:"Results over the latest completed matches suggest a useful review window. Start with repeated mistakes in losses.",
      supportingMetric:"Last 10: "+metrics.recent10.wins+"-"+metrics.recent10.losses+"-"+metrics.recent10.ties+" ("+metrics.recent10.winPct+"%)",
      priority:100
    });
  }

  if(metrics.recentDeltaCount>=10&&metrics.avgRecentDelta>=3){
    insights.push({
      type:"strength",
      title:"Positive Elo trend",
      explanation:"Recent rating movement indicates consistently positive match impact.",
      supportingMetric:"Average recent Elo: +"+metrics.avgRecentDelta.toFixed(1),
      priority:92
    });
  }else if(metrics.recentDeltaCount>=10&&metrics.avgRecentDelta<=-3){
    insights.push({
      type:"focus",
      title:"Review recent losses",
      explanation:"Recent rating movement is negative enough to warrant reviewing positioning, team fights, and late-match decisions.",
      supportingMetric:"Average recent Elo: "+metrics.avgRecentDelta.toFixed(1),
      priority:92
    });
  }

  const worstMap=metrics.mapExtremes.worst;
  if(worstMap&&worstMap.win_pct<40){
    insights.push({
      type:"focus",
      title:"Map review focus",
      explanation:"This qualifying map has the clearest results-based opportunity for focused practice.",
      supportingMetric:worstMap.w+"-"+worstMap.l+"-"+worstMap.t+" | "+worstMap.win_pct+"% | "+worstMap.completedGames+" games",
      priority:88,
      map:worstMap.map
    });
  }

  if(metrics.hMatches>=10&&metrics.teamDamageRatio!==null&&metrics.teamDamageRatio>.08){
    insights.push({
      type:"focus",
      title:"Team-damage discipline",
      explanation:"Cleaner firing lanes and more deliberate spam timing could reduce avoidable damage to teammates.",
      supportingMetric:"Team damage: "+(metrics.teamDamageRatio*100).toFixed(1)+"% of enemy damage",
      priority:86
    });
  }

  if(metrics.hMatches>=10&&metrics.kdr<.85){
    insights.push({
      type:"focus",
      title:"Survival and trades",
      explanation:"Prioritize safer engagements, cleaner exits, and fights where teammates can immediately trade.",
      supportingMetric:"KDR: "+metrics.kdr.toFixed(2)+" over "+metrics.hMatches+" matches",
      priority:84
    });
  }else if(metrics.hMatches>=10&&metrics.kdr>1.25){
    insights.push({
      type:"strength",
      title:"Combat efficiency",
      explanation:"Your kill-to-death results are a consistent strength across the tracked sample.",
      supportingMetric:"KDR: "+metrics.kdr.toFixed(2)+" over "+metrics.hMatches+" matches",
      priority:84
    });
  }

  if(metrics.hMatches>=10&&metrics.damageRatio!==null&&metrics.damageRatio<.90){
    insights.push({
      type:"focus",
      title:"Damage trading",
      explanation:"Look for higher-value engagements and reduce damage taken without a favorable return.",
      supportingMetric:"Damage dealt/taken: "+metrics.damageRatio.toFixed(2),
      priority:82
    });
  }else if(metrics.hMatches>=10&&metrics.damageRatio!==null&&metrics.damageRatio>1.20){
    insights.push({
      type:"strength",
      title:"Efficient damage trading",
      explanation:"You are dealing substantially more damage than you receive across the tracked sample.",
      supportingMetric:"Damage dealt/taken: "+metrics.damageRatio.toFixed(2),
      priority:82
    });
  }

  const bestMap=metrics.mapExtremes.best;
  if(bestMap&&bestMap.win_pct>60){
    insights.push({
      type:"strength",
      title:"Reliable map",
      explanation:"This qualifying map is currently your strongest results-based map.",
      supportingMetric:bestMap.w+"-"+bestMap.l+"-"+bestMap.t+" | "+bestMap.win_pct+"% | "+bestMap.completedGames+" games",
      priority:78,
      map:bestMap.map
    });
  }

  if(metrics.topClass&&metrics.topClass.pct>=65){
    insights.push({
      type:"neutral",
      title:"Class specialization",
      explanation:"Your tracked class time is strongly concentrated. This can support mastery, while making secondary-class readiness worth monitoring.",
      supportingMetric:metrics.topClass.name+": "+metrics.topClass.pct.toFixed(1)+"% of tracked time",
      priority:64,
      className:metrics.topClass.name
    });
  }else if(metrics.topClass&&metrics.topClass.pct<=35&&metrics.classesAbove10>=4){
    insights.push({
      type:"focus",
      title:"Narrow the active class pool",
      explanation:"Tracked time is spread across several classes. A smaller primary pool may improve consistency and role-specific decision making.",
      supportingMetric:metrics.classesAbove10+" classes above 10% usage",
      priority:64
    });
  }

  return insights.sort((a,b)=>b.priority-a.priority).slice(0,3);
}

function renderCoachingCard(data,recentRows,permapRows){
  const metrics=buildCoachingMetrics(data,recentRows,permapRows);
  const insights=generateCoachingInsights(metrics);
  const primaryInsight=insights[0]||null;
  let summary="Rule-based insights from existing match, map, class, and Hampalyzer data.";

  if(metrics.trendComparisonReady){
    const change=metrics.recentWinPctChange;
    summary+=" Last 10 win rate: "+metrics.recent10.winPct+"% versus "+metrics.previous10.winPct+"% in the previous 10";
    summary+=(change>0?" (+"+change:change<0?" ("+change:" (no change")+(change!==0?" points).":").");
  }else if(metrics.completedRecentCount<10){
    summary+=" More completed match history is needed for recent-form analysis.";
  }
  setText("coaching-summary",summary);

  if(primaryInsight){
    const focusTitle=primaryInsight.map
      ? '<a href="map.html?map='+encodeURIComponent(primaryInsight.map)+'">'+escapeHtml(primaryInsight.map)+'</a>'
      : escapeHtml(primaryInsight.title);
    setHtml("intel-coaching-focus",
      '<span class="player-intel-label">Coaching Focus</span>'+
      '<strong class="'+escapeHtml(primaryInsight.type)+'">'+focusTitle+'</strong>'+
      '<small>'+escapeHtml(primaryInsight.supportingMetric)+'</small>'
    );
  }else{
    setHtml("intel-coaching-focus",
      '<span class="player-intel-label">Coaching Focus</span>'+
      '<strong>More history needed</strong>'+
      '<small>No qualifying insight yet</small>'
    );
  }

  if(!insights.length){
    setHtml("coaching-insights",'<div class="empty-v3">More match history is needed for coaching insights.</div>');
    return;
  }

  setHtml("coaching-insights",insights.map(insight=>{
    const typeLabel=insight.type==="strength"?"Strength":insight.type==="focus"?"Focus Area":"Profile Note";
    const title=insight.map
      ? escapeHtml(insight.title)+': <a href="map.html?map='+encodeURIComponent(insight.map)+'">'+escapeHtml(insight.map)+'</a>'
      : escapeHtml(insight.title);
    return '<article class="coaching-insight-card '+escapeHtml(insight.type)+'">'+
      '<span class="coaching-insight-type">'+escapeHtml(typeLabel)+'</span>'+
      '<h3>'+title+'</h3>'+
      '<p>'+escapeHtml(insight.explanation)+'</p>'+
      '<strong class="coaching-insight-metric">'+escapeHtml(insight.supportingMetric)+'</strong>'+
    '</article>';
  }).join(""));
}

function selectMapExtremes(rows,minimumGames=5){
  const eligible=(Array.isArray(rows)?rows:[]).map(row=>{
    const w=Number(row.w||0);
    const l=Number(row.l||0);
    const t=Number(row.t||0);
    return{
      ...row,
      w,
      l,
      t,
      completedGames:w+l+t,
      win_pct:Number(row.win_pct||0),
      avg_delta:Number(row.avg_delta||0)
    };
  }).filter(row=>row.completedGames>=minimumGames);

  const byName=(a,b)=>String(a.map||"").localeCompare(String(b.map||""));
  const best=[...eligible].sort((a,b)=>
    b.win_pct-a.win_pct||
    b.avg_delta-a.avg_delta||
    b.completedGames-a.completedGames||
    byName(a,b)
  )[0]||null;
  const worst=[...eligible].sort((a,b)=>
    a.win_pct-b.win_pct||
    a.avg_delta-b.avg_delta||
    b.completedGames-a.completedGames||
    byName(a,b)
  )[0]||null;

  return{
    best,
    worst:eligible.length>1?worst:null
  };
}

function renderMapExtremes(rows){
  const extremes=selectMapExtremes(rows);

  function renderSummary(targetId,label,row,tone){
    if(!row){
      setHtml(targetId,
        '<span class="player-intel-label">'+escapeHtml(label)+'</span>'+
        '<strong>More history needed</strong>'+
        '<small>Minimum 5 completed games</small>'
      );
      return;
    }

    const mapName=String(row.map||"Unknown");
    setHtml(targetId,
      '<span class="player-intel-label">'+escapeHtml(label)+'</span>'+
      '<strong class="'+tone+'"><a href="map.html?map='+encodeURIComponent(mapName)+'">'+escapeHtml(mapName)+'</a></strong>'+
      '<small>'+row.win_pct+'% win rate / '+row.completedGames+' games</small>'
    );
  }

  function render(targetId,label,row,tone){
    if(!row){
      setHtml(targetId,
        '<div class="map-performance-label '+tone+'">'+escapeHtml(label)+'</div>'+
        '<div class="empty-v3">Not enough map history</div>'
      );
      return;
    }

    const mapName=String(row.map||"Unknown");
    setHtml(targetId,
      '<div class="map-performance-label '+tone+'">'+escapeHtml(label)+'</div>'+
      '<a class="map-performance-name" href="map.html?map='+encodeURIComponent(mapName)+'">'+escapeHtml(mapName)+'</a>'+
      '<div class="map-performance-stats">'+
        '<div><span>Record</span><strong>'+row.w+'-'+row.l+'-'+row.t+'</strong></div>'+
        '<div><span>Win Rate</span><strong class="'+tone+'">'+row.win_pct+'%</strong></div>'+
        '<div><span>Games</span><strong>'+row.completedGames+'</strong></div>'+
      '</div>'
    );
  }

  renderSummary("intel-best-map","Best Map",extremes.best,"good");
  renderSummary("intel-worst-map","Worst Map",extremes.worst,"bad");
  render("best-map-card","Best Map",extremes.best,"good");
  render("worst-map-card","Worst Map",extremes.worst,"bad");
}

function setupPlayerIntelToggle(){
  const toggle=qs("player-intel-toggle");
  const details=qs("player-intel-details");
  if(!toggle||!details)return;

  toggle.addEventListener("click",()=>{
    const expanded=toggle.getAttribute("aria-expanded")==="true";
    toggle.setAttribute("aria-expanded",String(!expanded));
    toggle.textContent=expanded?"View Details":"Hide Details";
    details.hidden=expanded;
  });
}

function renderMapFrequency(rows){
  const legend=qs("map-donut-legend");
  const canvas=qs("map-donut-chart");
  const top=[...rows].sort((a,b)=>(b.gp||0)-(a.gp||0)).slice(0,6);
  const total=rows.reduce((sum,r)=>sum+Number(r.gp||0),0)||0;
  setText("map-donut-total",total||"-");

  if(!top.length||!canvas||typeof Chart==="undefined"){
    if(legend)legend.innerHTML='<div class="empty-v3">No map data</div>';
    return;
  }

  const colors=["#0ea5e9","#22d3ee","#22c55e","#a855f7","#facc15","#60a5fa"];

  if(mapDonutChartV3)mapDonutChartV3.destroy();

  mapDonutChartV3=new Chart(canvas.getContext("2d"),{
    type:"doughnut",
    data:{
      labels:top.map(r=>r.map||"Unknown"),
      datasets:[{
        data:top.map(r=>Number(r.gp||0)),
        backgroundColor:colors,
        borderColor:"rgba(8,13,26,.95)",
        borderWidth:4,
        hoverOffset:5
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      cutout:"64%",
      plugins:{
        legend:{display:false},
        tooltip:{callbacks:{label:function(context){
          const value=Number(context.raw||0);
          const pct=total?Math.round((value/total)*100):0;
          return context.label+": "+value+" games ("+pct+"%)";
        }}}
      }
    }
  });

  if(legend){
    legend.innerHTML=top.map((row,i)=>{
      const pct=total?Math.round((Number(row.gp||0)/total)*100):0;
      return '<div class="map-donut-item">'+
        '<i class="map-donut-dot" style="background:'+colors[i]+';color:'+colors[i]+'"></i>'+
        '<a href="map.html?map='+encodeURIComponent(row.map||"")+'">'+escapeHtml(row.map||"Unknown")+'</a>'+
        '<span>'+pct+'% - '+(row.gp||0)+'</span>'+
      '</div>';
    }).join("");
  }
}

function buildActivityMatrix(rows){
  const matrix=Array.from({length:7},()=>Array(12).fill(0));
  rows.forEach(m=>{
    if(!m.created_at)return;
    const d=new Date(Number(m.created_at)*1000);
    const jsDay=d.getDay();
    const day=jsDay===0?6:jsDay-1;
    const bucket=Math.min(11,Math.floor(d.getHours()/2));
    matrix[day][bucket]++;
  });
  return matrix;
}

function heatLevel(value,max){
  if(!value||!max)return 0;
  const pct=value/max;
  if(pct>=.8)return 5;
  if(pct>=.55)return 4;
  if(pct>=.35)return 3;
  if(pct>=.18)return 2;
  return 1;
}

function renderHeatmap(targetId,rows){
  const el=qs(targetId);
  if(!el)return;

  const days=["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const hours=["12A","2A","4A","6A","8A","10A","12P","2P","4P","6P","8P","10P"];
  const matrix=buildActivityMatrix(rows);
  const max=Math.max(1,...matrix.flat());

  let html="<div></div>"+hours.map(h=>'<div class="heat-hour">'+h+"</div>").join("");
  matrix.forEach((row,dayIndex)=>{
    html+='<div class="heat-label">'+days[dayIndex]+"</div>";
    row.forEach((value,hourIndex)=>{
      html+='<div class="heat-cell heat-'+heatLevel(value,max)+'" title="'+days[dayIndex]+" "+hours[hourIndex]+": "+value+' matches"></div>';
    });
  });

  el.innerHTML=html;
}

function renderActivityHeatmaps(rows){
  renderHeatmap("activity-heatmap",rows);

  const matrix=buildActivityMatrix(rows);
  const days=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const hours=["12-2 AM","2-4 AM","4-6 AM","6-8 AM","8-10 AM","10 AM-12 PM","12-2 PM","2-4 PM","4-6 PM","6-8 PM","8-10 PM","10 PM-12 AM"];

  let best={day:0,hour:0,count:0};
  matrix.forEach((row,d)=>row.forEach((count,h)=>{
    if(count>best.count)best={day:d,hour:h,count};
  }));

  setText("activity-peak",best.count?"Peak: "+days[best.day]+" "+hours[best.hour]:"Peak: -");
}

function renderRelationshipLists(rows,playerId){
  const teammates=new Map();
  const opponents=new Map();

  rows.forEach(m=>{
    const team=getPlayerTeam(m,playerId);
    if(!team)return;

    const mine=team==="BLUE"?(m.blueTeam||[]):(m.redTeam||[]);
    const theirs=team==="BLUE"?(m.redTeam||[]):(m.blueTeam||[]);
    const result=getPlayerResult(m,playerId);

    mine.forEach(p=>{
      if(String(p.id)===String(playerId))return;
      const key=String(p.id);
      const rec=teammates.get(key)||{
        id:key,
        name:p.name||key,
        avatar:p.avatar||null,
        avatarmedium:p.avatarmedium||null,
        avatarfull:p.avatarfull||null,
        gp:0,
        wins:0
      };
      rec.gp++;
      if(result==="Win")rec.wins++;
      teammates.set(key,rec);
    });

    theirs.forEach(p=>{
      const key=String(p.id);
      const rec=opponents.get(key)||{
        id:key,
        name:p.name||key,
        avatar:p.avatar||null,
        avatarmedium:p.avatarmedium||null,
        avatarfull:p.avatarfull||null,
        gp:0,
        wins:0
      };
      rec.gp++;
      if(result==="Win")rec.wins++;
      opponents.set(key,rec);
    });
  });

  const bestTeam=[...teammates.values()]
    .filter(x=>x.gp>=2)
    .sort((a,b)=>(b.wins/b.gp)-(a.wins/a.gp)||b.gp-a.gp)
    .slice(0,3);

  const toughOpps=[...opponents.values()]
    .filter(x=>x.gp>=2)
    .sort((a,b)=>(a.wins/a.gp)-(b.wins/b.gp)||b.gp-a.gp)
    .slice(0,3);

  renderPeopleList("best-teammates",bestTeam,"teammate");
  renderPeopleList("toughest-opponents",toughOpps,"opponent");
}

function renderPeopleList(id,rows,type){
  const el=qs(id);
  if(!el)return;

  el.innerHTML=rows.map(r=>{
    const pct=r.gp?Math.round((r.wins/r.gp)*100):0;
    const avatarUrl=r.avatarfull||r.avatarmedium||r.avatar||"";
    const avatar=typeof window.nnHelpers?.avatarHtml==="function"
      ? window.nnHelpers.avatarHtml(r.name,avatarUrl,"nn-avatar-rel")
      : '<span class="nn-avatar nn-avatar-rel"><span class="nn-avatar-fallback">'+escapeHtml(playerInitial(r.name))+"</span></span>";
    return '<div class="mini-person">'+
      '<a class="mini-avatar" href="player.html?id='+encodeURIComponent(r.id)+'">'+avatar+'</a>'+
      '<div>'+
        '<a href="player.html?id='+encodeURIComponent(r.id)+'"><strong>'+escapeHtml(r.name)+'</strong></a>'+
        '<small>'+r.gp+' matches</small>'+
      '</div>'+
      '<div class="mini-stat '+(type==="teammate"?"good":"bad")+'">'+pct+'% Win%</div>'+
    '</div>';
  }).join("")||'<div class="empty-v3">Not enough data yet</div>';
}

document.addEventListener("click",e=>{
  const btn=e.target.closest(".match-id-pill,[data-match-id]");
  if(!btn)return;

  const matchId=btn.dataset.matchId||btn.textContent.trim();
  if(!matchId)return;

  e.preventDefault();
  openMatchDrawer(matchId);
});

function openMatchDrawer(matchId){
  const drawer=document.getElementById("match-drawer");
  const backdrop=document.getElementById("match-drawer-backdrop");
  const title=document.getElementById("match-drawer-title");
  const body=document.getElementById("match-drawer-body");

  if(!drawer||!backdrop||!title||!body)return;

  drawer.classList.add("open");
  backdrop.classList.add("open");
  title.textContent=matchId;
  body.innerHTML='<div class="drawer-loading">Loading match...</div>';

  loadMatchDrawer(matchId);
}

function closeMatchDrawer(){
  document.getElementById("match-drawer")?.classList.remove("open");
  document.getElementById("match-drawer-backdrop")?.classList.remove("open");
}

document.getElementById("match-drawer-close")?.addEventListener("click",closeMatchDrawer);
document.getElementById("match-drawer-backdrop")?.addEventListener("click",closeMatchDrawer);

document.addEventListener("keydown",e=>{
  if(e.key==="Escape")closeMatchDrawer();
});

async function loadMatchDrawer(matchId){
  const body=document.getElementById("match-drawer-body");

  try{
    const res=await fetch(`/api/match/${encodeURIComponent(matchId)}`);
    const data=await res.json();

    if(!res.ok||data.ok===false)throw new Error(data.error||"Failed to load match");

    renderMatchDrawer(data);
  }catch(err){
    body.innerHTML=`<div class="drawer-error">Could not load match ${escapeHtml(matchId)}.</div>`;
  }
}
function renderMatchDrawer(data){
  const body=document.getElementById("match-drawer-body");
  const title=document.getElementById("match-drawer-title");
  if(!body||!title)return;

  const m=data.match||data;

  const blue=m.blueTeam||m.blue||m.team_blue||m.teams?.blue||[];
  const red=m.redTeam||m.red||m.team_red||m.teams?.red||[];

  const allPlayers=m.player_stats||m.players||[];
  const allWeapons=m.weapon_stats||[];
  const allClasses=m.class_stats||[];
  const allRounds=Array.isArray(m.rounds)?m.rounds:[];
  const allRoundPlayerStats=Array.isArray(m.round_player_stats)?m.round_player_stats:[];
  const allMatchMvps=Array.isArray(m.match_mvps)?m.match_mvps:[];

  const currentPlayerId=new URLSearchParams(window.location.search).get("id");
  const currentPlayer=[...blue,...red].find(p=>String(p.id)===String(currentPlayerId));
  const currentPlayerName=currentPlayer?.name||currentPlayer?.display_name||"Player";

  const result=getPlayerResult(m,currentPlayerId);
  const team=getPlayerTeam(m,currentPlayerId);
  const teamLabel=team==="BLUE"?"Team 1":team==="RED"?"Team 2":"Team ?";
  const delta=Number(currentPlayer?.delta||0);

  const resultText=result==="Win"?"WIN":result==="Loss"?"LOSS":result==="Tie"?"TIE":"-";
  const deltaText=delta>0?`+${delta} Elo`:delta<0?`${delta} Elo`:"No Elo";

const currentStats=allPlayers.find(p=>
  String(p.player_key||"")===String(currentPlayerId) ||
  String(p.steam_id||"")===String(currentPlayer?.steam_id||"") ||
  playerNormName(p.display_name)===playerNormName(currentPlayerName)
);

const playerKeys=[
  currentPlayerId,
  currentPlayer?.id,
  currentPlayer?.player_key,
  currentPlayer?.steam_id,
  currentStats?.player_key,
  currentStats?.steam_id
].filter(Boolean).map(String);

const players=currentStats?[currentStats]:[];

const weapons=allWeapons.filter(w=>
  playerKeys.includes(String(w.player_key||"")) ||
  playerKeys.includes(String(w.steam_id||"")) ||
  playerNormName(w.display_name)===playerNormName(currentPlayerName) ||
  playerNormName(w.display_name)===playerNormName(currentStats?.display_name)
);

const classes=allClasses.filter(c=>
  playerKeys.includes(String(c.player_key||"")) ||
  playerKeys.includes(String(c.steam_id||"")) ||
  playerNormName(c.display_name)===playerNormName(currentPlayerName) ||
  playerNormName(c.display_name)===playerNormName(currentStats?.display_name)
);

const roundStats=allRoundPlayerStats.filter(p=>
  playerKeys.includes(String(p.player_key||"")) ||
  playerKeys.includes(String(p.steam_id||"")) ||
  playerNormName(p.display_name)===playerNormName(currentPlayerName) ||
  playerNormName(p.display_name)===playerNormName(currentStats?.display_name)
);

const currentMvp=allMatchMvps.find(mvp=>{
  const mvpName=playerNormName(mvp.mvp_display_name);
  const currentNames=[
    currentPlayerName,
    currentStats?.display_name
  ].filter(Boolean).map(playerNormName);

  return playerKeys.includes(String(mvp.mvp_player_key||"")) ||
    playerKeys.includes(String(mvp.steam_id||"")) ||
    (mvpName&&currentNames.includes(mvpName));
});

const currentMvpBadge=renderDrawerMvpBadge(currentMvp);
  title.innerHTML=
    escapeHtml(m.id||m.match_id||"-")+
    `<small class="match-drawer-player">${escapeHtml(currentPlayerName)} • ${escapeHtml(resultText)} • ${escapeHtml(teamLabel)} • ${escapeHtml(deltaText)}${currentMvpBadge}</small>`+
    `<small class="match-drawer-date">${escapeHtml(formatMatchDate(m.created_at))}</small>`;

  body.innerHTML=`
    <div class="drawer-section">
      <h3>Links</h3>
      <div class="drawer-link-row">
        ${m.hampalyzer_url?`<a href="${escapeAttr(m.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">Hampalyzer</a>`:""}
        ${m.tfcstats_url?`<a href="${escapeAttr(m.tfcstats_url)}" target="_blank" rel="noopener noreferrer">TFCStats</a>`:""}
        <a href="match.html?id=${encodeURIComponent(m.id||m.match_id)}">View Full Match</a>
      </div>
    </div>

    <div class="drawer-section">
      <h3>Your Stats</h3>
      ${renderPlayerStatTiles(players[0])}
    </div>

    <div class="drawer-section">
      <h3>Round Breakdown</h3>
      ${renderPlayerRoundStats(roundStats,allRounds)}
    </div>

    <div class="drawer-section">
      <h3>Your Classes</h3>
      ${renderPlayerClassList(classes)}
    </div>

    <div class="drawer-section">
      <h3>Your Weapons</h3>
      ${renderPlayerWeaponList(weapons)}
    </div>
  `;
}

function renderDrawerMvpBadge(mvp){
  if(!mvp)return"";
  const rounds=[...new Set(
    (Array.isArray(mvp.rounds)?mvp.rounds:[])
      .map(Number)
      .filter(round=>Number.isFinite(round)&&round>0)
  )].sort((a,b)=>a-b);

  let label="🏆 MVP";
  if(rounds.includes(1)&&rounds.includes(2))label="🏆 Game MVP";
  else if(rounds.length===1)label=`⭐ Round ${rounds[0]} MVP`;
  else if(rounds.length>1)label=`⭐ Round MVP R${rounds.join("/R")}`;

  return ` <span class="drawer-mvp-badge">${escapeHtml(label)}</span>`;
}

function renderPlayerRoundStats(rows,rounds){
  if(!Array.isArray(rows)||!rows.length){
    return `<div class="drawer-round-empty">No round breakdown available.</div>`;
  }

  const roundsByNumber=new Map(
    (Array.isArray(rounds)?rounds:[]).map(round=>[
      Number(round.round_num||0),
      round
    ])
  );

  return `
    <div class="drawer-round-list">
      ${[...rows]
        .sort((a,b)=>Number(a.round_num||0)-Number(b.round_num||0))
        .map(row=>{
          const roundNum=Number(row.round_num||0);
          const round=roundsByNumber.get(roundNum)||{};
          const deathsByEnemy=Number(row.deaths_by_enemy||0);
          const deathsByTeam=Number(row.deaths_by_team||0);
          const suicides=Number(row.suicides||0);
          const meta=[
            row.team_name,
            row.role,
            round.map_name,
            Number(round.duration_seconds||0)>0?playerFormatSeconds(round.duration_seconds):null
          ].filter(Boolean).join(" • ");

          return `
            <article class="drawer-round-card">
              <div class="drawer-round-head">
                <strong>Round ${roundNum||"-"}</strong>
                ${meta?`<span>${escapeHtml(meta)}</span>`:""}
              </div>
              <div class="drawer-round-stats">
                <div><span>Kills</span><b>${fmt(row.kills)}</b></div>
                <div title="Enemy / team / suicide deaths">
                  <span>Deaths E/T/S</span>
                  <b>${deathsByEnemy} / ${deathsByTeam} / ${suicides}</b>
                </div>
                <div><span>Enemy Damage</span><b>${fmt(row.enemy_damage)}</b></div>
                <div><span>Team Damage</span><b>${fmt(row.team_damage)}</b></div>
                <div><span>Conced Kills</span><b>${fmt(row.conced_kills)}</b></div>
                <div><span>Sentry Kills</span><b>${fmt(row.sentry_kills)}</b></div>
                <div><span>Conc Jumps</span><b>${fmt(row.conc_jumps)}</b></div>
                <div><span>Flag Captures</span><b>${fmt(row.flag_captures)}</b></div>
                <div><span>Flag Touches</span><b>${fmt(row.flag_touches)}</b></div>
                <div><span>Flag Time</span><b>${playerFormatSeconds(row.flag_time_seconds)}</b></div>
              </div>
            </article>
          `;
        }).join("")}
    </div>
  `;
}

function renderPlayerStatTiles(p){
  if(!p)return `<div class="drawer-loading">No data.</div>`;

  return `
    <div class="drawer-stat-grid">
      <div><span>Kills</span><b>${fmt(p.kills)}</b></div>
      <div><span>Deaths</span><b>${fmt(p.deaths)}</b></div>
      <div><span>Damage</span><b>${fmt(p.damage)}</b></div>
      <div><span>Caps</span><b>${fmt(p.caps)}</b></div>
      <div><span>Touches</span><b>${fmt(p.touches)}</b></div>
      <div><span>Conc Jumps</span><b>${fmt(p.conc_jumps)}</b></div>
    </div>
  `;
}

function renderPlayerClassList(rows){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  return `
    <div class="drawer-simple-list">
      ${rows
        .sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0))
        .map(c=>`
          <div class="drawer-simple-row">
            <span>${escapeHtml(classDisplayName(c.class_name||"-"))}</span>
            <b>${playerFormatSeconds(c.seconds)}</b>
          </div>
        `).join("")}
    </div>
  `;
}

function renderPlayerWeaponList(rows){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  return `
    <div class="drawer-simple-list">
      ${rows
        .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0))
        
        .map(w=>`
          <div class="drawer-simple-row weapon">
            <span class="drawer-weapon-cell">
              <i class="weapon-icon ${escapeHtml(w.weapon||"")}"></i>
              <span>${escapeHtml(playerWeaponName(w.weapon||"-"))}</span>
            </span>
            <b>${Number(w.kills||0)}</b>
          </div>
        `).join("")}
    </div>
  `;
}

function renderDrawerTable(rows,cols){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  return `
    <table class="drawer-table">
      <thead><tr>${cols.map(c=>`<th>${escapeHtml(c.replaceAll("_"," "))}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.slice(0,50).map(r=>`
          <tr>${cols.map(c=>`<td>${escapeHtml(r[c]??"-")}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderClassGroupedTable(rows){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  const byPlayer=new Map();

  rows.forEach(r=>{
    const name=String(r.display_name||"-");
    const list=byPlayer.get(name)||[];
    list.push(r);
    byPlayer.set(name,list);
  });

  const players=[...byPlayer.entries()].sort((a,b)=>a[0].localeCompare(b[0]));

  return `
    <div class="drawer-class-groups">
      ${players.map(([name,classes])=>`
        <div class="drawer-class-player">
          <div class="drawer-class-player-name">${escapeHtml(name)}</div>

          ${classes
            .sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0))
            .map(c=>`
              <div class="drawer-class-line">
                <span>${escapeHtml(classDisplayName(c.class_name||"-"))}</span>
                <b>${playerFormatSeconds(c.seconds)}</b>
              </div>
            `).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderWeaponGroupedTable(rows){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  const byPlayer=new Map();

  rows.forEach(r=>{
    const name=String(r.display_name||"-");
    const list=byPlayer.get(name)||[];
    list.push(r);
    byPlayer.set(name,list);
  });

  const players=[...byPlayer.entries()].sort((a,b)=>a[0].localeCompare(b[0]));

  return `
    <div class="drawer-weapon-groups">
      ${players.map(([name,weapons])=>`
        <div class="drawer-weapon-player">
          <div class="drawer-weapon-player-name">${escapeHtml(name)}</div>

          ${weapons
            .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0))
            .map(w=>`
              <div class="drawer-weapon-line">
                <span class="drawer-weapon-cell">
                  <i class="weapon-icon ${escapeHtml(w.weapon||"")}"></i>
                  <span>${escapeHtml(playerWeaponName(w.weapon||"-"))}</span>
                </span>
                <b>${Number(w.kills||0)}</b>
              </div>
            `).join("")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderWeaponDrawerTable(rows){
  if(!Array.isArray(rows)||!rows.length)return `<div class="drawer-loading">No data.</div>`;

  return `
    <table class="drawer-table">
      <thead>
        <tr>
          <th>Player</th>
          <th>Weapon</th>
          <th>Kills</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0,50).map(r=>`
          <tr>
            <td>${escapeHtml(r.display_name??"-")}</td>
            <td>
              <span class="drawer-weapon-cell">
                <i class="weapon-icon ${escapeHtml(r.weapon||"")}"></i>
                <span>${escapeHtml(r.weapon||"-")}</span>
              </span>
            </td>
            <td>${escapeHtml(r.kills??"-")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function escapeAttr(v){
  return String(v??"").replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
}

document.addEventListener("DOMContentLoaded",()=>{
  setupPlayerIntelToggle();
  loadPlayerV3();
});
