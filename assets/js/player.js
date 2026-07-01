// =============================================
// Path: /assets/js/player.js
// Competitive player profile. Reuses the existing player APIs.
// =============================================

let eloChartV3=null;
let currentClasses=[];
let currentHampa=null;
let currentRatings=null;
let currentPlayerId=null;
let currentGranular=null;
let currentGranularBase=null;
let currentGranularEvents=null;
let currentObjectiveGranularEvents=null;
let granularMapFilter="";
let granularMatchFilter="";
let granularClassFilter="";
let granularClassOptions=[];
let granularRecentMatches=[];
let granularSummaryLoading=false;
let granularSampleLoading=false;
let granularSampleLoaded=false;
let granularSampleFailed=false;
let granularEventsLoading=false;
let granularEventsLoaded=false;
let granularObjectiveEventsLoading=false;
let granularObjectiveEventsLoaded=false;
let granularRequestSeq=0;
let granularDrillFilter=null;
let granularObjectiveDrillFilter=null;
let granularVictimFilter=null;
let granularVictimLoading=false;
let granularVictimRequestSeq=0;
let granularOpenClassKeys=new Set();
let granularOpenObjectiveKeys=new Set();
let granularOpenObjectiveClassKeys=new Set();
let granularOpenRoleKeys=new Set();
const PLAYER2_RECENT_PAGE_SIZE=5;
let player2RecentRows=[];
let player2RecentPlayerId=null;
let player2RecentHidden=false;
let player2RecentPage=0;
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

