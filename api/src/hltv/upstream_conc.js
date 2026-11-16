"use strict";
// Transport/typed-array adaptation only; the estimate is Ghosty's original code.
const fs = require("fs"), path = require("path"), zlib = require("zlib");
function estimate(upstreamRoot, directory) {
  const read = (name, max) => {
    const file = path.join(directory, name);
    if (fs.statSync(file).size > max) throw new Error("upstream_output_too_large");
    return fs.readFileSync(file);
  };
  const meta = JSON.parse(zlib.gunzipSync(read("meta.json.gz", 32 * 1024 * 1024), { maxOutputLength: 64 * 1024 * 1024 }));
  const bytes = zlib.gunzipSync(read("data.bin.gz", 256 * 1024 * 1024), { maxOutputLength: 512 * 1024 * 1024 });
  const log = JSON.parse(read("matched-log.json", 32 * 1024 * 1024));
  // Keep typed views on the decompressed buffer; do not copy up to 512 MiB.
  const buffer = bytes.buffer, base = bytes.byteOffset;
  const typed = (name, Type) => {
    const section = meta.buffers?.[name];
    if (!Array.isArray(section) || section.length !== 2 || section.some(v => !Number.isSafeInteger(v) || v < 0) ||
        section[0] % 4 || section[1] % 4 || section[0] + section[1] > bytes.byteLength) throw new Error("unsupported_upstream_layout");
    return new Type(buffer, base + section[0], section[1] / 4);
  };
  if (!Number.isSafeInteger(meta.frames) || meta.frames < 1 || !Array.isArray(meta.slots) || meta.slots.length > 64) throw new Error("unsupported_upstream_layout");
  const data = { buf: buffer, n: meta.frames, times: typed("times", Float32Array), slots: meta.slots, pos: {}, info: {} };
  if (data.times.length !== data.n) throw new Error("unsupported_upstream_layout");
  for (const slot of data.slots) {
    data.pos[slot] = typed("pos" + slot, Float32Array); data.info[slot] = typed("info" + slot, Uint32Array);
    if (data.pos[slot].length !== data.n * 5 || data.info[slot].length !== data.n) throw new Error("unsupported_upstream_layout");
  }
  const Conc = require(path.join(upstreamRoot, "web/conc.js"));
  // Do not run/return proximity estimates as a fallback to rejected log pairing.
  const result = Conc.withLog(meta, data, { settings: { ...Conc.defaults }, bySlot: {} }, log);
  if (result.log !== log) throw new Error("upstream_rejected_log");
  const windows = [];
  for (const [slot, rows] of Object.entries(result.bySlot)) for (const row of rows) {
    const player = meta.players.find(p => p.ent === Number(slot) && p.steam === row.steam && p.first <= row.t + 1 && (p.left == null || p.left >= row.t - 1));
    windows.push({ player_steam_id: row.steam, player_name: player?.name || null, slot: Number(slot), time_seconds: row.t,
      end_seconds: row.end, unpaused_seconds: Conc.elapsed(row.t, row.end, result.pauses),
      assumed_class_duration_seconds: row.duration, class_id: row.cls, log_line: row.line });
    if (windows.length > 5000) throw new Error("too_many_concussion_windows");
  }
  return { version: 1, mode: "logged_events_estimated_timers", map: meta.map, duration_seconds: meta.end - meta.start,
    decoder_warnings: meta.warnings || [],
    settings: result.settings, pauses: result.pauses, windows, logged_events: log.events.length,
    limitation: "Concussion events are logged; duration and remaining effect are estimates. This is not anomaly detection or a cheating verdict." };
}
function probe(upstreamRoot) {
  const os = require("os"), directory = fs.mkdtempSync(path.join(os.tmpdir(), "hltv-conc-probe-"));
  try {
    const count = 2801, bytes = Buffer.alloc(count * 28), times = new Float32Array(bytes.buffer, bytes.byteOffset, count);
    for (let i = 0; i < count; i++) times[i] = i / 20;
    const infoOffset = count * 24, info = new Uint32Array(bytes.buffer, bytes.byteOffset + infoOffset, count);
    info.fill(1 | (6 << 8));
    const meta = { frames: count, slots: [1], file: "compatibility.dem", map: "test", game: "tfc", start: 0, end: 140,
      pauses: [{ t: 5, paused: true }, { t: 105, paused: false }], levels: [{ t: 0 }], kills: [],
      players: [{ ent: 1, steam: "S1", first: 0, left: null }],
      buffers: { times: [0, count * 4], pos1: [count * 4, count * 20], info1: [infoOffset, count * 4] } };
    const log = { version: 1, file: meta.file, map: meta.map, demoEnd: meta.end, alignment: { anchors: 30 },
      events: [{ t: 2, slot: 1, steam: "S1", line: 1 }], stops: [] };
    fs.writeFileSync(path.join(directory, "meta.json.gz"), zlib.gzipSync(JSON.stringify(meta)));
    fs.writeFileSync(path.join(directory, "data.bin.gz"), zlib.gzipSync(bytes));
    fs.writeFileSync(path.join(directory, "matched-log.json"), JSON.stringify(log));
    const result = estimate(upstreamRoot, directory), window = result.windows[0];
    if (result.windows.length !== 1 || window.end_seconds !== 117 || window.unpaused_seconds !== 15) throw new Error("incompatible_upstream_concussion_contract");
    return { ok: true, capability: "matched_log_pause_aware_concussion_estimate" };
  } finally {
    for (const file of ["meta.json.gz", "data.bin.gz", "matched-log.json"]) { try { fs.unlinkSync(path.join(directory, file)); } catch {} }
    fs.rmdirSync(directory);
  }
}
if (require.main === module) {
  try { const result = process.argv[2] === "--probe" ? probe(process.argv[3]) : estimate(process.argv[2], process.argv[3]); const output = JSON.stringify(result); if (output.length > 2 * 1024 * 1024) throw new Error("result_too_large"); process.stdout.write(output); }
  catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
}
module.exports = { estimate, probe };
