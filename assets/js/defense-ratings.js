"use strict";
document.addEventListener('DOMContentLoaded', async () => {
  const $ = suffix => document.getElementById(`defense-${suffix}`);
  if (!$('map')) return;
  const classes = {soldier:{label:'Soldier',asset:'Soldier'},demoman:{label:'Demoman',asset:'Demoman'},hwguy:{label:'HWGuy',asset:'Heavy'},engineer:{label:'Engineer',asset:'Engineer'}};
  let data, selectedClass = 'soldier', view = 'overview';
  const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const picker = window.nnRatings.createPlayerPicker('defense',()=>[],()=>null,()=>{});
  function setView() {
    document.querySelectorAll('[data-defense-view]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.defenseView===view)));
    $('context').hidden = !['overview','players'].includes(view);
    $('leaderboard').hidden = !['overview','players'].includes(view);
    $('distribution-panel').hidden = !['overview','distribution'].includes(view);
    $('trends-panel').hidden = !['overview','trends'].includes(view);
    $('dashboard').dataset.view = view;
  }
  function render() {
    if (!data) return;
    const map=data.maps.find(item=>item.map===$('map').value), current=classes[selectedClass];
    const mapLabel=map?.map || 'No completed maps';
    const completed=Number.isFinite(map?.completedMatches) ? map.completedMatches.toLocaleString() : 'Unavailable';
    $('summary').textContent=`${current.label} · ${mapLabel} · minimum ${$('minimum').value} games · verified defensive-class appearances and qualifying players unavailable.`;
    $('dashboard').hidden=false;
    $('reason').textContent=data.reason;
    $('missing').replaceChildren(...data.methodology.missing.map(reason=>{const item=document.createElement('li');item.textContent=reason;return item;}));
    const unavailableCard=(title,note,kind)=>`<article class="capture-kpi capture-kpi-${kind}"><h3>${title}<small>${escape(note)}</small></h3><strong class="defense-unavailable-value">Unavailable</strong><span>Verified participation required</span></article>`;
    $('kpis').innerHTML=`<article class="capture-map-card"><img id="defense-map-image" src="assets/images/maps/NoMap.webp" alt=""><div><strong>${escape(mapLabel)}</strong><span>${completed} completed matches · coverage only</span><span>Eligible appearances / players: unavailable</span></div></article>${unavailableCard('Defensive baseline',current.label+' · '+mapLabel,'baseline')}${unavailableCard('Top defender','No verified rankings','defense')}${unavailableCard('Most experienced','Eligible class appearances unavailable','experience')}`;
    const image=$('map-image');
    if(map){
      if(window.setMapImageFromName)window.setMapImageFromName(image,map.map,{fallbackSrc:'assets/images/maps/NoMap.webp'});
      else{image.src=`assets/images/maps/${encodeURIComponent(map.map)}.webp`;image.onerror=()=>{image.onerror=null;image.src='assets/images/maps/NoMap.webp';};}
    }
    $('spotlight').innerHTML=`<div class="defense-class-context"><img src="assets/images/classes/${current.asset}old_tfc.png" alt="" width="42" height="56"><div><strong>${current.label} · ${escape(mapLabel)}</strong><p>No verified defenders available to inspect.</p></div></div><p>Search is ready for qualifying players. Without reliable class and defensive-role participation, eligible games, rating, rank, sample tier, and comparisons remain unavailable.</p>`;
    $('distribution').textContent=`${current.label} · ${mapLabel}: no verified defensive-class observations. A conceded-captures distribution cannot be calculated from aggregate class time.`;
    $('trend').textContent=`${current.label} · ${mapLabel}: no verified defensive-class observations. Raw points, rolling averages, and a defensive baseline require reliable participation intervals.`;
    const sort=$('sort').selectedOptions?.[0]?.textContent || {defense:'Defense rating',conceded:'Captures conceded',games:'Eligible appearances',player:'Player name'}[$('sort').value];
    $('ranking-context').textContent=`${current.label} · ${sort}`;
    $('leaderboard-empty').textContent=`${current.label} on ${mapLabel}: ratings unavailable. No verified defensive-class players can be filtered or ranked at the selected minimum of ${$('minimum').value} games.`;
    picker.dismiss();setView();
  }
  [$('map'),$('minimum'),$('sort')].forEach(control=>control.addEventListener('change',render));
  document.querySelectorAll('[data-defense-class]').forEach(button=>button.addEventListener('click',()=>{
    selectedClass=button.dataset.defenseClass;
    document.querySelectorAll('[data-defense-class]').forEach(option=>option.setAttribute('aria-pressed',String(option.dataset.defenseClass===selectedClass)));
    render();
  }));
  document.querySelectorAll('[data-defense-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.defenseView;setView();}));
  try {
    const response=await window.nnHelpers.fetchJSON('/api/stats/defense-ratings');
    // This foundation deliberately accepts only the audited unavailable contract.
    // Verified ratings require an explicit methodology implementation, not guessed fields.
    if(!response?.ok||response.data?.status!=='unavailable'||!Array.isArray(response.data.maps)||!Array.isArray(response.data.methodology?.missing))throw new Error('Unsupported defense data contract');
    data=response.data;
    $('map').replaceChildren(...data.maps.map(map=>new Option(`${map.map} (${map.completedMatches} completed)`,map.map)));
    if(!data.maps.length)$('map').add(new Option('No completed maps',''));
    $('map').disabled=!data.maps.length;
    render();
  }catch(error){
    $('map').replaceChildren(new Option('Unavailable',''));$('map').disabled=true;
    $('summary').textContent='Defense data coverage could not be loaded. Refresh the page to try again.';
    $('dashboard').hidden=true;
  }
});