async function renderSpeedrunProfileLink(playerId){
  setHtml("player-profile-links","");
  if(!playerId)return;

  const speedrun=await fetchJSON("/api/speedruns/players/"+encodeURIComponent(playerId));
  if(speedrun?.ok===false || !speedrun?.player)return;

  const summary=speedrun.summary||{};
  const hasSpeedrunActivity=
    Number(summary.totalRuns||0)>0 ||
    Number(summary.currentRecords||0)>0 ||
    (Array.isArray(speedrun.personalBests)&&speedrun.personalBests.length>0) ||
    (Array.isArray(speedrun.worldRecords)&&speedrun.worldRecords.length>0) ||
    (Array.isArray(speedrun.recentActivity)&&speedrun.recentActivity.length>0);

  if(!hasSpeedrunActivity)return;

  setHtml(
    "player-profile-links",
    '<a class="player-profile-link speedrun" href="'+playerEscapeAttr("speedrun-player.html?id="+encodeURIComponent(playerId))+'">Speedrun Profile</a>'
  );
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

function formatEloWindow(ratings){
  if(ratings?.hidden)return{text:"Hidden",cls:"muted"};
  const delta=Number(ratings?.elo_window?.delta||0);
  const symbol=delta>0?"▲":delta<0?"▼":"—";
  const value=delta>0?"+"+delta:String(delta);
  return{
    text:delta===0?"— 0 Elo":symbol+" "+value+" Elo",
    cls:delta>0?"good":delta<0?"bad":"muted"
  };
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
  const labels={hwguy:"HWGuy"};
  const key=classKey(s);
  if(labels[key])return labels[key];
  return s.charAt(0).toUpperCase()+s.slice(1);
}

function classKey(name){
  return String(name||"unknown").toLowerCase().replace(/[^a-z0-9]/g,"");
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
  const el=document.getElementById("player-name-v3");
  const text=el?.querySelector(".player-name-text");
  if(!el||!text)return;

  const max=window.innerWidth<=800 ? 32 : 56;
  const min=window.innerWidth<=800 ? 14 : 16;

  let size=max;
  text.style.fontSize=size+"px";

  while(el.scrollWidth>el.clientWidth && size>min){
    size--;
    text.style.fontSize=size+"px";
  }
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

  const [v3,recent,relationshipHistory]=await Promise.all([
    fetchJSON("/api/player/"+enc+"/v3"),
    fetchJSON("/api/player/"+enc+"/recent?limit=300"),
    fetchJSON("/api/player/"+enc+"/recent?limit=5000")
  ]);

  if(!v3.ok||!v3.data){
    setText("player-name-v3","Player not found");
    return;
  }

  const data=v3.data;
  const player=data.player||{};
  const ratings=data.ratings||{};
  const h=data.hampalyzer||{};
  currentRatings=ratings;
  currentHampa=h;
  currentClasses=Array.isArray(data.classes)?data.classes:[];

  const allRecentRows=Array.isArray(recent.data)?recent.data:[];
  const recentRows=allRecentRows.filter(m=>
    m.status==="completed" &&
    m.status!=="admin" &&
    !String(m.id||"").startsWith("admin-") &&
    !String(m.id||"").startsWith("admin-set-") &&
    !String(m.id||"").startsWith("seed-") &&
    !String(m.map_name||"").includes("Admin Adjustment")
  );
  const relationshipRows=(Array.isArray(relationshipHistory.data)?relationshipHistory.data:[]).filter(m=>
    m.status==="completed" &&
    !String(m.id||"").startsWith("admin-") &&
    !String(m.id||"").startsWith("admin-set-") &&
    !String(m.id||"").startsWith("seed-") &&
    !String(m.map_name||"").includes("Admin Adjustment")
  );

  const playerName=player.name||playerId;
  const playerBadge=pageSupporterBadge(playerId);

  setHtml(
      "player-name-v3",
      `<span class="player-name-text">${escapeHtml(playerName)}</span>${playerBadge}`
  );
  requestAnimationFrame(fitPlayerName);

  const avatarUrl=player.avatarfull||player.avatarmedium||player.avatar||"";
  const avatarFallback='<span class="nn-avatar-fallback">'+escapeHtml(playerInitial(playerName))+'</span>';
  const avatarImage=avatarUrl
    ? '<img src="'+escapeAttr(avatarUrl)+'" alt="" referrerpolicy="no-referrer" onerror="this.remove()">'
    : "";
  setHtml("player-mark",avatarFallback+avatarImage);
  setHtml("player-elo-line",ratings.hidden
    ? 'Current Elo: <strong>Hidden</strong> <span>| Elo Tier: <strong>Hidden</strong></span>'
    : 'Current Elo: <strong>'+Number(ratings.elo||0)+'</strong> <span>| Elo Tier: <strong>'+eloTierRank(ratings.elo)+'</strong></span>'
  );
  setHtml("player-record-line",'Record: <strong>'+escapeHtml(ratings.record||"-")+'</strong> <span>| Win%: <b class="good">'+(ratings.win_pct??0)+'%</b></span>');
  setText("steam-line",player.steam_id?"SteamID: "+player.steam_id:"SteamID: Not linked");
  renderSpeedrunProfileLink(playerId);
  setText("player2-current-elo",ratings.hidden?"Hidden":String(Number(ratings.elo||0)));
  setText("player2-record",ratings.record||"-");
  setText("player2-win-pct",(ratings.win_pct??0)+"%");

  setText("kpi-rank",ratings.hidden?"Hidden":(ratings.rank?("#"+fmt(ratings.rank)):"-"));
  const eloWindow=formatEloWindow(ratings);
  const eloWindowEl=document.getElementById("kpi-elo-window");
  if(eloWindowEl){
    eloWindowEl.textContent=eloWindow.text;
    eloWindowEl.className=eloWindow.cls;
  }
  setText("kpi-elo-window-label","Last "+fmt(ratings.elo_window?.games||0)+" Games");
  setText("kpi-peak-elo",ratings.hidden?"Hidden":ratings.peak_elo);
  setText("kpi-best-streak",fmt(ratings.best_streak));
  setText("kpi-pugs-week",ratings.pugs_per_week ?? "0.0");
  const mvpGames=Number(h.mvp_games||0);
  const mvpPct=ratings.games>0? Math.round((mvpGames/ratings.games)*100): 0;
  const mvpEl=document.getElementById("kpi-mvps");
  if(mvpEl)mvpEl.innerHTML = `${fmt(mvpGames)} <span class="kpi-subpct">· ${mvpPct}% of games</span>`;
  const eloValues=recentRows
    .map(m=>({elo:Number(m.after??m.rating),delta:Number(m.delta??0),ts:Number(m.created_at||0)}))
    .filter(v=>Number.isFinite(v.elo))
    .reverse();

  renderEloChartV3(eloValues,!!ratings.hidden);
  populateGranularMapSelect(recentRows);
  populateGranularMatchSelect(recentRows);
  renderRecentMatches(recentRows,playerId,!!ratings.hidden);
  renderActivityHeatmaps(recentRows);
  renderRelationshipLists(relationshipRows,playerId);
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

function getRecentMatchMap(row){
  return String(row?.map_name||row?.map||"").trim();
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

const CLASS_ROLE_GROUPS={
  offense:{
    title:"Offense",
    classes:["medic","scout","spy"]
  },
  defense:{
    title:"Defense",
    classes:["soldier","engineer","demoman","hwguy"]
  }
};

function roleClassRows(classes,role){
  const group=CLASS_ROLE_GROUPS[role];
  if(!group)return[];

  const byClass=new Map(classes.map(c=>[classKey(c.class),c]));
  const rows=group.classes
    .map(cls=>byClass.get(cls))
    .filter(row=>row&&(Number(row.seconds||0)>0||Number(row.matches||0)>0))
    .map(row=>({
      class:row.class,
      seconds:Number(row.seconds||0),
      hours:Number(row.hours||0),
      matches:Number(row.matches||0),
      avg_seconds_per_match:Number(row.avg_seconds_per_match||0),
      flagCaptures:Number((row.flagCaptures??row.flag_captures)||0),
      flagTouches:Number((row.flagTouches??row.flag_touches)||0)
    }));

  return normalizeClassRows(rows).sort(
    (a,b)=>group.classes.indexOf(classKey(a.class))-group.classes.indexOf(classKey(b.class))
  );
}

function roleForClass(className){
  const key=classKey(className);
  return Object.keys(CLASS_ROLE_GROUPS).find(role=>CLASS_ROLE_GROUPS[role].classes.includes(key))||null;
}

function granularRoleForClass(className){
  return roleForClass(className)||"other";
}

function granularRoleLabel(role){
  if(CLASS_ROLE_GROUPS[role])return CLASS_ROLE_GROUPS[role].title;
  return "Other";
}

function granularRoleSort(a,b){
  const order={offense:0,defense:1,other:2};
  return (order[a]??9)-(order[b]??9)||String(a).localeCompare(String(b));
}

function topRoleWeapon(role,classWeaponRows){
  const roleWeapons=Array.isArray(currentGranular?.roleWeapons)?currentGranular.roleWeapons:[];
  const byWeapon=new Map();
  roleWeapons
    .filter(row=>String(row.role||"").toLowerCase()===role)
    .forEach(row=>{
      const weapon=playerWeaponName(row.weapon||"Unknown");
      byWeapon.set(weapon,(byWeapon.get(weapon)||0)+Number(row.kills||0));
    });

  if(!byWeapon.size){
    classWeaponRows.forEach(row=>{
      const weapon=playerWeaponName(row.weapon||"Unknown");
      byWeapon.set(weapon,(byWeapon.get(weapon)||0)+Number(row.kills||0));
    });
  }

  return [...byWeapon.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||null;
}

function roleObjectiveKills(role){
  const flagCarrierRows=Array.isArray(currentGranular?.flagCarrierKills)?currentGranular.flagCarrierKills:[];
  const concededRows=Array.isArray(currentGranular?.concededKills)?currentGranular.concededKills:[];
  const flagCarrierKills=flagCarrierRows
    .filter(row=>roleForClass(row.class)===role)
    .reduce((sum,row)=>sum+Number(row.kills||0),0);
  const concededKills=concededRows
    .filter(row=>roleForClass(row.class)===role)
    .reduce((sum,row)=>sum+Number(row.kills||0),0);
  return{flagCarrierKills,concededKills,total:flagCarrierKills+concededKills};
}

function roleKpiData(role){
  const filteredClassTime=Array.isArray(currentGranular?.roleClassTime)?currentGranular.roleClassTime:[];
  const classTimeRows=filteredClassTime.length
    ? filteredClassTime.filter(row=>String(row.role||"").toLowerCase()===role)
    : currentClasses;
  const rows=roleClassRows(normalizeClassRows(classTimeRows),role);
  const seconds=rows.reduce((sum,row)=>sum+Number(row.seconds||0),0);
  const topClass=rows
    .filter(row=>Number(row.seconds||0)>0)
    .sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0))[0]||null;
  const flagCaps=rows.reduce((sum,row)=>sum+Number((row.flagCaptures??row.flag_captures)||0),0);
  const flagTouches=rows.reduce((sum,row)=>sum+Number((row.flagTouches??row.flag_touches)||0),0);
  const classWeaponRows=aggregateGranularWeaponRows(currentGranular?.classWeapons||[])
    .filter(row=>roleForClass(row.class)===role);
  const eventKills=classWeaponRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
  const killsByClass=new Map();
  classWeaponRows.forEach(row=>{
    const key=classKey(row.class);
    killsByClass.set(key,(killsByClass.get(key)||0)+Number(row.kills||0));
  });
  const topEventClass=[...killsByClass.entries()]
    .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]||null;
  const weapon=topRoleWeapon(role,classWeaponRows);
  const filteredFlags=currentGranular?.filteredFlags||null;
  const useFilteredFlags=dataRoleHasFilteredFlags(role,filteredFlags);
  const objectiveKills=roleObjectiveKills(role);
  const matches=granularMatchCount(filteredFlags,currentGranular?.sample||{});

  return{
    role,
    title:CLASS_ROLE_GROUPS[role].title,
    matches,
    seconds,
    hours:seconds/3600,
    topClass,
    topEventClass,
    classes:rows,
    eventKills,
    objectiveKills:objectiveKills.total,
    flagCarrierKills:objectiveKills.flagCarrierKills,
    concededKills:objectiveKills.concededKills,
    topWeapon:weapon,
    flagCaps:useFilteredFlags?Number(filteredFlags.captures||0):(filteredClassTime.length?flagCaps:Number(currentHampa?.caps||0)),
    flagTouches:useFilteredFlags?Number(filteredFlags.touches||0):(filteredClassTime.length?flagTouches:Number(currentHampa?.touches||0)),
    initialTouches:useFilteredFlags?Number(filteredFlags.initialTouches||0):0,
    sentryKills:useFilteredFlags?Number(filteredFlags.sentryKills||0):0,
    offenseAverages:role==="offense"?offenseAveragesForGranular(currentGranular):null
  };
}

function dataRoleHasFilteredFlags(role,filteredFlags){
  return role==="offense"&&filteredFlags&&(
    filteredFlags.captures!==undefined||
    filteredFlags.touches!==undefined
  );
}

function compactWeaponLabel(name){
  const value=String(name||"Unknown");
  const key=normalizeGranularWeapon(value);
  const labels={
    yellowgrenlauncher:"Yellow GL",
    grenlauncher:"Grenade Launcher",
    rocketlauncher:"Rocket Launcher",
    assaultcannon:"Assault Cannon",
    supernailgun:"Super Nailgun",
    supershotgun:"Super Shotgun",
    nailgrenade:"Nail Grenade",
    sentrygun:"Sentry Gun"
  };
  return labels[key]||value;
}

function updateGranularClassOptions(data,force=false){
  const rows=Array.isArray(data?.roleClassTime)?normalizeClassRows(data.roleClassTime):[];
  if((force||!granularClassFilter)&&rows.length){
    granularClassOptions=rows;
  }
}

function roleClassPillsHtml(data){
  const optionRows=granularClassOptions.length
    ? roleClassRows(granularClassOptions,data.role)
    : (Array.isArray(data.classes)?data.classes:[]);
  const classes=optionRows;
  if(!classes.length)return '<div class="role-class-pills role-class-empty">No class time</div>';
  const roleSeconds=classes.reduce((sum,row)=>sum+Number(row.seconds||0),0);
  return '<div class="role-class-pills">'+classes.map(row=>{
    const key=classKey(row.class);
    const active=granularClassFilter===key;
    const pct=roleSeconds?Math.round((Number(row.seconds||0)/roleSeconds)*100):0;
    return '<button type="button" class="role-class-pill '+(active?"active":"")+'" data-granular-class-filter="'+escapeAttr(key)+'" aria-pressed="'+(active?"true":"false")+'">'+
      '<span>'+escapeHtml(classDisplayName(row.class))+'</span>'+
      '<small>'+escapeHtml(Number(row.hours||0).toFixed(1))+'H · '+escapeHtml(String(pct))+'%</small>'+
    '</button>';
  }).join("")+'</div>';
}

function roleKpiPanel(data){
  const granularReady=!!currentGranular?.source?.granularAvailable;
  const averageValue=(value,matches)=>{
    const gameCount=Number(matches||0);
    if(!granularReady)return "Loading...";
    if(!gameCount)return "-";
    return (Number(value||0)/gameCount).toFixed(1);
  };
  const avgTile=(label,value,className="",title="")=>'<div class="'+escapeAttr(className)+'"'+(title?' title="'+escapeAttr(title)+'"':"")+'><span>'+escapeHtml(label)+'</span><strong>'+escapeHtml(value)+'</strong></div>';
  const topWeapon=data.topWeapon
    ? '<span class="weapon-short" title="'+escapeAttr(data.topWeapon[0])+'">'+escapeHtml(compactWeaponLabel(data.topWeapon[0]))+'</span> <small>'+escapeHtml(averageValue(data.topWeapon[1],data.matches))+' / match</small>'
    : (granularReady?"-":"Loading...");
  const offenseAvg=data.offenseAverages||{};
  const extraClass=data.role==="offense"?" role-kpi-offense":" role-kpi-defense";
  const classTimeTile='<div><span>Class Time</span><strong>'+escapeHtml(data.hours?data.hours.toFixed(1)+"H":"-")+'</strong></div>';
  const metricsHtml=data.role==="offense"
    ? avgTile("Frags / Match",averageValue(data.eventKills,data.matches),"role-skill-tile role-skill-frags")+
      avgTile("Touches / Match",averageValue(offenseAvg.touches,offenseAvg.matches),"role-skill-tile role-skill-touches")+
      avgTile("SG Kills / Match",averageValue(offenseAvg.guns,offenseAvg.matches),"role-skill-tile role-skill-sg")+
      classTimeTile+
      '<div class="role-kpi-wide"><span>Top Kill Weapon</span><strong>'+topWeapon+'</strong></div>'
    : avgTile("Frags / Match",averageValue(data.eventKills,data.matches),"role-skill-tile role-skill-frags")+
      avgTile("Conced Kills / Match",averageValue(data.concededKills,data.matches),"role-skill-tile role-skill-conced")+
      avgTile("FC Kills / Match",averageValue(data.flagCarrierKills,data.matches),"role-skill-tile role-skill-fc","Flag Carriers Killed / Match")+
      classTimeTile+
      '<div class="role-kpi-wide"><span>Top Kill Weapon</span><strong>'+topWeapon+'</strong></div>';

  return '<article class="role-kpi-panel role-'+escapeAttr(data.role)+extraClass+'">'+
    '<div class="role-kpi-title">'+
      '<h3>'+escapeHtml(data.title)+'</h3>'+
      roleClassPillsHtml(data)+
    '</div>'+
    '<div class="role-kpi-metrics">'+
      metricsHtml+
    '</div>'+
  '</article>';
}

function roleKpiStripHtml(){
  if(!currentGranular){
    return '<div class="role-kpi-strip"><div class="empty-v3">Loading role profile...</div></div>';
  }

  const roles=["offense","defense"].map(roleKpiData);
  const hasAnyRoleData=roles.some(role=>role.seconds>0||role.eventKills>0||role.objectiveKills>0||role.topWeapon);
  if(!hasAnyRoleData){
    return '<div class="role-kpi-strip"><div class="empty-v3">Loading role profile...</div></div>';
  }

  return '<div class="role-kpi-strip granular-role-kpis">'+roles.map(roleKpiPanel).join("")+'</div>';
}

function granularContextMapName(){
  if(granularMapFilter)return granularMapFilter;
  if(granularMatchFilter){
    const match=granularRecentMatches.find(row=>getRecentMatchId(row)===granularMatchFilter);
    const mapName=getRecentMatchMap(match);
    if(mapName)return mapName;
  }
  return "";
}

function applyGranularMapBackground(mapName){
  const img=qs("granular-map-image");
  const wrap=img?.closest(".granular-map-thumb-wrap");
  if(!img||!wrap)return;

  const clean=String(mapName||"").trim();
  if(!clean){
    wrap.classList.add("no-image");
    img.removeAttribute("src");
    return;
  }

  window.setMapImageFromName?.(img,clean,{
    containerSelector:".granular-map-thumb-wrap"
  });
}

function granularOverviewHtml(sample,loading=false){
  const contextMap=granularContextMapName();
  const mapLabel=contextMap||"All Maps";
  const recordSample=granularRecordSample(sample||{});
  const recordHtml=loading
    ? '<strong>Loading...</strong>'
    : granularRecordKpiHtml(recordSample);

  return '<div class="granular-overview-grid">'+
    '<div class="granular-context-column">'+
      '<article id="granular-map-record-card" class="granular-map-record-card">'+
        '<div class="granular-map-thumb-wrap">'+
          '<img id="granular-map-image" class="granular-map-image" src="" alt="Map preview">'+
          '<div class="granular-map-image-fallback"></div>'+
        '</div>'+
        '<div class="granular-map-copy">'+
          '<span>Map</span>'+
          '<strong class="granular-map-name">'+escapeHtml(mapLabel)+'</strong>'+
          '<div class="granular-map-record">'+
            '<span>W / L / T</span>'+
            recordHtml+
          '</div>'+
        '</div>'+
      '</article>'+
    '</div>'+
    '<div class="granular-role-column">'+
      roleKpiStripHtml()+
    '</div>'+
  '</div>';
}

function granularRecordSample(sample){
  const isUnfilteredAllMaps=
    !granularMapFilter &&
    !granularMatchFilter &&
    !granularClassFilter &&
    !granularVictimFilter &&
    !granularDrillFilter &&
    !granularObjectiveDrillFilter;

  if(!isUnfilteredAllMaps||!currentRatings)return sample;
  return{
    ...sample,
    wins:Number(currentRatings.wins||0),
    losses:Number(currentRatings.losses||0),
    ties:Number(currentRatings.ties||0),
    fromProfileRecord:true
  };
}

function granularMatchCount(flags,sample){
  const explicit=Number(flags?.matches||0);
  if(explicit>0)return explicit;
  const sampleGames=Number(sample?.wins||0)+Number(sample?.losses||0)+Number(sample?.ties||0);
  if(sampleGames>0)return sampleGames;
  return Number(currentHampa?.matches||currentRatings?.games||0);
}

function offenseAveragesForGranular(data){
  if(!data?.source?.granularAvailable)return null;
  const flags=data.filteredFlags||{};
  const matches=granularMatchCount(flags,data.sample||{});
  return{
    matches,
    touches:Number(flags.touches||0),
    guns:Number(flags.sentryKills||0)
  };
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
  player2RecentRows=Array.isArray(rows)?rows:[];
  player2RecentPlayerId=playerId;
  player2RecentHidden=!!hidden;
  player2RecentPage=0;
  renderRecentMatchesPage();
}

function renderRecentMatchesPage(){
  const total=player2RecentRows.length;
  const totalPages=Math.max(1,Math.ceil(total/PLAYER2_RECENT_PAGE_SIZE));
  player2RecentPage=Math.min(Math.max(0,player2RecentPage),totalPages-1);
  const start=player2RecentPage*PLAYER2_RECENT_PAGE_SIZE;
  const pageRows=player2RecentRows.slice(start,start+PLAYER2_RECENT_PAGE_SIZE);
  const playerId=player2RecentPlayerId;
  const hidden=player2RecentHidden;

  setHtml("recent-match-list",pageRows.map(m=>{
    const result=getPlayerResult(m,playerId);
    const cls=result.toLowerCase();
    const delta=Number(m.delta||0);
    const deltaCls=delta>0?"delta-pos":delta<0?"delta-neg":"";
    const deltaText=hidden?"Hidden":(delta?(delta>0?"+":"")+delta+" Elo":"0 Elo");
    const team=getPlayerTeam(m,playerId);
    const opponentTeam=team==="BLUE"?"RED":team==="RED"?"BLUE":"";
    const mine=team==="BLUE"?(m.blueTeam||[]):team==="RED"?(m.redTeam||[]):[];
    const theirs=team==="BLUE"?(m.redTeam||[]):team==="RED"?(m.blueTeam||[]):[];
    const teamScore=team==="BLUE"?Number(m.score_blue||0):team==="RED"?Number(m.score_red||0):0;
    const oppScore=team==="BLUE"?Number(m.score_red||0):team==="RED"?Number(m.score_blue||0):0;
    const scoreDiff=(Number.isFinite(teamScore)&&Number.isFinite(oppScore))?teamScore-oppScore:0;
    const scoreDiffText=(scoreDiff>0?"+":"")+scoreDiff+" diff";
    const matchId=m.match_id||m.id||"-";
    const detailUrl="match.html?id="+encodeURIComponent(matchId);
    const mapName=m.map_name||"Unknown";

  return '<article class="recent-match-card '+escapeAttr(cls)+'" role="button" tabindex="0" data-match-id="'+escapeAttr(matchId)+'">'+
    '<div class="recent-story-result">'+
      '<strong>'+escapeHtml(result==="-"?"Match":result)+'</strong>'+
      '<span class="'+escapeAttr(deltaCls)+'">'+escapeHtml(deltaText)+'</span>'+
    '</div>'+
    '<div class="recent-story-main">'+
      '<div class="recent-story-meta">'+
        '<button type="button" class="match-id-pill" data-match-id="'+escapeAttr(matchId)+'">'+escapeHtml(matchId)+'</button>'+
        '<span>'+escapeHtml(relativeTime(m.created_at))+'</span>'+
      '</div>'+
      '<a class="recent-story-map" href="'+escapeAttr("map.html?map="+encodeURIComponent(mapName))+'">'+escapeHtml(mapName)+'</a>'+
      '<div class="recent-story-teams">'+
        recentTeamLine("Played as",team)+
        recentTeamLine("Vs",opponentTeam)+
      '</div>'+
    '</div>'+
    '<div class="recent-story-rosters">'+
      recentChipLine("With",mine,playerId)+
      recentChipLine("Vs",theirs,playerId)+
    '</div>'+
    '<div class="recent-story-score">'+
      '<span>Score</span>'+
      '<strong>'+escapeHtml((m.score_blue??"?")+" - "+(m.score_red??"?"))+'</strong>'+
      '<small class="'+escapeAttr(scoreDiff>0?"delta-pos":scoreDiff<0?"delta-neg":"")+'">'+escapeHtml(scoreDiffText)+'</small>'+
    '</div>'+
    '<div class="recent-story-visual">'+
      '<div class="recent-story-actions">'+
        '<button type="button" class="recent-action recent-action-details" data-match-id="'+escapeAttr(matchId)+'">Details</button>'+
        (m.hampalyzer_url?'<a class="recent-action recent-action-hamp" href="'+escapeAttr(m.hampalyzer_url)+'" target="_blank" rel="noopener noreferrer">Hampalyzer</a>':"")+
        (m.tfcstats_url?'<a class="recent-action recent-action-tfc" href="'+escapeAttr(m.tfcstats_url)+'" target="_blank" rel="noopener noreferrer">TFC Stats</a>':"")+
        '<a class="recent-action recent-action-page" href="'+escapeAttr(detailUrl)+'">NN//Stats</a>'+
      '</div>'+
      '<a class="recent-map-thumb" href="'+escapeAttr("map.html?map="+encodeURIComponent(mapName))+'" aria-label="View '+escapeAttr(mapName)+' map">'+
        '<img class="recent-map-image" data-map-name="'+escapeAttr(mapName)+'" alt="" loading="lazy">'+
        '<span>'+escapeHtml(mapName)+'</span>'+
      '</a>'+
    '</div>'+
  '</article>';
  }).join("")||'<div class="empty-v3">No recent matches</div>');
  requestAnimationFrame(hydrateRecentMapImages);
  renderRecentMatchPager(total,totalPages,start,pageRows.length);
}

function renderRecentMatchPager(total,totalPages,start,pageCount){
  const el=qs("recent-match-pager");
  if(!el)return;
  if(total<=PLAYER2_RECENT_PAGE_SIZE){
    el.innerHTML="";
    return;
  }

  const from=start+1;
  const to=start+pageCount;
  el.innerHTML=
    '<button type="button" class="player2-pager-btn" data-recent-page="prev" '+(player2RecentPage<=0?"disabled":"")+'>Previous</button>'+
    '<span>Showing '+fmt(from)+'-'+fmt(to)+' of '+fmt(total)+'</span>'+
    '<button type="button" class="player2-pager-btn" data-recent-page="next" '+(player2RecentPage>=totalPages-1?"disabled":"")+'>Next</button>';
}

function hydrateRecentMapImages(){
  document.querySelectorAll(".recent-map-image[data-map-name]").forEach(img=>{
    const mapName=img.dataset.mapName||"";
    if(!mapName||img.dataset.loadedMap===mapName)return;
    img.dataset.loadedMap=mapName;
    window.setMapImageFromName?.(img,mapName,{containerSelector:".recent-map-thumb"});
  });
}

function recentTeamLine(label,team){
  if(!team)return "";
  const key=String(team).toLowerCase();
  return '<span><small>'+escapeHtml(label)+'</small><b class="team-dot-label team-'+escapeAttr(key)+'"><i></i>'+escapeHtml(team)+'</b></span>';
}

function recentChipLine(label,players,playerId){
  const safePlayers=(Array.isArray(players)?players:[]).filter(p=>String(p.id)!==String(playerId));
  if(!safePlayers.length)return '<div class="recent-chip-line"><span>'+escapeHtml(label)+'</span><em>-</em></div>';
  return '<div class="recent-chip-line"><span>'+escapeHtml(label)+'</span><div>'+
    safePlayers.map(recentPlayerChip).join("")+
  '</div></div>';
}

function recentPlayerChip(player){
  const name=player?.name||player?.display_name||player?.id||"?";
  const badge=pageSupporterBadge(player?.id);
  return '<b class="recent-player-chip">'+
    '<span>'+escapeHtml(name)+badge+'</span>'+
  '</b>';
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

function granularWeaponRow(row,extra,options={}){
  const showClassWeaponRates=!granularMatchFilter&&Number(row.matchesWithKill||0)>0;
  const rate=Number(row.killsPerMatch||0);
  const value=showClassWeaponRates
    ? '<span class="granular-weapon-stats"><b>'+fmt(row.kills)+' kills</b><b>'+fmt(row.matchesWithKill)+' matches</b><b>'+escapeHtml(formatGranularRate(rate))+' K/M</b></span>'
    : '<strong>'+fmt(row.kills)+' kills</strong>';
  const filter=row.drillFilter||{};
  const attrs=Object.keys(filter).length
    ? ' role="button" tabindex="0" title="Show matching kill events" data-granular-drill-filter="'+escapeAttr(JSON.stringify(filter))+'"'
    : "";
  return '<div class="granular-row granular-weapon-row'+(attrs?" granular-drill-row":"")+(options.active?" active":"")+'"'+attrs+'>'+
    '<span class="granular-weapon-cell">'+
      weaponIconMarkup(row.weapon)+
      '<b>'+escapeHtml(playerWeaponName(row.weapon||"-"))+'</b>'+
      (extra?'<small>'+escapeHtml(extra)+'</small>':"")+
    '</span>'+
    value+
  '</div>';
}

function granularClassWeaponFilter(row,className){
  return{
    role:granularRoleForClass(row.displayClass||row.class||className),
    class:normalizeGranularClass(row.class||className),
    weapon:row.weapon,
    official:"1"
  };
}

function granularObjectiveWeaponFilter(row,className,objectiveKey){
  return{
    role:granularRoleForClass(row.displayClass||row.class||className),
    objective:objectiveKey,
    class:normalizeGranularClass(row.class||className),
    weapon:row.weapon,
    official:"1"
  };
}

function sameGranularWeaponFilter(filter,row,className,objectiveKey=""){
  if(!filter||filter.victim)return false;
  if(String(filter.objective||"")!==String(objectiveKey||""))return false;
  const rowFilter=objectiveKey
    ? granularObjectiveWeaponFilter(row,className,objectiveKey)
    : granularClassWeaponFilter(row,className);
  return String(filter.role||"")===String(rowFilter.role||"") &&
    normalizeGranularClass(filter.class)===normalizeGranularClass(rowFilter.class) &&
    normalizeGranularWeapon(filter.weapon)===normalizeGranularWeapon(rowFilter.weapon);
}

function granularDrillScope(filter){
  return filter?.objective?"objective":"class";
}

function activeGranularDrillFilter(scope="class"){
  return scope==="objective"?granularObjectiveDrillFilter:granularDrillFilter;
}

function clearGranularDrillFilter(scope){
  if(!scope||scope==="class"){
    granularDrillFilter=null;
    granularEventsLoaded=false;
    currentGranularEvents=null;
  }
  if(!scope||scope==="objective"){
    granularObjectiveDrillFilter=null;
    granularObjectiveEventsLoaded=false;
    currentObjectiveGranularEvents=null;
  }
}

function clearGranularVictimFilter(){
  granularVictimFilter=null;
  granularVictimLoading=false;
  granularVictimRequestSeq++;
  clearGranularDrillFilter("class");
  if(currentGranularBase){
    currentGranular=currentGranularBase;
  }
}

function setGranularVictimFilter(filter){
  const nextFilter=filter&&typeof filter==="object"?filter:null;
  if(isCurrentGranularVictimFilter(nextFilter)){
    clearGranularVictimFilter();
    renderPlayerGranular(currentGranular);
    return;
  }
  granularVictimFilter=nextFilter;
  clearGranularDrillFilter("class");
  renderPlayerGranular(currentGranular);
  loadGranularVictimBreakdown();
}

function setGranularClassFilter(className){
  const nextClass=classKey(className||"");
  if(!granularClassFilter)updateGranularClassOptions(currentGranular,true);
  granularClassFilter=granularClassFilter===nextClass?"":nextClass;
  clearGranularDrillFilter("class");
  reloadGranularForActiveFilter();
}

function setGranularDrillFilter(filter){
  const nextFilter=filter&&typeof filter==="object"?filter:null;
  const scope=granularDrillScope(nextFilter);
  if(scope==="objective"){
    granularObjectiveDrillFilter=nextFilter;
    if(granularObjectiveDrillFilter?.objective){
      granularOpenObjectiveKeys.add(granularObjectiveDrillFilter.objective);
      if(granularObjectiveDrillFilter?.role)granularOpenRoleKeys.add(granularObjectiveDrillFilter.objective+"|"+granularObjectiveDrillFilter.role);
      if(granularObjectiveDrillFilter?.class&&granularObjectiveDrillFilter?.role){
        granularOpenObjectiveClassKeys.add(granularObjectiveDrillFilter.objective+"|"+granularObjectiveDrillFilter.role+"|"+normalizeGranularClass(granularObjectiveDrillFilter.class));
      }
    }
  }else{
    granularDrillFilter=nextFilter;
    if(granularDrillFilter?.role)granularOpenRoleKeys.add("class|"+granularDrillFilter.role);
    if(granularDrillFilter?.class)granularOpenClassKeys.add(normalizeGranularClass(granularDrillFilter.class));
  }
  resetGranularEventsState(scope);
  renderPlayerGranular(currentGranular);
  if(nextFilter){
    loadGranularEvents(0,false,scope);
  }
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

function fmtGranularRecord(sample){
  if(!granularSampleLoaded)return"Loading...";
  if(granularSampleFailed)return"Unavailable";
  if(!sample)return"-";
  return fmt(sample.wins)+" / "+fmt(sample.losses)+" / "+fmt(sample.ties);
}

function granularRecordKpiHtml(sample){
  if(!sample?.fromProfileRecord&&(!granularSampleLoaded||granularSampleFailed||!sample)){
    return '<strong>'+escapeHtml(fmtGranularRecord(sample))+'</strong>';
  }
  return '<strong class="granular-record-kpi">'+
    '<span><b>'+escapeHtml(fmt(sample.wins))+'</b><em>W</em></span>'+
    '<span><b>'+escapeHtml(fmt(sample.losses))+'</b><em>L</em></span>'+
    '<span><b>'+escapeHtml(fmt(sample.ties))+'</b><em>T</em></span>'+
  '</strong>';
}

function granularClassSummaryByClass(rows){
  const byClass=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    byClass.set(normalizeGranularClass(row.class),row);
  });
  return byClass;
}

function granularClassMetaHtml(total,weapons,summary){
  const base=fmt(total)+" kills - "+fmt(weapons)+" weapons";
  if(!summary)return '<span class="granular-class-meta-line">'+escapeHtml(base)+'</span>';
  const record=fmt(summary.matches)+" games - "+fmt(summary.wins)+" W / "+fmt(summary.losses)+" L / "+fmt(summary.ties)+" T";
  return '<span class="granular-class-meta-line">'+escapeHtml(base)+'</span>'+
    '<span class="granular-class-meta-line granular-class-record">'+escapeHtml(record)+'</span>';
}

function objectiveSummaryByKey(rows){
  const byKey=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    byKey.set(String(row.objective||""),row);
  });
  return byKey;
}

