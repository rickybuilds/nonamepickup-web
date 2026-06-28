"use strict";

const express = require("express");
const { createHealthHandler } = require("../helpers/health");

function createSystemRouter({ db, fs, supportersFile, sendError, logRouteError }) {
  const router = express.Router();

  router.get("/health", createHealthHandler({
    label: "[/api/health]",
    check: async () => {
      db.prepare("SELECT 1").get();
    },
    payload: {},
    onError: (error, req, res) => {
      logRouteError("[/api/health]", error);
      sendError(res, 503, "database_unavailable");
    }
  }));

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
