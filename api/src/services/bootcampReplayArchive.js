"use strict";

const crypto = require("node:crypto");

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;

function isLoopback(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function createBootcampReplayArchiveClient({ enabled = false, baseUrl, token, fetchImpl = globalThis.fetch, timeoutMs = 3000 } = {}) {
  if (!enabled) return null;
  if (!baseUrl || !token) throw new Error("Bootcamp replay archive URL and token are required when enabled");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("Invalid Bootcamp archive timeout");
  const base = new URL(baseUrl);
  if (base.search || base.hash || base.username || base.password) throw new Error("Bootcamp archive URL cannot contain credentials, query or fragment");
  if (base.protocol !== "https:" && !isLoopback(base.hostname)) throw new Error("Bootcamp replay archive requires HTTPS except on loopback");
  if (typeof fetchImpl !== "function") throw new Error("Fetch API is unavailable");

  return {
    async getTftr(ghostId) {
      const id = Number(ghostId);
      if (!Number.isSafeInteger(id) || id < 1) throw new Error("Invalid Bootcamp archive ghost ID");
      const url = new URL(`${base.pathname.replace(/\/$/, "")}/v1/ghosts/${id}/tftr`, base.origin);
      const response = await fetchImpl(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.nn.ghost-sidecar" },
        signal: AbortSignal.timeout(timeoutMs)
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Bootcamp replay archive returned HTTP ${response.status}`);
      if (!/^application\/vnd\.nn\.ghost-sidecar(?:\s*;|$)/i.test(response.headers.get("content-type") || ""))
        throw new Error("Bootcamp replay archive returned an invalid content type");
      const declaredLength = Number(response.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > MAX_ARCHIVE_BYTES) throw new Error("Bootcamp replay archive object is oversized");
      const data = Buffer.from(await response.arrayBuffer());
      if (data.length < 27 || data.length > MAX_ARCHIVE_BYTES || data.toString("ascii", 0, 4) !== "TFTR")
        throw new Error("Bootcamp replay archive returned invalid TFTR bytes");
      const sha256 = crypto.createHash("sha256").update(data).digest("hex");
      const declaredSha256 = response.headers.get("x-tftr-sha256");
      if (!/^[a-f0-9]{64}$/i.test(declaredSha256 || "") || declaredSha256.toLowerCase() !== sha256)
        throw new Error("Bootcamp replay archive checksum mismatch");
      return { data, sha256 };
    }
  };
}

module.exports = { MAX_ARCHIVE_BYTES, createBootcampReplayArchiveClient };
