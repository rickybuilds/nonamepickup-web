"use strict";
const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../src/hltv/review.html"),"utf8");
const script=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
function section(start,end){const a=script.indexOf(start),b=script.indexOf(end,a);assert.ok(a>=0&&b>a);return script.slice(a,b);}
const runtime=[section("const pendingControls=","function tableControls("),section("async function refresh(){","async function open("),section("function navigateRegistry(","function renderRecoveryLinks(")].join("\n");
const storage=count=>({current_demos:count,demos:count,open_reviews:0,high_priority_reviews:0,free_bytes:1073741824,low_disk:false,policy:[{class:"normal",days:7}]});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness(responder=async route=>route.startsWith("/demos?")?[]:storage(1)){
  const elements=new Map(),calls=[];
  const el=id=>{if(!elements.has(id))elements.set(id,{value:"",disabled:false,hidden:false,textContent:"",replaceChildren(){},click(){return this.onclick?.();}});return elements.get(id);};
  el("detail").hidden=true;el("queue").hidden=false;
  const context={URLSearchParams,WeakMap,Math,Date,Number,Array,Object,Error,Promise,
    api:route=>{calls.push(route);return responder(route);},
    $:el,message:text=>{el("message").textContent=text;},
    registryPageSize:10,stamp:()=>"",cell(){throw Error("Unexpected row")},mapPreview(){throw Error("Unexpected row")},statusBadge(){throw Error("Unexpected row")}};
  vm.createContext(context);
  vm.runInContext(`let registryRequest=0,navigationEpoch=0,timelineRequest=0,eventRequest=0,selected=null,reviewTarget=null,offset=0;${runtime}\nglobalThis.testApi={run,navigateRegistry,refresh,getOffset:()=>offset,comparisonSummary,comparisonText,findingEvidence,historicalContextText};`,context);
  return {el,calls,...context.testApi};
}
test("comparison helpers keep aim-near context separate from strict hit evidence",()=>{
  const ui=harness();
  const summary=ui.comparisonSummary({near:107,nearEligible:409,strict:108,strictEligible:409},{near:153,nearEligible:674,strict:177,strictEligible:674});
  assert.equal(summary.aimNear.conc.percent.toFixed(1),"26.2");
  assert.equal(summary.aimNear.outside.percent.toFixed(1),"22.7");
  assert.equal(summary.aimNear.gapPoints.toFixed(1),"3.5");
  assert.equal(summary.strict.conc.percent.toFixed(1),"26.4");
  assert.equal(summary.strict.outside.percent.toFixed(1),"26.3");
  assert.equal(summary.strict.gapPoints.toFixed(1),"0.1");
  assert.equal(summary.aimNear.label,"Near Parity");
  assert.equal(ui.comparisonText(summary.strict),"Near parity: concussed 26.4% (108/409) vs non-concussed 26.3% (177/674), a +0.1 point difference.");
});
test("comparison helpers describe direction and insufficient evidence without fabricating rates",()=>{
  const ui=harness();
  assert.equal(ui.comparisonSummary({near:30,nearEligible:100,strict:40,strictEligible:100},{near:20,nearEligible:100,strict:10,strictEligible:100}).aimNear.label,"Concussion Advantage");
  assert.equal(ui.comparisonSummary({near:10,nearEligible:100,strict:5,strictEligible:100},{near:20,nearEligible:100,strict:30,strictEligible:100}).strict.label,"Normal Advantage");
  const missing=ui.comparisonSummary({near:0,nearEligible:0,strict:0,strictEligible:0},null);
  assert.equal(missing.aimNear.label,"Insufficient Data");
  assert.equal(missing.strict.conc.percent,null);
  assert.match(ui.comparisonText(missing.strict),/Insufficient data/);
});
test("comparison helpers fail closed for malformed numerators and missing history",()=>{
  const ui=harness();
  assert.equal(ui.comparisonSummary({near:undefined,nearEligible:100,strict:108,strictEligible:409},{near:153,nearEligible:674,strict:177,strictEligible:674}).aimNear.label,"Insufficient Data");
  assert.equal(JSON.stringify(ui.findingEvidence({metric:"aim-near-context",conc_near:107,conc_eligible:409,outside_near:153,outside_eligible:674})),JSON.stringify({kind:"aim-near",label:"Aim-near context",concNumerator:107,outsideNumerator:153}));
  assert.equal(JSON.stringify(ui.findingEvidence({metric:"strict-hit-evidence-v1",conc_hits:108,conc_eligible:409,outside_hits:177,outside_eligible:674})),JSON.stringify({kind:"strict-hit-evidence",label:"Strict matched hit evidence",concNumerator:108,outsideNumerator:177}));
  assert.equal(ui.historicalContextText({conc_windows:null,baseline:null}),"Historical consistency: unavailable; no compatible baseline or concussion-window coverage was returned.");
});
test("Review Queue makes one registry request and leaves navigation enabled",async()=>{
  const ui=harness();for(const id of ["back","refresh","lock","filters","previous","next"])ui.el(id);
  await ui.navigateRegistry("queued");
  assert.equal(ui.el("status").value,"queued");
  assert.equal(ui.calls.filter(route=>route.startsWith("/demos?")).length,1);
  assert.equal(ui.calls.filter(route=>route==="/storage-summary").length,1);
  assert.match(ui.calls[0],/status=queued/);
  for(const id of ["back","refresh","lock","previous","next"])assert.equal(ui.el(id).disabled,false,id);
  await ui.navigateRegistry();
  assert.equal(ui.el("status").value,"");
  assert.equal(ui.calls.filter(route=>route.startsWith("/demos?")).length,2);
});
test("rapid navigation ignores older responses and never locks controls",async()=>{
  const first=deferred(),second=deferred();let summaries=0;
  const ui=harness(route=>route.startsWith("/demos?")?[]:(++summaries===1?first.promise:second.promise));
  const queue=ui.navigateRegistry("queued");const registry=ui.navigateRegistry("");
  second.resolve(storage(2));await registry;
  first.resolve(storage(1));await queue;
  assert.equal(ui.el("summaryRecordings").textContent,2);
  assert.equal(ui.el("status").value,"");
  assert.equal(ui.el("back").disabled,false);
  assert.equal(ui.el("refresh").disabled,false);
});
test("request failure and exceptions release only their own temporary control",async()=>{
  const failure=harness(async()=>{throw Error("Network unavailable")});
  await failure.navigateRegistry("queued");
  assert.equal(failure.el("back").disabled,false);
  assert.match(failure.el("message").textContent,/Network unavailable/);
  const control=failure.el("claim"),signOut=failure.el("lock"),a=deferred(),b=deferred();
  const first=failure.run(()=>a.promise,control),second=failure.run(()=>b.promise,control);
  assert.equal(control.disabled,true);assert.equal(signOut.disabled,false);
  a.resolve();await first;assert.equal(control.disabled,true,"another action still owns the control");
  b.reject(Error("Action failed"));await second;assert.equal(control.disabled,false);
  assert.match(failure.el("message").textContent,/Action failed/);
  control.disabled=true;await failure.run(()=>{throw Error("Unexpected")},control);
  assert.equal(control.disabled,true,"preexisting restriction remains enforced");
});
test("malformed registry responses show an error without disabling safe navigation",async()=>{
  const ui=harness(async route=>route.startsWith("/demos?")?{unexpected:true}:storage(1));
  await ui.navigateRegistry("queued");
  assert.match(ui.el("message").textContent,/invalid response/);
  assert.equal(ui.el("back").disabled,false);
  assert.equal(ui.el("lock").disabled,false);
});
