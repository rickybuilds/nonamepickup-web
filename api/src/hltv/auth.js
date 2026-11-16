"use strict";
const crypto = require("crypto");
function createAuth(env = process.env) {
  const allowed = new Set((env.HLTV_REVIEW_ALLOWED_USER_IDS || "").split(",").map(x => x.trim()).filter(Boolean));
  const credentials = JSON.parse(env.HLTV_REVIEW_TOKEN_HASHES || "{}");
  for (const [user, hash] of Object.entries(credentials)) {
    if (!/^\d{17,20}$/.test(user) || !allowed.has(user) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) throw new Error("Invalid HLTV reviewer credentials");
  }
  return (req, res, next) => {
    res.set({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
    const token = /^Bearer ([\x21-\x7e]{32,256})$/.exec(req.headers.authorization || "")?.[1];
    if (!token) return res.status(401).json({ ok: false, error: "review_auth_required" });
    const hash = crypto.createHash("sha256").update(token).digest();
    const user = Object.entries(credentials).find(([, value]) => crypto.timingSafeEqual(hash, Buffer.from(value, "hex")))?.[0];
    if (!user) return res.status(403).json({ ok: false, error: "review_access_denied" });
    req.hltvActor = user; next();
  };
}
module.exports = { createAuth };
