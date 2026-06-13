"use strict";

const fs = require("fs");
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
