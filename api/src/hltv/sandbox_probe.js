"use strict";
// Linux installer check: confirm the transient service actually has a RAM cap.
const fs = require("fs"), path = require("path");
try {
  const expected = Number(process.argv[2]);
  const entries = fs.readFileSync("/proc/self/cgroup", "utf8").trim().split("\n").map(line => line.split(":"));
  const unified = entries.find(parts => parts[0] === "0" && parts[1] === "");
  const legacy = entries.find(parts => parts[1].split(",").includes("memory"));
  const file = unified ? path.join("/sys/fs/cgroup", unified[2], "memory.max") :
    legacy ? path.join("/sys/fs/cgroup/memory", legacy[2], "memory.limit_in_bytes") : null;
  if (!file) throw new Error("Memory controller unavailable");
  const limit = Number(fs.readFileSync(file, "utf8").trim());
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > expected) throw new Error("Whole-process memory cap not enforced");
  const swap = unified ? Number(fs.readFileSync(path.join("/sys/fs/cgroup", unified[2], "memory.swap.max"), "utf8").trim()) :
    Number(fs.readFileSync(path.join("/sys/fs/cgroup/memory", legacy[2], "memory.memsw.limit_in_bytes"), "utf8").trim()) - limit;
  if (swap !== 0) throw new Error("Swap cap not enforced");
  process.stdout.write(JSON.stringify({ ok: true, memory_limit: limit }));
} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
