"use strict";
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env"), quiet: true });
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { OFFICIAL, command, releaseRoot, verifyRelease } = require("../src/hltv/upstreamRelease");
function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) { console.log("Usage: node scripts/updateHltvUpstream.js [--check | --apply] [--revision 40_HEX_SHA]\nDefault: check official HEAD only. Apply checks and pins an immutable upstream checkout; never modifies upstream files."); return; }
  let apply = false, revision = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") apply = true;
    else if (args[i] === "--check") { /* default */ }
    else if (args[i] === "--revision" && /^[a-f0-9]{40}$/.test(args[i + 1] || "")) revision = args[++i];
    else throw new Error("Invalid update arguments; use --help");
  }
  const root = releaseRoot(process.env.HLTV_UPSTREAM_ROOT || "/opt/noname-hltv-tools");
  const pin = path.join(root, "active.json");
  const installed = fs.existsSync(pin) ? JSON.parse(fs.readFileSync(pin, "utf8")).sha : null;
  const sha = revision || command("git", ["ls-remote", OFFICIAL, "HEAD"]).split(/\s+/)[0];
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Upstream did not return a revision");
  if (!apply) { console.log(JSON.stringify({ repository: OFFICIAL, installed, candidate: sha, update_available: installed !== sha, changed: false })); return; }
  fs.mkdirSync(path.join(root, "releases"), { recursive: true, mode: 0o700 });
  const lock = path.join(root, "update.lock");
  const fd = fs.openSync(lock, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, started_at: Date.now() }));
    const target = path.join(root, "releases", sha);
    if (!fs.existsSync(target)) {
      const stage = path.join(root, "releases", ".staging-" + crypto.randomUUID());
      command("git", ["clone", "--no-checkout", "--", OFFICIAL, stage]);
      command("git", ["-C", stage, "checkout", "--detach", sha]);
      fs.renameSync(stage, target);
    }
    const release = verifyRelease(root, sha);
    const python = process.env.HLTV_UPSTREAM_PYTHON || "python3";
    const probe = command(python, ["-I", path.resolve(__dirname, "../src/hltv/upstream_bridge.py")], {
      input: JSON.stringify({ upstream_root: release.root, check: true }), env: { PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "" },
    });
    const capability = JSON.parse(probe);
    if (capability.ok !== true || capability.export_version !== 16) throw new Error("Unsupported upstream Python/export API; keep the existing pin until the adapter is updated");
    // Upstream-supplied regression checks, not copied detector implementations.
    for (const file of ["test_conc_pause.cjs", "test_blood_hits.cjs", "test_visible_shots.cjs"]) {
      command(process.execPath, [path.join(target, "tests", file)], { cwd: target });
    }
    const concProbe = JSON.parse(command(process.execPath, [path.resolve(__dirname, "../src/hltv/upstream_conc.js"), "--probe", target]));
    if (concProbe.ok !== true) throw new Error("Unsupported concussion adapter contract");
    if (process.platform === "linux") {
      const { upstreamConfig, sandboxCommand } = require("../src/hltv/upstream");
      const memory = upstreamConfig().memoryBytes, scratch = fs.mkdtempSync(path.join(root, ".sandbox-check-"));
      try {
        const check = sandboxCommand(process.execPath, [path.resolve(__dirname, "../src/hltv/sandbox_probe.js"), String(memory)], scratch, memory);
        if (JSON.parse(command(check.bin, check.args, { timeout: 30000 })).ok !== true) throw new Error("Sandbox compatibility failed");
      } finally { fs.rmdirSync(scratch); }
    }
    verifyRelease(root, sha);
    const temporary = pin + "." + crypto.randomUUID();
    const pinFd = fs.openSync(temporary, "wx", 0o600);
    try { fs.writeFileSync(pinFd, JSON.stringify({ sha, repository: OFFICIAL, activated_at: Date.now(), previous: installed })); fs.fsyncSync(pinFd); }
    finally { fs.closeSync(pinFd); }
    fs.renameSync(temporary, pin);
    console.log(JSON.stringify({ repository: OFFICIAL, installed: sha, previous: installed, compatibility_checks: "passed", changed: installed !== sha }));
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
try { main(); } catch (error) { console.error("[HLTV upstream update]", error.message); process.exitCode = 1; }
