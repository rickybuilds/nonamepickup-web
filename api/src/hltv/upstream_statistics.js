"use strict";
// Host the ORIGINAL viewer calculations; graphics uploads are inert, geometry is untouched.
// This VM is an API adapter, not a security boundary. Run inside the existing systemd sandbox.
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
function loadViewer(root, fetch) {
  const stopped = new Error("noname_skip_render_startup");
  const gl = Object.fromEntries(["bindTexture", "texStorage2D", "texParameteri", "bindVertexArray", "bindBuffer", "bufferData", "enableVertexAttribArray", "vertexAttribPointer", "pixelStorei", "texImage2D", "generateMipmap"].map(name => [name, () => {}]));
  for (const name of ["createTexture", "createVertexArray", "createBuffer", "createProgram"]) gl[name] = () => ({});
  gl.getParameter = () => 4096;
  gl.getExtension = () => null;
  gl.createShader = () => { throw stopped; };
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: id === "#concAimMargin" ? "10" : id === "#concViewAspect" ? String(4/3) : "",
      textContent: "", innerHTML: "", classList: {add(){},remove(){},toggle(){}}, addEventListener(){}, getContext: () => gl });
    return elements.get(id);
  };
  const context = vm.createContext({ TextDecoder, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, Int32Array,
    ArrayBuffer, DataView, performance, setTimeout, clearTimeout, fetch,
    document: {querySelector:element,body:element("body")}, window: {addEventListener(){}},
    localStorage: {getItem:()=>null}, console: {log(){},warn(){}}, requestAnimationFrame(){},
  });
  for (const file of ["conc.js", "conc_aim.js", "blood_hits.js", "studio.js", "viewer.js"]) {
    try { vm.runInContext(fs.readFileSync(path.join(root, "web", file), "utf8"), context, {filename:file,timeout:5000}); }
    catch (error) { if (file !== "viewer.js" || error !== stopped) throw error; }
  }
  const api = vm.runInContext("({S,prefs,Studio,ConcEstimate,ConcAim,BloodHits,buildData,loadMap,runConcAim,playerState,serverModelPath,who})",context);
  api.Studio.init(gl, () => ({u:{}}));
  api.elements = elements;
  return api;
}
const crypto = require("crypto");
function assetReader(filename) {
  const fd = fs.openSync(filename, "r"), head = Buffer.alloc(65536);
  fs.readSync(fd, head, 0, head.length, 0);
  const length = head.readUInt32LE(0);
  if (length > 65532) { fs.closeSync(fd); throw new Error("invalid_asset_manifest"); }
  const manifest = JSON.parse(head.subarray(4, 4 + length));
  const size = fs.fstatSync(fd).size;
  for (const row of manifest.assets) if (!row.missing && (!Number.isSafeInteger(row.offset) || !Number.isSafeInteger(row.length) || row.offset < 65536 || row.length < 1 || row.length > 134217728 || row.offset + row.length > size)) throw new Error("invalid_asset_section");
  return { manifest, close: () => fs.closeSync(fd), fetch: async url => {
    // No HTTP listener and no arbitrary filesystem/network access.
    const route = decodeURIComponent(url), row = manifest.assets.find(row => row.route === route);
    if (!row || row.missing) return {ok:false,status:404,json:async()=>({error:"missing_private_asset"})};
    const compressed = Buffer.alloc(row.length);
    if (fs.readSync(fd, compressed, 0, row.length, row.offset) !== row.length) throw new Error("asset_changed");
    const bytes = zlib.gunzipSync(compressed, {maxOutputLength:134217728});
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error("asset_checksum_mismatch");
    return {ok:true,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)};
  }};
}
const key = shot => `${shot.slot}|${shot.t}|${shot.weapon}`;
function evidenceQueues(shots){
  const queues=new Map();
  for(const shot of shots){const id=key(shot);if(!queues.has(id))queues.set(id,[]);queues.get(id).push(shot);}
  return shot=>queues.get(key(shot))?.shift();
}
async function compare(root, meta, bytes, log, fetch) {
  const viewer = loadViewer(root, fetch), {S, ConcAim, Studio} = viewer;
  for (const section of Object.values(meta.buffers)) {
    if (!Array.isArray(section) || section.length !== 2 || section.some(n=>!Number.isSafeInteger(n)||n<0) || section[0]%4 || section[0]+section[1]>bytes.byteLength) throw new Error("invalid_demo_buffer");
  }
  S.meta = meta; S.t = meta.start; S.D = viewer.buildData(meta, bytes);
  S.conc = viewer.ConcEstimate.withLog(meta, S.D, {settings:{...viewer.ConcEstimate.defaults},bySlot:{}}, log);
  if (S.conc.log !== log) throw new Error("upstream_rejected_log");
  S.maps = {};
  for (const level of meta.levels) if (!S.maps[level.map]) S.maps[level.map] = await viewer.loadMap(meta.game, level.map);
  const requiredModels = new Set();
  for (const slot of S.D.slots) for (const [frame] of meta.pmodels?.[slot] || []) {
    const model = viewer.serverModelPath(slot, frame);
    if (model) requiredModels.add(model);
  }
  for (const model of requiredModels) if (!await Studio.load(meta.game, model)) throw new Error("missing_or_invalid_player_model");
  if (!requiredModels.size) throw new Error("no_server_player_models");
  const samples = new Map(), originalMeasure = ConcAim.measure;
  // Observe original sample outputs; return each output unchanged to the original estimator.
  ConcAim.measure = args => originalMeasure({...args, sample:(t,margin,shot)=>{
    const sample = args.sample(t,margin,shot); samples.set(key(shot),sample); return sample;
  }});
  const shots = [], audits = [], groups = new Map(); let unassigned = 0;
  for (const slot of S.D.slots) {
    S.sel = slot;
    const firing = ConcAim.firingEvents(meta, S.D, slot);
    if (!firing.events.length) continue;
    await viewer.runConcAim();
    const result = S.concAim?.result;
    if (!result?.bloodHits) throw new Error("upstream_comparison_incomplete");
    audits.push({slot,duplicate_firing_events:firing.duplicates,geometry:result.rows,evidence:result.bloodHits.rows,audit:result.bloodHits.audit});
    // Upstream preserves distinct event records even when time/slot/weapon match.
    const takeEvidence=evidenceQueues(result.bloodHits.shots);
    for (const fire of firing.events) {
      if (shots.length >= 10000) throw new Error("too_many_recorded_shots");
      const frame = ConcAim.eventFrame(S.D.times, fire.t), actor = viewer.playerState(slot,frame,0);
      // Identity ranges are explicit. Never use viewer display fallback across a slot reuse gap.
      const identities = meta.players.filter(player=>player.ent===slot && player.first<=fire.t && (player.left==null || player.left>fire.t));
      const person = identities.length===1 ? identities[0] : null;
      const steam = person?.steam, classId = actor?.cls;
      const assigned = /^STEAM_[0-5]:[01]:\d+$/.test(steam || "") && classId>=1 && classId<=10;
      const state = ConcAim.stateAt(S.conc.bySlot[slot] || [],fire.t,log.alignment.uncertainty);
      const sample = samples.get(key(fire)), hit = takeEvidence(fire);
      const row = {time_seconds:fire.t,slot,steam_id:assigned?steam:null,name:person?.name||null,class_id:classId||null,weapon:fire.weapon,state,
        visibility:state==="uncertain"?"uncertain":sample==null?"unknown":sample.visible?"visible":"not-visible",
        geometry_hit:!!sample?.hit,aim_near:!!sample?.near,evidence:hit||null};
      shots.push(row);
      if (!assigned) {unassigned++;continue;}
      const groupKey = JSON.stringify([steam,classId,fire.weapon,state]);
      if (!groups.has(groupKey)) groups.set(groupKey,{steam_id:steam,name:person.name,class_id:classId,weapon:fire.weapon,state,
        recorded:0,eligible:0,no_enemy:0,unavailable:0,uncertain:0,geometry_hit:0,aim_near:0,strict:0,inclusive:0,evidence_eligible:0});
      const group = groups.get(groupKey); group.recorded++;
      if(state==="uncertain"){group.uncertain++;continue;}
      if(row.visibility==="unknown"){group.unavailable++;continue;}
      if(row.visibility==="not-visible"){group.no_enemy++;continue;}
      group.eligible++; group.geometry_hit+=Number(row.geometry_hit); group.aim_near+=Number(row.aim_near);
      if(hit?.includedInPercentage){group.evidence_eligible++;const strict=["kill-confirmed","blood-damage"].includes(hit.status);group.strict+=Number(strict);group.inclusive+=Number(strict||!!hit.inclusiveMatch);}
    }
  }
  return {version:1,metric:"ghosty-firing-v1",settings:{margin:.1,aspect:4/3,lag_compensation:true,uncertainty:log.alignment.uncertainty},
    groups:[...groups.values()],shots,audits,unassigned,accuracy_kind:"estimated_hit_evidence_not_bullet_accuracy"};
}
async function run(root,directory){
  const read=(name,max)=>{const file=path.join(directory,name);if(fs.statSync(file).size>max)throw new Error("statistics_input_too_large");return fs.readFileSync(file);};
  const meta=JSON.parse(zlib.gunzipSync(read("meta.json.gz",33554432),{maxOutputLength:67108864}));
  const data=zlib.gunzipSync(read("data.bin.gz",268435456),{maxOutputLength:536870912});
  const log=JSON.parse(read("matched-log.json",33554432)),assets=assetReader(path.join(directory,"assets.bin"));
  try{
    const buffer=data.byteOffset===0&&data.byteLength===data.buffer.byteLength?data.buffer:data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength);
    const result=await compare(root,meta,buffer,log,assets.fetch);
    result.assets=assets.manifest.assets.map(({route,sha256,missing,sources})=>({route,sha256,missing,sources}));
    const output=JSON.stringify(result);if(Buffer.byteLength(output)>16777216)throw new Error("statistics_result_too_large");
    fs.writeFileSync(path.join(directory,"statistics.json"),output,{flag:"wx",mode:0o600});
    return {ok:true,recorded_shots:result.shots.length,groups:result.groups.length};
  }finally{assets.close();}
}
if(require.main===module)run(process.argv[2],process.argv[3]).then(result=>process.stdout.write(JSON.stringify(result))).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
module.exports = { loadViewer,compare,assetReader,run,evidenceQueues };
