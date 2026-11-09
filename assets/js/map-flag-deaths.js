(() => {
  "use strict";
  const canvas = document.getElementById("flag-death-canvas");
  const status = document.getElementById("flag-death-status");
  const count = document.getElementById("flag-death-count");
  const select = document.getElementById("flag-death-player");
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
      const scale = canvas.width * Number(zoom[1]) / 8192, ox = Number(origin[1]), oy = Number(origin[2]);
      function draw() {
        context.drawImage(background,0,0);
        const rows = select.value ? response.deaths.filter(d => d.steamId === select.value) : response.deaths;
        context.fillStyle = "rgba(255, 154, 65, .8)";
        for (const d of rows) {
          const x = Number(rotated[1]) ? canvas.width/2+(d.x-ox)*scale : canvas.width/2-(d.y-oy)*scale;
          let y = Number(rotated[1]) ? canvas.height/2-(d.y-oy)*scale : canvas.height/2-(d.x-ox)*scale;
          if (flipVertical) y = canvas.height - y;
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
