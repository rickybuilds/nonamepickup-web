"use strict";
const fs = require("fs"), path = require("path"), crypto = require("crypto");
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}
class Storage {
  constructor(root, { publicRoot, maxBytes = 268435456 } = {}) {
    if (!root || !path.isAbsolute(root)) throw new Error("HLTV absolute private storage root required");
    this.root = path.resolve(root); this.maxBytes = maxBytes;
    const repository = path.resolve(__dirname, "../../..");
    if (this.root === repository || inside(repository, this.root)) throw new Error("HLTV storage must be outside the website repository");
    if (publicRoot && (this.root === path.resolve(publicRoot) || inside(path.resolve(publicRoot), this.root))) throw new Error("HLTV storage cannot be public");
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 });
    if (fs.realpathSync(this.root) !== this.root || fs.lstatSync(this.root).isSymbolicLink()) throw new Error("HLTV root cannot contain symlinks");
  }
  resolve(key, extension = ".dem") {
    if (typeof key !== "string" || key.includes("\\") || key.includes("\0") || key.includes(":")) throw new Error("Unsafe storage key");
    const parts = key.split("/");
    if (parts.some(p => !p || p === "." || p === "..") || !key.endsWith(extension)) throw new Error("Unsafe storage key");
    const target = path.resolve(this.root, ...parts);
    if (!inside(this.root, target)) throw new Error("Path outside storage root");
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Symlink in storage key");
    }
    if (fs.realpathSync(target) !== target) throw new Error("Storage path identity changed");
    return target;
  }
  inspect(key) {
    const target = this.resolve(key);
    const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > this.maxBytes) throw new Error("Invalid demo size or file type");
      const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
      let count;
      while ((count = fs.readSync(fd, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, count));
      const after = fs.fstatSync(fd), named = fs.lstatSync(target);
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || named.ino !== stat.ino || named.dev !== stat.dev) throw new Error("Demo changed during read");
      return { path: target, size: stat.size, sha256: hash.digest("hex"), ino: stat.ino, dev: stat.dev };
    } finally { fs.closeSync(fd); }
  }
  verify(demo) {
    const file = this.inspect(demo.storage_key);
    if (file.sha256 !== demo.sha256 || file.size !== demo.size_bytes) throw new Error("Demo checksum mismatch");
    return file;
  }
  freeBytes() { const s = fs.statfsSync(this.root); return s.bavail * s.bsize; }
}
module.exports = { Storage, inside };
