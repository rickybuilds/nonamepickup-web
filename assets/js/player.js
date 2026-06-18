// =============================================
// NoName TFC Pickups Player V3 Granular
// Map-filtered class identity version
// Path: /assets/js/player.js
// =============================================

let eloChartV3=null;
let mapDonutChartV3=null;
let selectedClassIndex=0;
let selectedClassMap="__all";
let currentClasses=[];
let currentClassMaps=[];
let currentHampa=null;
let currentPlayerId=null;
let currentGranular=null;
let currentGranularEvents=null;
let granularMatchFilter="";
let granularSummaryLoading=false;
let granularSampleLoading=false;
let granularSampleLoaded=false;
let granularSampleFailed=false;
let granularEventsLoading=false;
let granularEventsLoaded=false;
let granularEventsObserver=null;
let granularRequestSeq=0;
const nn = window.nnHelpers || {};
const playerFormatSeconds = nn.formatSeconds || (s => `${Number(s || 0)}s`);
const playerNormName = nn.normName || (v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
const playerWeaponName = nn.weaponName || (v => v);
const canonicalFetchJSON = nn.fetchJSON;
const pageSupporterBadge = nn.supporterBadge || (() => "");

async function fetchJSON(url){
  if(typeof canonicalFetchJSON==="function"){
    const result=await canonicalFetchJSON(url);
    return result?.ok===false
      ? {...result,data:null,error:result.error||"Request failed"}
      : result;
  }
  try{
    const res=await fetch(url,{cache:"no-store"});
    if(!res.ok)throw new Error("HTTP "+res.status);
    return await res.json();
  }catch(e){
    console.error("[PlayerV3] failed",url,e);
    return{ok:false,data:null,error:String(e)};
  }
}

function qs(id){return document.getElementById(id);}
function setText(id,value){const el=qs(id);if(el)el.textContent=value;}
function setHtml(id,value){
  const el=qs(id);
  if(el){
    el.innerHTML=value;
    requestAnimationFrame(()=>hydrateLazyWeaponIcons(el));
  }
}

const playerEscapeHtml=window.nnHelpers?.escapeHtml||window.escapeHtml;
const playerEscapeAttr=window.nnHelpers?.escapeAttr||window.escapeAttr;

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

let lazyWeaponObserver=null;

function revealLazyWeaponIcon(el){
  const cls=el?.dataset?.lazyWeapon||"";
  if(cls)el.classList.add(cls);
  el?.removeAttribute("data-lazy-weapon");
}

function getLazyWeaponObserver(){
  if(lazyWeaponObserver||!("IntersectionObserver" in window))return lazyWeaponObserver;
  lazyWeaponObserver=new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      if(!entry.isIntersecting)return;
      revealLazyWeaponIcon(entry.target);
      lazyWeaponObserver.unobserve(entry.target);
    });
  },{rootMargin:"320px 0px"});
  return lazyWeaponObserver;
}

function hydrateLazyWeaponIcons(root=document){
  const icons=root.querySelectorAll?.(".weapon-icon[data-lazy-weapon]");
  if(!icons?.length)return;
  const observer=getLazyWeaponObserver();
  icons.forEach(icon=>{
    if(observer){
      observer.observe(icon);
    }else{
      revealLazyWeaponIcon(icon);
    }
  });
}

function weaponIconMarkup(weaponClass){
  return '<i class="weapon-icon" data-lazy-weapon="'+escapeAttr(weaponClass||"")+'"></i>';
}

