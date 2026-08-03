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
    const sha256 = /^[a-f0-9]{64}$/.test(diagnostic.sha256 || "")
      ? diagnostic.sha256
      : null;
    if (!sha256) throw pickupError(500, "quarantine_sha256_required");

    const existing = await this.findQuarantineBySha256(sha256);
    if (existing) {
      await this.remove(stagedPath);
      return { id: existing.id, created: false };
    }

    const identifier = sha256;
    const archivePath = path.join(this.quarantine, `${identifier}.tar.zst`);
    const diagnosticPath = path.join(this.quarantine, `${identifier}.json`);
    let created = false;
    try {
      await fsp.link(stagedPath, archivePath);
      created = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const safeDiagnostic = {
      id: identifier,
      receivedAt: new Date().toISOString(),
      error: String(diagnostic.code || "invalid_archive").slice(0, 128),
      sha256,
      byteSize: Number.isSafeInteger(diagnostic.byteSize) ? diagnostic.byteSize : null
    };
    try {
      await fsp.writeFile(diagnosticPath, `${JSON.stringify(safeDiagnostic)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    await this.remove(stagedPath);
    return { id: identifier, created };
  }

  async findQuarantineBySha256(sha256) {
    const canonicalArchive = path.join(this.quarantine, `${sha256}.tar.zst`);
    const canonicalDiagnostic = path.join(this.quarantine, `${sha256}.json`);
    if (await this.pathsExist(canonicalArchive, canonicalDiagnostic)) {
      return { id: sha256 };
    }

    const entries = await fsp.readdir(this.quarantine, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const id = entry.name.slice(0, -5);
      try {
        const value = JSON.parse(await fsp.readFile(path.join(this.quarantine, entry.name), "utf8"));
        if (value.sha256 === sha256 &&
            await this.pathsExist(path.join(this.quarantine, `${id}.tar.zst`), path.join(this.quarantine, entry.name))) {
          return { id };
        }
      } catch (error) {
        if (error.code === "ENOENT" || error instanceof SyntaxError) continue;
        throw error;
      }
    }
    return null;
  }

  async pathsExist(...paths) {
    const results = await Promise.all(paths.map(async pathname => {
      try {
        await fsp.access(pathname);
        return true;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    }));
    return results.every(Boolean);
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
