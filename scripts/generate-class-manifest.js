"use strict";

const fs = require("fs");
const path = require("path");

const classDir = path.resolve(__dirname, "..", "assets", "images", "classes");
const manifestPath = path.join(classDir, "manifest.json");
const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

const files = fs.readdirSync(classDir, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => entry.name)
  .filter(name => allowedExtensions.has(path.extname(name).toLowerCase()))
  .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

fs.writeFileSync(manifestPath, `${JSON.stringify(files, null, 2)}\n`);

console.log(`Wrote ${path.relative(process.cwd(), manifestPath)} (${files.length} files)`);
