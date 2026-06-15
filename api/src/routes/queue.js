"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");

let queueSnapshot = null;
let queueSnapshotAt = 0;

function createQueueRouter({
  queueFile,
  dataDir,
  cleanString,
  logRouteError
}) {
  const router = express.Router();
  
const SERVERS_FILE="/root/tfcbot/servers.json";

function splitServerAddress(value){
  const raw=String(value||"").trim();
  const [host,port]=raw.split(":");
  return {host:host||null,port:Number(port||27015)};
}

function serverKeyFromName(name){
  const s=String(name||"").toLowerCase();
  if(s.includes("central 2"))return"central2";
  if(s.includes("central"))return"central";
  if(s.includes("east"))return"east";
  if(s.includes("west"))return"west";
  return null;
}

async function readServers(){
  try{
    const raw=await fs.promises.readFile(SERVERS_FILE,"utf8");
    const rows=JSON.parse(raw||"[]");
    const out={};

    for(const row of Array.isArray(rows)?rows:[]){
      const key=serverKeyFromName(row.name);
      if(!key)continue;
      const addr=splitServerAddress(row.ip);
      out[key]={...row,host:addr.host,port:addr.port};
    }

    return out;
  }catch{
    return {};
  }
}

const { GameDig } = require("gamedig");

const timeleftCache = new Map();

function normalizeTimeleft(value){
  if(value==null)return null;
  const s=String(value).trim();
  if(!s)return null;
  if(/^\d+$/.test(s)){
    const sec=Number(s);
    const m=Math.floor(sec/60);
    const r=sec%60;
    return `${m}:${String(r).padStart(2,"0")}`;
  }
  return s;
}

async function queryTimeleft(serverIp,serverPort){
  if(!serverIp)return null;

  const key=`${serverIp}:${serverPort||27015}`;
  const now=Date.now();
  const cached=timeleftCache.get(key);

  if(cached&&now-cached.at<1000)return cached.value;

  try{
    const state=await GameDig.query({
      type:"tfc",
      host:serverIp,
      port:Number(serverPort||27015),
      requestRules:true,
      maxAttempts:1,
      socketTimeout:1200
    });

    const rules=state.raw?.rules||{};
    const value=normalizeTimeleft(
      rules.amx_timeleft ||
      rules.timeleft ||
      rules.mp_timeleft ||
      null
    );

    timeleftCache.set(key,{at:now,value});
    return value;
  }catch(e){
    timeleftCache.set(key,{at:now,value:null});
    return null;
  }
}

  router.get("/queue",async(req,res)=>{
    try{
      const now = Date.now();
      if (queueSnapshot && now - queueSnapshotAt < 1000) {
        res.setHeader("Cache-Control", "public, max-age=1, stale-while-revalidate=2");
        return res.json(queueSnapshot);
      }

      const raw=await fs.promises.readFile(queueFile,"utf8");
      const queue=JSON.parse(raw||"[]");
      if (!Array.isArray(queue)) throw new Error("queue_not_array");

      async function readLiveStates(){
        let files=[];
        try{
          files=await fs.promises.readdir(dataDir);
        }catch{
          return [];
        }

        const liveFiles=files.filter(f=>/^live_[a-z0-9_-]+\.json$/i.test(f)&&f!=="live_state.json");

        const lives=await Promise.all(liveFiles.map(async file=>{
          try{
            const serverKey=file.replace(/^live_/i,"").replace(/\.json$/i,"");
            const raw=await fs.promises.readFile(path.join(dataDir,file),"utf8");
            const live=JSON.parse(raw||"{}");

            if(!live||!live.active)return null;

            return {
              ...live,
              serverKey
            };
          }catch{
            return null;
          }
        }));

        return lives
          .filter(Boolean)
          .sort((a,b)=>Number(b.updated_at||0)-Number(a.updated_at||0));
      }

      const servers=await readServers();
		const liveMatches=await Promise.all((await readLiveStates()).map(async live=>{
		  const server=servers[live.serverKey]||{};
		  const serverIp=server.host||null;
		  const serverPort=Number(server.port||27015);

		  return {
			...live,
			serverIp,
			serverPort,
			timeleft:await queryTimeleft(serverIp,serverPort)
		  };
		}));

      queueSnapshot = {
        ok:true,
        count:queue.length,
        max:8,
        players:queue.map(p=>({
          id:cleanString(p.id,100),
          name:cleanString(p.name,200),
          lastSeenAt:p.lastSeenAt
        })),
        liveMatches
      };
      queueSnapshotAt = now;
      res.setHeader("Cache-Control", "public, max-age=1, stale-while-revalidate=2");
      res.json(queueSnapshot);
    }catch(e){
      logRouteError("[/api/queue]",e);
      res.json({
        ok:false,
        count:0,
        max:8,
        players:[],
        liveMatches:[]
      });
    }
  });

  return router;
}

module.exports = { createQueueRouter };
