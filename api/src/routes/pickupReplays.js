"use strict";

const express = require("express");
const { PickupError } = require("../pickup/errors");
const { parseViewerIdentity } = require("../pickup/viewer");

function closeAfterResponse(req, res) {
  res.set("Connection", "close");
  req.resume();
}

function logIngestionFailure(logger, error, httpStatus, metadata) {
  const fields = {
    event: "pickup_replay_ingestion_failed",
    errorCode: error.code || "ingestion_failed",
    httpStatus,
    sha256: error.sha256 || metadata?.sha256 || null,
    byteSize: error.byteSize || metadata?.contentLength || null,
    quarantine: error.quarantined
      ? (error.quarantineCreated ? "created" : "deduplicated")
      : "none",
    retryable: error.retryable !== false
  };
  logger.error?.(JSON.stringify(fields));
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
      const terminalQuarantine = expected && error.quarantined && error.retryable === false;
      const responseStatus = terminalQuarantine ? 202 : (expected ? error.status : 500);
      logIngestionFailure(logger, error, responseStatus, metadata);
      if (error.code === "upload_too_large" || error.code === "upload_stream_error") {
        closeAfterResponse(req, res);
      }
      return res.status(responseStatus).json({
        ok: false,
        ...(terminalQuarantine ? {
          quarantined: true,
          retryable: false
        } : {}),
        error: expected ? error.code : "ingestion_failed",
        ...(terminalQuarantine ? { sha256: error.sha256 } : {})
      });
    }
  });

  return router;
}

function createPickupReplayViewerRouter({ viewer, logger = console }) {
  const router = express.Router();

  router.get("/pickup-replays/viewer/:matchId/:round", async (req, res) => {
    try {
      const identity = parseViewerIdentity(req.params.matchId, req.params.round);
      res.json(await viewer.metadata(identity.matchId, identity.round));
    } catch (error) {
      const expected = error instanceof PickupError;
      if (!expected || error.status >= 500) logger.error?.("[pickup replay viewer] metadata_failed");
      res.status(expected ? error.status : 500).json({
        ok: false,
        error: expected ? error.code : "replay_load_failed"
      });
    }
  });

  router.get("/pickup-replays/viewer/:matchId/:round/files/:fileName", async (req, res) => {
    try {
      const identity = parseViewerIdentity(req.params.matchId, req.params.round);
      await viewer.streamFile(identity.matchId, identity.round, req.params.fileName, res);
    } catch (error) {
      if (res.headersSent || res.destroyed) return res.destroy();
      const expected = error instanceof PickupError;
      if (!expected || error.status >= 500) logger.error?.("[pickup replay viewer] file_failed");
      res.status(expected ? error.status : 500).json({
        ok: false,
        error: expected ? error.code : "replay_file_failed"
      });
    }
  });

  return router;
}

module.exports = { createPickupReplaysRouter, createPickupReplayViewerRouter };