async function loadPlayerV3(){
  const playerId=new URLSearchParams(window.location.search).get("id");

  if(!playerId){
    setText("player-name-v3","No player selected");
    return;
  }

  currentPlayerId=playerId;
  const enc=encodeURIComponent(playerId);
  resetGranularState();
  renderPlayerGranularLoading();

  const [v3,recent,permap]=await Promise.all([
    fetchJSON("/api/player/"+enc+"/v3"),
    fetchJSON("/api/player/"+enc+"/recent?limit=300"),
    fetchJSON("/api/player/"+enc+"/permap")
  ]);

  if(!v3.ok||!v3.data){
    setText("player-name-v3","Player not found");
    setHtml("combat-stats",'<div class="empty-v3">V3 API failed. Check console.</div>');
    return;
  }

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
  const playerBadge=pageSupporterBadge(playerId);

  setHtml("player-name-v3",escapeHtml(playerName)+playerBadge);
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
  populateGranularMatchSelect(recentRows);
  renderRecentMatches(recentRows,playerId,!!ratings.hidden);
  renderMapFrequency(permapRows);
  renderActivityHeatmaps(recentRows);
  renderRelationshipLists(recentRows,playerId);
  scheduleGranularSummaryLoad(playerId);
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

function formatGranularMatchOption(row){
  const matchId=getRecentMatchId(row);
  const map=row?.map_name||row?.map||"Unknown map";
  return matchId+" — "+map+" — "+formatMatchDate(row?.created_at);
}

function getRecentMatchId(row){
  return String(row?.id||row?.match_id||row?.matchId||row?.match||"");
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
      '<div class="weapon-row" title="'+escapeAttr(playerWeaponName(w.weapon_class))+'">'+
        '<span>'+weaponIconMarkup(w.weapon_class)+'</span>'+
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
    '<button class="map-class-button '+(selectedClassMap===btn.key?"active":"")+'" data-map="'+escapeAttr(btn.key)+'">'+
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
    '<button class="class-tab '+(i===selectedClassIndex?"active":"")+'" data-index="'+escapeAttr(i)+'">'+
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
    '<a class="map recent-map" href="'+escapeAttr("map.html?map="+encodeURIComponent(m.map_name||""))+'">'+escapeHtml(m.map_name||"Unknown")+'</a>'+
    '<button class="match-id-pill" data-match-id="'+escapeAttr(m.match_id||m.id)+'">'+escapeHtml(m.match_id||m.id||"-")+'</button>'+
    '<span class="recent-score">'+(m.score_blue??"?")+" - "+(m.score_red??"?")+'</span>'+
    '<span class="'+cls+' recent-result">'+result+'</span>'+
    '<span class="'+deltaCls+' recent-delta">'+deltaText+'</span>'+
  '</div>';
  }).join("")||'<div class="empty-v3">No recent matches</div>');
}

function formatEventTime(row){
  if(row?.eventTimeText)return row.eventTimeText;
  const seconds=Number(row?.eventTimeSeconds);
  if(!Number.isFinite(seconds)||seconds<0)return "-";
  const mins=Math.floor(seconds/60);
  const secs=Math.floor(seconds%60);
  return mins+":"+String(secs).padStart(2,"0");
}

function groupRows(rows,key){
  return (Array.isArray(rows)?rows:[]).reduce((groups,row)=>{
    const groupKey=String(row?.[key]||"Unknown");
    if(!groups[groupKey])groups[groupKey]=[];
    groups[groupKey].push(row);
    return groups;
  },{});
}

function granularWeaponRow(row,extra){
  const showClassWeaponRates=!granularMatchFilter&&Number(row.matchesWithKill||0)>0;
  const rate=Number(row.killsPerMatch||0);
  const value=showClassWeaponRates
    ? '<span class="granular-weapon-stats"><b>'+fmt(row.kills)+' kills</b><b>'+fmt(row.matchesWithKill)+' matches</b><b>'+escapeHtml(formatGranularRate(rate))+' K/M</b></span>'
    : '<strong>'+fmt(row.kills)+' kills</strong>';
  return '<div class="granular-row granular-weapon-row">'+
    '<span class="granular-weapon-cell">'+
      weaponIconMarkup(row.weapon)+
      '<b>'+escapeHtml(playerWeaponName(row.weapon||"-"))+'</b>'+
      (extra?'<small>'+escapeHtml(extra)+'</small>':"")+
    '</span>'+
    value+
  '</div>';
}

function formatGranularRate(value){
  const n=Number(value||0);
  if(!Number.isFinite(n))return"0.0";
  return n.toFixed(1);
}

const GRANULAR_WEAPON_CLASS_OVERRIDES={
  sentrygun:"Engineer",
  emp:"Engineer",
  railgun:"Engineer",
  assaultcannon:"HWGuy",
  rocketlauncher:"Soldier",
  nailgrenade:"Soldier",
  mirv:"Demoman",
  pipelauncher:"Demoman",
  yellowgrenlauncher:"Demoman",
  grenlauncher:"Demoman"
};

