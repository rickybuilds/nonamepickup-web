"use strict";

const express = require("express");
const { PickupError } = require("../pickup/errors");
const { cleanIdentity } = require("../pickup/live");

function closeAfterResponse(req, res) {
  res.set("Connection", "close");
  req.resume();
}

function sendLiveError(res, error, fallback) {
  const expected = error instanceof PickupError;
  res.status(expected ? error.status : 500).json({
    ok: false,
    error: expected ? error.code : fallback
  });
}

function createPickupLiveIngestRouter({ live, logger = console }) {
  const router = express.Router();
  // The service separately enforces decoded CSV bytes. Leave room here for
  // JSON property names and escaping around that bounded payload.
  const json = express.json({ limit: live.maxBatchBytes + 64 * 1024, type: "application/json" });

  router.post("/pickup-live/ingest", (req, res, next) => {
    if (!live.authenticated(req.get("authorization"))) {
      closeAfterResponse(req, res);
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    next();
  }, json, (req, res) => {
    try {
      const result = live.ingest(live.metadata(req.headers), req.body);
      res.status(result.duplicate ? 200 : 202).json(result);
    } catch (error) {
      if (!(error instanceof PickupError) || error.status >= 500) logger.error?.("[pickup live] ingest_failed");
      sendLiveError(res, error, "live_ingest_failed");
    }
  });

  return router;
}

function createPickupLiveViewerRouter({ live, logger = console }) {
  const router = express.Router();

  function identity(req) {
    return cleanIdentity(req.params.serverId, req.params.matchId, req.params.round);
  }

  router.get("/pickup-live/viewer/:serverId/:matchId/:round", async (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await live.viewerMetadata(identity(req)));
    } catch (error) {
      if (!(error instanceof PickupError) || error.status >= 500) logger.error?.("[pickup live] metadata_failed");
      sendLiveError(res, error, "live_metadata_failed");
    }
  });

  router.get("/pickup-live/viewer/:serverId/:matchId/:round/snapshot", (req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(live.snapshot(identity(req)));
    } catch (error) {
      if (!(error instanceof PickupError) || error.status >= 500) logger.error?.("[pickup live] snapshot_failed");
      sendLiveError(res, error, "live_snapshot_failed");
    }
  });

  router.get("/pickup-live/viewer/:serverId/:matchId/:round/events", (req, res) => {
    try {
      const cursorText = req.get("last-event-id") || req.query.after || "0";
      const after = /^\d{1,10}$/.test(String(cursorText)) ? Number(cursorText) : 0;
      res.status(200);
      res.set({
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.flushHeaders?.();
      live.subscribe(identity(req), after, res);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!(error instanceof PickupError) || error.status >= 500) logger.error?.("[pickup live] stream_failed");
      sendLiveError(res, error, "live_stream_failed");
    }
  });

  return router;
}

module.exports = { createPickupLiveIngestRouter, createPickupLiveViewerRouter };
