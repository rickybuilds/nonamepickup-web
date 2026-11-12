(() => {
  "use strict";
  const canvas = document.getElementById("flag-death-canvas");
  const status = document.getElementById("flag-death-status");
  const count = document.getElementById("flag-death-count");
  const select = document.getElementById("flag-death-player");
  const matchSelect = document.getElementById("flag-death-match");
  const sideSelect = document.getElementById("flag-map-side");
  const teamSelect = document.getElementById("flag-map-team");
  const weaponSelect = document.getElementById("flag-map-weapon");
  const layerButtons = [...document.querySelectorAll("#flag-map-layers button")];
  const title = document.getElementById("flag-map-title");
  const description = document.getElementById("flag-map-description");
  const playerLabel = document.getElementById("flag-map-player-label");
  const sideLabel = document.getElementById("flag-map-side-label");
  const directionLabel = document.getElementById("flag-map-direction-label");
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
  let activeLayer = "flags";
  const layers = {
    flags: { title: "Flag Carrier Deaths", description: "Where players died carrying the flag in recorded pickup rounds.", unit: "deaths" },
    defense: { title: "Defensive Kills", description: "Where defenders killed enemies in recorded pickup rounds. Dots mark the victim’s location.", unit: "kills" },
    offense: { title: "Offensive Kills", description: "Where attackers killed enemies in recorded pickup rounds. Dots mark the victim’s location.", unit: "kills" }
  };
  const weaponAliases = {
    normalgrenade: "grenade", handgrenade: "grenade", grenade: "grenade",
    mirv: "mirvgrenade", mirvgrenade: "mirvgrenade", mirvgrenadelet: "mirvbomblet", nailgrenade: "nailgrenade", nailgren: "nailgrenade",
    supershotgun: "supershotgun", sshotgun: "supershotgun", shotgun: "shotgun", singleshotgun: "shotgun",
    sentrygun: "sentrygun", sentry: "sentrygun", buildingsentrygun: "sentrygun", dispenser: "dispenser", buildingdispenser: "dispenser",
    ac: "assaultcannon", assaultcannon: "assaultcannon", ic: "incendiarycannon", incendiarycannon: "incendiarycannon",
    rpgrocket: "rocketlauncher", rocket: "rocketlauncher", pipebomb: "pipetrap"
  };
  const canonicalWeaponNames = {
    "weapon-1": "Grenade", "weapon-2": "Nailgren", "weapon-3": "MIRV", "weapon-4": "EMP",
    "weapon-5": "Super Nailgun", "weapon-6": "Nails", "weapon-7": "Crowbar", "weapon-8": "Spanner",
    "weapon-9": "Medkit", "weapon-10": "Single Shotgun", "weapon-11": "Super Shotgun",
    "weapon-12": "Rocket Launcher", "weapon-13": "Assault Cannon", "weapon-14": "Railgun",
    "weapon-15": "Sentry Gun", "weapon-16": "Dispenser", "weapon-18": "Yellow Gren Launcher",
    "weapon-19": "Blue Gren Launcher", "weapon-20": "DetPack", "weapon-21": "Flamethrower",
    "weapon-22": "Napalm Grenade", "weapon-24": "Hallucination Grenade", "weapon-25": "Knife",
    "weapon-26": "Headshot Sniper Rifle", "weapon-27": "Sniper Rifle", "weapon-28": "Auto Sniper Rifle",
    "weapon-29": "Infection"
  };
  function weaponKey(value) {
    const raw = String(value || "unknown").trim().toLowerCase().replace(/^(?:tf_|weapon_)+/, "");
    const key = raw.replace(/[^a-z0-9]/g, "");
    if (/^\d+$/.test(key)) return "unknown";
    if (/^weapon\d+$/.test(key)) return "weapon-" + key.slice(6);
    return weaponAliases[key] || (weaponNameKnown(key) ? key : raw.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")) || "unknown";
  }
  function weaponNameKnown(key) {
    if (canonicalWeaponNames[key]) return canonicalWeaponNames[key];
    return ({ grenade: "Grenade", mirvgrenade: "MIRV Grenade", nailgrenade: "Nail Grenade",
      mirvbomblet: "MIRV Bomblet", assaultcannon: "Assault Cannon", incendiarycannon: "Incendiary Cannon",
      supershotgun: "Super Shotgun", shotgun: "Single Shotgun", sentrygun: "Sentry Gun", dispenser: "Dispenser",
      rocketlauncher: "Rocket Launcher", glgrenade: "Grenade Launcher", pipetrap: "Pipebomb",
      nailgun: "Nailgun", supernailgun: "Super Nailgun", flames: "Flames", flamethrower: "Flamethrower",
      empgrenade: "EMP Grenade", gasgrenade: "Gas Grenade", napalmgrenade: "Napalm Grenade",
      infection: "Infection", medikit: "Medikit", spanner: "Spanner", autorifle: "Auto Rifle", sniperrifle: "Sniper Rifle", unknown: "Unknown weapon" })[key];
  }
  function weaponName(key) {
    return weaponNameKnown(key) || key.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  }
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
      const [metadata, initialResponse, image] = await Promise.all([
        fetch(root + ".txt").then(r => {
          if (r.status === 404) throw Object.assign(new Error("No overview metadata"), { missingOverview: true });
          if (!r.ok) throw Error("Overview metadata unavailable");
          return r.text();
        }),
        fetch(`/api/map/${encodeURIComponent(name)}/flag-deaths`).then(r => { if (!r.ok) throw Error("Death data unavailable"); return r.json(); }).catch(() => null),
        new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error("No overview image")); img.src = root + ".bmp"; })
      ]);
      let response = initialResponse;
      const cache = new Map(initialResponse?.ok && Array.isArray(initialResponse.deaths) ? [["flags", initialResponse]] : []);
      let requestId = 0;
      const zoom = /^\s*zoom\s+([-+\d.]+)/im.exec(metadata);
      const origin = /^\s*origin\s+([-+\d.]+)\s+([-+\d.]+)\s+([-+\d.]+)/im.exec(metadata);
      const rotated = /^\s*rotated\s+([01])/im.exec(metadata);
      if (!zoom || !origin || !rotated || !(Number(zoom[1]) > 0)) throw Object.assign(new Error("Invalid overview metadata"), { missingOverview: true });
      const shutdown2 = name.toLowerCase() === "shutdown2_lg2";
      const mapName = name.toLowerCase();
      const displayOriented = ["shutdown2_lg2", "alchimy_lg", "openfire_lowgrens", "blutopia_tfp", "fry_baked_lg", "snow_gutter", "demolish2_b4r", "demolish2_b6", "schtop", "siege", "waterwar_lg", "voltage_lg", "mortality_lg", "viridian", "siden_lg", "foundry_b3", "mm_chateau_b1", "mm_chateau_b2", "mm_chateau_b3", "mm_chateau_b4", "2mesa3_lg", "ostargh", "2trof_b4", "turbo_b10", "congestus_lg"].includes(mapName);
      const captureDimensionsMatch = image.naturalWidth === 1920 && image.naturalHeight === 1080;
      const cropLeft = displayOriented && captureDimensionsMatch ? 240 : 0;
      const cropRight = displayOriented && captureDimensionsMatch ? 240 : 0;
      const cropWidth = image.naturalWidth - cropLeft - cropRight;
      dots.classList.toggle("fry-baked-dots", mapName === "fry_baked_lg");
      canvas.width = cropWidth; canvas.height = image.naturalHeight;
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
      // Fresh in-game BMP captures are already in display orientation; older overviews
      // in this collection need the vertical correction applied here.
      if (!displayOriented) {
        bg.translate(0, canvas.height);
        bg.scale(1, -1);
        bg.drawImage(image, 0, 0);
      } else {
        bg.drawImage(image, cropLeft, 0, cropWidth, canvas.height, 0, 0, canvas.width, canvas.height);
      }
      bg.setTransform(1, 0, 0, 1, 0, 0);
      const pixels = bg.getImageData(0, 0, canvas.width, canvas.height);
      const sourcePixels = new Uint8ClampedArray(pixels.data);
      for (let i=0; i<sourcePixels.length; i+=4) {
        const r = sourcePixels[i], g = sourcePixels[i+1], b = sourcePixels[i+2];
        const isKey = r === 0 && g === 255 && b === 0;
        const greenFringe = (shutdown2 && g > 45 && r < 100 && b < 80 && g > r * 1.25 && g > b * 1.5) ||
          (g > 80 && r < 50 && b < 80 && g > r * 1.5 && g > b * 1.2);
        if (isKey || greenFringe) {
          pixels.data[i]=16; pixels.data[i+1]=21; pixels.data[i+2]=28;
        }
      }
      bg.putImageData(pixels,0,0);
      context.drawImage(background, 0, 0);
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
      function updateMatches() {
        const previous = matchSelect.value;
        matchSelect.replaceChildren(new Option("All games", ""));
        for (const match of response.matches || []) {
          const option = document.createElement("option");
          option.value = match.matchId;
          const date = matchDate(match.createdAt);
          option.textContent = date ? date + " · " + match.matchId : match.matchId;
          matchSelect.append(option);
        }
        matchSelect.value = (response.matches || []).some(match => match.matchId === previous) ? previous : "";
        matchSelect.disabled = !(response.matches || []).length;
      }
      function matchesFilters(row, includePlayer = true, includeWeapon = true, includeSide = true) {
        return (!matchSelect.value || row.matchId === matchSelect.value) &&
          (!includeSide || !sideSelect.value || String(activeLayer === "flags" ? row.victimTeam : row.attackerTeam) === sideSelect.value) &&
          (!teamSelect.value || row.attackerTeam + "-" + row.victimTeam === teamSelect.value) &&
          (!includeWeapon || !weaponSelect.value || weaponKey(row.weapon) === weaponSelect.value) &&
          (!includePlayer || !select.value || playerKey(row) === select.value);
      }
      function updateSideOptions() {
        const previous = sideSelect.value;
        const base = response.deaths.filter(row => matchesFilters(row, false, true, false));
        const counts = new Map([["1", 0], ["2", 0]]);
        for (const row of base) {
          const side = String(activeLayer === "flags" ? row.victimTeam || "" : row.attackerTeam || "");
          if (counts.has(side)) counts.set(side, counts.get(side) + 1);
        }
        sideSelect.replaceChildren(new Option("Both teams", ""));
        sideSelect.append(new Option(`Team 1 (${counts.get("1")})`, "1"));
        sideSelect.append(new Option(`Team 2 (${counts.get("2")})`, "2"));
        sideSelect.value = previous;
        sideSelect.disabled = !counts.get("1") && !counts.get("2");
        if (sideSelect.disabled) sideSelect.value = "";
      }
      function updateWeapons() {
        const previous = weaponSelect.value;
        const weapons = new Set(response.deaths.filter(row => matchesFilters(row, false, false))
          .map(row => weaponKey(row.weapon)).filter(key => key !== "unknown"));
        weaponSelect.replaceChildren(new Option("All weapons", ""));
        for (const key of [...weapons].sort((a, b) => weaponName(a).localeCompare(weaponName(b)))) {
          weaponSelect.append(new Option(weaponName(key), key));
        }
        weaponSelect.value = weapons.has(previous) ? previous : "";
        weaponSelect.disabled = !weapons.size;
      }
      function updatePlayers() {
        const previous = select.value;
        const players = new Map();
        for (const death of response.deaths) {
          if (!matchesFilters(death, false)) continue;
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
        const identity = activeLayer === "flags"
          ? (death.playerName || "Unknown player") + " (flag carrier)" + (death.attackerName ? "\nKilled by " + death.attackerName : "")
          : (death.playerName || "Unknown killer") + " → " + (death.victimName || "Unknown victim");
        const teams = death.attackerTeam && death.victimTeam ? " · Team " + death.attackerTeam + " → Team " + death.victimTeam : "";
        const weapon = weaponKey(death.weapon);
        const weaponLine = weapon === "unknown" ? "" : weaponName(weapon) + "\n";
        tooltip.textContent = identity + "\n" + weaponLine + (teams ? teams.trim() + "\n" : "") + "Round " + death.round + " · replay " + replayTime(death.timeMs) + "\n" + (dateTime ? "Game: " + dateTime + "\n" : "Game time unavailable\n") + "Match " + death.matchId;
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
        const rows = response.deaths.filter(d => matchesFilters(d));
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
        const unit = layers[activeLayer].unit;
        count.textContent = response.rounds ? `${rows.length.toLocaleString()} ${unit}` : "Not indexed";
        status.textContent = response.rounds
          ? `${rows.length ? "" : "No " + unit + " match this view. "}From ${response.rounds.toLocaleString()} indexed replay rounds. Positions are sampled.${response.unclassifiedKills ? " " + response.unclassifiedKills.toLocaleString() + " located kills have no unambiguous recorded round role and are excluded." : ""}${response.truncated ? " Showing the first 100,000 " + unit + "; filters apply to this sample." : ""}`
          : activeLayer === "flags" ? "No replay rounds have been indexed for this map yet." : "Kill locations have not been indexed for this map yet.";
      }
      async function changeLayer(layer) {
        activeLayer = layer;
        const id = ++requestId;
        const config = layers[layer];
        title.textContent = config.title;
        description.textContent = config.description;
        playerLabel.textContent = layer === "flags" ? "Carrier" : "Killer";
        sideLabel.textContent = layer === "flags" ? "Carrier team" : "Killer team";
        directionLabel.textContent = layer === "flags" ? "Killer → carrier" : "Killer → victim";
        canvas.setAttribute("aria-label", config.title + " locations on the map");
        layerButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.layer === layer)));
        hideTooltip();
        buckets = new Map();
        points.setAttribute("d", "");
        [select, matchSelect, sideSelect, teamSelect, weaponSelect].forEach(control => { control.disabled = true; });
        count.textContent = "Loading…";
        status.textContent = "Loading recorded " + config.unit + "…";
        viewport.setAttribute("aria-busy", "true");
        try {
          let next = cache.get(layer);
          if (!next) {
            const endpoint = layer === "flags" ? "flag-deaths" : "kills?role=" + layer;
            const result = await fetch(`/api/map/${encodeURIComponent(name)}/${endpoint}`);
            if (!result.ok) throw Error("Kill data unavailable");
            const data = await result.json();
            if (!data.ok || !Array.isArray(layer === "flags" ? data.deaths : data.kills)) throw Error("Kill data unavailable");
            next = layer === "flags" ? data : { ...data, deaths: data.kills };
            cache.set(layer, next);
          }
          if (id !== requestId) return;
          response = next;
          updateSideOptions();
          teamSelect.disabled = !response.deaths.some(row => row.attackerTeam && row.victimTeam);
          if (teamSelect.disabled) teamSelect.value = "";
          updateMatches();
          updateWeapons();
          updatePlayers();
          draw();
        } catch (error) {
          if (id !== requestId) return;
          count.textContent = "Unavailable";
          status.textContent = "Could not load recorded " + config.unit + ". Select this tab again to retry.";
        } finally {
          if (id === requestId) viewport.setAttribute("aria-busy", "false");
        }
      }
      select.addEventListener("change", draw);
      matchSelect.addEventListener("change", () => { updateWeapons(); updatePlayers(); draw(); });
      sideSelect.addEventListener("change", () => { updateWeapons(); updatePlayers(); draw(); });
      teamSelect.addEventListener("change", () => { updateWeapons(); updatePlayers(); draw(); });
      weaponSelect.addEventListener("change", () => { updatePlayers(); draw(); });
      layerButtons.forEach(button => {
        button.disabled = false;
        button.addEventListener("click", () => changeLayer(button.dataset.layer));
      });
      await changeLayer("flags");
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