function normalizeGranularWeapon(value){
  return String(value||"").toLowerCase().replace(/[^a-z0-9]/g,"");
}

function granularOverrideClassForWeapon(weapon){
  const weaponKey=normalizeGranularWeapon(playerWeaponName(weapon)||weapon);
  return GRANULAR_WEAPON_CLASS_OVERRIDES[weaponKey]||"";
}

function granularDisplayClassForWeapon(weapon,sourceClass,context={}){
  const weaponKey=normalizeGranularWeapon(playerWeaponName(weapon)||weapon);
  if(weaponKey==="singleshotgun"&&context.demomanSourceClasses?.has(normalizeGranularClass(sourceClass))){
    return"Demoman";
  }
  return granularOverrideClassForWeapon(weapon)||granularClassLabel(sourceClass);
}

function granularAggregationContext(rows){
  const demomanSourceClasses=new Set();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const weaponKey=normalizeGranularWeapon(playerWeaponName(row.weapon)||row.weapon);
    const override=granularOverrideClassForWeapon(row.weapon);
    if(override==="Demoman"&&weaponKey!=="singleshotgun"){
      demomanSourceClasses.add(normalizeGranularClass(row.class));
    }
  });
  return{demomanSourceClasses};
}

function aggregateGranularWeaponRows(rows){
  const merged=new Map();
  const context=granularAggregationContext(rows);
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    const displayClass=granularDisplayClassForWeapon(row.weapon,row.class,context);
    // Merge only within the displayed class. Generic weapons like Grenade stay split by class.
    const key=normalizeGranularClass(displayClass)+"|"+normalizeGranularWeapon(row.weapon);
    const current=merged.get(key)||{
      ...row,
      class:displayClass,
      displayClass,
      kills:0,
      matchesWithKill:0,
      killsPerMatch:0
    };
    current.kills+=Number(row.kills||0);
    current.matchesWithKill+=Number(row.matchesWithKill||0);
    merged.set(key,current);
  });
  return [...merged.values()].map(row=>({
    ...row,
    killsPerMatch:Number(row.matchesWithKill||0)>0
      ? Number(row.kills||0)/Number(row.matchesWithKill||0)
      : 0
  }));
}

function fmtGranularSample(value){
  if(!granularSampleLoaded)return"Loading...";
  if(granularSampleFailed)return"Unavailable";
  if(value===null||value===undefined)return"-";
  return fmt(value);
}

function renderGranularClassWeapons(rows){
  const displayRows=aggregateGranularWeaponRows(rows)
    .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));
  const groups=groupRows(displayRows,"displayClass");
  const classNames=Object.keys(groups);
  if(!classNames.length)return '<div class="granular-empty">No class weapon kills found.</div>';
  return classNames.map(className=>{
    const total=groups[className].reduce((sum,row)=>sum+Number(row.kills||0),0);
    return '<article class="granular-group">'+
      '<div class="granular-group-head"><strong>'+escapeHtml(classDisplayName(className))+'</strong><span>'+fmt(total)+' kills</span></div>'+
      groups[className].slice(0,8).map(row=>granularWeaponRow(row)).join("")+
    '</article>';
  }).join("");
}

const GRANULAR_CLASS_LABELS={
  scout:"Scout",
  medic:"Medic",
  spy:"Spy",
  soldier:"Soldier",
  demoman:"Demoman",
  hwguy:"HWGuy",
  engineer:"Engineer",
  sniper:"Sniper",
  pyro:"Pyro",
  civilian:"Civilian",
  unknown:"Unknown"
};

function normalizeGranularClass(value){
  return String(value||"unknown").trim().toLowerCase()||"unknown";
}

function granularClassLabel(className){
  const cls=normalizeGranularClass(className);
  return GRANULAR_CLASS_LABELS[cls]||classDisplayName(cls);
}

