"use strict";

// Local/read-only only. Explicitly pass a local snapshot, never a production DB.
// node api/scripts/benchmarkReports.js /absolute/local/elo.db /output/directory
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { performance, monitorEventLoopDelay } = require("node:perf_hooks");
const Database = require("better-sqlite3");
const express = require("express");
const { ReportCache, runReport, createRevisionReader } = require("../src/lib/reportCache");
const { createAnalyticsRouter } = require("../src/routes/analytics");
const { createStatsRouter } = require("../src/routes/stats");
const { positiveInt } = require("../src/helpers/values");

async function main() {
  const [databasePath, outputPath] = process.argv.slice(2);
  if (!databasePath || !outputPath) throw new Error("Pass a LOCAL database snapshot and output directory");
  fs.mkdirSync(outputPath, { recursive: true });
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  const readRevision = createRevisionReader(db);
  const markerStart = performance.now(); readRevision();
  const markerMs = performance.now() - markerStart;
  const metrics = [];
  // Benchmark deliberately bypasses the production cooldown to bound run time.
  const reports = new ReportCache({ cooldownMs: 0, revision: readRevision,
    run: kind => runReport(databasePath, kind, { onMetrics: metric => metrics.push({ kind, ...metric }) }) });
  const app = express();
  app.get("/ping", (_, res) => res.json({ok:true}));
  const helpers = { db, reports, positiveInt, logRouteError: () => {},
    sendError: (res, status, error) => res.status(status).json({ok:false,error}) };
  app.use(createAnalyticsRouter(helpers)); app.use(createStatsRouter(helpers));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, encoding = "identity") {
    const start = performance.now();
    const res = await fetch(base + route, {headers:{"Accept-Encoding":encoding}});
    const body = await res.text();
    return { ms:performance.now()-start, status:res.status, encoding:res.headers.get("content-encoding"),
      compressedBytes:Number(res.headers.get("content-length")) || null, bytes:Buffer.byteLength(body),
      cache:res.headers.get("x-analytics-cache") || res.headers.get("x-defense-cache"), body };
  }
  const results = { runtime:process.version, platform:process.platform, matches:db.prepare("SELECT COUNT(*) AS n FROM matches").get().n, markerMs, metrics, reports:[] };
  try {
    for (const [kind, route, variant] of [["analytics","/analytics?limit=5",5],["defense","/stats/defense-ratings","default"]]) {
      const delay = monitorEventLoopDelay({resolution:10}); delay.enable();
      const cpu = process.cpuUsage(), start = performance.now(), pings = [];
      let done = false;
      const cold = reports.get(kind,variant).finally(() => {done=true;});
      const pingTask = (async () => {
        while (!done) { pings.push((await request("/ping")).ms); await new Promise(resolve => setTimeout(resolve,15)); }
      })();
      const initial = await request(route);
      await cold;
      await pingTask;
      const coldMs = performance.now()-start, parentCpu=process.cpuUsage(cpu);
      delay.disable();
      const hit=[];
      for(let i=0;i<15;i++)hit.push((await request(route)).ms);
      const body=await request(route);
      fs.writeFileSync(path.join(outputPath,`${kind}-after.json`),body.body);
      const compressed=await request(route,"gzip");
      assert.equal(compressed.encoding,"gzip");
      assert.deepEqual(JSON.parse(compressed.body),JSON.parse(body.body));
      // Compression streams use chunked transfer, so measure wire bytes separately.
      const http=require("node:http");
      const gzipBytes=await new Promise((resolve,reject)=>http.get(base+route,{headers:{"Accept-Encoding":"gzip"}},res=>{
        let n=0;res.on("data",chunk=>{n+=chunk.length});res.on("end",()=>resolve(n));
      }).on("error",reject));
      reports.invalidate();
      const stale=await request(route);
      assert.equal(stale.cache,"STALE");
      assert.deepEqual(JSON.parse(stale.body),JSON.parse(body.body));
      await reports.pending.get(kind);
      delay.disable(); hit.sort((a,b)=>a-b); pings.sort((a,b)=>a-b);
      results.reports.push({kind,coldMs,initialStatus:initial.status,initialMs:initial.ms,
        hitMedianMs:hit[7],hitP95Ms:hit[14],staleMs:stale.ms,pingMaxMs:pings.at(-1),pingCount:pings.length,
        eventLoopMaxMs:delay.max/1e6,parentCpuMs:(parentCpu.user+parentCpu.system)/1000,
        parentRssMiB:process.memoryUsage().rss/1048576,bytes:body.bytes,gzipBytes});
      if(kind==='analytics') {
        const ten=await request('/analytics?limit=10');
        fs.writeFileSync(path.join(outputPath,'analytics-10-after.json'),ten.body);
      } else {
        const selected=await request('/stats/defense-ratings?detail=selected&map=phantom_lg&class=soldier');
        const summary=await request('/stats/defense-ratings?detail=summary');
        results.defenseSelectedBytes=selected.bytes;results.defenseSummaryBytes=summary.bytes;
      }
    }
    fs.writeFileSync(path.join(outputPath,"after-results.json"),JSON.stringify(results,null,2));
    console.log(JSON.stringify(results,null,2));
  } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.close();}
}

main().catch(error=>{console.error(error);process.exitCode=1;});
