"use strict";

const express = require("express");

function buildMutedPayload(rows, cleanString) {
  const messages = (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row === "object" && !Array.isArray(row))
    .map((row, index) => {
      const timestamp = cleanString(row.timestamp, 100);
      const parsedTime = Date.parse(timestamp);
      return {
        id: cleanString(row.messageId, 100) || `message-${index + 1}`,
        timestamp,
        timestamp_ms: Number.isFinite(parsedTime) ? parsedTime : null,
        user_id: cleanString(row.userId, 100),
        username: cleanString(row.username, 100) || "Unknown user",
        guild_name: cleanString(row.guildName, 100),
        channel_id: cleanString(row.channelId, 100),
        channel_name: cleanString(row.channelName, 100) || "Unknown channel",
        content: cleanString(row.content, 4000)
      };
    })
    .sort((a, b) => (b.timestamp_ms ?? 0) - (a.timestamp_ms ?? 0));

  return {
    ok: true,
    generated_at: Date.now(),
    summary: {
      messages: messages.length,
      users: new Set(messages.map(message => message.user_id || message.username)).size,
      channels: new Set(messages.map(message => message.channel_id || message.channel_name)).size
    },
    messages
  };
}

function createMutedRouter({ mutedLogsFile, fs, cleanString, logRouteError }) {
  const router = express.Router();

  router.get("/muted", async (req, res) => {
    try {
      const raw = await fs.promises.readFile(mutedLogsFile, "utf8");
      const rows = JSON.parse(raw || "[]");
      if (!Array.isArray(rows)) throw new Error("muted_logs_not_array");

      res.setHeader("Cache-Control", "public, max-age=5, stale-while-revalidate=15");
      res.json(buildMutedPayload(rows, cleanString));
    } catch (error) {
      logRouteError("[/api/muted]", error);
      res.status(503).json({
        ok: false,
        error: "muted_data_unavailable",
        summary: { messages: 0, users: 0, channels: 0 },
        messages: []
      });
    }
  });

  return router;
}

module.exports = { buildMutedPayload, createMutedRouter };