function renderGranularSpecialKills(flagRows,concedRows){
  const hasFlag=Array.isArray(flagRows)&&flagRows.length;
  const hasConced=Array.isArray(concedRows)&&concedRows.length;
  if(!hasFlag&&!hasConced)return '<div class="granular-empty">No objective kill events found.</div>';
  function block(title,rows){
    const safeRows=aggregateGranularWeaponRows(rows)
      .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));
    return '<article class="granular-mini-block">'+
      '<div class="granular-group-head"><strong>'+escapeHtml(title)+'</strong><span>'+fmt(safeRows.reduce((sum,row)=>sum+Number(row.kills||0),0))+' kills</span></div>'+
      (safeRows.length?safeRows.slice(0,6).map(row=>{
        return granularWeaponRow(row,row.displayClass||granularDisplayClassForWeapon(row.weapon,row.class));
      }).join(""):'<div class="granular-empty">No '+escapeHtml(title.toLowerCase())+' found.</div>')+
    '</article>';
  }
  return block("Flag Carrier Kills",flagRows)+block("Conced Kills",concedRows);
}

function renderGranularVictims(rows){
  const victims=Array.isArray(rows)?rows:[];
  if(!victims.length)return '<div class="granular-empty">No victim data found.</div>';
  return '<div class="granular-list">'+victims.slice(0,16).map((row,index)=>
    '<div class="granular-row">'+
      '<span><b>#'+(index+1)+' '+granularVictimLink(row)+'</b><small>'+escapeHtml(row.victimDiscordId||row.victimSteamId||row.victimKey||"unresolved")+'</small></span>'+
      '<strong>'+fmt(row.kills)+' kills</strong>'+
    '</div>'
  ).join("")+'</div>';
}

function granularVictimLink(row){
  const name=row?.victimName||"Unknown";
  const id=row?.victimDiscordId||row?.victimSteamId||row?.victimKey||"";
  if(!id||id==="unresolved")return escapeHtml(name);
  return '<a class="granular-player-link" href="'+escapeAttr("player.html?id="+encodeURIComponent(id))+'">'+escapeHtml(name)+'</a>';
}

function renderGranularAliases(rows){
  const aliases=Array.isArray(rows)?rows:[];
  if(!aliases.length)return '<div class="granular-empty">No alias history found.</div>';
  return '<div class="granular-list">'+aliases.slice(0,16).map(row=>
    '<div class="granular-row">'+
      '<span><b>'+escapeHtml(row.name||"Unknown")+'</b></span>'+
      '<strong>'+fmt(row.kills)+' kills</strong>'+
    '</div>'
  ).join("")+'</div>';
}

function renderGranularEvents(data){
  const events=Array.isArray(data?.events)?data.events:[];
  if(!events.length)return '<div class="granular-empty">No kill events found.</div>';
  return '<div class="granular-event-list">'+events.map(event=>{
    const matchId=event.matchId||"-";
    const attribution=event.attacker?.classAttribution==="uncertain"?"uncertain":"official";
    return '<div class="granular-event-row">'+
      '<button type="button" class="match-id-pill granular-match-pill" data-match-id="'+escapeAttr(matchId)+'">'+escapeHtml(matchId)+'</button>'+
      '<span class="granular-event-meta">'+escapeHtml(event.map||"Unknown map")+' · R'+escapeHtml(event.round||"-")+' · '+escapeHtml(formatEventTime(event))+'</span>'+
      '<span class="granular-event-kill">'+
        weaponIconMarkup(event.weapon)+
        '<b>'+escapeHtml(playerWeaponName(event.weapon||"-"))+'</b>'+
        '<small>'+escapeHtml(granularEventClassText(event))+' vs '+escapeHtml(event.victim?.name||"Unknown")+'</small>'+
      '</span>'+
      '<span class="granular-event-badges">'+
        '<i class="'+escapeAttr(attribution)+'">'+escapeHtml(attribution)+'</i>'+
        (event.flags?.flagCarrierKill?'<i>flag carrier</i>':"")+
        (event.flags?.conced?'<i>conced</i>':"")+
      '</span>'+
    '</div>';
  }).join("")+'</div>';
}

function granularEventClassText(event){
  const sourceClass=event?.attacker?.class||"Unknown";
  return granularDisplayClassForWeapon(event?.weapon,sourceClass);
}

function granularEventsUrl(offset=0){
  if(!currentPlayerId)return "";
  const params=new URLSearchParams({limit:"100",offset:String(offset)});
  if(granularMatchFilter)params.set("matchId",granularMatchFilter);
  return "/api/player/"+encodeURIComponent(currentPlayerId)+"/granular/events?"+params.toString();
}

