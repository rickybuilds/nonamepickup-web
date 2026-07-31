"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const { once } = require("node:events");
const fsp = require("node:fs/promises");
const { validateArchive } = require("./archive");
const { PickupError, pickupError } = require("./errors");

const MATCH_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const SERVER_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const SHA256_PATTERN = /^[a-fA-F0-9]{64}$/;
const ACCEPTED_CONTENT_TYPES = new Set([
  "application/zstd",
  "application/x-zstd",
  "application/x-tar+zstd",
  "application/vnd.tfc.round-replay+tar.zstd"
]);

function tokenMatches(header, expected) {
  if (!expected || typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  if (!supplied) return false;
  const suppliedDigest = crypto.createHash("sha256").update(supplied, "utf8").digest();
  const expectedDigest = crypto.createHash("sha256").update(expected, "utf8").digest();
  return crypto.timingSafeEqual(suppliedDigest, expectedDigest);
}

function parseMetadata(headers, config) {
  const matchId = headers["x-pickup-match-id"];
  const serverId = headers["x-pickup-server-id"];
  const roundText = headers["x-pickup-round"];
  const shaText = headers["x-pickup-sha256"];
  const lengthText = headers["content-length"];
  const contentType = String(headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();

  if (typeof matchId !== "string" || !MATCH_ID_PATTERN.test(matchId)) {
    throw pickupError(400, "invalid_match_id");
  }
  if (typeof serverId !== "string" || !SERVER_ID_PATTERN.test(serverId)) {
    throw pickupError(400, "invalid_server_id");
  }
  if (typeof roundText !== "string" || !/^\d{1,4}$/.test(roundText)) {
    throw pickupError(400, "invalid_round");
  }
  const round = Number(roundText);
  if (round < 1 || round > 9999) throw pickupError(400, "invalid_round");
  if (typeof shaText !== "string" || !SHA256_PATTERN.test(shaText)) {
    throw pickupError(400, "invalid_sha256");
  }
  if (typeof lengthText !== "string" || !/^[1-9]\d*$/.test(lengthText)) {
    throw pickupError(411, "content_length_required");
  }
  const contentLength = Number(lengthText);
  if (!Number.isSafeInteger(contentLength)) throw pickupError(400, "invalid_content_length");
  if (contentLength > config.maxUploadBytes) throw pickupError(413, "upload_too_large");
  if (!ACCEPTED_CONTENT_TYPES.has(contentType)) {
    throw pickupError(415, "unsupported_media_type");
  }
  return {
    matchId,
    serverId,
    round,
    sha256: shaText.toLowerCase(),
    contentLength
  };
}

async function streamRequestToFile(request, destination, metadata, maxUploadBytes) {
  const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
  const hash = crypto.createHash("sha256");
  let byteSize = 0;
  let complete = false;
  let failure = null;
  let rejectFailure;
  const failurePromise = new Promise((_, reject) => {
    rejectFailure = reject;
  });

  function fail(error) {
    if (complete || failure) return;
    failure = error;
    request.pause();
    output.destroy();
    rejectFailure(error);
  }

  request.on("aborted", () => fail(pickupError(400, "upload_aborted")));
  request.on("error", error => fail(pickupError(400, "upload_stream_error", { cause: error })));
  output.on("error", error => fail(pickupError(500, "upload_storage_error", { cause: error })));
  output.on("drain", () => request.resume());

  request.on("data", chunk => {
    if (failure) return;
    byteSize += chunk.length;
    if (byteSize > maxUploadBytes) {
      fail(pickupError(413, "upload_too_large"));
      return;
    }
    hash.update(chunk);
    if (!output.write(chunk)) request.pause();
  });
  request.on("end", () => {
    if (!failure) output.end();
  });

  await Promise.race([once(output, "finish"), failurePromise]);
  complete = true;
  if (failure) throw failure;
  const sha256 = hash.digest("hex");
  if (byteSize !== metadata.contentLength) {
    throw pickupError(400, "content_length_mismatch", { quarantine: true });
  }
  if (sha256 !== metadata.sha256) {
    throw pickupError(422, "sha256_mismatch", { quarantine: true });
  }
  return { byteSize, sha256 };
}

class PickupIngestion {
  constructor({ config, storage, repository, archiveValidator = validateArchive, openArchive, logger = console }) {
    this.config = config;
    this.storage = storage;
    this.repository = repository;
    this.archiveValidator = archiveValidator;
    this.openArchive = openArchive;
    this.logger = logger;
  }

  authenticated(header) {
    return tokenMatches(header, this.config.uploadToken);
  }

  metadata(headers) {
    return parseMetadata(headers, this.config);
  }

  async ingest(request, metadata) {
    const stagedPath = await this.storage.createIncoming();
    let extractionPath = null;
    let received = null;
    let promotedPath = null;
    let createdStorage = false;
    try {
      received = await streamRequestToFile(
        request,
        stagedPath,
        metadata,
        this.config.maxUploadBytes
      );
      extractionPath = await this.storage.createExtractionDirectory();
      const validated = await this.archiveValidator({
        archivePath: stagedPath,
        extractionPath,
        matchId: metadata.matchId,
        round: metadata.round,
        maxFiles: this.config.maxArchiveFiles,
        maxBytes: this.config.maxExtractedBytes,
        zstdCommand: this.config.zstdCommand,
        openArchive: this.openArchive
      });
      const status = validated.complete ? "complete" : "aborted";
      const storageKey = this.storage.storageKey(
        metadata.matchId,
        metadata.round,
        received.sha256
      );
      const stored = await this.repository.persist({
        ...metadata,
        ...received,
        ...validated,
        status,
        storageKey
      }, async () => {
        promotedPath = await this.storage.promote(stagedPath, storageKey);
        createdStorage = true;
        return promotedPath;
      });

      await this.storage.remove(stagedPath);
      return {
        created: stored.created,
        artifactId: stored.artifactId,
        matchId: metadata.matchId,
        round: metadata.round,
        status,
        sha256: received.sha256,
        byteSize: stored.byteSize,
        storageKey: stored.storageKey
      };
    } catch (error) {
      promotedPath = error.promotedPath || promotedPath;
      createdStorage = error.createdStorage || createdStorage;
      if (createdStorage && promotedPath && error.commitAmbiguous !== true) {
        try {
          await fsp.unlink(promotedPath);
        } catch (cleanupError) {
          this.logger.error?.("[pickup replay] storage_rollback_failed");
        }
      }

      const shouldQuarantine =
        error.quarantine === true ||
        (!error.status && received != null);
      if (shouldQuarantine) {
        try {
          await this.storage.quarantineFile(stagedPath, {
            code: error.code || "ingestion_failed",
            sha256: received?.sha256,
            byteSize: received?.byteSize
          });
        } catch {
          await this.storage.remove(stagedPath);
          this.logger.error?.("[pickup replay] quarantine_failed");
        }
      } else {
        await this.storage.remove(stagedPath);
      }
      if (error instanceof PickupError) throw error;
      throw pickupError(500, "ingestion_failed", { cause: error });
    } finally {
      await this.storage.remove(extractionPath);
    }
  }
}

module.exports = {
  ACCEPTED_CONTENT_TYPES,
  PickupIngestion,
  parseMetadata,
  streamRequestToFile,
  tokenMatches
};
