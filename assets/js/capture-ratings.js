"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const $ = id => document.getElementById(`capture-${id}`);
  if (!$("map")) return;
  let maps = [], view = "overview", selected = null, descending = true;
  let eligiblePlayers = [];
  const picker = window.nnRatings.createPlayerPicker('capture', () => eligiblePlayers, () => selected, player => { selected = String(player.id); render(); });
  const fmt = value => Number.isFinite(value) ? value.toFixed(2) : "—";
  const signed = value => Number.isFinite(value) ? `${value >= 0.005 ? "+" : value <= -0.005 ? "−" : ""}${fmt(Math.abs(value))}` : "—";
  const tone = value => value >= 0.005 ? "capture-positive" : value <= -0.005 ? "capture-negative" : "capture-neutral";
  const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = value => typeof value === "number" && Number.isFinite(value);
  const svg = (body, label) => `<svg viewBox="0 0 420 180" role="img" aria-label="${escape(label)}">${body}</svg>`;
  const sample = games => games >= 50 ? {key:'extensive', label:'Extensive sample'} : games >= 25 ? {key:'established', label:'Established sample'} : games >= 10 ? {key:'developing', label:'Developing sample'} : {key:'limited', label:'Limited sample'};
  const badge = games => { const tier = sample(games); return `<span class="capture-sample" data-sample="${tier.key}" title="Sample size only; not formal statistical confidence">${tier.label}</span>`; };
  const profile = player => `<a href="player.html?id=${encodeURIComponent(player.id)}">${escape(player.player)}</a>`;
  // Competition ranks share positions for exact ties, with gaps after a tie.
  const rank = (players, player, field) => 1 + players.filter(other => other[field] > player[field]).length;
  function comparison(value, label, scale) {
    return `<div class="capture-bar-row" title="${label}: ${signed(value)} relative to map average"><span>${label[0]}</span><div class="capture-bar-track" aria-hidden="true"><i class="${tone(value)}" style="left:${value<0?50-Math.abs(value)/scale*50:50}%;width:${Math.abs(value)/scale*50}%"></i></div><b class="${tone(value)}">${signed(value)}</b></div>`;
  }
  function charts(map) {
    const observations = (map.observations || []).filter(o => num(o.blueCaps) && num(o.redCaps));
    $("trend-raw-legend").hidden = !$("trend-raw").checked;
    $("trend-rolling-legend").hidden = !$("trend-rolling").checked;
    if (!observations.length) {
      $("trend-order").textContent = "No match observations";
      [$("distribution"), $("trend")].forEach(el => { el.innerHTML = '<p class="capture-empty">Match observations are unavailable for this map.</p>'; });
      return;
    }
    const caps = observations.flatMap(o => [o.blueCaps, o.redCaps]);
    const max = Math.max(...caps), step = Math.max(1, Math.ceil((max + 1) / 8));
    const bins = Array.from({length: Math.max(1, Math.ceil((max + 1) / step))}, (_, i) => ({lo:i * step, count:0}));
    caps.forEach(c => bins[Math.floor(c / step)].count++);
    const peak = Math.max(...bins.map(b => b.count), 1), width = 350 / bins.length;
    let bars = '<line x1="45" y1="145" x2="405" y2="145" class="capture-axis"/>';
    for (let i = 0; i <= 2; i++) { const count = peak * i / 2, y = 145 - i * 60; bars += `<line x1="45" y1="${y}" x2="405" y2="${y}" class="capture-grid"/><text x="38" y="${y + 4}" text-anchor="end">${Math.round(count / caps.length * 100)}%</text>`; }
    bins.forEach((b,i) => { const h = b.count / peak * 120, x = 50 + i * width; bars += `<rect tabindex="0" x="${x}" y="${145-h}" width="${Math.max(width-10,4)}" height="${h}" class="capture-histogram"><title>${b.lo}${step > 1 ? `–${b.lo+step-1}` : ''} captures: ${b.count} team games (${(b.count/caps.length*100).toFixed(1)}%)</title></rect><text x="${x+(width-10)/2}" y="164" text-anchor="middle">${b.lo}${step>1 ? `–${b.lo+step-1}`:''}</text>`; });
    $("distribution").innerHTML = svg(bars, `Capture distribution across ${caps.length} team games; horizontal axis captures, vertical axis percentage`);
    const timestamp = o => typeof o.createdAt === 'number' && Number.isFinite(o.createdAt) ? o.createdAt * 1000 : Date.parse(o.createdAt);
    const dated = observations.every(o => Number.isFinite(timestamp(o)));
    const byMatch = (a,b) => String(a.matchId).localeCompare(String(b.matchId),undefined,{numeric:true});
    const ordered = observations.slice().sort((a,b) => dated ? timestamp(a)-timestamp(b) || byMatch(a,b) : byMatch(a,b));
    $("trend-order").textContent = dated ? 'Chronological match order' : 'Match ID order · timestamps incomplete';
    // Each point aggregates both teams in one match; no player observations are connected.
    const values = ordered.map(o => (o.blueCaps+o.redCaps)/2), top = Math.max(...values,map.average,1)*1.12;
    const x = i => ordered.length === 1 ? 225 : 45+i/(ordered.length-1)*355;
    const y = v => 145-v/top*120;
    let line = '';
    for (let i=0;i<=3;i++) {const v=top*i/3;line+=`<line x1="45" y1="${y(v)}" x2="405" y2="${y(v)}" class="capture-grid"/><text x="38" y="${y(v)+4}" text-anchor="end">${v.toFixed(1)}</text>`;}
    line += `<line x1="45" y1="${y(map.average)}" x2="405" y2="${y(map.average)}" class="capture-baseline"><title>Map baseline: ${fmt(map.average)} captures per team game</title></line>`;
    const rolling = values.map((_,i) => { const window = values.slice(Math.max(0,i-4),i+1); return window.reduce((total,value)=>total+value,0)/window.length; });
    if ($("trend-rolling").checked) {
      line += `<polyline points="${rolling.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" class="capture-rolling-line" aria-label="Trailing 5-match rolling average with partial initial windows"/>`;
      ordered.forEach((o,i) => { const description = `Match ${o.matchId}: rolling mean ${fmt(rolling[i])} caps/team across ${Math.min(i+1,5)} completed matches`;
        line += `<circle tabindex="0" cx="${x(i)}" cy="${y(rolling[i])}" r="3" class="capture-rolling-point" aria-label="${escape(description)}"><title>${escape(description)}</title></circle>`; });
    }
    if ($("trend-raw").checked) ordered.forEach((o,i) => { const description = `Match ${o.matchId} · ${Number.isFinite(timestamp(o)) ? new Date(timestamp(o)).toLocaleDateString() : 'date unavailable'}: ${fmt(values[i])} caps/team (blue ${o.blueCaps}, red ${o.redCaps})`;
      line += `<circle tabindex="0" cx="${x(i)}" cy="${y(values[i])}" r="3.5" class="capture-trend-point" aria-label="${escape(description)}"><title>${escape(description)}</title></circle>`; });
    line += `<text x="45" y="165">Match 1</text><text x="405" y="165" text-anchor="end">Match ${ordered.length}</text>`;
    $("trend").innerHTML = svg(line, `${ordered.length} completed matches in ${dated ? "chronological" : "match ID"} order, captures per team game. Map baseline ${fmt(map.average)}.`);
  }
  function setView() {
    document.querySelectorAll('[data-capture-view]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.captureView === view)));
    $("context").hidden = !["overview","players"].includes(view);
    $("leaderboard").hidden = !["overview","players"].includes(view);
    $("distribution-panel").hidden = !["overview","distribution"].includes(view);
    $("trends-panel").hidden = !["overview","trends"].includes(view);
    $("dashboard").dataset.view = view;
  }
  function context(map, players) {
    const player = players.find(p => String(p.id) === selected) || players[0];
    selected = player ? String(player.id) : null;
    picker.dismiss();
    $("player").disabled = !player;
    if (!player) { $("equations").innerHTML = '<p class="capture-empty">Choose a lower minimum to inspect player ratings.</p>'; return; }
    const scale = Math.max(...players.flatMap(p => [Math.abs(p.offense),Math.abs(p.defense)]),0.01);
    const offenseRank = rank(players,player,'offense'), defenseRank = rank(players,player,'defense');
    $("equations").innerHTML = `<div id="capture-spotlight"><div class="capture-spotlight-identity"><div>${profile(player)}<span>${player.games.toLocaleString()} eligible games · ${players.length} qualifying players</span></div>${badge(player.games)}</div><div class="capture-spotlight-ratings"><div><span>Offense</span><strong class="${tone(player.offense)}">${signed(player.offense)}</strong><small>Rank #${offenseRank} of ${players.length} qualifying</small></div><div><span>Defense</span><strong class="${tone(player.defense)}">${signed(player.defense)}</strong><small>Rank #${defenseRank} of ${players.length} qualifying</small></div><div><span>Net rating</span><strong class="${tone(player.net)}">${signed(player.net)}</strong><small>Team differential</small></div></div><div class="capture-spotlight-bars">${comparison(player.offense,'Offense',scale)}${comparison(player.defense,'Defense',scale)}</div><div class="capture-spotlight-baseline"><span>Scored <b>${fmt(player.scored)}</b></span><span>Baseline <b>${fmt(map.average)}</b></span><span>Conceded <b>${fmt(player.conceded)}</b></span></div><details class="capture-formulas"><summary>Calculations &amp; sample context</summary><p>Offense: ${fmt(player.scored)} scored − ${fmt(map.average)} baseline = <b class="${tone(player.offense)}">${signed(player.offense)}</b><br>Defense: ${fmt(map.average)} baseline − ${fmt(player.conceded)} conceded = <b class="${tone(player.defense)}">${signed(player.defense)}</b><br>Net: ${signed(player.offense)} + (${signed(player.defense)}) = <b class="${tone(player.net)}">${signed(player.net)}</b></p><p>Caps per game are team-result associations across this player’s ${player.games} eligible games, not individual impact. Sample labels describe size, not statistical confidence. Ranks share places for equal ratings.</p></details></div>`;
    document.querySelectorAll('#capture-rows tr').forEach(row => row.classList.toggle('is-selected',row.dataset.player === selected));
  }
  function render() {
    const map = maps.find(m => m.map === $("map").value);
    if (!map) return;
    const players = map.players.filter(p => p.games >= Number($("minimum").value)).map(p => ({...p,net:p.offense+p.defense}));
    const key = $("sort").value;
    players.sort((a,b) => (key === 'player' ? a.player.localeCompare(b.player) : a[key]-b[key])*(descending?-1:1) || b.games-a.games || a.player.localeCompare(b.player));
    const games = players.reduce((total,p) => total+p.games,0);
    const leader = field => players.slice().sort((a,b) => b[field]-a[field] || b.games-a.games || a.player.localeCompare(b.player))[0];
    const topOffense = leader('offense'), topDefense = leader('defense'), experienced = leader('games');
    const leaderKpi = (title,player,field,kind) => `<article class="capture-kpi capture-kpi-${kind}"><h3>${title}<small>${player ? `${player.games.toLocaleString()} eligible games` : 'No qualifying players'}</small></h3><strong class="${field==='games' ? '' : tone(player?.[field])}">${player ? field==='games' ? player.games.toLocaleString() : signed(player[field]) : '—'}</strong><span class="capture-kpi-player">${player ? profile(player) : 'Adjust player filters'}</span>${player ? badge(player.games) : ''}${player && players.filter(p=>p[field]===player[field]).length>1 ? '<small class="capture-kpi-tie">Shared lead · games, then name break display ties</small>' : ''}</article>`;
    $("summary").textContent = `${map.map} · ${map.games.toLocaleString()} eligible matches · ${players.length.toLocaleString()} qualifying players · ${games.toLocaleString()} player-game observations in this filtered player set.`;
    $("dashboard").hidden = false;
    $("kpis").innerHTML = `<article class="capture-map-card"><img id="capture-map-image" src="assets/images/maps/NoMap.webp" alt=""/><div><strong>${escape(map.map)}</strong><span>${map.games.toLocaleString()} eligible matches · ${players.length} qualifying players</span></div></article><article class="capture-kpi capture-kpi-baseline"><h3>Map baseline <small>All eligible teams</small></h3><strong>${fmt(map.average)}</strong><span>captures / team game</span></article>${leaderKpi('Top offense',topOffense,'offense','offense')}${leaderKpi('Top defense',topDefense,'defense','defense')}${leaderKpi('Most experienced',experienced,'games','experience')}`;
    const image = $("map-image");
    if (window.setMapImageFromName) window.setMapImageFromName(image,map.map,{fallbackSrc:'assets/images/maps/NoMap.webp'});
    else { image.src=`assets/images/maps/${encodeURIComponent(map.map)}.webp`; image.onerror=()=>{image.onerror=null;image.src='assets/images/maps/NoMap.webp';}; }
    eligiblePlayers = players;
    const query = $("search").value.trim().toLocaleLowerCase();
    const matches = players.filter(p => p.player.toLocaleLowerCase().includes(query));
    $("player-count").textContent = query ? `(${matches.length} matching / ${players.length} qualifying)` : `(${players.length})`;
    $("search-clear").disabled = !$("search").value;
    $("empty").hidden = !!matches.length;
    $("empty").textContent = query && players.length ? 'No players match your search. Clear the search or try part of another name.' : 'No players meet these filters. Lower the minimum or choose another map.';
    $("rows").replaceChildren();
    const scale = Math.max(...players.flatMap(p => [Math.abs(p.offense),Math.abs(p.defense)]),0.01);
    players.forEach((p,i) => { if (!matches.includes(p)) return; const row=document.createElement('tr'); row.dataset.player=String(p.id); row.classList.toggle('is-top-performer', ['offense','defense','net'].includes(key) && rank(players,p,key)===1); row.innerHTML=`<td>${i+1}</td><td><a href="player.html?id=${encodeURIComponent(p.id)}">${escape(p.player)}</a><button class="capture-inspect" type="button" aria-label="Inspect ${escape(p.player)} ratings">Inspect</button></td><td>${p.games.toLocaleString()}${badge(p.games)}</td><td>${fmt(p.scored)}</td><td class="${tone(p.offense)}">${signed(p.offense)}</td><td>${fmt(p.conceded)}</td><td class="${tone(p.defense)}">${signed(p.defense)}</td><td class="${tone(p.net)}">${signed(p.net)}</td><td class="capture-bars">${comparison(p.offense,'Offense',scale)}${comparison(p.defense,'Defense',scale)}</td>`;row.addEventListener('click',event=>{if(event.target.closest('a'))return;selected=String(p.id);context(map,players);});$("rows").appendChild(row); });
    document.querySelectorAll('[data-capture-sort]').forEach(th=>th.setAttribute('aria-sort',th.dataset.captureSort===key ? descending?'descending':'ascending':'none'));
    context(map,players); charts(map); setView();
  }
  [$("map"),$("minimum")].forEach(el=>el.addEventListener('change',render));
  $("search").addEventListener('input', render);
  $("search-clear").addEventListener('click', () => { $("search").value = ''; render(); $("search").focus(); });
  [$("trend-raw"),$("trend-rolling")].forEach(el=>el.addEventListener('change',()=>{const map=maps.find(m=>m.map===$("map").value);if(map)charts(map);}));
  $("sort").addEventListener('change',()=>{descending=$("sort").value!=='player';render();});
  document.querySelectorAll('[data-capture-sort]').forEach(th=>th.querySelector('button').addEventListener('click',()=>{descending=$("sort").value===th.dataset.captureSort ? !descending : th.dataset.captureSort!=='player';$("sort").value=th.dataset.captureSort;render();}));
  document.querySelectorAll('[data-capture-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.captureView;setView();}));
  const descriptions={offense:'Team captures scored per game minus the map average. Higher is better.',defense:'Map average minus team captures conceded per game. Higher is better.',net:'Offense plus defense: the player’s teams’ average capture differential, not individual impact.'};
  Object.entries(descriptions).forEach(([key,description])=>{document.querySelector(`[data-capture-sort="${key}"] button`).title=description;});
  let loading=false,pendingRefresh=false,refreshTimer;
  async function loadCapture() {
    if(loading)return;loading=true;
    try {
      const response=await window.nnHelpers.fetchJSON('/api/stats/capture-ratings');
      if(!response?.ok || !Array.isArray(response.data))throw new Error('Invalid response');
      const currentMap=$('map').value;
      maps=response.data;
      $('map').replaceChildren(...maps.map(m=>new Option(`${m.map} (${m.games} matches)`,m.map)));
      if(maps.some(m=>m.map===currentMap))$('map').value=currentMap;
      if(!maps.length){$('map').add(new Option('No eligible maps',''));$('summary').textContent='No matches have complete capture records yet.';return;}
      $('map').disabled=false;render();
    } catch(error) {
      if(maps.length)return;
      $('map').replaceChildren(new Option('Unavailable',''));$('summary').textContent='Capture ratings could not be loaded. Refresh the page to try again.';
    } finally {loading=false;}
  }
  document.addEventListener('nn:analytics-updated',()=>{
    pendingRefresh=true;clearTimeout(refreshTimer);
    // Recheck after the capture endpoint's ten-second cache expires, once per
    // changed report rather than on every lightweight live check.
    refreshTimer=setTimeout(()=>{if(!document.hidden){pendingRefresh=false;loadCapture();}},11000);
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&pendingRefresh){pendingRefresh=false;loadCapture();}});
  await loadCapture();
});
