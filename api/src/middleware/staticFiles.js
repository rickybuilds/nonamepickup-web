"use strict";

const express = require("express");
const fs = require("fs");
const path = require("path");
const { bootcampEnabled } = require("../routes/bootcamp");

function registerStaticFiles(app, publicDir) {
  if (fs.existsSync(publicDir)) {
    app.use((req, res, next) => {
      let requestPath;
      try { requestPath = path.posix.normalize(decodeURIComponent(req.path).replace(/\\/g, "/")).toLowerCase(); }
      catch { return res.status(400).end(); }
      if (["/bootcamp.html", "/bootcamp-review.html", "/assets/js/bootcamp-hub.js", "/assets/css/bootcamp-hub.css",
        "/assets/js/bootcamp-review.js", "/assets/css/bootcamp-review.css"].includes(requestPath) &&
          !bootcampEnabled(process.env.BOOTCAMP_API_ENABLED)) return res.status(404).end();
      return next();
    });
    app.use(express.static(publicDir, {
      etag: true,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
      index: "index.html"
    }));
  }
}

module.exports = { registerStaticFiles };
