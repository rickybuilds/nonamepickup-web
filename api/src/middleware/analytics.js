"use strict";

const crypto = require("crypto");

function createAnalyticsMiddleware({
  analyticsInsertStmt,
  analyticsSalt,
  cleanString
}) {
  function anonymizeIp(value) {
    return crypto
      .createHash("sha256")
      .update(`${analyticsSalt}:${String(value || "unknown")}`)
      .digest("hex")
      .slice(0, 24);
  }

  return (req, res, next) => {
    try {
      if (
        req.path.startsWith("/assets/") ||
        req.path.startsWith("/api/") ||
        req.path.includes(".css") ||
        req.path.includes(".js") ||
        req.path.includes(".png") ||
        req.path.includes(".ico")
      ) {
        return next();
      }

      const ip = req.ip || req.socket.remoteAddress || "unknown";

      analyticsInsertStmt.run(
        Math.floor(Date.now() / 1000),
        anonymizeIp(ip),
        req.method,
        req.path,
        cleanString(req.headers["user-agent"], 500)
      );

      console.log(`[WEB] ${req.method} ${req.path}`);
    } catch (e) {
      console.error("[web analytics]", e);
    }

    next();
  };
}

module.exports = { createAnalyticsMiddleware };
