"use strict";

const nn = window.nnHelpers || {};
const matchFormatSeconds = nn.formatSeconds || (s => `${Number(s || 0)}s`);
const matchNormName = nn.normName || (v => String(v || "").toLowerCase().replace(/[^a-z0-9]/g, ""));
const matchWeaponName = nn.weaponName || (v => v);
const pageSupporterBadge = nn.supporterBadge || (() => "");

function qs(id){return document.getElementById(id);}
const matchEscapeHtml=window.nnHelpers?.escapeHtml||window.escapeHtml;
const matchEscapeAttr=window.nnHelpers?.escapeAttr||window.escapeAttr;
function fmt(n){const v=Number(n||0);return Number.isFinite(v)?v.toLocaleString():"-";}
function formatDate(ts){const d=new Date(Number(ts||0)*1000);if(!Number.isFinite(d.getTime()))return"-";return d.toLocaleString([], {month:"short",day:"numeric",year:"numeric",hour:"numeric",minute:"2-digit"});}

function className(s){s=String(s||"unknown");return s.charAt(0).toUpperCase()+s.slice(1);}
function deltaText(d){d=Number(d||0);return d>0?"+"+d:d<0?String(d):"-";}
function playerLabel(p){return escapeHtml(p.display_name||p.name||p.player_key||p.steam_id||p.id||"-");}
function isBlueWinner(m){return String(m.winner||"").toUpperCase()==="BLUE";}
function isRedWinner(m){return String(m.winner||"").toUpperCase()==="RED";}

async function loadMatch(){
  const root=qs("match-root");
  const params=new URLSearchParams(location.search);
  const id=params.get("id")||params.get("match");
  if(!id){root.innerHTML='<div class="match-error">Missing match id.</div>';return;}

  try{
    const res=await fetch("api/match/"+encodeURIComponent(id),{cache:"no-store"});
    const data=await res.json();
    if(!res.ok||!data.ok)throw new Error(data.error||"match_failed");
    renderMatch(data.match||data);
  }catch(e){
    root.innerHTML='<div class="match-error">Could not load match '+escapeHtml(id)+'.</div>';
  }
}

function renderMatch(m){
  const root=qs("match-root");
  const blue=m.blueTeam||[];
  const red=m.redTeam||[];
  const players=m.player_stats||[];
  const classes=m.class_stats||[];
  const weapons=m.weapon_stats||[];
  const rounds=Array.isArray(m.rounds)?m.rounds:[];
  const roundPlayerStats=Array.isArray(m.round_player_stats)?m.round_player_stats:[];
  const roundMvps=Array.isArray(m.round_mvps)?m.round_mvps:[];
  const matchMvps=Array.isArray(m.match_mvps)?m.match_mvps:[];
  const capTimeline=Array.isArray(m.capTimeline)?m.capTimeline:[];
  const roundSections=rounds.length||roundPlayerStats.length
    ?renderRoundSections(rounds,roundPlayerStats,roundMvps,blue,red,players)
    :"";

  document.title=`${m.id||m.match_id} - Match Detail`;

  const mapName=String(m.map_name||m.map||"Unknown Map");

  root.innerHTML=`
    <section class="match-top">
      <div class="match-top-grid">
        <div class="match-hero">
          <p class="match-kicker">MATCH DETAIL</p>
          <h1 class="match-title">${escapeHtml(m.id||m.match_id||"-")}</h1>
          <div class="match-meta">
            <span>${escapeHtml(formatDate(m.created_at))}</span>
            <span>${escapeHtml(String(m.status||"-").toUpperCase())}</span>
            <span>Winner: ${escapeHtml(String(m.winner||"-"))}</span>
          </div>
        </div>

        <div class="score-card">
          <div class="match-map-wrap">
            <img id="match-map-image" class="match-map-image" alt="Match map preview">
            <div class="match-map-overlay"></div>
          </div>
          <div class="score-content">
            <div class="score-map">${escapeHtml(mapName)}</div>
            <div class="score-row">
              <div class="score-team score-blue ${isBlueWinner(m)?"winner":""}"><span>Team 1</span><strong>${Number(m.score_blue??0)}</strong></div>
              <div class="score-vs">VS</div>
              <div class="score-team score-red ${isRedWinner(m)?"winner":""}"><span>Team 2</span><strong>${Number(m.score_red??0)}</strong></div>
            </div>
            ${renderMatchMvp(matchMvps)}
          </div>
        </div>
      </div>
    </section>

    <div class="match-links">
      ${m.hampalyzer_url?`<a href="${escapeAttr(m.hampalyzer_url)}" target="_blank" rel="noopener noreferrer">Hampalyzer</a>`:""}
      ${m.tfcstats_url?`<a href="${escapeAttr(m.tfcstats_url)}" target="_blank" rel="noopener noreferrer">TFCStats</a>`:""}
      <a href="matches.html">Back to Matches</a>
    </div>

    ${renderCapTimelineCard(capTimeline)}

    ${renderMatchMvpsCard(matchMvps,m.nn_mvp)}

    ${roundSections}

    <div class="match-card">
      <h2>Player Stats</h2>
      <div class="player-teams-grid">
        ${renderPlayerTeam("Team 1",blue,players,classes,weapons,"blue")}
        ${renderPlayerTeam("Team 2",red,players,classes,weapons,"red")}
      </div>
    </div>
  `;

	if (typeof window.setMapImageFromName === "function") {
	  window.setMapImageFromName(qs("match-map-image"), mapName, {
		containerSelector: ".match-map-wrap",
		fallbackSrc: "assets/images/maps/NoMap.webp"
	  });
	}
	  bindRoundTabs(root);
	}

