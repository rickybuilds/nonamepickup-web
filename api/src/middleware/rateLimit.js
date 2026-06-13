"use strict";

function registerRateLimit(app, { apiRateLimit, sendError }) {
  const rateBuckets = new Map();
  app.use("/api", (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const bucket = rateBuckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    bucket.count += 1;
    res.setHeader("RateLimit-Limit", String(apiRateLimit));
    res.setHeader("RateLimit-Remaining", String(Math.max(0, apiRateLimit - bucket.count)));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > apiRateLimit) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      return sendError(res, 429, "rate_limit_exceeded");
    }
    next();
  });

  const rateCleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
      if (now >= bucket.resetAt) rateBuckets.delete(key);
    }
  }, 60_000);
  rateCleanupTimer.unref();
}

module.exports = { registerRateLimit };