function objectiveClassSummaryByKey(rows){
  const byKey=new Map();
  (Array.isArray(rows)?rows:[]).forEach(row=>{
    byKey.set(String(row.objective||"")+"|"+normalizeGranularClass(row.class),row);
  });
  return byKey;
}

function formatObjectiveMeta(total,weapons,summary){
  const games=summary?Number(summary.matches||0):0;
  return fmt(total)+" kills - "+fmt(weapons)+" weapons - "+fmt(games)+" games";
}

function renderGranularClassWeapons(rows,classSummaryRows,events,eventCountLabel,eventAction){
  const displayRows=aggregateGranularWeaponRows(rows)
    .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));
  const roleGroups=groupRows(displayRows.map(row=>({
    ...row,
    role:granularRoleForClass(row.displayClass||row.class)
  })),"role");
  const classSummary=granularClassSummaryByClass(classSummaryRows);
  const roles=Object.keys(roleGroups).sort(granularRoleSort);

  if(!roles.length)return '<div class="granular-empty">No class weapon kills found.</div>';

  return roles.map(role=>{
    const roleRows=roleGroups[role]||[];
    const groups=groupRows(roleRows,"displayClass");
    const classNames=Object.keys(groups)
    .sort((a,b)=>{
      const aKills=groups[a].reduce((sum,row)=>sum+Number(row.kills||0),0);
      const bKills=groups[b].reduce((sum,row)=>sum+Number(row.kills||0),0);
      return bKills-aKills||String(a).localeCompare(String(b));
    });
    const roleKills=roleRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
    const roleWeapons=new Set(roleRows.map(row=>normalizeGranularWeapon(row.weapon))).size;
    const roleKey="class|"+role;
    const isRoleOpen=granularOpenRoleKeys.has(roleKey);

    return '<section class="granular-role-block granular-role-'+escapeAttr(role)+' '+(isRoleOpen?"open":"")+'" data-granular-role-key="'+escapeAttr(roleKey)+'">'+
      '<button type="button" class="granular-role-head" data-granular-role-toggle="1" aria-expanded="'+(isRoleOpen?"true":"false")+'">'+
        '<strong>'+escapeHtml(granularRoleLabel(role))+'</strong>'+
        '<span>'+escapeHtml(fmt(roleKills)+" kills - "+fmt(roleWeapons)+" weapons")+'</span>'+
      '</button>'+
      '<div class="granular-role-body" '+(isRoleOpen?"":'hidden')+'>'+
      classNames.map(className=>{
    const classRows=groups[className]
      .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));
    const total=classRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
    const classKey=normalizeGranularClass(className);
    const summary=classSummary.get(classKey);
    const isOpen=granularOpenClassKeys.has(classKey);
    return '<article class="granular-group granular-class-group '+(isOpen?"open":"")+'" data-granular-class-key="'+escapeAttr(classKey)+'">'+
      '<button type="button" class="granular-group-head granular-class-toggle" data-granular-class-toggle="1" aria-expanded="'+(isOpen?"true":"false")+'">'+
        '<div class="granular-class-summary">'+
          '<strong class="granular-class-name">'+escapeHtml(classDisplayName(className))+'</strong>'+
          '<span class="granular-class-meta">'+granularClassMetaHtml(total,classRows.length,summary)+'</span>'+
        '</div>'+
      '</button>'+
      '<div class="granular-class-weapons" '+(isOpen?"":'hidden')+'>'+classRows.slice(0,8).map(row=>{
        const drillFilter=granularClassWeaponFilter(row,className);
        const active=sameGranularWeaponFilter(granularDrillFilter,row,className);
        return granularWeaponRow({
          ...row,
          drillFilter
        },null,{active})+(active?renderGranularWeaponKillEvents(events,eventCountLabel,eventAction,"class"):"");
      }).join("")+'</div>'+
    '</article>';
      }).join("")+
      '</div>'+
    '</section>';
  }).join("");
}

