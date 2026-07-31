"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const snapshots = Number(process.env.REPLAY_BENCHMARK_SNAPSHOTS || 48_000);
const sessions = Number(process.env.REPLAY_BENCHMARK_PLAYERS || 8);
const header = [
  "snapshot", "time_ms", "session_id", "slot", "alive", "team", "class", "goalitem_flags", "weapon", "buttons",
  "health", "armor", "x", "y", "z", "vx", "vy", "vz", "pitch", "yaw", "roll", "ducking", "oldbuttons",
  "player_model_id", "weapon_model_id", "body", "skin", "sequence", "gaitsequence", "frame", "framerate",
  "animtime", "body_pitch", "body_yaw", "body_roll", "controller0", "controller1", "controller2", "controller3",
  "blending0", "blending1"
].join(",");
const lines = [header];
for (let snapshot = 0; snapshot < snapshots; snapshot += 1) {
  for (let session = 1; session <= sessions; session += 1) {
    const time = snapshot * 20;
    lines.push([
      snapshot, time, session, session, 1, session <= 4 ? 1 : 2, (session % 9) + 1, 0, 7, 0,
      100, 100, snapshot * 0.1, session * 32, 64, 5, 0, 0, 0, snapshot % 360, 0, 0, 0,
      0, 0, 0, 0, 0, 0, snapshot % 256, 1, time / 1000, 0, snapshot % 360, 0, 0, 0, 0, 0, 0, 0
    ].join(","));
  }
}

const files = {
  roster: "roster",
  renderModels: "renderModels",
  players: "players",
  projectileDefs: "projectileDefs",
  projectiles: "projectiles",
  objectiveDefs: "objectiveDefs",
  objectives: "objectives",
  buildableDefs: "buildableDefs",
  buildables: "buildables",
  events: "events"
};
const data = new Map([
  ["roster", `session_id,slot,userid,steamid,name,initial_team,is_bot,joined_ms\n${Array.from({ length: sessions }, (_, index) => `${index + 1},${index + 1},${index + 1},STEAM_0:1:${index + 1},Player ${index + 1},${index < 4 ? 1 : 2},0,0`).join("\n")}\n`],
  ["renderModels", "model_id,kind,path,first_seen_ms\n"],
  ["players", lines.join("\n") + "\n"],
  ["projectileDefs", "projectile_id,entity,owner_session,classname,model_id,spawned_ms\n"],
  ["projectiles", "snapshot,time_ms,projectile_id,state,x,y,z,vx,vy,vz,pitch,yaw,roll\n"],
  ["objectiveDefs", "objective_id,entity,classname,model_id,targetname,base_x,base_y,base_z,base_yaw,first_seen_ms\n"],
  ["objectives", "snapshot,time_ms,objective_id,state,carrier_session,solid,effects,x,y,z,yaw\n"],
  ["buildableDefs", "buildable_id,entity,kind,classname,initial_owner_session,first_seen_ms\n"],
  ["buildables", "snapshot,time_ms,buildable_id,entity,active,owner_session,owner_entity,team,model_id,colormap,movetype,solid,effects,health,x,y,z,vx,vy,vz,pitch,yaw,roll,body,skin,sequence,gaitsequence,frame,framerate,animtime,scale,rendermode,renderamt,renderfx,render_r,render_g,render_b,controller0,controller1,controller2,controller3,blending0,blending1,aiment\n"],
  ["events", "snapshot,time_ms,event,actor_session,target_session,entity,value1,value2,int_value1,int_value2,text\n"]
]);

async function main() {
  let finish;
  const completed = new Promise((resolve, reject) => { finish = { resolve, reject }; });
  const self = {
    postMessage(message) {
      if (message.type === "complete") finish.resolve(message.payload);
      if (message.type === "error") finish.reject(new Error(message.error));
    }
  };
  const context = vm.createContext({
    self,
    fetch: async url => new Response(data.get(url), { status: data.has(url) ? 200 : 404 }),
    Response,
    TextDecoder,
    Uint8Array,
    Float32Array,
    Map,
    Set,
    Number,
    Math,
    Object,
    Array,
    Error
  });
  const worker = fs.readFileSync(
    path.resolve(__dirname, "..", "..", "assets", "js", "pickup-replay-worker.js"),
    "utf8"
  );
  vm.runInContext(worker, context, { filename: "pickup-replay-worker.js" });
  const before = process.memoryUsage();
  const started = performance.now();
  await self.onmessage({ data: { files, schemaVersion: 3 } });
  const payload = await completed;
  const elapsedMs = performance.now() - started;
  const after = process.memoryUsage();
  console.log(JSON.stringify({
    snapshots,
    sessions,
    playerRows: snapshots * sessions,
    parseMs: Math.round(elapsedMs),
    csvMiB: Math.round((data.get("players").length / 1024 / 1024) * 10) / 10,
    heapDeltaMiB: Math.round(((after.heapUsed - before.heapUsed) / 1024 / 1024) * 10) / 10,
    arrayBufferDeltaMiB: Math.round(((after.arrayBuffers - before.arrayBuffers) / 1024 / 1024) * 10) / 10,
    rssDeltaMiB: Math.round(((after.rss - before.rss) / 1024 / 1024) * 10) / 10,
    typedArrayMiB: Math.round((payload.players.reduce((sum, track) => sum + track.frames.byteLength, 0) / 1024 / 1024) * 10) / 10,
    tracks: payload.players.length
  }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
