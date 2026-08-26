const textDecoder = new TextDecoder();

function readString(bytes, start, length) {
  const slice = bytes.subarray(start, start + length);
  const end = slice.indexOf(0);
  return textDecoder.decode(end === -1 ? slice : slice.subarray(0, end)).trim();
}

function readOctal(bytes, start, length) {
  const value = readString(bytes, start, length).replace(/\0/g, "").trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function parsePax(bytes) {
  const values = {};
  let offset = 0;
  while (offset < bytes.length) {
    const space = bytes.indexOf(32, offset);
    if (space === -1) break;
    const length = Number.parseInt(textDecoder.decode(bytes.subarray(offset, space)), 10);
    if (!Number.isFinite(length) || length <= 0) break;
    const record = textDecoder.decode(bytes.subarray(space + 1, offset + length - 1));
    const equals = record.indexOf("=");
    if (equals !== -1) values[record.slice(0, equals)] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function parseTar(bytes) {
  const files = [];
  let offset = 0;
  let longName = "";
  let pax = {};

  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) break;

    const name = readString(header, 0, 100);
    const prefix = readString(header, 345, 155);
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.length) throw new Error("The game asset archive is truncated.");

    const data = bytes.subarray(dataStart, dataEnd);
    if (type === "x") {
      pax = parsePax(data);
    } else if (type === "L") {
      longName = readString(data, 0, data.length);
    } else {
      const path = (pax.path || longName || (prefix ? `${prefix}/${name}` : name))
        .replace(/^\.\//, "")
        .replaceAll("\\", "/");
      if (path && (type === "0" || type === "\0")) files.push({ path, data });
      longName = "";
      pax = {};
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return files;
}

async function fetchPart(part, manifestUrl, onProgress) {
  const url = new URL(part.url, manifestUrl);
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`Failed to download game assets (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length !== part.bytes) throw new Error(`Game asset part ${part.url} has the wrong size.`);
  onProgress(bytes.length);
  return bytes;
}

export async function loadGameAssets(manifestPath, onStatus = () => {}) {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support streaming gzip decompression.");
  }

  const manifestUrl = new URL(manifestPath, location.href);
  const response = await fetch(manifestUrl, { cache: "no-cache" });
  if (!response.ok) throw new Error("The TFC game asset manifest is unavailable.");
  const manifest = await response.json();
  if (manifest.format !== "tar+gzip+parts" || !Array.isArray(manifest.parts)) {
    throw new Error("The TFC game asset manifest is invalid.");
  }

  let loaded = 0;
  const report = bytes => {
    loaded += bytes;
    const percent = Math.round((loaded / manifest.compressedBytes) * 100);
    onStatus(`Downloading TFC assets… ${percent}%`);
  };
  const parts = [];
  for (const part of manifest.parts) parts.push(await fetchPart(part, manifestUrl, report));

  const compressed = new Uint8Array(manifest.compressedBytes);
  let writeOffset = 0;
  for (const part of parts) {
    compressed.set(part, writeOffset);
    writeOffset += part.length;
  }

  onStatus("Decompressing TFC assets…");
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  const archive = new Uint8Array(await new Response(stream).arrayBuffer());
  const files = parseTar(archive);
  onStatus(`Prepared ${files.length.toLocaleString()} TFC files.`);
  return files;
}

export function mountGameAssets(FS, files, extras) {
  FS.mkdirTree("/rodir");
  for (const file of files) {
    const path = `/rodir/${file.path}`;
    FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    FS.writeFile(path, file.data);
  }
  if (extras) FS.writeFile("/rodir/tfc/tf15client-extras.pk3", extras);
  FS.chdir("/rodir");
}
