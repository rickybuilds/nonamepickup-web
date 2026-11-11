'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const model=require('../../assets/js/defense-model');
const source=['ratings-controls.js','defense-model.js','defense-ratings.js'].map(f=>fs.readFileSync(path.join(__dirname,'../../assets/js',f),'utf8')).join('\n');
class Element{
  constructor(){this.value='';this.children=[];this.dataset={};this.events={};this.attributes={};this.classList={toggle(){}};this.hidden=false;}
  addEventListener(n,f){this.events[n]=f;}setAttribute(k,v){this.attributes[k]=v;}
  replaceChildren(...c){this.children=c;if(c.length&&c[0].value!==undefined&&!c.some(x=>x.value===this.value))this.value=c[0].value;}
  appendChild(c){this.children.push(c);}add(c){this.children.push(c);}focus(){}contains(){return false;}
  fire(n,extra={}){this.events[n]?.({preventDefault(){},target:{closest:()=>null},...extra});}
}
const p=(id,games,defense)=>({id,profileId:id,player:id,games,defense,conceded:7-defense});
const bucket={baseline:7,games:3,status:'estimated',players:[p('Alpha',5,1),p('Bravo',10,2)],observations:[{matchId:'m',roundNum:1,team:'Team B',conceded:7,createdAt:100,playerIds:['Alpha','Bravo']},{matchId:'n',roundNum:2,team:'Team A',conceded:5,createdAt:200,playerIds:['Bravo']}]};
async function dashboard(){
  const els=new Map(),el=id=>{if(!els.has(id))els.set(id,new Element());return els.get(id);};let ready;
  el('defense-minimum').value='5';el('defense-sort').value='defense';el('defense-trend-raw').checked=true;el('defense-trend-rolling').checked=true;
  const classes=['soldier','demoman','hwguy','engineer'].map(id=>{const e=new Element();e.dataset.defenseClass=id;return e;});const views=['overview','players','trends','distribution'].map(id=>{const e=new Element();e.dataset.defenseView=id;return e;});
  const data={status:'estimated',reason:'Estimated',methodology:{missing:[]},maps:[{map:'well',completedMatches:3,classes:Object.fromEntries(classes.map(e=>[e.dataset.defenseClass,bucket]))},{map:'empty',completedMatches:1,classes:{}}]};
  const document={getElementById:el,createElement:()=>new Element(),addEventListener(n,f){if(n==='DOMContentLoaded')ready=f;},querySelectorAll:s=>s==='[data-defense-class]'?classes:views};
  const window={nnHelpers:{fetchJSON:async()=>({ok:true,data})}};vm.runInNewContext(source,{window,document,Option:function(t,v){this.value=v;}});await ready();return {el:id=>el('defense-'+id),classes,views};
}
test('unique team-round aggregation respects minimum eligibility without weighting shared defenders',()=>{
  const duplicate={...bucket.observations[0]};const obs=model.observations({...bucket,observations:[...bucket.observations,duplicate]},bucket.players);
  assert.equal(obs.length,2);assert.equal(model.distribution(obs).reduce((s,b)=>s+b.count,0),2);
  assert.equal(model.observations(bucket,[]).length,0);assert.equal(model.eligible(bucket,10).length,1);
});
test('trend ordering and trailing five actual observations use partial initial windows',()=>{
  const input=Array.from({length:6},(_,i)=>({matchId:String(i),roundNum:1,team:'B',conceded:i,createdAt:100+i})).reverse();
  const t=model.trend(input);assert.equal(t.dated,true);assert.deepEqual(t.rolling,[0,.5,1,1.5,2,3]);
  assert.equal(model.trend([{...input[0],createdAt:null}]).dated,false);assert.deepEqual(model.trend([]).rolling,[]);
});
test('round sample tiers are descriptive and sorts do not mutate their population',()=>{
  assert.deepEqual([5,10,25,50].map(n=>model.sample(n).key),['limited','developing','established','extensive']);
  assert.equal(model.sort(bucket.players,'defense')[0].id,'Bravo');assert.equal(model.sort(bucket.players,'player')[0].id,'Alpha');assert.equal(model.sort(bucket.players,'conceded')[0].id,'Bravo');assert.equal(bucket.players[0].id,'Alpha');
});
test('dashboard defaults to top defender, renders real charts, synchronizes rows/search and filters',async()=>{
  const ui=await dashboard();assert.equal(ui.el('player').value,'Bravo');assert.match(ui.el('spotlight').innerHTML,/Rank #1/);assert.match(ui.el('spotlight').innerHTML,/7.00 baseline − 5.00/);assert.match(ui.el('distribution').innerHTML,/<svg/);assert.match(ui.el('trend').innerHTML,/Match m, round 1/);
  ui.el('rows').children[1].fire('click');assert.equal(ui.el('player').value,'Alpha');
  ui.el('player').value='br';ui.el('player').fire('input');assert.equal(ui.el('player-options').children.length,1);assert.match(ui.el('spotlight').innerHTML,/Alpha/);
  ui.el('player').fire('keydown',{key:'ArrowDown'});ui.el('player').fire('keydown',{key:'Enter'});assert.equal(ui.el('player').value,'Bravo');
  ui.el('search').value='al';ui.el('search').fire('input');assert.equal(ui.el('rows').children.length,1);ui.el('search-clear').fire('click');assert.equal(ui.el('rows').children.length,2);
  ui.el('minimum').value='10';ui.el('minimum').fire('change');assert.equal(ui.el('rows').children.length,1);assert.equal(ui.el('player').value,'Bravo');
  ui.classes[2].fire('click');assert.match(ui.el('spotlight').innerHTML,/HWGuy/);ui.views[2].fire('click');assert.equal(ui.el('trends-panel').hidden,false);assert.equal(ui.el('minimum').value,'10');
  ui.el('map').value='empty';ui.el('map').fire('change');assert.equal(ui.el('rows').children.length,0);assert.equal(ui.el('player').value,'');assert.match(ui.el('distribution').innerHTML,/No team-round/);assert.match(ui.el('spotlight').innerHTML,/No qualifying/);
});
