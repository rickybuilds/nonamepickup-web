"use strict";

const mysql = require("mysql2/promise");

let pickupPool = null;

function getPickupPool(config) {
  if (pickupPool) return pickupPool;
  pickupPool = mysql.createPool({
    host: config.PICKUP_DB_HOST,
    port: config.PICKUP_DB_PORT,
    user: config.PICKUP_DB_USER,
    password: config.PICKUP_DB_PASSWORD,
    database: config.PICKUP_DB_NAME,
    waitForConnections: true,
    connectionLimit: 4,
    maxIdle: 2,
    idleTimeout: 60_000,
    queueLimit: 20,
    connectTimeout: 5_000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    decimalNumbers: true,
    namedPlaceholders: false,
    multipleStatements: false
  });
  return pickupPool;
}

async function closePickupPool() {
  if (!pickupPool) return;
  const pool = pickupPool;
  pickupPool = null;
  await pool.end();
}

module.exports = { getPickupPool, closePickupPool };