function playerKeys(teamPlayer,stats){
  return [
    teamPlayer.id,
    teamPlayer.discord_id,
    teamPlayer.player_key,
    teamPlayer.steam_id,
    stats&&stats.player_key,
    stats&&stats.steam_id
  ].filter(Boolean).map(String);
}

function findStatsForPlayer(statsRows,teamPlayer){
  const keys=playerKeys(teamPlayer,null);
  const name=String(teamPlayer.name||teamPlayer.display_name||"");

  return statsRows.find(s=>
    keys.includes(String(s.player_key||"")) ||
    keys.includes(String(s.steam_id||"")) ||
    String(s.display_name||"")===name
  ) || null;
}

function rowsForPlayer(rows,teamPlayer,stats){
  const keys=playerKeys(teamPlayer,stats);
  const name=String(teamPlayer.name||teamPlayer.display_name||"");
  const statName=String(stats.display_name||"");

  return rows.filter(r=>
    keys.includes(String(r.player_key||"")) ||
    keys.includes(String(r.steam_id||"")) ||
    String(r.display_name||"")===name ||
    String(r.display_name||"")===statName ||
    matchNormName(r.display_name)===matchNormName(name) ||
    matchNormName(r.display_name)===matchNormName(statName)
  );
}

function normalizeRoundTeam(value){
  const team=String(value||"").trim().toLowerCase().replace(/[\s_-]+/g,"");
  if(team==="1"||team==="blu"||team.includes("team1")||team.includes("blue"))return"team1";
  if(team==="2"||team.includes("team2")||team.includes("red"))return"team2";
  return null;
}

function roundNumbers(rounds,roundPlayerStats){
  return [...new Set([
    ...rounds.map(r=>Number(r.round_num||0)),
    ...roundPlayerStats.map(r=>Number(r.round_num||0))
  ].filter(n=>Number.isFinite(n)&&n>0))].sort((a,b)=>a-b);
}

function roundRowMatchesPlayer(row,teamPlayer,stats){
  const keys=playerKeys(teamPlayer,stats);
  const names=[
    teamPlayer.name,
    teamPlayer.display_name,
    stats?.display_name
  ].filter(Boolean).map(matchNormName);

  return keys.includes(String(row.player_key||"")) ||
    keys.includes(String(row.steam_id||"")) ||
    names.includes(matchNormName(row.display_name));
}

function findRosterPlayerForRoundRow(row,blue,red,statsRows){
  for(const teamPlayer of [...blue,...red]){
    const stats=findStatsForPlayer(statsRows,teamPlayer);
    if(roundRowMatchesPlayer(row,teamPlayer,stats))return teamPlayer;
  }
  return null;
}

function resolveRoundTeam(row,blue,red,statsRows){
  const explicit=normalizeRoundTeam(row.team_name);
  if(explicit)return explicit;

  const rosterPlayer=findRosterPlayerForRoundRow(row,blue,red,statsRows);
  if(!rosterPlayer)return null;
  if(blue.includes(rosterPlayer))return"team1";
  if(red.includes(rosterPlayer))return"team2";
  return null;
}

