"use strict";

require("dotenv").config();

const path = require("path");
const { positiveInt, nonNegativeInt } = require("./helpers/values");

const PORT = Number(process.env.PORT || 4000);
const ROOT_DIR = path.resolve(__dirname, "..");
// TODO(production): Validate PUBLIC_DIR at startup; the default may not match the deployed static-file layout.
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(ROOT_DIR, "public");
const DATA_DIR = process.env.TFCBOT_DATA_DIR || "/root/tfcbot";
const ELO_DB = process.env.ELO_DB || path.join(DATA_DIR, "elo.db");
const SUPPORTERS_FILE = process.env.SUPPORTERS_FILE || path.join(DATA_DIR, "supporters.json");
const QUEUE_FILE = process.env.QUEUE_FILE || path.join(DATA_DIR, "queue.json");
// TODO(production): TRUST_PROXY must match the real proxy hop topology or client IPs and rate limits can be unreliable.
const TRUST_PROXY = process.env.TRUST_PROXY === "true" ? 1 : false;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "";
const API_RATE_LIMIT = positiveInt(process.env.API_RATE_LIMIT, 240, 10, 5000);
const MAX_MATCH_LIMIT = positiveInt(process.env.MAX_MATCH_LIMIT, 5000, 50, 5000);
const MAX_PLAYER_MATCH_LIMIT = positiveInt(process.env.MAX_PLAYER_MATCH_LIMIT, 5000, 50, 5000);
const ANALYTICS_RETENTION_DAYS = positiveInt(process.env.ANALYTICS_RETENTION_DAYS, 90, 1, 3650);
const ANALYTICS_WARM_INTERVAL_MS = nonNegativeInt(
  process.env.ANALYTICS_WARM_INTERVAL_MS,
  5 * 60 * 1000,
  24 * 60 * 60 * 1000
);
const STEAM_API_KEY = process.env.STEAM_API_KEY || "";
const CURRENT_RULESET = 1;
// TODO(production): Set a dedicated random ANALYTICS_SALT; the fallback is predictable and ADMIN_KEY reuse couples secrets.
const ANALYTICS_SALT = process.env.ANALYTICS_SALT || process.env.ADMIN_KEY || "tfcbot";

module.exports = {
  PORT,
  ROOT_DIR,
  PUBLIC_DIR,
  DATA_DIR,
  ELO_DB,
  SUPPORTERS_FILE,
  QUEUE_FILE,
  TRUST_PROXY,
  CORS_ORIGIN,
  API_RATE_LIMIT,
  MAX_MATCH_LIMIT,
  MAX_PLAYER_MATCH_LIMIT,
  ANALYTICS_RETENTION_DAYS,
  ANALYTICS_WARM_INTERVAL_MS,
  STEAM_API_KEY,
  CURRENT_RULESET,
  ANALYTICS_SALT
};
