(() => {
  "use strict";
  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) {
      let code = ""; try { code = (await response.json()).error; } catch {}
      if (code === "tactical_not_prepared") throw new Error("This round has not been prepared yet. The recording is still being processed. Try reloading this round shortly.");
      throw new Error(`Could not load round data (${response.status}). Check the match and round, then try again.`);
    }
    return response.json();
  }
  function imageFrom(url, signal) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const finish = (callback, result) => {
        signal?.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
        callback(result);
      };
      const abort = () => { image.removeAttribute("src"); finish(reject, new DOMException("Overview loading cancelled", "AbortError")); };
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      image.onload = () => finish(resolve, image);
      image.onerror = () => finish(reject, new Error("Map overview image could not be loaded."));
      image.src = url;
    });
  }
  async function overview(map, signal) {
    const manifest = await json("/assets/tfc/overviews/manifest.json", signal);
    const file = manifest[map.toLowerCase()];
    if (!file) throw new Error("This map does not have an overview yet.");
    const root = "/assets/tfc/overviews/" + encodeURIComponent(file);
    const response = await fetch(root + ".txt", { signal });
    if (!response.ok) throw new Error("Map overview coordinates are unavailable.");
    const metadata = await response.text(), image = await imageFrom(root + ".bmp", signal);
    const zoom = /^\s*zoom\s+([-+\d.]+)/im.exec(metadata), origin = /^\s*origin\s+([-+\d.]+)\s+([-+\d.]+)/im.exec(metadata), rotated = /^\s*rotated\s+([01])/im.exec(metadata);
    if (!zoom || !origin || !rotated || !(Number(zoom[1]) > 0)) throw new Error("Invalid overview coordinates.");
    const oriented = ["shutdown2_lg2", "alchimy_lg", "openfire_lowgrens", "blutopia_tfp", "fry_baked_lg", "snow_gutter", "demolish2_b4r", "demolish2_b6", "schtop", "siege", "waterwar_lg", "voltage_lg", "mortality_lg", "viridian", "siden_lg", "foundry_b3", "mm_chateau_b1", "mm_chateau_b2", "mm_chateau_b3", "mm_chateau_b4", "2mesa3_lg", "ostargh", "2trof_b4", "turbo_b10", "congestus_lg"].includes(map.toLowerCase());
    const crop = oriented && image.naturalWidth === 1920 && image.naturalHeight === 1080 ? 240 : 0;
    const bg = document.createElement("canvas"); bg.width = image.naturalWidth - crop * 2; bg.height = image.naturalHeight;
    const context = bg.getContext("2d");
    if (!oriented) { context.translate(0, bg.height); context.scale(1, -1); context.drawImage(image, 0, 0); }
    else context.drawImage(image, crop, 0, bg.width, bg.height, 0, 0, bg.width, bg.height);
    context.setTransform(1, 0, 0, 1, 0, 0);
    const pixels = context.getImageData(0, 0, bg.width, bg.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const r = pixels.data[i], g = pixels.data[i + 1], b = pixels.data[i + 2];
      if ((r === 0 && g === 255 && b === 0) || (g > 80 && r < 50 && b < 80 && g > r * 1.5 && g > b * 1.2) ||
          (map.toLowerCase() === "shutdown2_lg2" && g > 45 && r < 100 && b < 80 && g > r * 1.25 && g > b * 1.5)) {
        pixels.data[i] = 16; pixels.data[i + 1] = 21; pixels.data[i + 2] = 28;
      }
    }
    context.putImageData(pixels, 0, 0);
    const scale = bg.width * Number(zoom[1]) / 8192, ox = Number(origin[1]), oy = Number(origin[2]);
    return { background: bg, project: (x, y) => Number(rotated[1])
      ? [bg.width / 2 + (x - ox) * scale, bg.height / 2 - (y - oy) * scale]
      : [bg.width / 2 - (y - oy) * scale, bg.height / 2 - (x - ox) * scale] };
  }
  function frameAt(data, player, at) {
    const frames = player.frames, stride = data.stride;
    let low = 0, high = frames.length / stride;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * stride] <= at) low = middle + 1; else high = middle; }
    if (!low) return null;
    const index = (low - 1) * stride;
    if (at - frames[index] > Math.max(2000, data.sampleIntervalMs * 4)) return null;
    const frame = frames.slice(index, index + stride), next = index + stride;
    if (next < frames.length && frame[5] === 1 && frames[next + 5] === 1 &&
        frames[next] - frame[0] <= Math.max(2000, data.sampleIntervalMs * 4) &&
        Math.hypot(frames[next + 1] - frame[1], frames[next + 2] - frame[2]) < 1200) {
      const fraction = (at - frame[0]) / (frames[next] - frame[0]);
      if (Number.isFinite(fraction)) for (const field of [1, 2, 3]) frame[field] += (frames[next + field] - frame[field]) * fraction;
    }
    return frame;
  }
  function flagAt(data, byId, flag, at) {
    const frames = flag.frames;
    let low = 0, high = frames.length / 6;
    while (low < high) { const middle = Math.floor((low + high) / 2); if (frames[middle * 6] <= at) low = middle + 1; else high = middle; }
    if (!low) return null;
    const index = (low - 1) * 6;
    if (at - frames[index] > Math.max(2000, data.sampleIntervalMs * 4) || frames[index + 4] < 0) return null;
    const state = frames[index + 4], carrier = frames[index + 5];
    if (carrier > 0) {
      const player = byId.get(carrier), frame = player && frameAt(data, player, at);
      return frame?.[5] === 1 ? { x: frame[1], y: frame[2], state, carrier } : null;
    }
    // State 1 without a carrier can be a hidden objective, not a flag at base.
    if (state === 1) return null;
    let x = frames[index + 1], y = frames[index + 2];
    const next = index + 6;
    if (next < frames.length && frames[next + 4] === state && frames[next + 5] === 0 &&
        frames[next] > frames[index] && frames[next] - frames[index] <= 2000) {
      const fraction = (at - frames[index]) / (frames[next] - frames[index]);
      x += (frames[next + 1] - x) * fraction; y += (frames[next + 2] - y) * fraction;
    }
    return { x, y, state, carrier: 0 };
  }
  function resolveFlagTeams(data, byId) {
    const flagTeams = new Map();
    const flags = data.flags || [], evidence = new Map();
    for (const flag of flags) {
      const explicit = flag.team === 1 || flag.team === 2 ? flag.team : /blue/i.test(flag.name) ? 1 : /red/i.test(flag.name) ? 2 : null;
      if (explicit) flagTeams.set(flag.id, explicit);
      // Objective IDs identify entities, not teams. In a two-flag CTF round,
      // an enemy carrying a flag supplies ownership evidence for that flag.
      const owners = new Set(); evidence.set(flag.id, owners);
      if (explicit || flags.length !== 2) continue;
      for (let i = 0; i < flag.frames.length; i += 6) {
        if (flag.frames[i + 4] !== 1 || flag.frames[i + 5] <= 0) continue;
        const player = byId.get(flag.frames[i + 5]), frame = player && frameAt(data, player, flag.frames[i]);
        if (frame?.[5] === 1 && (frame[9] === 1 || frame[9] === 2)) owners.add(3 - frame[9]);
      }
      if (owners.size === 1) flagTeams.set(flag.id, owners.values().next().value);
    }
    if (flags.length === 2 && flagTeams.size === 1) {
      const unknown = flags.find(flag => !flagTeams.has(flag.id));
      // Only pair a genuinely unobserved flag; conflicting evidence stays unknown.
      if (evidence.get(unknown.id).size === 0) flagTeams.set(unknown.id, 3 - flagTeams.values().next().value);
    }
    return flagTeams;
  }
  window.nnMapVision = { overview, frameAt, flagAt, resolveFlagTeams };
})();
