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

      const liveMatches=await readLiveStates();

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
