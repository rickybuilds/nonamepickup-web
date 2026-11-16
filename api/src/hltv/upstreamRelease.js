"use strict";
const fs = require("fs"), path = require("path"), { spawnSync } = require("child_process");
const OFFICIAL = "https://github.com/ghostile/goldsrc-hltv-tools.git";
function command(bin, args, options = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, ...options });
  if (r.error || r.status !== 0) throw new Error(`${path.basename(bin)} check failed: ${(r.error?.message || r.stderr || r.stdout || "unknown").slice(0, 1000)}`);
  return r.stdout.trim();
}
function releaseRoot(root) {
  if (!root || !path.isAbsolute(root)) throw new Error("Absolute upstream root required");
  root = path.resolve(root);
  const repository = path.resolve(__dirname, "../../..");
  const relative = path.relative(repository, root);
  if (!relative || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) throw new Error("Keep upstream outside the website repository");
  if (fs.existsSync(root) && fs.realpathSync(root) !== root) throw new Error("Upstream root cannot contain symlinks");
  return root;
}
function verifyRelease(root, sha) {
  root = releaseRoot(root);
  if (!/^[a-f0-9]{40}$/.test(sha || "")) throw new Error("Invalid upstream revision");
  const dir = path.join(root, "releases", sha);
  if (fs.realpathSync(dir) !== dir) throw new Error("Unsafe upstream release path");
  if (command("git", ["-C", dir, "remote", "get-url", "origin"]) !== OFFICIAL ||
      command("git", ["-C", dir, "rev-parse", "HEAD"]) !== sha ||
      command("git", ["-C", dir, "status", "--porcelain", "--untracked-files=all"])) throw new Error("Upstream release is dirty or has unexpected origin/revision");
  for (const file of ["LICENSE", "goldsrc_demo.py", "demo_viewer.py", "server_log.py", "web/conc.js"]) {
    const target = path.join(dir, file);
    if (!fs.lstatSync(target).isFile() || fs.realpathSync(target) !== target) throw new Error("Unsafe/missing upstream API file");
  }
  return { root: dir, sha, repository: OFFICIAL };
}
function activeRelease(root) {
  root = releaseRoot(root);
  const file = path.join(root, "active.json");
  if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 4096) throw new Error("Unsafe upstream pin");
  return verifyRelease(root, JSON.parse(fs.readFileSync(file, "utf8")).sha);
}
module.exports = { OFFICIAL, command, releaseRoot, verifyRelease, activeRelease };
