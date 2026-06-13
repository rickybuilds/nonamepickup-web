"use strict";

const Database = require("better-sqlite3");
const { initializeSchema, cleanupAnalytics } = require("./schema");

function createDatabase(databasePath, analyticsRetentionDays) {
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  initializeSchema(db);
  cleanupAnalytics(db, analyticsRetentionDays);

  return db;
}

module.exports = { createDatabase };
