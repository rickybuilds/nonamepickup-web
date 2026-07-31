"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const yellowPath = path.join(root, "assets", "models", "pipebomb_yellow.glb");

function parseGlb(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "glTF" || buffer.readUInt32LE(4) !== 2) {
    throw new Error("Expected a GLB version 2 file");
  }

  const chunks = [];
  for (let offset = 12; offset < buffer.length;) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    chunks.push({ type, data: buffer.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }

  const jsonChunk = chunks.find(chunk => chunk.type === "JSON");
  if (!jsonChunk) throw new Error("GLB has no JSON chunk");
  const json = JSON.parse(jsonChunk.data.toString("utf8").replace(/\0/g, "").trim());
  return { json, chunks };
}

function encodeGlb(json, chunks) {
  const jsonText = Buffer.from(JSON.stringify(json), "utf8");
  const jsonPadding = (4 - (jsonText.length % 4)) % 4;
  const jsonData = Buffer.concat([jsonText, Buffer.alloc(jsonPadding, 0x20)]);

  const encodedChunks = chunks.map(chunk => {
    const data = chunk.type === "JSON" ? jsonData : chunk.data;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(data.length, 0);
    header.write(chunk.type, 4, 4, "ascii");
    return Buffer.concat([header, data]);
  });

  const body = Buffer.concat(encodedChunks);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, 4, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

const original = fs.readFileSync(yellowPath);
const { json, chunks } = parseGlb(original);
let removed = 0;

for (const mesh of json.meshes || []) {
  mesh.primitives = (mesh.primitives || []).filter(primitive => {
    const material = json.materials?.[primitive.material];
    const isBlueRemap = String(material?.name || "").toLowerCase() === "remap_pbomb2.bmp";
    if (isBlueRemap) removed += 1;
    return !isBlueRemap;
  });
}

if (removed > 1) throw new Error(`Refusing to remove ${removed} blue primitives`);
if (removed === 1) fs.writeFileSync(yellowPath, encodeGlb(json, chunks));

const remaining = new Set(
  (json.meshes || []).flatMap(mesh => mesh.primitives || [])
    .map(primitive => String(json.materials?.[primitive.material]?.name || "").toLowerCase())
);
if (!remaining.has("remap_pbomb.bmp") || remaining.has("remap_pbomb2.bmp")) {
  throw new Error("Yellow pipebomb material validation failed");
}

console.log(removed === 1 ? "Removed blue primitive from yellow pipebomb GLB" : "Yellow pipebomb GLB already fixed");
