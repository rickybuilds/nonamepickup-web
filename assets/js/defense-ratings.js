"use strict";
document.addEventListener('DOMContentLoaded',async()=>{
  const $=id=>document.getElementById(`defense-${id}`);if(!$('map'))return;
  const model=window.nnDefenseModel;
  const classes={soldier:{label:'Soldier',asset:'Soldier'},demoman:{label:'Demoman',asset:'Demoman'},hwguy:{label:'HWGuy',asset:'Heavy'},engineer:{label:'Engineer',asset:'Engineer'}};
  let data,selectedClass='soldier',selectedPlayer='',view='overview',eligible=[];
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=n=>Number.isFinite(n)?n.toFixed(2):'—';
  const signed=n=>Math.abs(n)<.005?'0.00':`${n>0?'+':''}${fmt(n)}`;
  const tone=n=>n>.005?'capture-positive':n<-.005?'capture-negative':'capture-neutral';
  const profile=p=>p.profileId?`<a href="player.html?id=${encodeURIComponent(p.profileId)}">${esc(p.player)}</a>`:`<strong>${esc(p.player)}</strong>`;
  const badge=p=>{const s=model.sample(p.games);return `<span class="capture-sample" data-sample="${s.key}" title="Descriptive round count, not statistical confidence">${s.label}</span>`;};
  const rank=p=>1+eligible.filter(other=>other.defense>p.defense).length;
  const bar=(p,scale)=>`<div class="capture-bar-row" title="Estimated defense rating ${signed(p.defense)}"><span>D</span><div class="capture-bar-track" aria-hidden="true"><i class="${tone(p.defense)}" style="left:${p.defense<0?50-Math.abs(p.defense)/scale*50:50}%;width:${Math.abs(p.defense)/scale*50}%"></i></div><b class="${tone(p.defense)}">${signed(p.defense)}</b></div>`;
  const picker=window.nnRatings.createPlayerPicker('defense',()=>eligible,()=>selectedPlayer,p=>{selectedPlayer=String(p.id);render();});
  function setView(){
    document.querySelectorAll('[data-defense-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.defenseView===view)));
    $('context').hidden=!['overview','players'].includes(view);$('leaderboard').hidden=!['overview','players'].includes(view);
    $('distribution-panel').hidden=!['overview','distribution'].includes(view);$('trends-panel').hidden=!['overview','trends'].includes(view);$('dashboard').dataset.view=view;
  }
  const svg=(body,label)=>`<svg viewBox="0 0 420 180" role="img" aria-label="${esc(label)}">${body}</svg>`;
  function charts(bucket){
    const observations=model.observations(bucket,eligible),total=observations.length;
    $('distribution-count').textContent=`${total} unique defensive team-rounds`;
    if(!total){$('distribution').innerHTML=$('trend').innerHTML='<p class="capture-empty">No team-round observations meet these filters. Lower the minimum or choose another class/map.</p>';$('trend-order').textContent='No observations';return;}
    const bins=model.distribution(observations),peak=Math.max(...bins.map(b=>b.count),1),width=350/bins.length;
    let bars='';
    for(let i=0;i<=2;i++){const y=145-i*60;bars+=`<line x1="45" y1="${y}" x2="405" y2="${y}" class="capture-grid"/><text x="38" y="${y+4}" text-anchor="end">${Math.round(peak*i/2/total*100)}%</text>`;}
    bins.forEach((b,i)=>{const h=b.count/peak*120,x=50+i*width,label=b.lo===b.hi?b.lo:`${b.lo}–${b.hi}`,description=`${label} captures conceded: ${b.count} unique team-rounds (${fmt(b.count/total*100)}%)`;bars+=`<rect tabindex="0" x="${x}" y="${145-h}" width="${Math.max(width-10,4)}" height="${h}" class="capture-histogram" aria-label="${esc(description)}"><title>${esc(description)}</title></rect><text x="${x+(width-10)/2}" y="163" text-anchor="middle">${label}</text>`;});
    bars+='<text x="225" y="179" text-anchor="middle">Captures conceded / defensive team-round</text>';
    $('distribution').innerHTML=svg(bars,`Captures conceded distribution: ${total} unique defensive team-rounds`);
    const {ordered,dated,rolling}=model.trend(observations),top=Math.max(...ordered.map(o=>o.conceded),bucket.baseline,1)*1.12;
    $('trend-order').textContent=dated?'Chronological team-round order':'Match ID / round order · timestamps incomplete';
    const x=i=>ordered.length===1?225:45+i/(ordered.length-1)*355,y=n=>145-n/top*120;
    let plot='';for(let i=0;i<=3;i++){const value=top*i/3;plot+=`<line x1="45" y1="${y(value)}" x2="405" y2="${y(value)}" class="capture-grid"/><text x="38" y="${y(value)+4}" text-anchor="end">${fmt(value)}</text>`;}
    plot+=`<line x1="45" y1="${y(bucket.baseline)}" x2="405" y2="${y(bucket.baseline)}" class="capture-baseline"><title>All eligible class/team-round baseline: ${fmt(bucket.baseline)} captures conceded/round</title></line>`;
    if($('trend-rolling').checked)plot+=`<polyline points="${rolling.map((v,i)=>`${x(i)},${y(v)}`).join(' ')}" class="capture-rolling-line"/>`;
    ordered.forEach((o,i)=>{const title=`Match ${o.matchId}, round ${o.roundNum}, ${o.team}: ${o.conceded} captures conceded${dated?`, ${new Date(o.createdAt*1000).toLocaleDateString()}`:''}`;if($('trend-raw').checked)plot+=`<circle tabindex="0" cx="${x(i)}" cy="${y(o.conceded)}" r="3.5" class="capture-trend-point" aria-label="${esc(title)}"><title>${esc(title)}</title></circle>`;if($('trend-rolling').checked)plot+=`<circle tabindex="0" cx="${x(i)}" cy="${y(rolling[i])}" r="3" class="capture-rolling-point"><title>${esc(title)} · trailing ${Math.min(i+1,5)} rounds: ${fmt(rolling[i])}</title></circle>`;});
    plot+=`<text x="45" y="165">Round 1</text><text x="405" y="165" text-anchor="end">Round ${total}</text>`;
    $('trend').innerHTML=svg(plot,`${total} unique defensive team-rounds; captures conceded per round; baseline ${fmt(bucket.baseline)}`);
  }
  function render(){
    const map=data?.maps.find(m=>m.map===$('map').value),bucket=map?.classes?.[selectedClass]||{players:[],observations:[],baseline:null,games:0},current=classes[selectedClass];
    eligible=model.eligible(bucket,$('minimum').value);const rated=model.sort(eligible,'defense'),top=rated[0];
    if(!eligible.some(p=>String(p.id)===selectedPlayer))selectedPlayer=top?String(top.id):'';
    const selected=eligible.find(p=>String(p.id)===selectedPlayer),scale=Math.max(...eligible.map(p=>Math.abs(p.defense)),.01);
    $('dashboard').hidden=false;$('summary').textContent=`${current.label} on ${map?.map||'no map'}: ${eligible.length} qualifying defenders.`;
    $('reason').textContent=data.reason;$('missing').replaceChildren(...(data.methodology?.missing||[]).map(t=>{const li=document.createElement('li');li.textContent=t;return li;}));
    $('kpis').innerHTML=`<article class="capture-map-card"><img id="defense-map-image" src="assets/images/maps/NoMap.webp" alt=""><div><strong>${esc(map?.map||'No eligible maps')}</strong><span>${map?.completedMatches||0} completed matches · ${bucket.games} eligible class/team-rounds</span></div></article><article class="capture-kpi capture-kpi-baseline"><h3>Estimated baseline<small>${current.label} · all eligible team-rounds</small></h3><strong>${fmt(bucket.baseline)}</strong><span>captures conceded / defensive round</span></article><article class="capture-kpi capture-kpi-defense"><h3>Top defender<small>${top?`${top.games} qualifying rounds`:'No qualifying players'}</small></h3><strong class="${tone(top?.defense)}">${top?signed(top.defense):'—'}</strong><span>${top?profile(top):'Adjust filters'}</span></article><article class="capture-kpi"><h3>Matching players</h3><strong>${eligible.length}</strong><span>At least ${$('minimum').value} defensive rounds</span></article>`;
    const image=$('map-image');if(window.setMapImageFromName)window.setMapImageFromName(image,map?.map,{fallbackSrc:'assets/images/maps/NoMap.webp'});
    $('player').disabled=!eligible.length;
    $('spotlight').innerHTML=selected?`<div class="capture-spotlight-identity"><div>${profile(selected)}<span>${current.label} · ${esc(map.map)} · ${selected.games} qualifying defensive rounds</span></div>${badge(selected)}</div><div class="capture-spotlight-ratings defense-spotlight-rating"><div><span>Estimated Defense Rating</span><strong class="${tone(selected.defense)}">${signed(selected.defense)}</strong><small>Rank #${rank(selected)} of ${eligible.length} eligible players</small></div></div><div class="capture-spotlight-bars">${bar(selected,scale)}</div><div class="capture-spotlight-baseline"><span>Baseline <b>${fmt(bucket.baseline)}</b></span><span>Team conceded <b>${fmt(selected.conceded)}</b></span><span>Difference <b class="${tone(selected.defense)}">${signed(selected.defense)}</b></span></div><details class="capture-formulas"><summary>Calculation &amp; sample context</summary><p>${fmt(bucket.baseline)} baseline − ${fmt(selected.conceded)} team captures conceded per round = <b class="${tone(selected.defense)}">${signed(selected.defense)}</b>.</p><p>Baseline: one outcome per eligible class/team-round. Player average: one outcome per qualifying player-round. Estimated team-result association; sample labels describe round counts, not confidence. Equal ratings share ranks.</p></details>`:'<p class="capture-empty">No qualifying defenders. Lower the minimum or choose another map/class.</p>';
    const query=$('search').value.trim().toLocaleLowerCase(),sorted=model.sort(eligible,$('sort').value),matches=sorted.filter(p=>p.player.toLocaleLowerCase().includes(query));
    $('search-clear').disabled=!$('search').value;$('ranking-context').textContent=`${matches.length} matching / ${eligible.length} qualifying`;
    $('leaderboard-empty').hidden=!!matches.length;$('leaderboard-empty').textContent=eligible.length?'No matching names. Clear the search or try part of another name.':'No defenders meet these filters. Lower the minimum or choose another map/class.';
    $('rows').replaceChildren();matches.forEach(p=>{const row=document.createElement('tr');row.classList.toggle('is-selected',String(p.id)===selectedPlayer);row.innerHTML=`<td>${rank(p)}</td><td>${profile(p)}<button class="capture-inspect" type="button" aria-label="Inspect ${esc(p.player)}">Inspect</button></td><td>${current.label}</td><td>${p.games}</td><td>${fmt(p.conceded)}</td><td>${fmt(bucket.baseline)}</td><td class="${tone(p.defense)}">${signed(p.defense)}</td><td>${badge(p)}</td><td class="capture-bars">${bar(p,scale)}</td>`;row.addEventListener('click',event=>{if(event.target.closest('a'))return;selectedPlayer=String(p.id);render();});$('rows').appendChild(row);});
    picker.dismiss();charts(bucket);setView();
  }
  [$('map'),$('minimum'),$('sort')].forEach(control=>control.addEventListener('change',render));
  $('search').addEventListener('input',render);$('search-clear').addEventListener('click',()=>{$('search').value='';render();$('search').focus();});
  [$('trend-raw'),$('trend-rolling')].forEach(control=>control.addEventListener('change',render));
  document.querySelectorAll('[data-defense-class]').forEach(button=>button.addEventListener('click',()=>{selectedClass=button.dataset.defenseClass;selectedPlayer='';document.querySelectorAll('[data-defense-class]').forEach(option=>option.setAttribute('aria-pressed',String(option===button)));render();}));
  document.querySelectorAll('[data-defense-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.defenseView;setView();}));
  try{const response=await window.nnHelpers.fetchJSON('/api/stats/defense-ratings');if(!response?.ok||!Array.isArray(response.data?.maps))throw Error('Unsupported defense response');data=response.data;$('map').replaceChildren(...data.maps.map(m=>new Option(`${m.map} (${m.completedMatches} completed)`,m.map)));if(!data.maps.length)$('map').add(new Option('No completed maps',''));$('map').disabled=!data.maps.length;render();}catch(error){$('map').replaceChildren(new Option('Unavailable',''));$('map').disabled=true;$('dashboard').hidden=true;$('summary').className='capture-summary';$('summary').textContent='Defense ratings could not be loaded. Refresh to try again.';}
});