function roundPlayerLabel(row,blue,red,statsRows){
  const rosterPlayer=findRosterPlayerForRoundRow(row,blue,red,statsRows);
  if(rosterPlayer?.id){
    return `<a href="${escapeAttr(`player.html?id=${encodeURIComponent(rosterPlayer.id)}`)}">${playerLabel(rosterPlayer)}</a>`;
  }
  return escapeHtml(row.display_name||row.player_key||row.steam_id||"-");
}

function topRoundPlayer(rows,field,blue,red,statsRows){
  if(!rows.length)return"-";
  const top=[...rows].sort((a,b)=>Number(b[field]||0)-Number(a[field]||0))[0];
  return `${roundPlayerLabel(top,blue,red,statsRows)} <b>${fmt(top[field])}</b>`;
}

function mvpName(mvp){
  return String(mvp?.mvp_display_name||mvp?.mvp_player_key||mvp?.steam_id||"Unknown");
}

function renderMatchMvp(matchMvps){
  if(!Array.isArray(matchMvps)||!matchMvps.length)return"";
  const names=matchMvps.map(mvp=>escapeHtml(mvpName(mvp)));
  const label=matchMvps.length===1?"Game MVP":"Split MVP";
  return `<div class="match-mvp-pill"><span>🏆 ${label}:</span> <strong>${names.join(" / ")}</strong></div>`;
}

function mvpIdentityValues(row){
  return [
    row?.player_key,
    row?.mvp_player_key,
    row?.steam_id,
    row?.mvp_steam_id,
    row?.display_name,
    row?.mvp_display_name
  ].filter(Boolean).map(value=>matchNormName(value));
}

function mvpAgrees(matchMvps,nnWinner){
  if(!nnWinner||!Array.isArray(matchMvps)||!matchMvps.length)return false;
  const nnValues=new Set(mvpIdentityValues(nnWinner));
  return matchMvps.some(mvp=>mvpIdentityValues(mvp).some(value=>nnValues.has(value)));
}

function renderMvpBadge(){
  return `<img class="match-mvps-icon" src="assets/images/icons/webp/mvp.webp" alt="" loading="lazy">`;
}

function renderUnavailableMvp(title,message){
  return `
    <article class="match-mvp-box unavailable">
      <div class="match-mvp-box-head">
        ${renderMvpBadge()}
        <span>${escapeHtml(title)}</span>
      </div>
      <p class="match-mvp-empty">${escapeHtml(message)}</p>
    </article>
  `;
}

function renderHampalyzerMvpBox(matchMvps){
  if(!Array.isArray(matchMvps)||!matchMvps.length){
    return renderUnavailableMvp("Hampalyzer MVP","Hampalyzer MVP unavailable");
  }

  const label=matchMvps.length===1?"Hampalyzer MVP":"Hampalyzer Split MVP";
  return `
    <article class="match-mvp-box hampalyzer">
      <div class="match-mvp-box-head">
        ${renderMvpBadge()}
        <span>${escapeHtml(label)}</span>
      </div>
      <div class="match-mvp-name">${matchMvps.map(mvp=>escapeHtml(mvpName(mvp))).join(" / ")}</div>
      <div class="match-mvp-desc">Official Hampalyzer selection</div>
    </article>
  `;
}

function mvpScore(value){
  const number=Number(value);
  return Number.isFinite(number)?number.toFixed(1):"-";
}

const NN_MVP_TOOLTIPS={
  score:"Final score is Combat + Objective + Impact + Discipline. Each category is worth up to 25 points, for a max score of 100.",
  combat:"Combat compares your kills, enemy damage, and KDR against the rest of this match.",
  objective:"Objective compares your flag touches, initial touches, captures, and flag time against the rest of this match.",
  impact:"Impact gives credit for high-value plays like conced kills, sentry kills, and flag carrier kills.",
  discipline:"Discipline rewards cleaner play: fewer team kills, suicides, deaths, and team damage."
};

