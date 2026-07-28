"use strict";

const express = require("express");
const { CURRENT_RULESET } = require("../config");
const { speedrunQuery } = require("../db/mariadb");
const { SpeedrunComparisonRepository } = require("../speedruns/comparisonRepository");
const { ExternalBaselineService, VALID_STATUSES } = require("../speedruns/externalBaselineService");

function cacheTtlMs() {
  const parsed = Number.parseInt(process.env.SPEEDRUN_COMPARISON_CACHE_TTL_MS || "", 10);
  return Number.isFinite(parsed) ? Math.max(1_000, Math.min(parsed, 300_000)) : 30_000;
}

function createDefaultService() {
  return new ExternalBaselineService({
    repository: new SpeedrunComparisonRepository({ query: speedrunQuery }),
    ruleset: CURRENT_RULESET,
    cacheTtlMs: cacheTtlMs()
  });
}

function createSpeedrunComparisonsRouter({ logRouteError, service = createDefaultService() }) {
  const router = express.Router();

  function unavailable(res) {
    return res.status(503).json({ ok: false, error: "speedrun_comparison_unavailable" });
  }

  function badRequest(res, error) {
    return res.status(400).json({ ok: false, error });
  }

  async function endpoint(res, label, handler) {
    try {
      const payload = await handler();
      if (payload == null) return res.status(404).json({ ok: false, error: "comparison_not_found" });
      return res.json(payload);
    } catch (error) {
      logRouteError(label, error);
      return unavailable(res);
    }
  }

  router.get("/summary", (_req, res) =>
    endpoint(res, "[/api/speedruns/comparisons/summary]", () => service.getSummary()));

  router.get("/leaderboard", (req, res) => {
    const status = String(req.query.status || "").trim().toLowerCase();
    if (status && !VALID_STATUSES.has(status)) return badRequest(res, "invalid_status");
    return endpoint(res, "[/api/speedruns/comparisons/leaderboard]", () =>
      service.getLeaderboard({
        status,
        source: req.query.source,
        query: req.query.q,
        sort: req.query.sort,
        limit: req.query.limit,
        offset: req.query.offset
      }));
  });

  router.get("/external-only", (req, res) =>
    endpoint(res, "[/api/speedruns/comparisons/external-only]", () =>
      service.getExternalOnlyMaps({
        limit: req.query.limit,
        offset: req.query.offset
      })));

  router.get("/missing-internal", (req, res) =>
    endpoint(res, "[/api/speedruns/comparisons/missing-internal]", () =>
      service.getMapsWithoutInternalRecords({
        limit: req.query.limit,
        offset: req.query.offset
      })));

  router.get("/maps/:map/classes/:classId", (req, res) => {
    const map = String(req.params.map || "").trim();
    const classId = Number(req.params.classId);
    if (!map || map.length > 128) return badRequest(res, "invalid_map");
    if (!Number.isInteger(classId) || classId < 0 || classId > 11) {
      return badRequest(res, "invalid_class_id");
    }
    return endpoint(res, "[/api/speedruns/comparisons/maps/:map/classes/:classId]", () =>
      service.getMapClass(map, classId));
  });

  router.get("/maps/:map", (req, res) => {
    const map = String(req.params.map || "").trim();
    if (!map || map.length > 128) return badRequest(res, "invalid_map");
    return endpoint(res, "[/api/speedruns/comparisons/maps/:map]", async () => {
      const comparisons = await service.getMap(map);
      if (!comparisons.length) return null;
      return {
        map: comparisons[0].map,
        comparisons
      };
    });
  });

  router.get("/players/:discordId", (req, res) => {
    const discordId = String(req.params.discordId || "").trim();
    if (!discordId || discordId.length > 32) return badRequest(res, "invalid_discord_id");
    return endpoint(res, "[/api/speedruns/comparisons/players/:discordId]", () =>
      service.getPlayerSummary(discordId));
  });

  return router;
}

module.exports = { createDefaultService, createSpeedrunComparisonsRouter };
