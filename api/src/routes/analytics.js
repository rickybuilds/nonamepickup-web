"use strict";
const express = require("express");
const compression = require("compression");
const { reportsFor, reportHeaders, coldWait } = require("../lib/reportCache");

function createAnalyticsRouter({ db, positiveInt, sendError, logRouteError, reports }) {
  const router = express.Router();
  router.get("/analytics", compression({ threshold: 1024, level: 1 }), async (req, res) => {
    try {
      const limit = positiveInt(req.query.limit, 5, 1, 10);
      const report = await coldWait((reports || reportsFor(db)).get("analytics", limit));
      reportHeaders(res, report, "Analytics");
      res.send(report.body);
    } catch (error) {
      logRouteError("[/api/analytics]", error);
      res.setHeader("Retry-After", "60");
      res.setHeader("Cache-Control", "no-store");
      sendError(res, 503, "analytics_warming");
    }
  });
  return router;
}
module.exports = { createAnalyticsRouter };