function renderMvpComponent(label,value,tooltip,extraClass=""){
  const scoreText=`${mvpScore(value)}/25`;
  const aria=`${label} score ${scoreText}. ${tooltip}`;
  return `
    <span class="match-mvp-chip ${extraClass}" tabindex="0" title="${escapeAttr(tooltip)}" aria-label="${escapeAttr(aria)}">
      <b>${escapeHtml(label)}</b>
      <strong>${escapeHtml(scoreText)}</strong>
    </span>
  `;
}

function renderNnMvpBox(nnMvp){
  if(!nnMvp||nnMvp.available===false||!nnMvp.winner){
    return renderUnavailableMvp("NoName MVP","NN MVP unavailable");
  }

  const winner=nnMvp.winner;
  const components=winner.display_components||{};
  const displayScore=Number.isFinite(Number(winner.display_score))?winner.display_score:winner.final_score;
  const scoreText=`${mvpScore(displayScore)}/100`;
  const reasons=Array.isArray(winner.reasons)?winner.reasons.slice(0,4):[];

  return `
    <article class="match-mvp-box noname">
      <div class="match-mvp-box-head">
        ${renderMvpBadge()}
        <span>NoName MVP</span>
      </div>
      <div class="match-mvp-name">${escapeHtml(winner.display_name||winner.player_key||winner.steam_id||"Unknown")}</div>
      <div class="match-mvp-score" tabindex="0" title="${escapeAttr(NN_MVP_TOOLTIPS.score)}" aria-label="${escapeAttr(`Score ${scoreText}. ${NN_MVP_TOOLTIPS.score}`)}">Score <strong>${escapeHtml(scoreText)}</strong></div>
      <div class="match-mvp-chips" aria-label="NoName MVP score components">
        ${renderMvpComponent("Combat",components.combat,NN_MVP_TOOLTIPS.combat)}
        ${renderMvpComponent("Objective",components.objective,NN_MVP_TOOLTIPS.objective)}
        ${renderMvpComponent("Impact",components.impact,NN_MVP_TOOLTIPS.impact)}
        ${renderMvpComponent("Discipline",components.discipline,NN_MVP_TOOLTIPS.discipline,"discipline")}
      </div>
      ${reasons.length?`
        <ul class="match-mvp-reasons">
          ${reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join("")}
        </ul>
      `:""}
    </article>
  `;
}

function renderMatchMvpsCard(matchMvps,nnMvp){
  const agrees=mvpAgrees(matchMvps,nnMvp?.winner);
  return `
    <section class="match-card match-mvps-card ${agrees?"agrees":""}">
      <div class="match-mvps-head">
        <h2>Match MVPs</h2>
        <span class="match-mvps-status ${agrees?"agree":"disagree"}">${agrees?"Systems Agree":"Systems Disagree"}</span>
      </div>
      <div class="match-mvps-grid">
        ${renderHampalyzerMvpBox(matchMvps)}
        ${renderNnMvpBox(nnMvp)}
      </div>
    </section>
  `;
}

function capTeamClass(team){
  const normalized=String(team||"").trim().toLowerCase().replace(/[\s_-]+/g,"");
  if(normalized==="1"||normalized==="blu"||normalized.includes("team1")||normalized.includes("blue"))return"blue";
  if(normalized==="2"||normalized.includes("team2")||normalized.includes("red"))return"red";
  return"neutral";
}

function capTeamLabel(team){
  const teamClass=capTeamClass(team);
  if(teamClass==="blue")return"Blue";
  if(teamClass==="red")return"Red";
  return String(team||"Team");
}