function renderGranularWeaponKillEvents(events,eventCountLabel,eventAction,scope="class"){
  const isLoading=scope==="objective"?granularObjectiveEventsLoading:granularEventsLoading;
  const isLoaded=scope==="objective"?granularObjectiveEventsLoaded:granularEventsLoaded;
  const activeFilter=activeGranularDrillFilter(scope);
  const action=isLoading
    ? '<button type="button" class="granular-load-more" disabled>Loading Events</button>'
    : eventAction;
  const loaded=Array.isArray(events?.events)&&events.events.length;
  const body=(isLoading||(!isLoaded&&activeFilter))&&!loaded
    ? '<div class="empty-v3">Loading granular events...</div>'
    : renderGranularInlineEvents(events);

  return '<div class="granular-inline-drilldown">'+
    '<div id="'+(scope==="objective"?"granular-objective-events-panel":"granular-events-panel")+'" class="granular-inline-events">'+body+'</div>'+
    (action||"")+
  '</div>';
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

function renderObjectiveClassWeaponGroups(rows,objectiveKey,classSummary,events,eventCountLabel,eventAction){
  const roleGroups=groupRows(rows.map(row=>({
    ...row,
    role:granularRoleForClass(row.displayClass||row.class)
  })),"role");
  return Object.keys(roleGroups).sort(granularRoleSort).map(role=>{
    const roleRows=roleGroups[role]||[];
    const groups=groupRows(roleRows,"displayClass");
    const classNames=Object.keys(groups)
      .sort((a,b)=>{
        const aKills=groups[a].reduce((sum,row)=>sum+Number(row.kills||0),0);
        const bKills=groups[b].reduce((sum,row)=>sum+Number(row.kills||0),0);
        return bKills-aKills||String(a).localeCompare(String(b));
    });
    const roleKills=roleRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
    const roleWeapons=new Set(roleRows.map(row=>normalizeGranularWeapon(row.weapon))).size;
    const roleKey=objectiveKey+"|"+role;
    const isRoleOpen=granularOpenRoleKeys.has(roleKey);

    return '<section class="granular-role-block granular-objective-role '+(isRoleOpen?"open":"")+'" data-granular-role-key="'+escapeAttr(roleKey)+'">'+
      '<button type="button" class="granular-role-head" data-granular-role-toggle="1" aria-expanded="'+(isRoleOpen?"true":"false")+'">'+
        '<strong>'+escapeHtml(granularRoleLabel(role))+'</strong>'+
        '<span>'+escapeHtml(fmt(roleKills)+" kills - "+fmt(roleWeapons)+" weapons")+'</span>'+
      '</button>'+
      '<div class="granular-role-body" '+(isRoleOpen?"":'hidden')+'>'+
      classNames.map(className=>{
        const classRows=groups[className]
          .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));
        const total=classRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
        const classKey=objectiveKey+"|"+role+"|"+normalizeGranularClass(className);
        const summary=classSummary.get(objectiveKey+"|"+normalizeGranularClass(className));
        const isOpen=granularOpenObjectiveClassKeys.has(classKey);

        return '<div class="granular-objective-class-group '+(isOpen?"open":"")+'" data-granular-objective-class-key="'+escapeAttr(classKey)+'">'+
          '<button type="button" class="granular-objective-class-head" data-granular-objective-class-toggle="1" aria-expanded="'+(isOpen?"true":"false")+'">'+
            '<strong>'+escapeHtml(classDisplayName(className))+'</strong>'+
            '<span>'+escapeHtml(formatObjectiveMeta(total,classRows.length,summary))+'</span>'+
          '</button>'+
          '<div class="granular-objective-class-weapons" '+(isOpen?"":'hidden')+'>'+
            classRows.slice(0,6).map(row=>{
              const drillFilter=granularObjectiveWeaponFilter(row,className,objectiveKey);
              const active=sameGranularWeaponFilter(granularDrillFilter,row,className,objectiveKey);
              return granularWeaponRow({
                ...row,
                drillFilter
              },null,{active})+(active?renderGranularWeaponKillEvents(events,eventCountLabel,eventAction,"objective"):"");
            }).join("")+
          '</div>'+
        '</div>';
      }).join("")+
      '</div>'+
    '</section>';
  }).join("");
}

