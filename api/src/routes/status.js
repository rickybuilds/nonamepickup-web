const express = require("express");
const os = require("os");

function createStatusRouter({ db, checkSpeedrunDatabase }) {
  const router = express.Router();

  router.get("/status", async (req, res) => {
    const start = Date.now();

    let systemDbOk = false;
    let speedrunDbOk = false;

    let systemDbMs = null;
    let speedrunDbMs = null;

    // system DB (SQLite)
    try {
      const t0 = Date.now();
      db.prepare("SELECT 1").get();
      systemDbMs = Date.now() - t0;
      systemDbOk = true;
    } catch (err) {
      console.log("[status] system DB error:", err.message);
    }

    // speedrun DB (DIRECT CALL — THIS IS THE FIX)
    try {
      const t0 = Date.now();
      await checkSpeedrunDatabase();   // ✅ FIXED LINE
      speedrunDbMs = Date.now() - t0;
      speedrunDbOk = true;
    } catch (err) {
      console.log("[status] speedrun DB error:", err.message);
    }

    const uptime = process.uptime() * 1000;

    res.setHeader("Cache-Control", "no-store");

    res.json({
      ok: systemDbOk && speedrunDbOk,
      services: {
        api: true,
        systemDb: systemDbOk,
        speedrunDb: speedrunDbOk
      },
      metrics: {
        uptime: Math.floor(uptime),
        memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        nodeVersion: process.version
      },
      timings: {
        systemDbMs,
        speedrunDbMs,
        totalMs: Date.now() - start
      }
    });
  });

  return router;
}

module.exports = { createStatusRouter };