function renderCapTimelineCard(capTimeline){
  if(!Array.isArray(capTimeline)||!capTimeline.length)return"";

  const maxSeconds=15*60;
  const events=[...capTimeline].sort((a,b)=>Number(a.time_seconds||0)-Number(b.time_seconds||0));

  return `
    <section class="match-card cap-timeline-card">
      <div class="cap-timeline-head">
        <h2>Flag Pace</h2>
        <span>Capture Timeline</span>
      </div>
      <div class="cap-timeline-bar" aria-label="Capture timeline from 0 to 15 minutes">
        <div class="cap-timeline-track">
          ${events.map(event=>{
			  const seconds=Number(event.time_seconds||0);
			  const left=Math.max(0,Math.min(100,(seconds/maxSeconds)*100));
			  const teamClass=capTeamClass(event.team);
			  const capNum=event.cap_num||"";

			  const capper = event.capper_name || event.capperName || "";

			  const title =
				`${capTeamLabel(event.team)} Capture #${capNum}` +
				(capper ? ` by ${capper}` : "");

			  const ariaLabel=[
				title,
				event.time_text||matchFormatSeconds(event.time_seconds),
				event.score_after?`Score ${event.score_after}`:""
			  ].filter(Boolean).join(" ");

			  const icon=teamClass==="red"
				?"assets/images/icons/webp/red-flag.webp"
				:"assets/images/icons/webp/blue-flag.webp";
            return `
              <span
                class="cap-marker ${teamClass}"
                style="left:${left}%"
                title="${escapeAttr(title)}"
                aria-label="${escapeAttr(ariaLabel)}"
              >
                <img src="${escapeAttr(icon)}" alt="" loading="lazy" aria-hidden="true">
                <span class="cap-marker-badge">${escapeHtml(capNum)}</span>
              </span>
            `;
          }).join("")}
        </div>
        <div class="cap-timeline-axis">
          <span>0:00</span>
          <span>5:00</span>
          <span>10:00</span>
          <span>15:00</span>
        </div>
      </div>
      <div class="cap-event-list">
		  ${events.map(event=>{
			const capper = event.capper_name || event.capperName || "";
			return `
			  <div class="cap-event ${capTeamClass(event.team)}">
				<span class="cap-event-dot"></span>
				<div class="cap-event-main">
				  <div class="cap-event-header">
					<strong>${escapeHtml(capTeamLabel(event.team))} Cap ${fmt(event.cap_num)}</strong>
					<span>${escapeHtml(event.time_text||matchFormatSeconds(event.time_seconds))}</span>
				  </div>
				  ${capper ? `<div class="cap-event-capper">${escapeHtml(capper)}</div>` : ""}
				</div>
			  </div>
			`;
		  }).join("")}
		</div>
    </section>
  `;
}

function roundMvpForPlayer(row,roundNum,roundMvps){
  return roundMvps.some(mvp=>
    Number(mvp.round_num||0)===Number(roundNum||0) &&
    (
      (mvp.mvp_player_key&&String(mvp.mvp_player_key)===String(row.player_key||"")) ||
      (mvp.steam_id&&String(mvp.steam_id)===String(row.steam_id||"")) ||
      (
        matchNormName(mvp.mvp_display_name) &&
        matchNormName(mvp.mvp_display_name)===matchNormName(row.display_name)
      )
    )
  );
}

function renderRoundMvpLabel(roundNum,roundMvps){
  const rows=roundMvps.filter(mvp=>Number(mvp.round_num||0)===Number(roundNum||0));
  if(!rows.length)return"";
  return `<div class="round-mvp-label">⭐ ${rows.map(mvp=>escapeHtml(mvpName(mvp))).join(" / ")}</div>`;
}

function renderRoundSections(rounds,roundPlayerStats,roundMvps,blue,red,statsRows){
  const numbers=roundNumbers(rounds,roundPlayerStats);
  if(!numbers.length)return"";

  const roundsByNumber=new Map(rounds.map(r=>[Number(r.round_num||0),r]));
  const statsByRound=new Map(numbers.map(n=>[
    n,
    roundPlayerStats.filter(r=>Number(r.round_num||0)===n)
  ]));
  const firstRound=numbers[0];

  return `
    <section class="match-card round-overview-card">
      <h2>Round Overview</h2>
      <div class="round-overview-grid">
        ${numbers.map(number=>renderRoundOverviewCard(
          number,
          roundsByNumber.get(number)||{},
          statsByRound.get(number)||[],
          roundMvps,
          blue,
          red,
          statsRows
        )).join("")}
      </div>
    </section>

    <section class="match-card round-details-card">
      <div class="round-details-head">
        <h2>Round Details</h2>
        <div class="round-tabs" role="tablist" aria-label="Match rounds">
          ${numbers.map(number=>`
            <button
              type="button"
              class="round-tab ${number===firstRound?"active":""}"
              data-round-tab="${escapeAttr(number)}"
              role="tab"
              aria-selected="${number===firstRound?"true":"false"}"
            >Round ${number}</button>
          `).join("")}
        </div>
      </div>
      <div class="round-detail-panels">
        ${numbers.map(number=>renderRoundDetail(
          number,
          statsByRound.get(number)||[],
          roundMvps,
          blue,
          red,
          statsRows,
          number===firstRound
        )).join("")}
      </div>
    </section>
  `;
}

function renderRoundOverviewCard(number,round,rows,roundMvps,blue,red,statsRows){
  const duration=Number(round.duration_seconds||0);
  const sideParts=[];
  if(round.offense_team)sideParts.push(`Offense: ${round.offense_team}`);
  if(round.defense_team)sideParts.push(`Defense: ${round.defense_team}`);

  return `
    <article class="round-overview-item">
      <div class="round-overview-head">
        <strong>Round ${number}</strong>
        <span>${escapeHtml(round.map_name||"")}</span>
      </div>
      ${renderRoundMvpLabel(number,roundMvps)}
      <div class="round-score">
        <div class="team1"><span>Team 1</span><b>${fmt(round.team1_score)}</b></div>
        <i>-</i>
        <div class="team2"><span>Team 2</span><b>${fmt(round.team2_score)}</b></div>
      </div>
      <div class="round-meta">
        <span>Duration: <b>${duration?matchFormatSeconds(duration):"-"}</b></span>
        ${sideParts.length?`<span>${escapeHtml(sideParts.join(" / "))}</span>`:""}
      </div>
      <div class="round-leaders">
        <div><span>Top Kills</span><strong>${topRoundPlayer(rows,"kills",blue,red,statsRows)}</strong></div>
        <div><span>Top Damage</span><strong>${topRoundPlayer(rows,"enemy_damage",blue,red,statsRows)}</strong></div>
      </div>
    </article>
  `;
}

function renderRoundDetail(number,rows,roundMvps,blue,red,statsRows,isActive){
  const grouped={team1:[],team2:[],unknown:[]};
  for(const row of rows){
    const team=resolveRoundTeam(row,blue,red,statsRows);
    grouped[team||"unknown"].push(row);
  }

  return `
    <div
      class="round-detail-panel ${isActive?"active":""}"
      data-round-panel="${escapeAttr(number)}"
      role="tabpanel"
      ${isActive?"":"hidden"}
    >
      <div class="round-team-tables">
        ${renderRoundTeamTable("Team 1",grouped.team1,"blue",number,roundMvps,blue,red,statsRows)}
        ${renderRoundTeamTable("Team 2",grouped.team2,"red",number,roundMvps,blue,red,statsRows)}
      </div>
      ${grouped.unknown.length
        ?`<div class="round-unassigned">${renderRoundTeamTable("Unassigned",grouped.unknown,"neutral",number,roundMvps,blue,red,statsRows)}</div>`
        :""}
    </div>
  `;
}

function renderRoundTeamTable(title,rows,color,roundNum,roundMvps,blue,red,statsRows){
  return `
    <section class="round-team-table ${color}">
      <div class="round-team-title">
        <span>${escapeHtml(title)}</span>
        <span>${rows.length} Players</span>
      </div>
      <div class="round-table-scroll">
        <table class="round-stats-table">
          <thead>
            <tr>
              <th>Player</th>
              <th>Role</th>
              <th>K</th>
              <th title="Enemy / team / suicide deaths">Deaths E/T/S</th>
              <th>Dmg</th>
              <th>Team Dmg</th>
              <th title="Conced kills">CK</th>
              <th title="Sentry kills">SG</th>
              <th title="Concussion jumps">CJ</th>
              <th>Caps</th>
              <th>Touches</th>
              <th>Flag Time</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length
              ?[...rows]
                .sort((a,b)=>Number(b.kills||0)-Number(a.kills||0))
                .map(row=>renderRoundPlayerRow(row,roundNum,roundMvps,blue,red,statsRows))
                .join("")
              :'<tr><td colspan="12" class="round-table-empty">No round stats</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRoundPlayerRow(row,roundNum,roundMvps,blue,red,statsRows){
  const isMvp=roundMvpForPlayer(row,roundNum,roundMvps);
  return `
    <tr class="${isMvp?"round-mvp-row":""}">
      <td class="round-player-name">${isMvp?'<span class="round-mvp-star" title="Round MVP">⭐</span>':""}${roundPlayerLabel(row,blue,red,statsRows)}</td>
      <td>${escapeHtml(row.role||"-")}</td>
      <td>${fmt(row.kills)}</td>
      <td>${fmt(row.deaths_by_enemy)}/${fmt(row.deaths_by_team)}/${fmt(row.suicides)}</td>
      <td>${fmt(row.enemy_damage)}</td>
      <td>${fmt(row.team_damage)}</td>
      <td>${fmt(row.conced_kills)}</td>
      <td>${fmt(row.sentry_kills)}</td>
      <td>${fmt(row.conc_jumps)}</td>
      <td>${fmt(row.flag_captures)}</td>
      <td>${fmt(row.flag_touches)}</td>
      <td>${matchFormatSeconds(row.flag_time_seconds)}</td>
    </tr>
  `;
}