function renderGranularSpecialKills(flagRows,concedRows,summaryRows,classSummaryRows,events,eventCountLabel,eventAction){
  const hasFlag=Array.isArray(flagRows)&&flagRows.length;
  const hasConced=Array.isArray(concedRows)&&concedRows.length;
  if(!hasFlag&&!hasConced)return '<div class="granular-empty">No objective kill events found.</div>';
  const objectiveSummary=objectiveSummaryByKey(summaryRows);
  const objectiveClassSummary=objectiveClassSummaryByKey(classSummaryRows);

  function block(title,rows,key){
    const safeRows=aggregateGranularWeaponRows(rows)
      .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0)||String(a.weapon||"").localeCompare(String(b.weapon||"")));

    const total=safeRows.reduce((sum,row)=>sum+Number(row.kills||0),0);
    const isOpen=granularOpenObjectiveKeys.has(key);

    return '<article class="granular-mini-block granular-objective-group '+(isOpen?"open":"")+'" data-granular-objective-key="'+escapeAttr(key)+'">'+
      '<button type="button" class="granular-group-head granular-objective-toggle" data-granular-objective-toggle="1" aria-expanded="'+(isOpen?"true":"false")+'">'+
        '<div class="granular-class-summary">'+
          '<strong class="granular-class-name">'+escapeHtml(title)+'</strong>'+
          '<span class="granular-class-meta">'+escapeHtml(formatObjectiveMeta(total,safeRows.length,objectiveSummary.get(key)))+'</span>'+
        '</div>'+
      '</button>'+
      '<div class="granular-objective-weapons" '+(isOpen?"":'hidden')+'>'+
        (safeRows.length?renderObjectiveClassWeaponGroups(safeRows,key,objectiveClassSummary,events,eventCountLabel,eventAction):'<div class="granular-empty">No '+escapeHtml(title.toLowerCase())+' found.</div>')+
      '</div>'+
    '</article>';
  }

  return block("Flag Carrier Kills",flagRows,"flag")+block("Conced Kills",concedRows,"conced");
}

