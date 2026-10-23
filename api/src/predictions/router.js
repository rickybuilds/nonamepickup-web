"use strict";

const express = require("express");
const { standings } = require("./metrics");
const { publicRows } = require("./preview");

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
function createPredictionsRouter({ mode = "live", repository = null, getRepository = null } = {}) {
  if (!["off", "preview", "live"].includes(mode)) throw new Error("Unknown prediction mode");
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache",
      "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" });
    if (mode === "off") return res.status(404).json({ ok: false, error: "predictions_disabled" });
    next();
  });
  const envelope = (data, state) => ({ ok: true, data, meta: { contractVersion: 1,
    mode, synthetic: mode === "preview",
    updatedAt: Date.now() - (mode === "preview" && state === "stale" ? 7200000 : 0),
    stale: mode === "preview" && state === "stale" } });
  const fail = (res, error) => res.status(error.message === "invalid_query" ? 400 : 503)
    .json({ ok: false, error: error.message === "invalid_query" ? "invalid_query" : "predictions_unavailable" });
  // Deterministic UI states are only accepted in synthetic mode.
  router.use((req, res, next) => {
    if (mode === "preview" && req.query.state === "unavailable") {
      return res.status(503).json({ ok: false, error: "preview_backend_unavailable" });
    }
    next();
  });
  router.get("/config", (req, res) => res.json(envelope({ columns: COLUMNS,
    ranking: { metric: "netProfit", ties: "competition", minimumGames: 0,
      participation: "all_accounts", inactive: "included" },
    publicPolicy: "approved", publicAvailable: mode === "preview" || mode === "live",
    wagering: "discord" })));
  router.get("/standings", (req, res) => {
    try {
      const query = pageQuery(req.query);
      const rows = mode === "preview" ? (req.query.state === "empty" ? [] : publicRows) :
        (getRepository ? getRepository() : repository).publicRows();
      const response = envelope({ columns: COLUMNS, ...standings(rows, query) }, req.query.state);
      res.json(response);
    } catch (error) { fail(res, error); }
  });
  // No mutation endpoints for accounts, stakes, payouts, or consent.
  router.use((req, res) => res.status(404).json({ ok: false, error: "predictions_endpoint_not_found" }));
  return router;
}

module.exports = { createPredictionsRouter };
