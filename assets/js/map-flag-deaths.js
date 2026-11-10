(() => {
  "use strict";
  const canvas = document.getElementById("flag-death-canvas");
  const status = document.getElementById("flag-death-status");
  const count = document.getElementById("flag-death-count");
  const select = document.getElementById("flag-death-player");
  const matchSelect = document.getElementById("flag-death-match");
  const tooltip = document.getElementById("flag-map-tooltip");
  const viewport = document.getElementById("flag-map-viewport");
  const comingSoon = document.getElementById("flag-map-coming-soon");
  const filters = document.getElementById("flag-death-filters");
  const controls = document.getElementById("flag-death-controls");
  const mapContent = document.getElementById("flag-map-content");
  const dots = document.getElementById("flag-map-dots");
  const points = document.getElementById("flag-map-points");
  const highlight = document.getElementById("flag-map-highlight");
  const zoomIn = document.getElementById("flag-map-zoom-in");
  const zoomOut = document.getElementById("flag-map-zoom-out");
  const resetView = document.getElementById("flag-map-reset");
  const zoomLevel = document.getElementById("flag-map-zoom-level");
  const name = new URLSearchParams(location.search).get("map") || "";
  function hideTooltip() {
    tooltip.hidden = true;
    highlight.setAttribute("visibility", "hidden");
  }
  if (!canvas || !/^[a-z0-9_-]{1,64}$/i.test(name)) return;
  const context = canvas.getContext("2d");
  async function init() {
    try {
      const manifest = await fetch("/assets/tfc/overviews/manifest.json").then(r => { if (!r.ok) throw Error("No overview index"); return r.json(); });
      const fileName = manifest[name.toLowerCase()];
      if (!fileName) throw Object.assign(new Error("No overview"), { missingOverview: true });
      const root = `/assets/tfc/overviews/${encodeURIComponent(fileName)}`;
      const [metadata, response, image] = await Promise.all([
        fetch(root + ".txt").then(r => {
          if (r.status === 404) throw Object.assign(new Error("No overview metadata"), { missingOverview: true });
          if (!r.ok) throw Error("Overview metadata unavailable");
          return r.text();
        }),
        fetch(`/api/map/${encodeURIComponent(name)}/flag-deaths`).then(r => { if (!r.ok) throw Error("Death data unavailable"); return r.json(); }),
        new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error("No overview image")); img.src = root + ".bmp"; })
      ]);
      const zoom = /^\s*zoom\s+([-+\d.]+)/im.exec(metadata);
      const origin = /^\s*origin\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)/im.exec(metadata);
      const rotated = /^\s*rotated\s+([01])/im.exec(metadata);
      if (!zoom || !origin || !rotated || !(Number(zoom[1]) > 0)) throw Object.assign(new Error("Invalid overview metadata"), { missingOverview: true });
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      viewport.style.aspectRatio = canvas.width + " / " + canvas.height;
      dots.setAttribute("viewBox", "0 0 " + canvas.width + " " + canvas.height);
      let viewScale = 1;
      function setZoom(next, clientX, clientY) {
        hideTooltip();
        const value = Math.min(8, Math.max(1, next));
        const rect = viewport.getBoundingClientRect();
        const x = clientX == null ? viewport.clientWidth / 2 : clientX - rect.left;
        const y = clientY == null ? viewport.clientHeight / 2 : clientY - rect.top;
        const fractionX = (viewport.scrollLeft + x) / mapContent.clientWidth;
        const fractionY = (viewport.scrollTop + y) / mapContent.clientHeight;
        viewScale = value;
        mapContent.style.width = (value * 100) + "%";
        viewport.scrollLeft = fractionX * mapContent.clientWidth - x;
        viewport.scrollTop = fractionY * mapContent.clientHeight - y;
        zoomLevel.textContent = Math.round(value * 100) + "%";
        zoomIn.disabled = value >= 8;
        zoomOut.disabled = value <= 1;
        resetView.disabled = value === 1 && viewport.scrollLeft === 0 && viewport.scrollTop === 0;
      }
      zoomIn.addEventListener("click", () => setZoom(viewScale * 1.35));
      zoomOut.addEventListener("click", () => setZoom(viewScale / 1.35));
      resetView.addEventListener("click", () => { setZoom(1); viewport.scrollTo(0, 0); resetView.disabled = true; });
      viewport.addEventListener("wheel", event => {
        event.preventDefault();
        setZoom(viewScale * Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      }, { passive: false });
      let drag = null;
      viewport.addEventListener("pointerdown", event => {
        if (event.pointerType !== "mouse" || event.button !== 0 || viewScale <= 1) return;
        hideTooltip();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture(event.pointerId);
        viewport.classList.add("is-dragging");
        event.preventDefault();
      });
      viewport.addEventListener("pointermove", event => {
        if (!drag || event.pointerId !== drag.id) return;
        viewport.scrollLeft = drag.left - (event.clientX - drag.x);
        viewport.scrollTop = drag.top - (event.clientY - drag.y);
      });
      function endDrag(event) {
        if (!drag || event.pointerId !== drag.id) return;
        drag = null;
        viewport.classList.remove("is-dragging");
      }
      viewport.addEventListener("pointerup", endDrag);
      viewport.addEventListener("pointercancel", endDrag);
      viewport.addEventListener("lostpointercapture", endDrag);
      viewport.addEventListener("keydown", event => {
        if (event.key === "+" || event.key === "=") { event.preventDefault(); setZoom(viewScale * 1.35); }
        if (event.key === "-") { event.preventDefault(); setZoom(viewScale / 1.35); }
        if (event.key === "0") { event.preventDefault(); setZoom(1); viewport.scrollTo(0, 0); }
      });
      setZoom(1);
      const background = document.createElement("canvas"); background.width = canvas.width; background.height = canvas.height;
      const bg = background.getContext("2d");
      // Shutdown2's fresh in-game BMP is already in display orientation; older overviews
      // in this collection need the vertical correction applied here.
      if (name.toLowerCase() !== "shutdown2_lg2") {
        bg.translate(0, canvas.height);
        bg.scale(1, -1);
      }
      bg.drawImage(image, 0, 0);
      bg.setTransform(1, 0, 0, 1, 0, 0);
      const pixels = bg.getImageData(0, 0, canvas.width, canvas.height);
      const sourcePixels = new Uint8ClampedArray(pixels.data);
      const shutdown2 = name.toLowerCase() === "shutdown2_lg2";
      function isTransparentGreen(x, y) {
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return false;
        const i = (y * canvas.width + x) * 4;
        return sourcePixels[i] === 0 && sourcePixels[i+1] === 255 && sourcePixels[i+2] === 0;
      }
      for (let y=0; y<canvas.height; y++) for (let x=0; x<canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        const r = sourcePixels[i], g = sourcePixels[i+1], b = sourcePixels[i+2];
        const isKey = r === 0 && g === 255 && b === 0;
        let greenFringe = false;
        if (shutdown2 && !isKey && g > 96 && r < 32 && b < 32) {
          for (let dy=-1; dy<=1 && !greenFringe; dy++) for (let dx=-1; dx<=1; dx++) {
            if ((dx || dy) && isTransparentGreen(x + dx, y + dy)) { greenFringe = true; break; }
          }
        }
        if (isKey || greenFringe) {
          pixels.data[i]=16; pixels.data[i+1]=21; pixels.data[i+2]=28;
        }
      }
      bg.putImageData(pixels,0,0);
      const playerKey = death => death.playerId ? "discord:" + death.playerId : death.steamId ? "steam:" + death.steamId : "";
      const matchDate = epoch => {
        const date = new Date(Number(epoch) * 1000);
        return epoch && Number.isFinite(date.getTime()) ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "";
      };
      const matchDateTime = epoch => {
        const date = new Date(Number(epoch) * 1000);
        return epoch && Number.isFinite(date.getTime())
          ? date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
          : "";
      };
      for (const match of response.matches || []) {
        const option = document.createElement("option");
        option.value = match.matchId;
        const date = matchDate(match.createdAt);
        option.textContent = date ? date + " · " + match.matchId : match.matchId;
        matchSelect.append(option);
      }
      matchSelect.disabled = !(response.matches || []).length;
      function updatePlayers() {
        const previous = select.value;
        const players = new Map();
        for (const death of response.deaths) {
          if (matchSelect.value && death.matchId !== matchSelect.value) continue;
          const key = playerKey(death);
          if (key) players.set(key, death.playerName);
        }
        select.replaceChildren(new Option("All players", ""));
        for (const [id, player] of [...players].sort((a,b) => a[1].localeCompare(b[1]))) {
          const option = document.createElement("option"); option.value=id; option.textContent=player; select.append(option);
        }
        select.value = players.has(previous) ? previous : "";
        select.disabled = !players.size;
      }
      updatePlayers();
      let buckets = new Map();
      const bucketSize = 16;
      function bucketKey(x, y) { return Math.floor(x / bucketSize) + ":" + Math.floor(y / bucketSize); }
      function replayTime(ms) {
        const seconds = Math.max(0, Math.floor(Number(ms) / 1000));
        return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
      }
      viewport.addEventListener("pointermove", event => {
        if (event.pointerType !== "mouse" || drag) { hideTooltip(); return; }
        const rect = mapContent.getBoundingClientRect();
        if (!rect.width || !rect.height) { hideTooltip(); return; }
        const x = (event.clientX - rect.left) * canvas.width / rect.width;
        const y = (event.clientY - rect.top) * canvas.height / rect.height;
        const radius = 9 * canvas.width / rect.width;
        let nearest = null, closest = radius * radius;
        const minX = Math.floor((x - radius) / bucketSize), maxX = Math.floor((x + radius) / bucketSize);
        const minY = Math.floor((y - radius) / bucketSize), maxY = Math.floor((y + radius) / bucketSize);
        for (let bx = minX; bx <= maxX; bx++) for (let by = minY; by <= maxY; by++) {
          for (const point of buckets.get(bx + ":" + by) || []) {
            const dist = (point.x - x) ** 2 + (point.y - y) ** 2;
            if (dist <= closest) { nearest = point; closest = dist; }
          }
        }
        if (!nearest) { hideTooltip(); return; }
        highlight.setAttribute("cx", nearest.x);
        highlight.setAttribute("cy", nearest.y);
        highlight.setAttribute("visibility", "visible");
        const death = nearest.death, dateTime = matchDateTime(death.matchCreatedAt);
        tooltip.textContent = (death.playerName || "Unknown player") + "\nRound " + death.round + " · replay " + replayTime(death.timeMs) + "\n" + (dateTime ? "Game: " + dateTime + "\n" : "Game time unavailable\n") + "Match " + death.matchId;
        tooltip.hidden = false;
        const box = tooltip.getBoundingClientRect();
        tooltip.style.left = Math.max(4, Math.min(event.clientX + 14, window.innerWidth - box.width - 4)) + "px";
        tooltip.style.top = Math.max(4, Math.min(event.clientY + 14, window.innerHeight - box.height - 4)) + "px";
      });
      viewport.addEventListener("pointerleave", () => { hideTooltip(); });
      viewport.addEventListener("scroll", () => { hideTooltip(); }, { passive: true });
      // Use the overview zoom and axes; Phantom’s displayed bitmap is flipped
      // above, but its world coordinates already project into that orientation.
      const scale = canvas.width * Number(zoom[1]) / 8192;
      const ox = Number(origin[1]), oy = Number(origin[2]);
      function draw() {
        context.drawImage(background,0,0);
        const rows = response.deaths.filter(d => (!select.value || playerKey(d) === select.value) &&
          (!matchSelect.value || d.matchId === matchSelect.value));
        let paths = "";
        buckets = new Map();
        hideTooltip();
        for (const d of rows) {
          const x = Number(rotated[1]) ? canvas.width/2+(d.x-ox)*scale : canvas.width/2-(d.y-oy)*scale;
          const y = Number(rotated[1]) ? canvas.height/2-(d.y-oy)*scale : canvas.height/2-(d.x-ox)*scale;
          if (x<0 || y<0 || x>=canvas.width || y>=canvas.height) continue;
          const key = bucketKey(x, y);
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push({ x, y, death: d });
          const radius = 2.2;
          paths += `M${x-radius} ${y}a${radius} ${radius} 0 1 0 ${radius*2} 0a${radius} ${radius} 0 1 0 ${-radius*2} 0`;
        }
        points.setAttribute("d", paths);
        count.textContent = response.rounds ? `${rows.length.toLocaleString()} deaths` : "Not indexed";
        status.textContent = response.rounds ? `From ${response.rounds.toLocaleString()} indexed replay rounds. Positions are sampled.${response.truncated ? " Showing the first 100,000 deaths." : ""}` : "No replay rounds have been indexed for this map yet.";
      }
      select.addEventListener("change", draw);
      matchSelect.addEventListener("change", () => { updatePlayers(); draw(); });
      draw();
    } catch (error) {
      if (error.missingOverview) {
        count.textContent = "Coming soon";
        status.textContent = "This map doesn't have an overview yet.";
        filters.hidden = true;
        controls.hidden = true;
        viewport.hidden = true;
        comingSoon.hidden = false;
      } else {
        count.textContent = "Unavailable";
        status.textContent = error.message === "Death data unavailable"
          ? "Could not load recorded deaths. Please try again later."
          : "Could not load the map overview. Please try again later.";
      }
    }
  }
  init();
})();