function renderGranularVictims(rows){
  const victims=Array.isArray(rows)?rows:[];
  if(!victims.length)return '<div class="granular-empty">No victim data found.</div>';
  return '<div class="granular-list">'+victims.slice(0,16).map((row,index)=>{
    const filter={
      victim:row.victimId||row.victimSteamId||row.victimKey||row.victimName||"",
      victimName:row.victimName||"Unknown"
    };
    const active=isCurrentGranularVictimFilter(filter);
    return '<div class="granular-row granular-victim-row '+(active?"active":"")+'" role="button" tabindex="0" title="Filter class weapon breakdown" data-granular-victim-filter="'+escapeAttr(JSON.stringify(filter))+'">'+
      '<span><b>#'+(index+1)+' '+granularVictimLink(row)+'</b></span>'+
      '<strong>'+fmt(row.kills)+' kills</strong>'+
    '</div>';
  }).join("")+'</div>';
}

function granularVictimLink(row){
  const name=row?.victimName||"Unknown";
  const id=row?.victimId||row?.victimDiscordId||row?.victimSteamId||row?.victimKey||"";
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

function renderGranularInlineEvents(data){
  const events=Array.isArray(data?.events)?data.events:[];
  if(!events.length)return '<div class="granular-empty">No matching kills found.</div>';
  return '<div class="granular-inline-event-list">'+events.map(event=>{
    const matchId=event.matchId||"-";
    const objectiveChips=[
      event.flags?.flagCarrierKill?'<i>flag carrier kill</i>':"",
      event.flags?.conced?'<i>conced</i>':""
    ].filter(Boolean).join("");
    return '<div class="granular-inline-event-row">'+
      '<button type="button" class="match-id-pill granular-match-pill" data-match-id="'+escapeAttr(matchId)+'">'+escapeHtml(matchId)+'</button>'+
      '<span class="granular-inline-event-meta">'+
        escapeHtml(event.map||"Unknown map")+
        ' · Round '+escapeHtml(event.round||"-")+
        ' · '+escapeHtml(formatEventTime(event))+
        ' · vs '+escapeHtml(event.victim?.name||"Unknown")+
      '</span>'+
      (objectiveChips?'<span class="granular-event-badges">'+objectiveChips+'</span>':"")+
    '</div>';
  }).join("")+'</div>';
}

function granularEventViewState(scope="class"){
  const activeFilter=activeGranularDrillFilter(scope);
  const isLoaded=scope==="objective"?granularObjectiveEventsLoaded:granularEventsLoaded;
  const isLoading=scope==="objective"?granularObjectiveEventsLoading:granularEventsLoading;
  const loadedEvents=scope==="objective"?currentObjectiveGranularEvents:currentGranularEvents;
  const fallbackEvents=!activeFilter&&Array.isArray(currentGranular?.matchDrilldown)?currentGranular.matchDrilldown:[];
  const hasLoadedEvents=isLoaded&&loadedEvents;
  const events=hasLoadedEvents?loadedEvents:{
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
  const eventAction=isLoading
    ? '<button type="button" class="granular-load-more" disabled>Loading Events</button>'
    : (!hasLoadedEvents
        ? '<button type="button" class="granular-load-more" data-granular-load-events="1" data-granular-event-scope="'+escapeAttr(scope)+'">Load Events</button>'
        : (events.hasMore?'<button type="button" class="granular-load-more" data-granular-load-more="'+escapeAttr(String(loaded))+'" data-granular-event-scope="'+escapeAttr(scope)+'">Load More Events</button>':""));
  return{events,eventCountLabel,eventAction};
}

function granularEventClassText(event){
  const sourceClass=event?.attacker?.class||"Unknown";
  return granularDisplayClassForWeapon(event?.weapon,sourceClass);
}

function granularEventsUrl(offset=0,scope="class"){
  if(!currentPlayerId)return "";
  const filter=activeGranularDrillFilter(scope);
  const params=new URLSearchParams({limit:"100",offset:String(offset)});
  if(granularMapFilter)params.set("map",granularMapFilter);
  if(granularMatchFilter)params.set("matchId",granularMatchFilter);
  if(granularClassFilter&&!filter?.class)params.set("class",granularClassFilter);
  if(scope==="class"&&granularVictimFilter?.victim)params.set("victim",granularVictimFilter.victim);
  if(filter?.class)params.set("class",filter.class);
  if(filter?.weapon)params.set("weapon",filter.weapon);
  if(filter?.objective)params.set("objective",filter.objective);
  if(filter?.victim)params.set("victim",filter.victim);
  if(filter?.official)params.set("official","1");
  return "/api/player/"+encodeURIComponent(currentPlayerId)+"/granular/events?"+params.toString();
}

function granularDrillFilterSignature(scope="class"){
  const filter=activeGranularDrillFilter(scope);
  return filter?JSON.stringify(filter):"";
}

function isCurrentGranularDrillFilter(filter){
  const scope=granularDrillScope(filter);
  return !!activeGranularDrillFilter(scope) && JSON.stringify(filter||{})===granularDrillFilterSignature(scope);
}

function granularVictimFilterSignature(filter=granularVictimFilter){
  return filter?JSON.stringify(filter):"";
}

function isCurrentGranularVictimFilter(filter){
  return !!granularVictimFilter && granularVictimFilterSignature(filter)===granularVictimFilterSignature();
}

function granularSummaryUrl(playerId,includeSample=false,extraFilters={}){
  const params=new URLSearchParams({limit:"50"});
  if(includeSample)params.set("includeSample","1");
  if(granularMapFilter)params.set("map",granularMapFilter);
  if(granularMatchFilter)params.set("matchId",granularMatchFilter);
  if(granularClassFilter)params.set("class",granularClassFilter);
  if(extraFilters.victim)params.set("victim",extraFilters.victim);
  return "/api/player/"+encodeURIComponent(playerId)+"/granular?"+params.toString();
}

function cleanGranularMapFilter(value){
  return String(value||"").trim().slice(0,200);
}

function cleanGranularMatchFilter(value){
  return String(value||"").trim().slice(0,100);
}

function populateGranularMatchSelect(rows){
  const select=qs("granular-match-select");
  if(!select)return;
  const matches=(Array.isArray(rows)?rows:[])
    .filter(row=>getRecentMatchId(row))
    .filter(row=>!granularMapFilter||getRecentMatchMap(row)===granularMapFilter)
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

function populateGranularMapSelect(rows){
  const select=qs("granular-map-select");
  if(!select)return;
  granularRecentMatches=Array.isArray(rows)?rows:[];
  const maps=[...new Set(granularRecentMatches.map(getRecentMatchMap).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b));
  if(!maps.length){
    select.innerHTML='<option value="">No maps</option>';
    select.disabled=true;
    return;
  }
  select.disabled=false;
  select.innerHTML='<option value="">All maps</option>'+maps.map(map=>
    '<option value="'+escapeAttr(map)+'">'+escapeHtml(map)+'</option>'
  ).join("");
  select.value=granularMapFilter;
}

function resetGranularState(){
  currentGranular=null;
  currentGranularBase=null;
  currentGranularEvents=null;
  currentObjectiveGranularEvents=null;
  granularMapFilter="";
  granularMatchFilter="";
  granularClassFilter="";
  granularClassOptions=[];
  granularDrillFilter=null;
  granularObjectiveDrillFilter=null;
  granularVictimFilter=null;
  granularVictimLoading=false;
  granularVictimRequestSeq++;
  granularOpenClassKeys=new Set();
  granularOpenObjectiveKeys=new Set();
  granularOpenObjectiveClassKeys=new Set();
  granularOpenRoleKeys=new Set();
  granularSummaryLoading=false;
  granularSampleLoading=false;
  granularSampleLoaded=false;
  granularSampleFailed=false;
  granularEventsLoading=false;
  granularEventsLoaded=false;
  granularObjectiveEventsLoading=false;
  granularObjectiveEventsLoaded=false;
  granularRequestSeq++;
  const input=qs("granular-match-filter");
  if(input)input.value="";
  const mapSelect=qs("granular-map-select");
  if(mapSelect)mapSelect.value="";
  const select=qs("granular-match-select");
  if(select)select.value="";
}

function renderPlayerGranularLoading(){
  bindGranularControls();
  const body=qs("player-granular-body");
  if(!body)return;
  body.innerHTML=
    granularOverviewHtml({},true)+
    '<div class="granular-grid">'+
      '<section class="granular-panel granular-class-panel"><div class="granular-panel-head"><h3>Class Weapon Breakdown</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading granular class weapons...</div></div></section>'+
      '<section class="granular-panel granular-victim-panel"><div class="granular-panel-head"><h3>Favorite Victims</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading nemesis table...</div></div></section>'+
      '<section class="granular-panel granular-alias-panel"><div class="granular-panel-head"><h3>Alias History</h3><span>Loading</span></div><div class="granular-panel-scroll"><div class="granular-empty">Loading aliases...</div></div></section>'+
    '</div>';
  requestAnimationFrame(()=>applyGranularMapBackground(granularContextMapName()));
}

function resetGranularSampleState(){
  granularSampleLoading=false;
  granularSampleLoaded=false;
  granularSampleFailed=false;
}

function resetGranularEventsState(scope){
  if(!scope||scope==="class"){
    granularEventsLoading=false;
    granularEventsLoaded=false;
    currentGranularEvents=null;
  }
  if(!scope||scope==="objective"){
    granularObjectiveEventsLoading=false;
    granularObjectiveEventsLoaded=false;
    currentObjectiveGranularEvents=null;
  }
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
      updateGranularClassOptions(currentGranular);
      currentGranularBase=currentGranular;
      renderPlayerGranular(currentGranular);
      scheduleGranularSampleLoad(requestedPlayerId);
      if(granularVictimFilter)loadGranularVictimBreakdown();
    },0);
  });
}