function granularSummaryUrl(playerId,includeSample=false){
  const params=new URLSearchParams({limit:"50"});
  if(includeSample)params.set("includeSample","1");
  if(granularMatchFilter)params.set("matchId",granularMatchFilter);
  return "/api/player/"+encodeURIComponent(playerId)+"/granular?"+params.toString();
}

function cleanGranularMatchFilter(value){
  return String(value||"").trim().slice(0,100);
}

function populateGranularMatchSelect(rows){
  const select=qs("granular-match-select");
  if(!select)return;
  const matches=(Array.isArray(rows)?rows:[])
    .filter(row=>getRecentMatchId(row))
    .slice(0,10);
  if(!matches.length){
    select.innerHTML='<option value="">No recent matches</option>';
    select.disabled=true;
    return;
  }
  select.disabled=false;
  select.innerHTML='<option value="">Recent match...</option>'+matches.map(row=>{
    const matchId=getRecentMatchId(row);
    return '<option value="'+escapeAttr(matchId)+'">'+escapeHtml(formatGranularMatchOption(row))+'</option>';
  }).join("");
}

function resetGranularState(){
  currentGranular=null;
  currentGranularEvents=null;
  granularMatchFilter="";
  granularSummaryLoading=false;
  granularSampleLoading=false;
  granularSampleLoaded=false;
  granularSampleFailed=false;
  granularEventsLoading=false;
  granularEventsLoaded=false;
  granularRequestSeq++;
  if(granularEventsObserver){
    granularEventsObserver.disconnect();
    granularEventsObserver=null;
  }
  const input=qs("granular-match-filter");
  if(input)input.value="";
  const select=qs("granular-match-select");
  if(select)select.value="";
}

function renderPlayerGranularLoading(){
  bindGranularControls();
  const body=qs("player-granular-body");
  if(!body)return;
  body.innerHTML=
    '<div class="granular-summary-strip">'+
      '<div><span>Event Kills</span><strong>Loading...</strong></div>'+
      '<div><span>Matches</span><strong>Loading...</strong></div>'+
      '<div><span>Official Class Kills</span><strong>Loading...</strong></div>'+
      '<div><span>Uncertain</span><strong>Loading...</strong></div>'+
    '</div>'+
    '<div class="granular-grid">'+
      '<section class="granular-panel granular-class-panel"><div class="granular-panel-head"><h3>Class Weapon Breakdown</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading granular class weapons...</div></div></section>'+
      '<section class="granular-panel granular-special-panel"><div class="granular-panel-head"><h3>Objective Kills</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading objective kills...</div></div></section>'+
      '<section class="granular-panel granular-victim-panel"><div class="granular-panel-head"><h3>Favorite Victims</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading nemesis table...</div></div></section>'+
      '<section class="granular-panel granular-alias-panel"><div class="granular-panel-head"><h3>Alias History</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading aliases...</div></div></section>'+
      '<section class="granular-panel granular-events-panel"><div class="granular-panel-head"><h3>Match Drilldown</h3><span>Waiting</span></div><div id="granular-events-panel" class="granular-panel-scroll"><div class="granular-empty">Full events load when this section enters view.</div></div><button type="button" class="granular-load-more" data-granular-load-events="1">Load Events</button></section>'+
    '</div>';
}

function resetGranularSampleState(){
  granularSampleLoading=false;
  granularSampleLoaded=false;
  granularSampleFailed=false;
}

function resetGranularEventsState(){
  granularEventsLoading=false;
  granularEventsLoaded=false;
  currentGranularEvents=null;
}

