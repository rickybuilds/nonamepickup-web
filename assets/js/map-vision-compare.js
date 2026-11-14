(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const replay = window.nnMapVision;
  const form = $("compare-form"), controls = $("heat-controls"), comparison = $("comparison");
  const source = $("heat-source"), flagSide = $("flag-side"), activity = $("flag-activity"), playerSide = $("player-side");
  let controller, loadVersion = 0, renderVersion = 0, pair = null, view = null;
  const waitForUI = () => new Promise(resolve => setTimeout(resolve, 0));
  const clock = ms => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
  };
  function status(text, error = false) {
    $("compare-status").textContent = text;
    $("compare-status").classList.toggle("error", error);
  }
  function matchId(value) {
    let id = value.trim();
    if (!/^[a-z0-9_-]{1,64}$/i.test(id)) {
      try { const url = new URL(id, location.href); id = url.searchParams.get("id") || url.searchParams.get("match") || url.searchParams.get("matchId") || ""; }
      catch { id = ""; }
    }
    if (!/^[a-z0-9_-]{1,64}$/i.test(id)) throw new Error("Enter a valid match ID or a match link in both fields.");
    return id.toUpperCase();
  }
  function updateURL(a, b) {
    const url = new URL(location.href);
    for (const [key, value] of Object.entries({ a, b, source: source.value, flag: flagSide.value, activity: activity.value, players: playerSide.value })) url.searchParams.set(key, value);
    history.replaceState(null, "", url);
  }
  function filterVisibility() {
    $("flag-filter").hidden = $("activity-filter").hidden = source.value !== "flags";
    $("player-filter").hidden = source.value !== "players";
  }
  function validTrack(frames, stride) {
    if (!Array.isArray(frames) || frames.length % stride) return false;
    let previous = -Infinity;
    for (let i = 0; i < frames.length; i += stride) {
      if (frames[i] < previous) return false;
      previous = frames[i];
      for (let j = 0; j < stride; j++) if (!Number.isFinite(frames[i + j])) return false;
    }
    return true;
  }
  async function loadMatch(id, signal) {
    const rounds = [];
    // Two match pipelines run together, each fetching its rounds sequentially.
    // This limits tactical requests to two, including large archived recordings.
    for (const round of [1, 2]) {
      let response;
      try { response = await fetch(`/api/pickup-replays/viewer/${encodeURIComponent(id)}/${round}/tactical`, { signal, cache: "no-cache" }); }
      catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`${id}, round ${round}: could not reach the recording service. Try again.`);
      }
      if (!response.ok) throw new Error(`${id}, round ${round}: ${response.status === 404 ? "recording is unavailable or still being prepared" : `recording could not be loaded (${response.status})`}. Both rounds are required.`);
      let data;
      try { data = await response.json(); }
      catch (error) {
        if (error.name === "AbortError") throw error;
        throw new Error(`${id}, round ${round}: the recording response is invalid. Try again later.`);
      }
      if (data.version !== 2 || data.stride !== 10 || typeof data.map !== "string" || !data.map.trim() ||
          !(data.durationMs > 0) || !Number.isFinite(data.durationMs) || !(data.sampleIntervalMs > 0) || !Number.isFinite(data.sampleIntervalMs) ||
          !Array.isArray(data.players) || !data.players.length ||
          !data.players.some(player => player.frames?.length) ||
          data.players.some(player => !Number.isFinite(player.id) || !validTrack(player.frames, 10)) ||
          (data.flags != null && (!Array.isArray(data.flags) || data.flags.some(flag => !Number.isFinite(flag.id) || !validTrack(flag.frames, 6))))) {
        throw new Error(`${id}, round ${round}: this recording cannot supply a complete tactical heatmap.`);
      }
      if ((data.round != null && Number(data.round) !== round) || (data.matchId != null && String(data.matchId).toUpperCase() !== id)) throw new Error(`${id}, round ${round}: the recording identity did not match the requested game.`);
      data.map = data.map.trim().toLowerCase();
      const byId = new Map(data.players.map(player => [player.id, player]));
      rounds.push({ data, byId, flagTeams: replay.resolveFlagTeams(data, byId) });
    }
    return { id, rounds, durationMs: rounds.reduce((total, round) => total + round.data.durationMs, 0) };
  }
  const kernel = [];
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    if (x * x + y * y <= 36) kernel.push([x, y, Math.exp(-(x * x + y * y) / 12)]);
  }
  function createGrid(background) {
    const ratio = Math.min(1, 384 / Math.max(background.width, background.height));
    const width = Math.max(1, Math.round(background.width * ratio)), height = Math.max(1, Math.round(background.height * ratio));
    return { width, height, density: new Float32Array(width * height), carriedMs: 0, droppedMs: 0, playerMs: 0, trackCount: 0, unknownFlags: 0, missingFlagRounds: [] };
  }
  function addHeat(grid, map, x, y, seconds) {
    const [px, py] = map.project(x, y);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false;
    const cx = Math.round(px * grid.width / map.background.width), cy = Math.round(py * grid.height / map.background.height);
    for (const [dx, dy, weight] of kernel) {
      const gx = cx + dx, gy = cy + dy;
      if (gx >= 0 && gx < grid.width && gy >= 0 && gy < grid.height) grid.density[gy * grid.width + gx] += seconds * weight;
    }
    return true;
  }
  async function aggregate(match, map, filters, version) {
    const grid = createGrid(map.background);
    let processed = 0;
    for (const [roundIndex, { data, byId, flagTeams }] of match.rounds.entries()) {
      const flags = filters.source === "flags", stride = flags ? 6 : data.stride;
      if (flags && !(data.flags || []).some(flag => flag.frames.length)) grid.missingFlagRounds.push(roundIndex + 1);
      for (const track of flags ? data.flags || [] : data.players) {
        if (flags && track.frames.length && !flagTeams.has(track.id)) grid.unknownFlags++;
        if (flags && filters.flag !== "all" && flagTeams.get(track.id) !== Number(filters.flag)) continue;
        if (track.frames.length) grid.trackCount++;
        const frames = track.frames, interval = data.sampleIntervalMs;
        for (let i = 0; i < frames.length; i += stride) {
          if (++processed % 12000 === 0) { await waitForUI(); if (version !== renderVersion) return null; }
          const at = frames[i], next = i + stride < frames.length ? frames[i + stride] : at + interval;
          const ms = Math.min(data.durationMs, next, at + interval) - Math.max(0, at);
          if (!(ms > 0)) continue;
          if (flags) {
            const frame = replay.flagAt(data, byId, track, at);
            if (!frame || (!frame.carrier && frame.state !== 2)) continue;
            if ((filters.activity === "carried" && !frame.carrier) || (filters.activity === "dropped" && frame.carrier)) continue;
            if (frame.carrier) {
              const carrier = replay.frameAt(data, byId.get(frame.carrier), at);
              if (at - carrier[0] > interval) continue;
            }
            if (!addHeat(grid, map, frame.x, frame.y, ms / 1000)) continue;
            if (frame.carrier) grid.carriedMs += ms; else grid.droppedMs += ms;
          } else {
            if (frames[i + 5] !== 1 || (filters.players !== "all" && frames[i + 9] !== Number(filters.players))) continue;
            if (addHeat(grid, map, frames[i + 1], frames[i + 2], ms / 1000)) grid.playerMs += ms;
          }
        }
      }
      await waitForUI();
      if (version !== renderVersion) return null;
    }
    return grid;
  }
  function heatLayer(grid, peak, compressed) {
    const layer = document.createElement("canvas"); layer.width = grid.width; layer.height = grid.height;
    const context = layer.getContext("2d"), pixels = context.createImageData(grid.width, grid.height);
    const stops = [[55, 160, 230], [52, 211, 153], [250, 210, 70], [245, 90, 55]];
    if (peak > 0) for (let i = 0; i < grid.density.length; i++) {
      const value = grid.density[i]; if (!value) continue;
      const intensity = Math.sqrt(compressed ? Math.log1p(value) / Math.log1p(peak) : value / peak);
      const color = intensity * 3, index = Math.min(2, Math.floor(color)), blend = color - index;
      for (let c = 0; c < 3; c++) pixels.data[i * 4 + c] = stops[index][c] + (stops[index + 1][c] - stops[index][c]) * blend;
      pixels.data[i * 4 + 3] = Math.round(180 * Math.min(1, intensity * 2));
    }
    context.putImageData(pixels, 0, 0); return layer;
  }
  function drawPanel(side, match, grid, map, peak, filters) {
    const canvas = $("map-" + side), background = map.background;
    canvas.width = background.width; canvas.height = background.height;
    const context = canvas.getContext("2d"); context.drawImage(background, 0, 0);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.drawImage(heatLayer(grid, peak, filters.source === "flags"), 0, 0, background.width, background.height);
    $("title-" + side).textContent = `Match ${side.toUpperCase()} · ${match.id}`;
    $("link-" + side).href = "match.html?id=" + encodeURIComponent(match.id);
    $("meta-" + side).textContent = `${match.rounds[0].data.map} · Rounds 1 + 2 · ${clock(match.durationMs)} recorded`;
    const flags = filters.source === "flags", total = flags ? grid.carriedMs + grid.droppedMs : grid.playerMs;
    $("totals-" + side).textContent = flags ? `Carried ${clock(grid.carriedMs)} · Dropped ${clock(grid.droppedMs)} · selected flag-time` : `${clock(grid.playerMs)} living player-time`;
    const message = flags && !grid.trackCount ? "No identified flag tracks for this selection." : !total ? "No recorded activity for this selection." : "Both rounds combined. Totals sum time across selected tracks.";
    const coverage = grid.missingFlagRounds.length ? ` Incomplete flag coverage: no flag tracks in round ${grid.missingFlagRounds.join(" or ")}. Heat reflects available flag tracks only.` : "";
    $("activity-" + side).textContent = message + coverage + (flags && grid.unknownFlags ? " Some flag colors are unknown; these tracks appear only in All flags." : "");
    $("activity-" + side).classList.toggle("coverage-warning", !!grid.missingFlagRounds.length);
    canvas.setAttribute("aria-label", `${match.id}, ${filters.source} heatmap, rounds 1 and 2. ${$("totals-" + side).textContent}. ${message}${coverage}`);
  }
  async function render() {
    filterVisibility();
    if (!pair || !view) return;
    const version = ++renderVersion, matches = pair, map = view;
    const filters = { source: source.value, flag: flagSide.value, activity: activity.value, players: playerSide.value };
    updateURL(matches[0].id, matches[1].id);
    comparison.hidden = true; comparison.setAttribute("aria-busy", "true"); status("Building full-match heatmaps…");
    try {
      const grids = [];
      for (const match of matches) {
        const grid = await aggregate(match, map, filters, version);
        if (!grid || version !== renderVersion) return;
        grids.push(grid);
      }
      let peak = 0;
      for (const grid of grids) for (const value of grid.density) peak = Math.max(peak, value);
      for (let i = 0; i < matches.length; i++) drawPanel(i ? "b" : "a", matches[i], grids[i], map, peak, filters);
      $("peak-label").textContent = peak ? `${peak.toFixed(1)} weighted seconds (peak)` : "No recorded activity";
      $("scale-copy").textContent = "Warmer = more recorded time · identical scale on both maps";
      $("comparison-note").textContent = filters.source === "flags"
        ? "Base time excluded. Carry routes and drops use recorded time with enhanced visibility for shorter stays. Raw time is compared; longer recordings can accumulate more heat."
        : "Living players only. In-game colors can switch between rounds and do not identify the same roster across games. Raw player-time is compared; longer recordings can accumulate more heat.";
      comparison.hidden = false;
      status(`${matches[0].id} versus ${matches[1].id} · ${map.name} · both rounds loaded for each match.`);
    } catch { if (version === renderVersion) status("The heatmaps could not be drawn. Try another selection or reload the recordings.", true); }
    finally { if (version === renderVersion) comparison.setAttribute("aria-busy", "false"); }
  }
  async function compare(event) {
    event?.preventDefault();
    controller?.abort(); controller = new AbortController();
    const version = ++loadVersion; renderVersion++;
    pair = view = null; controls.disabled = true; comparison.hidden = true;
    form.setAttribute("aria-busy", "true");
    try {
      const a = matchId($("match-a").value), b = matchId($("match-b").value);
      $("match-a").value = a; $("match-b").value = b; updateURL(a, b);
      status("Loading both rounds from both games… You can submit another pair to replace this one.");
      const matches = await Promise.all([loadMatch(a, controller.signal), loadMatch(b, controller.signal)]);
      if (version !== loadVersion) return;
      const maps = new Set(matches.flatMap(match => match.rounds.map(round => round.data.map)));
      if (maps.size !== 1) throw new Error(`These recordings use different maps (${[...maps].join(", ")}). Choose two complete matches on the same map.`);
      const name = maps.values().next().value;
      status(`Loading ${name} overview…`);
      const overview = await replay.overview(name, controller.signal);
      if (version !== loadVersion) return;
      pair = matches; view = { ...overview, name }; controls.disabled = false;
      await render();
    } catch (error) {
      if (version === loadVersion) {
        controller.abort();
        if (error.name !== "AbortError") status(error.message, true);
      }
    } finally { if (version === loadVersion) form.setAttribute("aria-busy", "false"); }
  }
  form.addEventListener("submit", compare);
  for (const input of [source, flagSide, activity, playerSide]) input.addEventListener("change", () => { void render(); });
  const params = new URLSearchParams(location.search);
  for (const [key, select] of [["source", source], ["flag", flagSide], ["activity", activity], ["players", playerSide]]) {
    const value = params.get(key); if ([...select.options].some(option => option.value === value)) select.value = value;
  }
  $("match-a").value = params.get("a") || ""; $("match-b").value = params.get("b") || "";
  filterVisibility();
  if (params.get("a") && params.get("b")) void compare();
  window.addEventListener("pagehide", () => { controller?.abort(); loadVersion++; renderVersion++; });
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    if (pair && view) void render();
    else if ($("match-a").value && $("match-b").value) void compare();
  });
})();