function reloadGranularForActiveFilter(){
  if(!currentPlayerId)return;
  scheduleGranularSummaryLoad(currentPlayerId);
  if(granularDrillFilter){
    loadGranularEvents(0,false,"class");
  }
  if(granularObjectiveDrillFilter){
    loadGranularEvents(0,false,"objective");
  }
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
    updateGranularClassOptions(currentGranular);
    if(!granularVictimFilter)currentGranularBase=currentGranular;
  }
  renderPlayerGranular(currentGranular);
}

async function loadGranularVictimBreakdown(){
  if(!currentPlayerId||!granularVictimFilter?.victim)return;
  const requestSeq=++granularVictimRequestSeq;
  const requestedPlayerId=String(currentPlayerId||"");
  const requestedMapFilter=granularMapFilter;
  const requestedMatchFilter=granularMatchFilter;
  const requestedVictim=granularVictimFilterSignature();
  granularVictimLoading=true;
  const result=await fetchJSON(granularSummaryUrl(requestedPlayerId,true,{victim:granularVictimFilter.victim}));
  granularVictimLoading=false;
  if(String(currentPlayerId)!==requestedPlayerId||requestedMapFilter!==granularMapFilter||requestedMatchFilter!==granularMatchFilter||requestedVictim!==granularVictimFilterSignature()||requestSeq!==granularVictimRequestSeq)return;
  const filtered=result?.ok?result.data:null;
  if(!filtered||!currentGranular)return;
  updateGranularClassOptions(filtered);
  const base=currentGranularBase||currentGranular;
  currentGranular={
    ...base,
    sample:filtered.sample||{},
      classWeapons:Array.isArray(filtered.classWeapons)?filtered.classWeapons:[],
      classSummary:Array.isArray(filtered.classSummary)?filtered.classSummary:[],
      roleClassTime:Array.isArray(filtered.roleClassTime)?filtered.roleClassTime:[],
      filteredFlags:filtered.filteredFlags||{matches:0,captures:0,touches:0,initialTouches:0,sentryKills:0},
      roleWeapons:Array.isArray(filtered.roleWeapons)?filtered.roleWeapons:[],
    flagCarrierKills:Array.isArray(filtered.flagCarrierKills)?filtered.flagCarrierKills:[],
    concededKills:Array.isArray(filtered.concededKills)?filtered.concededKills:[],
    objectiveSummary:Array.isArray(filtered.objectiveSummary)?filtered.objectiveSummary:[],
    objectiveClassSummary:Array.isArray(filtered.objectiveClassSummary)?filtered.objectiveClassSummary:[],
    matchDrilldown:Array.isArray(filtered.matchDrilldown)?filtered.matchDrilldown:[],
    favoriteVictims:Array.isArray(base.favoriteVictims)?base.favoriteVictims:[],
    aliasHistory:Array.isArray(base.aliasHistory)?base.aliasHistory:[]
  };
  renderPlayerGranular(currentGranular);
}

async function loadGranularEvents(offset=0,append=false,scope="class"){
  if(scope==="objective"?granularObjectiveEventsLoading:granularEventsLoading)return;
  const requestedPlayerId=String(currentPlayerId||"");
  const requestedMapFilter=granularMapFilter;
  const requestedFilter=granularMatchFilter;
  const requestedDrillFilter=granularDrillFilterSignature(scope);
  const requestSeq=granularRequestSeq;
  const body=qs(scope==="objective"?"granular-objective-events-panel":"granular-events-panel");
  if(body&&!append)body.innerHTML='<div class="empty-v3">Loading granular events...</div>';
  const url=granularEventsUrl(offset,scope);
  if(!url)return;
  if(scope==="objective")granularObjectiveEventsLoading=true;
  else granularEventsLoading=true;
  const result=await fetchJSON(url);
  if(scope==="objective")granularObjectiveEventsLoading=false;
  else granularEventsLoading=false;
  if(String(currentPlayerId)!==requestedPlayerId||requestedMapFilter!==granularMapFilter||requestedFilter!==granularMatchFilter||requestedDrillFilter!==granularDrillFilterSignature(scope)||requestSeq!==granularRequestSeq)return;
  const next=result?.ok?result.data:null;
  const currentEvents=scope==="objective"?currentObjectiveGranularEvents:currentGranularEvents;
  if(append&&currentEvents&&next){
    next.events=[...(currentEvents.events||[]),...(next.events||[])];
  }
  if(scope==="objective"){
    currentObjectiveGranularEvents=next;
    granularObjectiveEventsLoaded=!!next;
  }else{
    currentGranularEvents=next;
    granularEventsLoaded=!!next;
  }
  renderPlayerGranular(currentGranular);
}