function scheduleGranularSummaryLoad(playerId,options={}){
  const requestedPlayerId=String(playerId||"");
  if(!requestedPlayerId)return;
  const shouldReset=options.reset!==false;
  if(granularSummaryLoading&&!shouldReset)return;
  const requestSeq=shouldReset?++granularRequestSeq:granularRequestSeq;
  if(options.reset!==false){
    currentGranular=null;
    resetGranularSampleState();
    resetGranularEventsState();
    renderPlayerGranularLoading();
  }
  granularSummaryLoading=true;
  requestAnimationFrame(()=>{
    setTimeout(async()=>{
      const url=granularSummaryUrl(requestedPlayerId,false);
      const result=await fetchJSON(url);
      granularSummaryLoading=false;
      if(String(currentPlayerId)!==requestedPlayerId||requestSeq!==granularRequestSeq)return;
      currentGranular=result?.ok?result.data:null;
      renderPlayerGranular(currentGranular);
      observeGranularEvents();
      scheduleGranularSampleLoad(requestedPlayerId);
    },0);
  });
}

function reloadGranularForActiveFilter(){
  if(!currentPlayerId)return;
  if(granularEventsObserver){
    granularEventsObserver.disconnect();
    granularEventsObserver=null;
  }
  scheduleGranularSummaryLoad(currentPlayerId);
  loadGranularEvents(0,false);
}

async function scheduleGranularSampleLoad(playerId){
  const requestedPlayerId=String(playerId||"");
  if(!requestedPlayerId||granularSampleLoading||granularSampleLoaded||!currentGranular)return;
  const requestSeq=granularRequestSeq;
  granularSampleLoading=true;
  const url=granularSummaryUrl(requestedPlayerId,true);
  const result=await fetchJSON(url);
  granularSampleLoading=false;
  granularSampleLoaded=true;
  if(String(currentPlayerId)!==requestedPlayerId||requestSeq!==granularRequestSeq)return;
  const sampled=result?.ok?result.data:null;
  granularSampleFailed=!sampled?.sample;
  if(sampled?.sample&&currentGranular){
    currentGranular={...currentGranular,sample:sampled.sample};
  }
  renderPlayerGranular(currentGranular);
}

function observeGranularEvents(){
  const card=qs("player-granular-card");
  if(!card||granularEventsLoaded||granularEventsLoading)return;
  if(granularEventsObserver)granularEventsObserver.disconnect();
  if(!("IntersectionObserver" in window)){
    return;
  }
  granularEventsObserver=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){
      granularEventsObserver.disconnect();
      granularEventsObserver=null;
      loadGranularEvents(0,false);
    }
  },{rootMargin:"180px 0px",threshold:.12});
  granularEventsObserver.observe(card);
}

async function loadGranularEvents(offset=0,append=false){
  if(granularEventsLoading)return;
  const requestedPlayerId=String(currentPlayerId||"");
  const requestedFilter=granularMatchFilter;
  const requestSeq=granularRequestSeq;
  const body=qs("granular-events-panel");
  if(body&&!append)body.innerHTML='<div class="empty-v3">Loading granular events...</div>';
  const url=granularEventsUrl(offset);
  if(!url)return;
  granularEventsLoading=true;
  const result=await fetchJSON(url);
  granularEventsLoading=false;
  if(String(currentPlayerId)!==requestedPlayerId||requestedFilter!==granularMatchFilter||requestSeq!==granularRequestSeq)return;
  const next=result?.ok?result.data:null;
  if(append&&currentGranularEvents&&next){
    next.events=[...(currentGranularEvents.events||[]),...(next.events||[])];
  }
  currentGranularEvents=next;
  granularEventsLoaded=!!next;
  renderPlayerGranular(currentGranular,currentGranularEvents);
}

function bindGranularControls(){
  const card=qs("player-granular-card");
  if(!card||card.dataset.bound==="1")return;
  card.dataset.bound="1";
  qs("granular-match-apply")?.addEventListener("click",()=>{
    granularMatchFilter=cleanGranularMatchFilter(qs("granular-match-filter")?.value);
    reloadGranularForActiveFilter();
  });
  qs("granular-match-clear")?.addEventListener("click",()=>{
    granularMatchFilter="";
    const input=qs("granular-match-filter");
    if(input)input.value="";
    const select=qs("granular-match-select");
    if(select)select.value="";
    reloadGranularForActiveFilter();
  });
  qs("granular-match-filter")?.addEventListener("keydown",event=>{
    if(event.key==="Enter"){
      granularMatchFilter=cleanGranularMatchFilter(event.currentTarget.value);
      reloadGranularForActiveFilter();
    }
  });
  qs("granular-match-select")?.addEventListener("change",event=>{
    const input=qs("granular-match-filter");
    const value=event.currentTarget.value||"";
    if(input)input.value=value;
    granularMatchFilter=cleanGranularMatchFilter(value);
    reloadGranularForActiveFilter();
  });
  card.addEventListener("click",event=>{
    const loadEvents=event.target.closest("[data-granular-load-events]");
    if(loadEvents){
      loadGranularEvents(0,false);
      return;
    }
    const loadMore=event.target.closest("[data-granular-load-more]");
    if(loadMore){
      const offset=Number(loadMore.dataset.granularLoadMore||0);
      loadGranularEvents(offset,true);
    }
  });
}

