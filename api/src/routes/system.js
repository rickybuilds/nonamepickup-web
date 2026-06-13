"use strict";

const express = require("express");

function createSystemRouter({ db, fs, supportersFile, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/health", (req, res) => {
    try {
      db.prepare("SELECT 1").get();
      res.setHeader("Cache-Control", "no-store");
      res.json({ ok: true });
    } catch (error) {
      logRouteError("[/api/health]", error);
      sendError(res, 503, "database_unavailable");
    }
  });

  router.get("/supporters", (req, res) => {
    try {
      const ids = JSON.parse(fs.readFileSync(supportersFile, "utf8"));
      res.setHeader("Cache-Control", "public, max-age=60");
      res.json({ supporters: Array.isArray(ids) ? ids.map(String) : [] });
    } catch (e) {
      logRouteError("[api/supporters]", e);
      res.json({ supporters: [] });
    }
  });

  return router;
}

module.exports = { createSystemRouter };
