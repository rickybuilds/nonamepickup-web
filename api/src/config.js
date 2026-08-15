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
const KICKED_FILE = process.env.KICKED_FILE || path.join(DATA_DIR, "kicked.json");
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
const CURRENT_RULESET = 2;
const MIN_VALID_RUN_TIME_MS = positiveInt(process.env.MIN_VALID_RUN_TIME_MS, 2000, 1, 60 * 60 * 1000);
// TODO(production): Set a dedicated random ANALYTICS_SALT; the fallback is predictable and ADMIN_KEY reuse couples secrets.
const ANALYTICS_SALT = process.env.ANALYTICS_SALT || process.env.ADMIN_KEY || "tfcbot";
const PICKUP_DB_HOST = process.env.PICKUP_DB_HOST || "127.0.0.1";
const PICKUP_DB_PORT = positiveInt(process.env.PICKUP_DB_PORT, 3306, 1, 65535);
const PICKUP_DB_NAME = process.env.PICKUP_DB_NAME || "pickup_4v4";
const PICKUP_DB_USER = process.env.PICKUP_DB_USER || "";
const PICKUP_DB_PASSWORD = process.env.PICKUP_DB_PASSWORD || "";
const PICKUP_STORAGE_PATH = process.env.PICKUP_STORAGE_PATH || "";
const PICKUP_UPLOAD_TOKEN = process.env.PICKUP_UPLOAD_TOKEN || "";
const PICKUP_MAX_UPLOAD_BYTES = positiveInt(
  process.env.PICKUP_MAX_UPLOAD_BYTES,
  1024 * 1024 * 1024,
  1,
  Number.MAX_SAFE_INTEGER
);
const PICKUP_MAX_EXTRACTED_BYTES = positiveInt(
  process.env.PICKUP_MAX_EXTRACTED_BYTES,
  PICKUP_MAX_UPLOAD_BYTES * 4,
  1,
  Number.MAX_SAFE_INTEGER
);
const PICKUP_MAX_ARCHIVE_FILES = positiveInt(process.env.PICKUP_MAX_ARCHIVE_FILES, 32, 1, 1000);
const PICKUP_ZSTD_COMMAND = process.env.PICKUP_ZSTD_COMMAND || "zstd";
const PICKUP_LIVE_BUFFER_SECONDS = positiveInt(process.env.PICKUP_LIVE_BUFFER_SECONDS, 120, 30, 900);
const PICKUP_LIVE_STALE_SECONDS = positiveInt(process.env.PICKUP_LIVE_STALE_SECONDS, 30, 5, 300);
const PICKUP_LIVE_MAX_BATCH_BYTES = positiveInt(
  process.env.PICKUP_LIVE_MAX_BATCH_BYTES,
  1024 * 1024,
  64 * 1024,
  8 * 1024 * 1024
);

const config = {
  PORT,
  ROOT_DIR,
  PUBLIC_DIR,
  DATA_DIR,
  ELO_DB,
  SUPPORTERS_FILE,
  QUEUE_FILE,
  KICKED_FILE,
  TRUST_PROXY,
  CORS_ORIGIN,
  API_RATE_LIMIT,
  MAX_MATCH_LIMIT,
  MAX_PLAYER_MATCH_LIMIT,
  ANALYTICS_RETENTION_DAYS,
  ANALYTICS_WARM_INTERVAL_MS,
  STEAM_API_KEY,
  CURRENT_RULESET,
  MIN_VALID_RUN_TIME_MS,
  ANALYTICS_SALT,
  PICKUP_DB_HOST,
  PICKUP_DB_PORT,
  PICKUP_DB_NAME,
  PICKUP_DB_USER,
  PICKUP_DB_PASSWORD,
  PICKUP_STORAGE_PATH,
  PICKUP_UPLOAD_TOKEN,
  PICKUP_MAX_UPLOAD_BYTES,
  PICKUP_MAX_EXTRACTED_BYTES,
  PICKUP_MAX_ARCHIVE_FILES,
  PICKUP_ZSTD_COMMAND,
  PICKUP_LIVE_BUFFER_SECONDS,
  PICKUP_LIVE_STALE_SECONDS,
  PICKUP_LIVE_MAX_BATCH_BYTES
};

function validatePickupConfiguration(value = config) {
  const missing = [
    ["PICKUP_DB_USER", value.PICKUP_DB_USER],
    ["PICKUP_DB_PASSWORD", value.PICKUP_DB_PASSWORD],
    ["PICKUP_STORAGE_PATH", value.PICKUP_STORAGE_PATH],
    ["PICKUP_UPLOAD_TOKEN", value.PICKUP_UPLOAD_TOKEN]
  ].filter(([, configured]) => !configured).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing required pickup replay configuration: ${missing.join(", ")}`);
  }
}

module.exports = { ...config, validatePickupConfiguration };