function renderPlayerGranular(data,eventsData){
  bindGranularControls();
  currentGranular=data&&data.source?data:null;
  if(arguments.length>=2)currentGranularEvents=eventsData||null;
  const body=qs("player-granular-body");
  if(!body)return;

  if(!currentGranular||!currentGranular.source?.granularAvailable){
    body.innerHTML='<div class="empty-v3">No granular kill-event data yet.</div>';
    return;
  }

  const sample=currentGranular.sample||{};
  const fallbackEvents=Array.isArray(currentGranular.matchDrilldown)?currentGranular.matchDrilldown:[];
  const hasLoadedEvents=granularEventsLoaded&&currentGranularEvents;
  const events=hasLoadedEvents?currentGranularEvents:{
    events:fallbackEvents,
    total:null,
    hasMore:false,
    limit:fallbackEvents.length,
    offset:0
  };
  const loaded=Array.isArray(events.events)?events.events.length:0;
  const total=events.total===null||events.total===undefined?null:Number(events.total||loaded);
  const eventCountLabel=!hasLoadedEvents
    ? (loaded?fmt(loaded)+" preview":"Events not loaded")
    : (total===null?fmt(loaded)+" events":fmt(loaded)+" / "+fmt(total)+" events");
  const nextOffset=loaded;
  const eventAction=granularEventsLoading
    ? '<button type="button" class="granular-load-more" disabled>Loading Events</button>'
    : (!hasLoadedEvents
        ? '<button type="button" class="granular-load-more" data-granular-load-events="1">Load Events</button>'
        : (events.hasMore?'<button type="button" class="granular-load-more" data-granular-load-more="'+escapeAttr(String(nextOffset))+'">Load More Events</button>':""));

  body.innerHTML=
    '<div class="granular-summary-strip">'+
      '<div><span>Event Kills</span><strong>'+escapeHtml(fmtGranularSample(sample.kills))+'</strong></div>'+
      '<div><span>Matches</span><strong>'+escapeHtml(fmtGranularSample(sample.matches))+'</strong></div>'+
      '<div><span>Official Class Kills</span><strong>'+escapeHtml(fmtGranularSample(sample.officialClassKills))+'</strong></div>'+
      '<div><span>Uncertain</span><strong>'+escapeHtml(fmtGranularSample(sample.uncertainClassKills))+'</strong></div>'+
    '</div>'+
    '<div class="granular-grid">'+
      '<section class="granular-panel granular-class-panel"><div class="granular-panel-head"><h3>Class Weapon Breakdown</h3><span>'+fmt(currentGranular.classWeapons?.length)+' rows</span></div><p class="granular-panel-help">What weapons this player gets kills with while playing each class.</p><div class="granular-panel-scroll">'+renderGranularClassWeapons(currentGranular.classWeapons)+'</div></section>'+
      '<section class="granular-panel granular-special-panel"><div class="granular-panel-head"><h3>Objective Kills</h3><span>Flag + conced</span></div><p class="granular-panel-help">Flag carrier kills and conceded kills.</p><div class="granular-panel-scroll">'+renderGranularSpecialKills(currentGranular.flagCarrierKills,currentGranular.concededKills)+'</div></section>'+
      '<section class="granular-panel granular-victim-panel"><div class="granular-panel-head"><h3>Favorite Victims</h3><span>Most killed</span></div><p class="granular-panel-help">Players this player killed most.</p><div class="granular-panel-scroll">'+renderGranularVictims(currentGranular.favoriteVictims)+'</div></section>'+
      '<section class="granular-panel granular-alias-panel"><div class="granular-panel-head"><h3>Alias History</h3><span>Event names</span></div><p class="granular-panel-help">Names used by this player in Hampalyzer events.</p><div class="granular-panel-scroll">'+renderGranularAliases(currentGranular.aliasHistory)+'</div></section>'+
      '<section class="granular-panel granular-events-panel"><div class="granular-panel-head"><h3>Match Drilldown</h3><span>'+escapeHtml(eventCountLabel)+'</span></div><p class="granular-panel-help">Individual kill events.</p><div id="granular-events-panel" class="granular-panel-scroll">'+renderGranularEvents(events)+'</div>'+eventAction+'</section>'+
    '</div>';
  hydrateLazyWeaponIcons(body);
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
        '<a href="'+escapeAttr("map.html?map="+encodeURIComponent(row.map||""))+'">'+escapeHtml(row.map||"Unknown")+'</a>'+
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
      html+='<div class="heat-cell heat-'+heatLevel(value,max)+'" title="'+escapeAttr(days[dayIndex]+" "+hours[hourIndex]+": "+value+" matches")+'"></div>';
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
        wins:0,
        losses:0
      };
      rec.gp++;
      if(result==="Win")rec.wins++;
      else if(result==="Loss")rec.losses++;
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
        wins:0,
        losses:0
      };
      rec.gp++;
      if(result==="Win")rec.wins++;
      else if(result==="Loss")rec.losses++;
      opponents.set(key,rec);
    });
  });

  const bestTeam=[...teammates.values()]
    .filter(x=>x.gp>=2)
    .sort((a,b)=>relationshipWinPct(b)-relationshipWinPct(a)||b.gp-a.gp)
    .slice(0,3);

  const toughOpps=[...opponents.values()]
    .filter(x=>x.gp>=2)
    .sort((a,b)=>relationshipWinPct(a)-relationshipWinPct(b)||b.gp-a.gp)
    .slice(0,3);

  renderPeopleList("best-teammates",bestTeam,"teammate");
  renderPeopleList("toughest-opponents",toughOpps,"opponent");
}

