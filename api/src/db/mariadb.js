"use strict";

let mysql = null;
let pool = null;
let mysqlLoadError = null;

try {
  mysql = require("mysql2/promise");
} catch (error) {
  mysqlLoadError = error;
}

function readConfig() {
  return {
    host: process.env.SPEEDRUN_DB_HOST || "127.0.0.1",
    port: Number.parseInt(process.env.SPEEDRUN_DB_PORT || "3306", 10),
    user: process.env.SPEEDRUN_DB_USER || "",
    password: process.env.SPEEDRUN_DB_PASSWORD || "",
    database: process.env.SPEEDRUN_DB_NAME || "speedrun"
  };
}

function getSpeedrunPool() {
  if (mysqlLoadError) throw mysqlLoadError;
  if (pool) return pool;

  const config = readConfig();
  pool = mysql.createPool({
    host: config.host,
    port: Number.isFinite(config.port) ? config.port : 3306,
    user: config.user,
    password: config.password,
    database: config.database,
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 2,
    idleTimeout: 60_000,
    queueLimit: 20,
    connectTimeout: 5_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    namedPlaceholders: false,
    decimalNumbers: true,
    dateStrings: false
  });

  return pool;
}

async function speedrunQuery(sql, params = []) {
  const [rows] = await getSpeedrunPool().execute(sql, params);
  return rows;
}

async function checkSpeedrunDatabase() {
  await speedrunQuery("SELECT 1 AS ok");
  return true;
}

async function closeSpeedrunPool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

module.exports = {
  getSpeedrunPool,
  speedrunQuery,
  checkSpeedrunDatabase,
  closeSpeedrunPool
};
