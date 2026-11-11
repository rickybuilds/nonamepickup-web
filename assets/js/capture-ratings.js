"use strict";
document.addEventListener("DOMContentLoaded", async () => {
  const $ = id => document.getElementById(`capture-${id}`);
  if (!$("map")) return;
  let maps = [], view = "overview", selected = null, descending = true;
  const fmt = value => Number.isFinite(value) ? value.toFixed(2) : "—";
  const signed = value => Number.isFinite(value) ? `${value >= 0.005 ? "+" : value <= -0.005 ? "−" : ""}${fmt(Math.abs(value))}` : "—";
  const tone = value => value >= 0.005 ? "capture-positive" : value <= -0.005 ? "capture-negative" : "capture-neutral";
  const escape = value => String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num = value => typeof value === "number" && Number.isFinite(value);
  const svg = (body, label) => `<svg viewBox="0 0 420 180" role="img" aria-label="${escape(label)}">${body}</svg>`;
  function charts(map) {
    const observations = (map.observations || []).filter(o => num(o.blueCaps) && num(o.redCaps));
    if (!observations.length) {
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
    const ordered = observations.filter(o => Number.isFinite(timestamp(o))).sort((a,b) => timestamp(a)-timestamp(b) || String(a.matchId).localeCompare(String(b.matchId),undefined,{numeric:true}));
    if (!ordered.length) { $("trend").innerHTML = '<p class="capture-empty">Dated match observations are unavailable for this map.</p>'; return; }
    // Each point aggregates both teams in one match; no player observations are connected.
    const values = ordered.map(o => (o.blueCaps+o.redCaps)/2), top = Math.max(...values,map.average,1)*1.12;
    const x = i => ordered.length === 1 ? 225 : 45+i/(ordered.length-1)*355;
    const y = v => 145-v/top*120;
    let line = '';
    for (let i=0;i<=3;i++) {const v=top*i/3;line+=`<line x1="45" y1="${y(v)}" x2="405" y2="${y(v)}" class="capture-grid"/><text x="38" y="${y(v)+4}" text-anchor="end">${v.toFixed(1)}</text>`;}
    line += `<line x1="45" y1="${y(map.average)}" x2="405" y2="${y(map.average)}" class="capture-baseline"><title>Map baseline: ${fmt(map.average)} captures per team game</title></line>`;
    line += `<polyline points="${values.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" class="capture-trend-line"/>`;
    ordered.forEach((o,i) => { line += `<circle tabindex="0" cx="${x(i)}" cy="${y(values[i])}" r="3.5" class="capture-trend-point"><title>Match ${escape(o.matchId)}${o.createdAt ? ` · ${escape(new Date(timestamp(o)).toLocaleDateString())}`:''}: ${fmt(values[i])} caps/team (blue ${o.blueCaps}, red ${o.redCaps})</title></circle>`; });
    line += `<text x="45" y="165">Match 1</text><text x="405" y="165" text-anchor="end">Match ${ordered.length}</text>`;
    $("trend").innerHTML = svg(line, `${ordered.length} completed matches, captures per team game. Map baseline ${fmt(map.average)}.`);
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
    $("player").value = selected || "";
    $("player").disabled = !player;
    if (!player) { $("equations").innerHTML = '<p class="capture-empty">Choose a lower minimum to inspect player ratings.</p>'; return; }
    $("equations").innerHTML = `<div class="capture-equation"><div><strong>Offense rating</strong><small>Team scored − map baseline</small></div><span>${fmt(player.scored)} − ${fmt(map.average)} =</span><b class="${tone(player.offense)}">${signed(player.offense)}</b></div><div class="capture-equation"><div><strong>Defense rating</strong><small>Map baseline − team conceded</small></div><span>${fmt(map.average)} − ${fmt(player.conceded)} =</span><b class="${tone(player.defense)}">${signed(player.defense)}</b></div>`;
    document.querySelectorAll('#capture-rows tr').forEach(row => row.classList.toggle('is-selected',row.dataset.player === selected));
  }
  function render() {
    const map = maps.find(m => m.map === $("map").value);
    if (!map) return;
    const players = map.players.filter(p => p.games >= Number($("minimum").value)).map(p => ({...p,net:p.offense+p.defense}));
    const key = $("sort").value;
    players.sort((a,b) => (key === 'player' ? a.player.localeCompare(b.player) : a[key]-b[key])*(descending?-1:1) || b.games-a.games || a.player.localeCompare(b.player));
    const games = players.reduce((total,p) => total+p.games,0);
    const weighted = field => games ? players.reduce((total,p) => total+p[field]*p.games,0)/games : NaN;
    const offense = weighted('offense'), defense = weighted('defense');
    $("summary").textContent = `${map.games.toLocaleString()} eligible matches · ${players.length.toLocaleString()} qualifying players · population averages weighted across ${games.toLocaleString()} player-game observations.`;
    $("dashboard").hidden = false;
    $("kpis").innerHTML = `<article class="capture-map-card"><img id="capture-map-image" src="assets/images/maps/NoMap.webp" alt=""/><div><strong>${escape(map.map)}</strong><span>${map.games.toLocaleString()} eligible matches</span></div></article><article class="capture-kpi"><h3>Map average <small>All teams · baseline</small></h3><strong>${fmt(map.average)}</strong><span>captures / team game</span></article><article class="capture-kpi"><h3>Player population <small>${players.length} qualifying players</small></h3><strong>${fmt(weighted('scored'))}</strong><span>team caps / player game</span></article><article class="capture-kpi"><h3>Offense rating <small>Population · game weighted</small></h3><strong class="${tone(offense)}">${signed(offense)}</strong><span>${fmt(weighted('scored'))} scored vs. ${fmt(map.average)} baseline</span></article><article class="capture-kpi"><h3>Defense rating <small>Population · game weighted</small></h3><strong class="${tone(defense)}">${signed(defense)}</strong><span>${fmt(weighted('conceded'))} conceded vs. ${fmt(map.average)}</span></article>`;
    const image = $("map-image");
    if (window.setMapImageFromName) window.setMapImageFromName(image,map.map,{fallbackSrc:'assets/images/maps/NoMap.webp'});
    else { image.src=`assets/images/maps/${encodeURIComponent(map.map)}.webp`; image.onerror=()=>{image.onerror=null;image.src='assets/images/maps/NoMap.webp';}; }
    $("player").replaceChildren(...players.map(p => new Option(p.player,String(p.id))));
    $("player-count").textContent = `(${players.length})`;
    $("empty").hidden = !!players.length;
    $("rows").replaceChildren();
    const scale = Math.max(...players.flatMap(p => [Math.abs(p.offense),Math.abs(p.defense)]),0.01);
    const bar = (value,label) => `<div class="capture-bar-row" title="${label}: ${signed(value)} relative to map average"><span>${label[0]}</span><div class="capture-bar-track"><i class="${tone(value)}" style="left:${value<0?50-Math.abs(value)/scale*50:50}%;width:${Math.abs(value)/scale*50}%"></i></div><b class="${tone(value)}">${signed(value)}</b></div>`;
    players.forEach((p,i) => { const row=document.createElement('tr'); row.dataset.player=String(p.id); row.innerHTML=`<td>${i+1}</td><td><a href="player.html?id=${encodeURIComponent(p.id)}">${escape(p.player)}</a><button class="capture-inspect" type="button" aria-label="Inspect ${escape(p.player)} ratings">Inspect</button></td><td>${p.games.toLocaleString()}</td><td>${fmt(p.scored)}</td><td class="${tone(p.offense)}">${signed(p.offense)}</td><td>${fmt(p.conceded)}</td><td class="${tone(p.defense)}">${signed(p.defense)}</td><td class="${tone(p.net)}">${signed(p.net)}</td><td class="capture-bars">${bar(p.offense,'Offense')}${bar(p.defense,'Defense')}</td>`;row.addEventListener('click',event=>{if(event.target.closest('a'))return;selected=String(p.id);context(map,players);});$("rows").appendChild(row); });
    document.querySelectorAll('[data-capture-sort]').forEach(th=>th.setAttribute('aria-sort',th.dataset.captureSort===key ? descending?'descending':'ascending':'none'));
    context(map,players); charts(map); setView();
  }
  [$("map"),$("minimum")].forEach(el=>el.addEventListener('change',render));
  $("sort").addEventListener('change',()=>{descending=$("sort").value!=='player';render();});
  $("player").addEventListener('change',()=>{selected=$("player").value;render();});
  document.querySelectorAll('[data-capture-sort]').forEach(th=>th.querySelector('button').addEventListener('click',()=>{descending=$("sort").value===th.dataset.captureSort ? !descending : th.dataset.captureSort!=='player';$("sort").value=th.dataset.captureSort;render();}));
  document.querySelectorAll('[data-capture-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.captureView;setView();}));
  const descriptions={offense:'Team captures scored per game minus the map average. Higher is better.',defense:'Map average minus team captures conceded per game. Higher is better.',net:'Offense plus defense: the player’s teams’ average capture differential, not individual impact.'};
  Object.entries(descriptions).forEach(([key,description])=>{document.querySelector(`[data-capture-sort="${key}"] button`).title=description;});
  try {
    const response=await window.nnHelpers.fetchJSON('/api/stats/capture-ratings');
    if(!response?.ok || !Array.isArray(response.data)) throw new Error('Invalid response');
    maps=response.data;
    $("map").replaceChildren(...maps.map(m=>new Option(`${m.map} (${m.games} matches)`,m.map)));
    if(!maps.length){$("map").add(new Option('No eligible maps',''));$("summary").textContent='No matches have complete capture records yet.';return;}
    $("map").disabled=false;render();
  } catch(error) {$("map").replaceChildren(new Option('Unavailable',''));$("summary").textContent='Capture ratings could not be loaded. Refresh the page to try again.';}
});
