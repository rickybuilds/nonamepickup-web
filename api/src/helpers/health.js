"use strict";

function createHealthHandler({ label, check, payload, onError }) {
  return async function healthHandler(req, res) {
    res.setHeader("Cache-Control", "no-store");

    try {
      if (check) {
        await check(req, res);
      }

      const resolvedPayload = typeof payload === "function" ? await payload(req, res) : payload;
      const responsePayload = resolvedPayload && typeof resolvedPayload === "object" && !Array.isArray(resolvedPayload)
        ? resolvedPayload
        : {};

      res.json({ ok: true, ...responsePayload });
    } catch (error) {
      if (onError) {
        onError(error, req, res, label);
      }
    }
  };
}

module.exports = { createHealthHandler };
