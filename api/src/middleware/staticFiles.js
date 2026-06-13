"use strict";

const express = require("express");
const fs = require("fs");

function registerStaticFiles(app, publicDir) {
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, {
      etag: true,
      maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
      index: "index.html"
    }));
  }
}

module.exports = { registerStaticFiles };
