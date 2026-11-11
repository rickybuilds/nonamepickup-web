"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=['ratings-controls.js','defense-ratings.js'].map(file=>fs.readFileSync(path.join(__dirname,'../../assets/js',file),'utf8')).join('\n');
const html=fs.readFileSync(path.join(__dirname,'../../analytics.html'),'utf8');
class Element {
  constructor(){this.value='';this.dataset={};this.children=[];this.events={};this.attributes={};this.hidden=true;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(key,value){this.attributes[key]=value;}
  replaceChildren(...children){this.children=children;if(children.length&&!children.some(c=>c.value===this.value))this.value=children[0].value;}
  appendChild(child){this.children.push(child);} add(child){this.appendChild(child);}
  focus(){} contains(){return false;}
  fire(name,extra={}){this.events[name]?.({preventDefault(){},target:{},...extra});}
}
const fixture={status:'unavailable',reason:'Verified defensive role and class participation intervals are not available.',maps:[{map:'well',completedMatches:12,games:null,baseline:null,players:[],observations:[],status:'unavailable'},{map:'2fort',completedMatches:3,games:null,baseline:null,players:[],observations:[],status:'unavailable'}],eligibleAppearances:null,qualifyingPlayers:null,methodology:{missing:['Class participation intervals','Defensive role coverage'],baseline:'unavailable'}};
async function dashboard(data=fixture,ok=true){
  const elements=new Map();const el=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  el('defense-minimum').value='5';el('defense-sort').value='defense';
  const classes=['soldier','demoman','hwguy','engineer'].map(id=>{const e=new Element();e.dataset.defenseClass=id;return e;});
  const views=['overview','players','trends','distribution'].map(id=>{const e=new Element();e.dataset.defenseView=id;return e;});
  let ready,requested;const events={};
  const document={getElementById:el,createElement:()=>new Element(),addEventListener(name,fn){if(name==='DOMContentLoaded')ready=fn;else events[name]=fn;},querySelectorAll:selector=>selector==='[data-defense-class]'?classes:views};
  const window={nnHelpers:{fetchJSON:async url=>{requested=url;return {ok,data};}}};
  vm.runInNewContext(source,{document,window,Option:function(text,value){this.text=text;this.value=value;}});await ready();
  return {el:id=>el('defense-'+id),classes,views,requested};
}
test('Defense navigation, class assets and shared picker are wired into Analytics',()=>{
  assert.match(html,/data-analytics-tab="defense-ratings"/);assert.match(html,/data-analytics-panel="defense-ratings"/);
  assert.ok(html.indexOf('ratings-controls.js')<html.indexOf('capture-ratings.js'));
  assert.match(html,/Heavyold_tfc.png/);assert.match(html,/id="defense-player"[^>]+role="combobox"/);
  assert.match(html,/<select id="defense-minimum"[^>]*><option value="5">/);
});
test('Defense coverage renders unavailable metrics without borrowing Capture baselines or fabricating zero ratings',async()=>{
  const ui=await dashboard();assert.equal(ui.requested,'/api/stats/defense-ratings');
  assert.equal(ui.el('dashboard').hidden,false);assert.match(ui.el('kpis').innerHTML,/12 completed matches · coverage only/);
  assert.match(ui.el('kpis').innerHTML,/Eligible appearances \/ players: unavailable/);
  assert.doesNotMatch(ui.el('kpis').innerHTML,/0\.00|capture-positive|player.html/);
  assert.match(ui.el('reason').textContent,/participation intervals/);assert.equal(ui.el('missing').children.length,2);
  assert.match(ui.el('spotlight').innerHTML,/Soldier · well/);
});
test('class and map selections refresh all panels while view changes retain minimum and sort',async()=>{
  const ui=await dashboard();ui.el('minimum').value='25';ui.el('minimum').fire('change');ui.el('sort').value='conceded';ui.el('sort').fire('change');
  ui.classes.find(c=>c.dataset.defenseClass==='engineer').fire('click');ui.el('map').value='2fort';ui.el('map').fire('change');
  assert.match(ui.el('summary').textContent,/Engineer · 2fort · minimum 25/);
  for(const id of ['distribution','trend','leaderboard-empty'])assert.match(ui.el(id).textContent,/Engineer.*2fort/);
  assert.match(ui.el('spotlight').innerHTML,/Engineer · 2fort/);assert.match(ui.el('ranking-context').textContent,/Captures conceded/);
  ui.views.find(v=>v.dataset.defenseView==='trends').fire('click');assert.equal(ui.el('trends-panel').hidden,false);assert.equal(ui.el('leaderboard').hidden,true);
  ui.views.find(v=>v.dataset.defenseView==='players').fire('click');assert.equal(ui.el('context').hidden,false);assert.equal(ui.el('leaderboard').hidden,false);
  assert.equal(ui.el('minimum').value,'25');assert.equal(ui.el('sort').value,'conceded');assert.equal(ui.el('map').value,'2fort');
});
test('searchable defender picker reports no verified options, handles keyboard and resets on class change',async()=>{
  const ui=await dashboard();ui.el('player').value='alice';ui.el('player').fire('input');
  assert.equal(ui.el('player').attributes['aria-expanded'],'true');assert.match(ui.el('player-options').children[0].textContent,/No qualifying players/);
  assert.equal(ui.el('player-status').textContent,'0 matching players');ui.el('player').fire('keydown',{key:'ArrowDown'});ui.el('player').fire('keydown',{key:'Enter'});
  assert.match(ui.el('spotlight').innerHTML,/No verified defenders/);ui.el('player').fire('keydown',{key:'Escape'});assert.equal(ui.el('player-options').hidden,true);
  ui.el('player').fire('input');ui.classes[1].fire('click');assert.equal(ui.el('player').value,'');assert.equal(ui.el('player-options').hidden,true);
});
test('no completed maps, API failures and unsupported ratings contracts stay distinct and safe',async()=>{
  const empty=await dashboard({...fixture,maps:[]});assert.equal(empty.el('map').disabled,true);assert.match(empty.el('kpis').innerHTML,/No completed maps/);
  const failed=await dashboard(null,false);assert.equal(failed.el('dashboard').hidden,true);assert.match(failed.el('summary').textContent,/could not be loaded/);
  const unsupported=await dashboard({...fixture,status:'available',players:[{player:'Unverified',defense:99}]});assert.equal(unsupported.el('dashboard').hidden,true);assert.equal(unsupported.el('kpis').innerHTML,undefined);
});
