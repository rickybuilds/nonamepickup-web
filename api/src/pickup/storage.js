"use strict";

const crypto = require("node:crypto");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { pickupError } = require("./errors");

class PickupStorage {
  constructor(root, { publicRoot = null } = {}) {
    this.root = root;
    this.publicRoot = publicRoot;
    this.incoming = path.join(root, "incoming");
    this.artifacts = path.join(root, "artifacts");
    this.quarantine = path.join(root, "quarantine");
  }

  async ensureReady() {
    if (!this.root || !path.isAbsolute(this.root)) {
      throw pickupError(503, "pickup_ingestion_not_configured");
    }
    const resolvedRoot = path.resolve(this.root);
    const resolvedPublic = this.publicRoot ? path.resolve(this.publicRoot) : null;
    if (resolvedRoot === path.parse(resolvedRoot).root) {
      throw pickupError(503, "unsafe_pickup_storage_configuration");
    }
    if (resolvedPublic &&
        (resolvedRoot === resolvedPublic || resolvedRoot.startsWith(`${resolvedPublic}${path.sep}`))) {
      throw pickupError(503, "unsafe_pickup_storage_configuration");
    }
    await Promise.all([
      fsp.mkdir(this.incoming, { recursive: true, mode: 0o700 }),
      fsp.mkdir(this.artifacts, { recursive: true, mode: 0o700 }),
      fsp.mkdir(this.quarantine, { recursive: true, mode: 0o700 })
    ]);
    const realRoot = await fsp.realpath(this.root);
    if (resolvedPublic) {
      try {
        const realPublic = await fsp.realpath(resolvedPublic);
        if (realRoot === realPublic || realRoot.startsWith(`${realPublic}${path.sep}`)) {
          throw pickupError(503, "unsafe_pickup_storage_configuration");
        }
      } catch (error) {
        if (error instanceof Error && error.code !== "ENOENT") throw error;
      }
    }
    for (const child of [this.incoming, this.artifacts, this.quarantine]) {
      const realChild = await fsp.realpath(child);
      if (!realChild.startsWith(`${realRoot}${path.sep}`)) {
        throw pickupError(503, "unsafe_pickup_storage_configuration");
      }
    }
  }

  randomName(suffix) {
    return `${crypto.randomUUID()}${suffix}`;
  }

  async createIncoming() {
    await this.ensureReady();
    return path.join(this.incoming, this.randomName(".part"));
  }

  async createExtractionDirectory() {
    await this.ensureReady();
    return fsp.mkdtemp(path.join(this.incoming, "extract-"));
  }

  storageKey(matchId, round, sha256, now = new Date()) {
    const year = String(now.getUTCFullYear()).padStart(4, "0");
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const roundName = String(round).padStart(2, "0");
    return path.posix.join(
      year,
      month,
      matchId,
      `round-${roundName}-${sha256}.tar.zst`
    );
  }

  artifactPath(storageKey) {
    const segments = storageKey.split("/");
    if (segments.some(part => !part || part === "." || part === "..")) {
      throw pickupError(500, "invalid_storage_key");
    }
    const resolved = path.resolve(this.artifacts, ...segments);
    const prefix = `${path.resolve(this.artifacts)}${path.sep}`;
    if (!resolved.startsWith(prefix)) throw pickupError(500, "invalid_storage_key");
    return resolved;
  }

  async promote(stagedPath, storageKey) {
    this.assertIncomingPath(stagedPath);
    const destination = this.artifactPath(storageKey);
    await fsp.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    try {
      await fsp.link(stagedPath, destination);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw pickupError(409, "artifact_storage_conflict");
      }
      throw error;
    }
    return destination;
  }

  async quarantineFile(stagedPath, diagnostic) {
    this.assertIncomingPath(stagedPath);
    let exists = true;
    try {
      await fsp.access(stagedPath);
    } catch {
      exists = false;
    }
    if (!exists) return null;

    await this.ensureReady();
    const identifier = crypto.randomUUID();
    const archivePath = path.join(this.quarantine, `${identifier}.tar.zst`);
    const diagnosticPath = path.join(this.quarantine, `${identifier}.json`);
    await fsp.rename(stagedPath, archivePath);
    const safeDiagnostic = {
      id: identifier,
      receivedAt: new Date().toISOString(),
      error: String(diagnostic.code || "invalid_archive").slice(0, 128),
      sha256: /^[a-f0-9]{64}$/.test(diagnostic.sha256 || "") ? diagnostic.sha256 : null,
      byteSize: Number.isSafeInteger(diagnostic.byteSize) ? diagnostic.byteSize : null
    };
    await fsp.writeFile(diagnosticPath, `${JSON.stringify(safeDiagnostic)}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx"
    });
    return identifier;
  }

  async remove(pathname) {
    if (!pathname) return;
    this.assertIncomingPath(pathname);
    await fsp.rm(pathname, { recursive: true, force: true });
  }

  assertIncomingPath(pathname) {
    const resolved = path.resolve(pathname);
    const incoming = path.resolve(this.incoming);
    if (!resolved.startsWith(`${incoming}${path.sep}`)) {
      throw pickupError(500, "unsafe_storage_cleanup_target");
    }
  }
}

module.exports = { PickupStorage };
