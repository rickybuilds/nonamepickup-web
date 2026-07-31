"use strict";

const express = require("express");
const { PickupError } = require("../pickup/errors");

function closeAfterResponse(req, res) {
  res.set("Connection", "close");
  res.once("finish", () => {
    if (!req.complete) req.destroy();
  });
}

function createPickupReplaysRouter({ ingestion, logger = console }) {
  const router = express.Router();

  router.post("/pickup-replays", async (req, res) => {
    if (!ingestion.authenticated(req.get("authorization"))) {
      closeAfterResponse(req, res);
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    let metadata;
    try {
      metadata = ingestion.metadata(req.headers);
    } catch (error) {
      closeAfterResponse(req, res);
      const status = error instanceof PickupError ? error.status : 400;
      const code = error instanceof PickupError ? error.code : "invalid_request";
      return res.status(status).json({ ok: false, error: code });
    }

    try {
      const result = await ingestion.ingest(req, metadata);
      return res.status(result.created ? 201 : 200).json({
        ok: true,
        artifactId: result.artifactId,
        matchId: result.matchId,
        round: result.round,
        status: result.status,
        sha256: result.sha256,
        byteSize: result.byteSize,
        storageKey: result.storageKey
      });
    } catch (error) {
      if (req.aborted || res.headersSent || res.destroyed) return;
      const expected = error instanceof PickupError;
      if (!expected || error.status >= 500) logger.error?.("[pickup replay] ingestion_failed");
      if (error.code === "upload_too_large" || error.code === "upload_stream_error") {
        closeAfterResponse(req, res);
      }
      return res.status(expected ? error.status : 500).json({
        ok: false,
        error: expected ? error.code : "ingestion_failed"
      });
    }
  });

  return router;
}

module.exports = { createPickupReplaysRouter };