function bindGranularControls(){
  const card=qs("player-granular-card");
  if(!card||card.dataset.bound==="1")return;
  card.dataset.bound="1";
  qs("granular-match-apply")?.addEventListener("click",()=>{
    granularMapFilter=cleanGranularMapFilter(qs("granular-map-select")?.value);
    granularMatchFilter=cleanGranularMatchFilter(qs("granular-match-filter")?.value);
    populateGranularMatchSelect(granularRecentMatches);
    reloadGranularForActiveFilter();
  });
  qs("granular-match-clear")?.addEventListener("click",()=>{
    granularMapFilter="";
    granularMatchFilter="";
    granularClassFilter="";
    granularClassOptions=[];
    clearGranularDrillFilter();
    clearGranularVictimFilter();
    const input=qs("granular-match-filter");
    if(input)input.value="";
    const mapSelect=qs("granular-map-select");
    if(mapSelect)mapSelect.value="";
    const select=qs("granular-match-select");
    if(select)select.value="";
    populateGranularMatchSelect(granularRecentMatches);
    reloadGranularForActiveFilter();
  });
  qs("granular-match-filter")?.addEventListener("keydown",event=>{
    if(event.key==="Enter"){
      granularMapFilter=cleanGranularMapFilter(qs("granular-map-select")?.value);
      granularMatchFilter=cleanGranularMatchFilter(event.currentTarget.value);
      populateGranularMatchSelect(granularRecentMatches);
      reloadGranularForActiveFilter();
    }
  });
  qs("granular-map-select")?.addEventListener("change",event=>{
    granularMapFilter=cleanGranularMapFilter(event.currentTarget.value);
    granularMatchFilter="";
    const input=qs("granular-match-filter");
    if(input)input.value="";
    populateGranularMatchSelect(granularRecentMatches);
    const matchSelect=qs("granular-match-select");
    if(matchSelect)matchSelect.value="";
    reloadGranularForActiveFilter();
  });
  qs("granular-match-select")?.addEventListener("change",event=>{
    const input=qs("granular-match-filter");
    const value=event.currentTarget.value||"";
    if(input)input.value=value;
    granularMatchFilter=cleanGranularMatchFilter(value);
    reloadGranularForActiveFilter();
  });
  card.addEventListener("click",event=>{
    const classFilterButton=event.target.closest("[data-granular-class-filter]");
    if(classFilterButton){
      setGranularClassFilter(classFilterButton.dataset.granularClassFilter||"");
      return;
    }

    const victimRow=event.target.closest("[data-granular-victim-filter]");
    if(victimRow&&!event.target.closest("a,button")){
      try{
        setGranularVictimFilter(JSON.parse(victimRow.dataset.granularVictimFilter||"{}"));
      }catch{
        clearGranularVictimFilter();
        renderPlayerGranular(currentGranular);
      }
      return;
    }

    const drillRow=event.target.closest("[data-granular-drill-filter]");
    if(drillRow&&!event.target.closest("a,button")){
      try{
        const filter=JSON.parse(drillRow.dataset.granularDrillFilter||"{}");
        const scope=granularDrillScope(filter);
        if(isCurrentGranularDrillFilter(filter)){
          clearGranularDrillFilter(scope);
          renderPlayerGranular(currentGranular);
        }else{
          setGranularDrillFilter(filter);
        }
      }catch{
        setGranularDrillFilter(null);
      }
      return;
    }

    const roleToggle=event.target.closest("[data-granular-role-toggle]");
    if(roleToggle){
      const group=roleToggle.closest(".granular-role-block");
      if(!group)return;
      const body=group?.querySelector(".granular-role-body");
      const key=group?.dataset?.granularRoleKey||"";
      const isOpen=!group.classList.contains("open");
      group?.classList.toggle("open",isOpen);
      if(body)body.hidden=!isOpen;
      roleToggle.setAttribute("aria-expanded",isOpen?"true":"false");
      if(key){
        if(isOpen)granularOpenRoleKeys.add(key);
        else granularOpenRoleKeys.delete(key);
      }
      if(isOpen&&group)hydrateLazyWeaponIcons(group);
      return;
    }

    const classToggle=event.target.closest("[data-granular-class-toggle]");
    if(classToggle){
      const group=classToggle.closest(".granular-class-group");
      const weapons=group?.querySelector(".granular-class-weapons");
      const classKey=group?.dataset?.granularClassKey||"";
      const isOpen=!group.classList.contains("open");
      group?.classList.toggle("open",isOpen);
      if(weapons)weapons.hidden=!isOpen;
      classToggle.setAttribute("aria-expanded",isOpen?"true":"false");
      if(classKey){
        if(isOpen)granularOpenClassKeys.add(classKey);
        else granularOpenClassKeys.delete(classKey);
      }
      if(isOpen&&group)hydrateLazyWeaponIcons(group);
      return;
    }

    const loadEvents=event.target.closest("[data-granular-load-events]");
    if(loadEvents){
      loadGranularEvents(0,false,loadEvents.dataset.granularEventScope||"class");
      return;
    }

      const objectiveToggle=event.target.closest("[data-granular-objective-toggle]");
        if(objectiveToggle){
          const group=objectiveToggle.closest(".granular-objective-group");
          const weapons=group?.querySelector(".granular-objective-weapons");
          const key=group?.dataset?.granularObjectiveKey||"";
          const isOpen=!group.classList.contains("open");

          group?.classList.toggle("open",isOpen);
          if(weapons)weapons.hidden=!isOpen;
          objectiveToggle.setAttribute("aria-expanded",isOpen?"true":"false");

          if(key){
            if(isOpen)granularOpenObjectiveKeys.add(key);
            else granularOpenObjectiveKeys.delete(key);
          }

          if(isOpen&&group)hydrateLazyWeaponIcons(group);
          return;
        }
        const objectiveClassToggle=event.target.closest("[data-granular-objective-class-toggle]");
          if(objectiveClassToggle){
            const group=objectiveClassToggle.closest(".granular-objective-class-group");
            const weapons=group?.querySelector(".granular-objective-class-weapons");
            const key=group?.dataset?.granularObjectiveClassKey||"";
            const isOpen=!group.classList.contains("open");

            group?.classList.toggle("open",isOpen);
            if(weapons)weapons.hidden=!isOpen;
            objectiveClassToggle.setAttribute("aria-expanded",isOpen?"true":"false");

            if(key){
              if(isOpen)granularOpenObjectiveClassKeys.add(key);
              else granularOpenObjectiveClassKeys.delete(key);
            }

            if(isOpen&&group)hydrateLazyWeaponIcons(group);
            return;
          }

    const loadMore=event.target.closest("[data-granular-load-more]");
    if(loadMore){
      const offset=Number(loadMore.dataset.granularLoadMore||0);
      loadGranularEvents(offset,true,loadMore.dataset.granularEventScope||"class");
    }
  });

  card.addEventListener("keydown",event=>{
    if(event.key!=="Enter"&&event.key!==" ")return;
    const classFilterButton=event.target.closest("[data-granular-class-filter]");
    if(classFilterButton){
      event.preventDefault();
      setGranularClassFilter(classFilterButton.dataset.granularClassFilter||"");
      return;
    }

    const victimRow=event.target.closest("[data-granular-victim-filter]");
    if(victimRow){
      event.preventDefault();
      try{
        setGranularVictimFilter(JSON.parse(victimRow.dataset.granularVictimFilter||"{}"));
      }catch{
        clearGranularVictimFilter();
        renderPlayerGranular(currentGranular);
      }
      return;
    }

    const drillRow=event.target.closest("[data-granular-drill-filter]");
    if(!drillRow)return;
    event.preventDefault();
    try{
      const filter=JSON.parse(drillRow.dataset.granularDrillFilter||"{}");
      const scope=granularDrillScope(filter);
      if(isCurrentGranularDrillFilter(filter)){
        clearGranularDrillFilter(scope);
        renderPlayerGranular(currentGranular);
      }else{
        setGranularDrillFilter(filter);
      }
    }catch{
      setGranularDrillFilter(null);
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
  const classEventState=granularEventViewState("class");
  const classRowsLabel=granularVictimFilter?.victimName
    ? "vs "+granularVictimFilter.victimName
    : fmt(currentGranular.classWeapons?.length)+" rows";

  body.innerHTML=
    granularOverviewHtml(sample,false)+
    '<div class="granular-grid">'+
      '<section class="granular-panel granular-class-panel"><div class="granular-panel-head"><h3>Class Weapon Breakdown</h3><span>'+escapeHtml(granularVictimLoading?"Filtering...":classRowsLabel)+'</span></div><p class="granular-panel-help">What weapons this player gets kills with while playing each class.</p><div class="granular-panel-scroll">'+renderGranularClassWeapons(currentGranular.classWeapons,currentGranular.classSummary,classEventState.events,classEventState.eventCountLabel,classEventState.eventAction)+'</div></section>'+
      '<section class="granular-panel granular-victim-panel"><div class="granular-panel-head"><h3>Favorite Victims</h3><span>Most killed</span></div><p class="granular-panel-help">Players this player killed most.</p><div class="granular-panel-scroll">'+renderGranularVictims(currentGranular.favoriteVictims)+'</div></section>'+
      '<section class="granular-panel granular-alias-panel"><div class="granular-panel-head"><h3>Alias History</h3><span>Event names</span></div><p class="granular-panel-help">Names used by this player in Hampalyzer events.</p><div class="granular-panel-scroll">'+renderGranularAliases(currentGranular.aliasHistory)+'</div></section>'+
    '</div>';
  requestAnimationFrame(()=>applyGranularMapBackground(granularContextMapName()));
  hydrateLazyWeaponIcons(body);
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
    const matchId=String(m.id||m.match_id||"");
    const team=getPlayerTeam(m,playerId);
    if(!team)return;

    const mine=team==="BLUE"?(m.blueTeam||[]):(m.redTeam||[]);
    const theirs=team==="BLUE"?(m.redTeam||[]):(m.blueTeam||[]);
    const result=getPlayerResult(m,playerId);
    const counted=new Set();

    mine.forEach(p=>{
      if(String(p.id)===String(playerId))return;
      const key=String(p.id);
      const countKey="teammate:"+matchId+":"+key;
      if(counted.has(countKey))return;
      counted.add(countKey);
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
      const countKey="opponent:"+matchId+":"+key;
      if(counted.has(countKey))return;
      counted.add(countKey);
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
    .slice(0,4);

  const toughOpps=[...opponents.values()]
    .filter(x=>x.gp>=2)
    .sort((a,b)=>relationshipWinPct(a)-relationshipWinPct(b)||b.gp-a.gp)
    .slice(0,4);

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
  const pager=e.target.closest("[data-recent-page]");
  if(pager){
    e.preventDefault();
    e.stopPropagation();
    if(pager.dataset.recentPage==="next")player2RecentPage++;
    else player2RecentPage--;
    renderRecentMatchesPage();
    document.querySelector(".player2-recent-card")?.scrollIntoView({behavior:"smooth",block:"start"});
    return;
  }

  const btn=e.target.closest(".match-id-pill,[data-match-id]");
  if(!btn)return;
  if(e.target.closest("a[href]")&&!e.target.closest(".match-id-pill"))return;

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
  if((e.key==="Enter"||e.key===" ")&&e.target.closest?.(".recent-match-card[data-match-id]")){
    const card=e.target.closest(".recent-match-card[data-match-id]");
    if(card&&document.activeElement===card){
      e.preventDefault();
      openMatchDrawer(card.dataset.matchId);
    }
  }
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

function init(){
  bindEvents();
  loadPlayer();
}

function loadPlayer(){
  return loadPlayerV3();
}

function renderOverview(data,recentRows){
  return {data,recentRows};
}

function renderEloChart(values,hidden){
  return renderEloChartV3(values,hidden);
}

function renderActivity(rows){
  return renderActivityHeatmaps(rows);
}

function renderRelationships(rows,playerId){
  return renderRelationshipLists(rows,playerId);
}

function renderGranularAnalytics(data,eventsData){
  return renderPlayerGranular(data,eventsData);
}

function bindEvents(){
  bindGranularControls();
}

window.player2Profile={
  init,
  loadPlayer,
  renderOverview,
  renderEloChart,
  renderRecentMatches,
  renderActivity,
  renderRelationships,
  renderGranularAnalytics,
  bindEvents
};

window.addEventListener("resize", fitPlayerName);
document.addEventListener("DOMContentLoaded", init);
