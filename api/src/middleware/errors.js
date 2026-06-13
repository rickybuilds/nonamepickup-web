"use strict";

function registerErrorHandlers(app, { sendError, logRouteError }) {
  app.use((error, req, res, next) => {
    if (!error) return next();
    logRouteError("[request error]", error);
    if (error.type === "entity.parse.failed") {
      return sendError(res, 400, "invalid_json");
    }
    if (error.type === "entity.too.large") {
      return sendError(res, 413, "request_too_large");
    }
    return sendError(res, 500, "internal_error");
  });

  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    const allowedPages = [
      "/",
      "/index.html",
      "/live.html",
      "/matches.html",
      "/leaderboard.html",
      "/player.html",
      "/map.html",
      "/compare.html",
      "/vegasodds.html"
    ];

    if (!allowedPages.includes(req.path)) {
      return res.redirect(302, "/");
    }

    res.redirect("/");
  });
}

module.exports = { registerErrorHandlers };
