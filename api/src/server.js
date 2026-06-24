"use strict";

const fs = require("fs");
const http = require("http");
const config = require("./config");
const { cached, cachedFor } = require("./helpers/cache");
const {
  positiveInt,
  nonNegativeInt,
  cleanString,
  parseIdList
} = require("./helpers/values");
const { safePublicUrl } = require("./helpers/urls");
const { sendError, logRouteError } = require("./helpers/http");
const { matchColumns, serializeMatch } = require("./serializers/match");
const { createStatements } = require("./db/statements");
const { createMatchPlayerLoader } = require("./db/matchPlayers");
const { createDatabase } = require("./db");
const { createApp } = require("./app");

const db = createDatabase(config.ELO_DB, config.ANALYTICS_RETENTION_DAYS);

const loadMatchPlayers = createMatchPlayerLoader(db);

const statements = createStatements(db, matchColumns);

const app = createApp({
  db,
  fs,
  config,
  helpers: {
    cached,
    cachedFor,
    positiveInt,
    nonNegativeInt,
    cleanString,
    parseIdList,
    safePublicUrl,
    sendError,
    logRouteError
  },
  serializers: {
    matchColumns,
    serializeMatch
  },
  loadMatchPlayers,
  statements
});

const server = app.listen(config.PORT, "0.0.0.0", () => {
  console.log(`API running on http://0.0.0.0:${config.PORT}/`);
});

function warmLocalApi(path) {
  return new Promise(resolve => {
    const req = http.get({
      hostname: "127.0.0.1",
      port: config.PORT,
      path,
      timeout: 10_000
    }, res => {
      res.resume();
      res.on("end", () => resolve(true));
      res.on("error", error => {
        console.warn(`[warmup] ${path} response failed: ${error.message}`);
        resolve(false);
      });
    });

    req.on("error", error => {
      console.warn(`[warmup] ${path} failed: ${error.message}`);
      resolve(false);
    });
    req.on("timeout", () => {
      req.destroy(new Error("timeout"));
    });
  });
}

let analyticsWarmInFlight = false;
async function warmAnalytics() {
  if (analyticsWarmInFlight) return;
  analyticsWarmInFlight = true;
  try {
    await warmLocalApi("/api/analytics?limit=5&refresh=1");
  } finally {
    analyticsWarmInFlight = false;
  }
}

setTimeout(() => {
  void warmAnalytics();
}, 250).unref();

if (config.ANALYTICS_WARM_INTERVAL_MS > 0) {
  setInterval(() => {
    void warmAnalytics();
  }, config.ANALYTICS_WARM_INTERVAL_MS).unref();
}

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal}`);

  const forceTimer = setTimeout(() => process.exit(1), 10_000);
  forceTimer.unref();

  server.close(() => {
    try {
      db.close();
    } finally {
      clearTimeout(forceTimer);
      process.exit(0);
    }
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server };
