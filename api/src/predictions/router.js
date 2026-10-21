"use strict";

const express = require("express");
const { standings } = require("./metrics");

const COLUMNS = [
  { key: "rank", label: "Rank", type: "integer" },
  { key: "displayName", label: "Player", type: "string" },
  { key: "netProfit", label: "Net profit", type: "points" },
  { key: "settledGames", label: "Settled games", type: "integer" },
  { key: "winRate", label: "Correct picks", type: "ratio", nullable: true }
];
const integer = (value, fallback, max) => {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value) || Number(value) < 1 || Number(value) > max) {
    throw new Error("invalid_query");
  }
  return Number(value);
};
function pageQuery(query) {
  const page = integer(query.page, 1, 1000000), pageSize = integer(query.pageSize, 20, 100);
  const sort = query.sort || "netProfit", direction = query.direction || "desc";
  if (!COLUMNS.some(column => column.key === sort) || !["asc", "desc"].includes(direction) ||
      (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 100))) throw new Error("invalid_query");
  return { page, pageSize, sort, direction, search: query.search || "" };
}
function createPredictionsRouter({ mode = "live", getRepository } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer" });
    if (mode === "off") return res.status(404).json({ ok: false, error: "predictions_disabled" });
    next();
  });
  const envelope = data => ({ ok: true, data, meta: { contractVersion: 1,
    mode: "live", updatedAt: Date.now(), refreshIntervalMs: 15000 } });
  router.get("/config", (req, res) => res.json(envelope({ columns: COLUMNS,
    ranking: { metric: "netProfit", ties: "competition", minimumGames: 1, participation: "settled_bettors", inactive: "included" },
    wagering: "discord" })));
  router.get("/standings", (req, res) => {
    try {
      const query = pageQuery(req.query);
      const rows = getRepository().publicRows();
      res.json(envelope({ columns: COLUMNS, ...standings(rows, query) }));
    } catch (error) {
      const invalid = error.message === "invalid_query";
      const known = ["predictions_database_unavailable", "predictions_schema_unavailable", "predictions_configuration_unavailable"];
      res.status(invalid ? 400 : 503).json({ ok: false,
        error: invalid ? "invalid_query" : known.includes(error.code) ? error.code : "predictions_unavailable" });
    }
  });
  // Aggregate standings only: no per-account, financial-write or login endpoints.
  router.use((req, res) => res.status(404).json({ ok: false, error: "predictions_endpoint_not_found" }));
  return router;
}

module.exports = { createPredictionsRouter };