function bindRoundTabs(root){
  if(root.dataset.roundTabsBound==="1")return;
  root.dataset.roundTabsBound="1";

  root.addEventListener("click",event=>{
    const tab=event.target.closest("[data-round-tab]");
    if(!tab||!root.contains(tab))return;

    const round=String(tab.dataset.roundTab||"");
    root.querySelectorAll("[data-round-tab]").forEach(button=>{
      const active=String(button.dataset.roundTab||"")===round;
      button.classList.toggle("active",active);
      button.setAttribute("aria-selected",active?"true":"false");
    });
    root.querySelectorAll("[data-round-panel]").forEach(panel=>{
      const active=String(panel.dataset.roundPanel||"")===round;
      panel.classList.toggle("active",active);
      panel.hidden=!active;
    });
  });
}

function renderPlayerTeam(title,teamRows,statsRows,classRows,weaponRows,color){
  return `
    <div class="player-team-card ${color}">
      <div class="player-team-head">
        <span>${escapeHtml(title)}</span>
        <span>${teamRows.length} Players</span>
      </div>
      ${teamRows.map(p=>renderMatchPlayer(p,statsRows,classRows,weaponRows)).join("")||'<div class="match-player-card">No players</div>'}
    </div>
  `;
}

function renderMatchPlayer(teamPlayer,statsRows,classRows,weaponRows){
  const name=String(teamPlayer.name||teamPlayer.display_name||"");
  const stats=findStatsForPlayer(statsRows,teamPlayer)||{};
  const classes=rowsForPlayer(classRows,teamPlayer,stats).sort((a,b)=>Number(b.seconds||0)-Number(a.seconds||0));
  const weapons=rowsForPlayer(weaponRows,teamPlayer,stats).sort((a,b)=>Number(b.kills||0)-Number(a.kills||0));
  const d=Number(teamPlayer.delta||0);

  return `
    <div class="match-player-card">
      <div class="match-player-top">
        <a href="${escapeAttr(`player.html?id=${encodeURIComponent(teamPlayer.id)}`)}">${playerLabel(teamPlayer)}${pageSupporterBadge(teamPlayer.id)}</a>
        <b class="${d>0?"delta-pos":d<0?"delta-neg":""}">${deltaText(d)}</b>
      </div>

      <div class="match-player-kpis">
        <div><span>Kills</span><strong>${fmt(stats.kills)}</strong></div>
        <div><span>Deaths</span><strong>${fmt(stats.deaths)}</strong></div>
        <div><span>Caps</span><strong>${fmt(stats.caps)}</strong></div>
        <div><span>Damage</span><strong>${fmt(stats.damage)}</strong></div>
      </div>

      <div class="match-subgrid">
        <div class="match-mini-box">
          <div class="match-mini-title">Classes Played</div>
          ${classes.length?classes.map(c=>`
            <div class="match-mini-row"><span>${escapeHtml(className(c.class_name))}</span><b>${matchFormatSeconds(c.seconds)}</b></div>
          `).join(""):'<div class="match-mini-row"><span>-</span><b>-</b></div>'}
        </div>

        <div class="match-mini-box">
          <div class="match-mini-title">Weapons Used</div>
          ${weapons.length?weapons.map(w=>`
            <div class="match-mini-row">
              <span class="weapon-cell"><i class="weapon-icon ${escapeAttr(w.weapon||"")}"></i><span>${escapeHtml(matchWeaponName(w.weapon||"-"))}</span></span>
              <b>${fmt(w.kills)}</b>
            </div>
          `).join(""):'<div class="match-mini-row"><span>-</span><b>-</b></div>'}
        </div>
      </div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded",loadMatch);
