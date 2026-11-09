(() => {
  "use strict";
  const canvas = document.getElementById("flag-death-canvas");
  const status = document.getElementById("flag-death-status");
  const count = document.getElementById("flag-death-count");
  const select = document.getElementById("flag-death-player");
  const viewport = document.getElementById("flag-map-viewport");
  const zoomIn = document.getElementById("flag-map-zoom-in");
  const zoomOut = document.getElementById("flag-map-zoom-out");
  const resetView = document.getElementById("flag-map-reset");
  const zoomLevel = document.getElementById("flag-map-zoom-level");
  const name = new URLSearchParams(location.search).get("map") || "";
  if (!canvas || !/^[a-z0-9_-]{1,64}$/i.test(name)) return;
  const context = canvas.getContext("2d");
  async function init() {
    try {
      const manifest = await fetch("/assets/tfc/overviews/manifest.json").then(r => { if (!r.ok) throw Error("No overview index"); return r.json(); });
      const fileName = manifest[name.toLowerCase()];
      if (!fileName) throw Error("No overview");
      const root = `/assets/tfc/overviews/${encodeURIComponent(fileName)}`;
      const [metadata, response, image] = await Promise.all([
        fetch(root + ".txt").then(r => { if (!r.ok) throw Error("No overview metadata"); return r.text(); }),
        fetch(`/api/map/${encodeURIComponent(name)}/flag-deaths`).then(r => { if (!r.ok) throw Error("Death data unavailable"); return r.json(); }),
        new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error("No overview image")); img.src = root + ".bmp"; })
      ]);
      const zoom = /^\s*zoom\s+([-+\d.]+)/im.exec(metadata);
      const origin = /^\s*origin\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)/im.exec(metadata);
      const rotated = /^\s*rotated\s+([01])/im.exec(metadata);
      if (!zoom || !origin || !rotated || !(Number(zoom[1]) > 0)) throw Error("Invalid overview metadata");
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      viewport.style.aspectRatio = canvas.width + " / " + canvas.height;
      let viewScale = 1;
      function setZoom(next, clientX, clientY) {
        const value = Math.min(8, Math.max(1, next));
        const rect = viewport.getBoundingClientRect();
        const x = clientX == null ? viewport.clientWidth / 2 : clientX - rect.left;
        const y = clientY == null ? viewport.clientHeight / 2 : clientY - rect.top;
        const fractionX = (viewport.scrollLeft + x) / canvas.clientWidth;
        const fractionY = (viewport.scrollTop + y) / canvas.clientHeight;
        viewScale = value;
        canvas.style.width = (value * 100) + "%";
        viewport.scrollLeft = fractionX * canvas.clientWidth - x;
        viewport.scrollTop = fractionY * canvas.clientHeight - y;
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
      // This overview has vertically mirrored artwork in the supplied bitmap.
      // Apply the same flip to the dots so they remain aligned with the image.
      const flipVertical = name.toLowerCase() === "phantom_lg";
      if (flipVertical) { bg.translate(0, canvas.height); bg.scale(1, -1); }
      bg.drawImage(image, 0, 0);
      bg.setTransform(1, 0, 0, 1, 0, 0);
      const pixels = bg.getImageData(0, 0, canvas.width, canvas.height);
      for (let i=0; i<pixels.data.length; i+=4) if (pixels.data[i] === 0 && pixels.data[i+1] === 255 && pixels.data[i+2] === 0) {
        pixels.data[i]=16; pixels.data[i+1]=21; pixels.data[i+2]=28;
      }
      bg.putImageData(pixels,0,0);
      const players = new Map();
      for (const death of response.deaths) if (death.steamId) players.set(death.steamId, death.playerName);
      for (const [id, player] of [...players].sort((a,b) => a[1].localeCompare(b[1]))) {
        const option = document.createElement("option"); option.value=id; option.textContent=player; select.append(option);
      }
      select.disabled = !players.size;
      // Phantom’s bitmap was rendered at a different scale than its overview TXT.
      // Its two recorded flag bases align with their image markers at 768 / 8192.
      const scale = flipVertical ? canvas.height / 8192 : canvas.width * Number(zoom[1]) / 8192;
      const ox = Number(origin[1]), oy = Number(origin[2]);
      function draw() {
        context.drawImage(background,0,0);
        const rows = select.value ? response.deaths.filter(d => d.steamId === select.value) : response.deaths;
        context.fillStyle = "rgba(255, 154, 65, .8)";
        for (const d of rows) {
          let x = Number(rotated[1]) ? canvas.width/2+(d.x-ox)*scale : canvas.width/2-(d.y-oy)*scale;
          let y = Number(rotated[1]) ? canvas.height/2-(d.y-oy)*scale : canvas.height/2-(d.x-ox)*scale;
          if (flipVertical) {
            y = canvas.height - y;
            // Phantom’s recorded coordinates are rotated relative to its overview.
            const dx = x - canvas.width / 2, dy = y - canvas.height / 2;
            x = canvas.width / 2 + dy;
            y = canvas.height / 2 - dx;
          }
          if (x<0 || y<0 || x>=canvas.width || y>=canvas.height) continue;
          context.beginPath(); context.arc(x,y,2.2,0,Math.PI*2); context.fill();
        }
        count.textContent = response.rounds ? `${rows.length.toLocaleString()} deaths` : "Not indexed";
        status.textContent = response.rounds ? `From ${response.rounds.toLocaleString()} indexed replay rounds. Positions are sampled.${response.truncated ? " Showing the first 100,000 deaths." : ""}` : "No replay rounds have been indexed for this map yet.";
      }
      select.addEventListener("change", draw); draw();
    } catch (error) {
      count.textContent = "Unavailable";
      status.textContent = error.message === "Death data unavailable" ? "Could not load recorded deaths. Please try again later." : "No usable overview is available for this map.";
    }
  }
  init();
})();
