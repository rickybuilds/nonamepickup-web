"use strict";

function sendError(res, status, code) {
  return res.status(status).json({ ok: false, error: code });
}

function logRouteError(label, error) {
  console.error(label, error?.stack || error);
}

module.exports = { sendError, logRouteError };
