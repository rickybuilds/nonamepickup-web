"use strict";

const express = require("express");

const TAG_LIMIT = 120;
const TAGS_TO_RETURN = 100;
const MAX_STORED_TAGS = 100;
const POST_COOLDOWN_MS = 30 * 60 * 1000;

// Keep this intentionally conservative: the public box is for short, positive
// tags only. The check runs on the server before anything is written to SQLite.
const BLOCKED_WORDS = [
  "idiot", "moron", "stupid", "dumb", "loser", "clown", "trash", "garbage",
  "lame", "ugly", "sucks", "suck", "hate", "hating", "worst", "terrible", "awful",
  "shut up", "go away", "kill yourself", "kys",
  "nigger", "nigga", "spic", "chink", "kike", "gook", "wetback", "coon", "beaner",
  "faggot", "fag", "tranny", "retard"
];

const BLOCKED_COMPACT_WORDS = [
  "idiot", "moron", "stupid", "loser", "trash", "garbage", "nigger", "nigga",
  "spic", "chink", "kike", "gook", "wetback", "beaner", "faggot", "retard",
  "kys"
];

function normalizeForModeration(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[013457@$]/g, char => ({
      "0": "o",
      "1": "i",
      "3": "e",
      "4": "a",
      "5": "s",
      "7": "t",
      "@": "a",
      "$": "s"
    }[char] || char));
}

function hasBlockedContent(message) {
  const normalized = normalizeForModeration(message);
  const words = normalized.replace(/[^a-z0-9]+/g, " ").trim();
  const compact = words.replace(/\s+/g, "");

  if (/<|>|https?:\/\/|www\.|discord\.gg|discord\.com\/invite|\S+@\S+/i.test(message)) {
    return true;
  }

  if (BLOCKED_WORDS.some(term => new RegExp(`(?:^|\\s)${term.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}(?:$|\\s)`, "i").test(words))) {
    return true;
  }

  return BLOCKED_COMPACT_WORDS.some(term => compact.includes(term));
}

function createCoolestDudeRouter({
  db,
  cleanString,
  positiveInt,
  sendError,
  logRouteError
}) {
  const router = express.Router();
  const postBuckets = new Map();

  router.get("/coolest-dude/tags", (req, res) => {
    try {
      const limit = positiveInt(req.query.limit, TAGS_TO_RETURN, 1, TAGS_TO_RETURN);
      const rows = db.prepare(`
        SELECT id, message, created_at
        FROM coolest_dude_tags
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).all(limit);

      res.setHeader("Cache-Control", "no-store");
      res.json({
        ok: true,
        data: rows.map(row => ({
          id: Number(row.id),
          message: row.message,
          created_at: Number(row.created_at) * 1000
        }))
      });
    } catch (error) {
      logRouteError("[/api/coolest-dude/tags GET]", error);
      sendError(res, 500, "coolest_dude_tags_failed");
    }
  });

  router.post("/coolest-dude/tags", (req, res) => {
    const now = Date.now();
    const clientKey = req.ip || req.socket.remoteAddress || "unknown";
    const nextAllowedAt = postBuckets.get(clientKey) || 0;

    if (nextAllowedAt > now) {
      res.setHeader("Retry-After", String(Math.ceil((nextAllowedAt - now) / 1000)));
      return sendError(res, 429, "tag_rate_limited");
    }

    postBuckets.delete(clientKey);

    try {
      const rawMessage = typeof req.body?.message === "string" ? req.body.message.trim() : "";
      if (rawMessage.length > TAG_LIMIT) return sendError(res, 400, "tag_too_long");

      const message = cleanString(rawMessage, TAG_LIMIT);
      if (!message) return sendError(res, 400, "tag_required");
      if (hasBlockedContent(message)) return sendError(res, 422, "tag_not_allowed");

      const createdAt = Math.floor(now / 1000);
      const result = db.transaction(() => {
        const inserted = db.prepare(`
          INSERT INTO coolest_dude_tags (message, created_at)
          VALUES (?, ?)
        `).run(message, createdAt);

        db.prepare(`
          DELETE FROM coolest_dude_tags
          WHERE id NOT IN (
            SELECT id
            FROM coolest_dude_tags
            ORDER BY created_at DESC, id DESC
            LIMIT ?
          )
        `).run(MAX_STORED_TAGS);

        return inserted;
      })();

      postBuckets.set(clientKey, now + POST_COOLDOWN_MS);

      res.status(201).json({
        ok: true,
        data: {
          id: Number(result.lastInsertRowid),
          message,
          created_at: createdAt * 1000
        }
      });
    } catch (error) {
      logRouteError("[/api/coolest-dude/tags POST]", error);
      sendError(res, 500, "coolest_dude_tag_failed");
    }
  });

  return router;
}

module.exports = { createCoolestDudeRouter, hasBlockedContent };