function relationshipWinPct(row){
  const wins=Number(row.wins||0);
  const losses=Number(row.losses||0);
  const decided=wins+losses;
  return decided?wins/decided:0;
}

function renderPeopleList(id,rows,type){
  const el=qs(id);
  if(!el)return;

  el.innerHTML=rows.map(r=>{
    const pct=Math.round(relationshipWinPct(r)*100);
    const avatarUrl=r.avatarfull||r.avatarmedium||r.avatar||"";
    const avatar=typeof window.nnHelpers?.avatarHtml==="function"
      ? window.nnHelpers.avatarHtml(r.name,avatarUrl,"nn-avatar-rel")
      : '<span class="nn-avatar nn-avatar-rel"><span class="nn-avatar-fallback">'+escapeHtml(playerInitial(r.name))+"</span></span>";
    return '<div class="mini-person">'+
      '<a class="mini-avatar" href="'+escapeAttr("player.html?id="+encodeURIComponent(r.id))+'">'+avatar+'</a>'+
      '<div>'+
        '<a href="'+escapeAttr("player.html?id="+encodeURIComponent(r.id))+'"><strong>'+escapeHtml(r.name)+'</strong></a>'+
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
  document.body.classList.add("match-drawer-open");
  title.textContent=matchId;
  body.innerHTML='<div class="drawer-loading">Loading match...</div>';

  loadMatchDrawer(matchId);
}

function closeMatchDrawer(){
  document.getElementById("match-drawer")?.classList.remove("open");
  document.getElementById("match-drawer-backdrop")?.classList.remove("open");
  document.body.classList.remove("match-drawer-open");
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
        <a href="${escapeAttr(`match.html?id=${encodeURIComponent(m.id||m.match_id)}`)}">View Full Match</a>
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
  hydrateLazyWeaponIcons(body);
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
              ${weaponIconMarkup(w.weapon)}
              <span>${escapeHtml(playerWeaponName(w.weapon||"-"))}</span>
            </span>
            <b>${Number(w.kills||0)}</b>
          </div>
        `).join("")}
    </div>
  `;
}

document.addEventListener("DOMContentLoaded",()=>{
  loadPlayerV3();
});
