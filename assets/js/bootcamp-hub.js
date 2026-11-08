(function () {
  "use strict";
  const byId = id => document.getElementById(id);
  const classes = ["Any", "Scout", "Sniper", "Soldier", "Demoman", "Medic", "HWGuy", "Pyro", "Spy", "Engineer"];
  const tiers = ["Unranked", "Bronze", "Silver", "Gold", "Platinum"];
  const licenses = { none: "No license", permit: "Learner's permit", licensed: "TFC license", platinum: "Platinum license" };
  let mapRequest = 0, rankingRequest = 0, profileRequest = 0;

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }
  function message(container, text, error = false) {
    container.replaceChildren(element("p", text, error ? "bc-error" : "bc-empty"));
  }
  async function get(path) {
    const response = await fetch(path, { cache: "no-store" });
    if (!response.ok) throw new Error("Request failed");
    return response.json();
  }
  function time(ms) {
    const seconds = Number(ms) / 1000;
    const minutes = Math.floor(seconds / 60);
    return minutes ? `${minutes}:${(seconds % 60).toFixed(3).padStart(6, "0")}` : `${seconds.toFixed(3)}s`;
  }
  function className(id) { return classes[id] || `Class ${id}`; }
  function table(headers, rows) {
    const wrap = element("div", undefined, "bc-table-wrap"), grid = element("table", undefined, "bc-table");
    wrap.tabIndex = 0;
    wrap.setAttribute("aria-label", "Scrollable results table");
    const head = element("thead"), headerRow = element("tr");
    headers.forEach(text => { const th = element("th", text); th.scope = "col"; headerRow.append(th); });
    head.append(headerRow); grid.append(head);
    const body = element("tbody");
    rows.forEach(row => { const tr = element("tr"); row.forEach(value => {
      const td = element("td");
      if (value instanceof Node) td.append(value); else td.textContent = String(value);
      tr.append(td);
    }); body.append(tr); });
    grid.append(body); wrap.append(grid); return wrap;
  }
  function itemList(items, label, detail, action) {
    const list = element("ul", undefined, "bc-list");
    items.forEach(item => {
      const li = element("li"), text = element("div"), button = element("button", "Leaderboard");
      text.append(element("strong", label(item)), element("span", detail(item), "bc-detail"));
      button.type = "button"; button.setAttribute("aria-label", `View ${label(item)} leaderboard`);
      button.addEventListener("click", () => action(item)); li.append(text, button); list.append(li);
    });
    return list;
  }
  async function showRanking(kind, item) {
    const token = ++rankingRequest, section = byId("bc-ranking"), target = byId("bc-ranking-content");
    section.hidden = false; byId("bc-ranking-title").textContent = `${item.name} leaderboard`;
    message(target, "Loading leaderboard…");
    try {
      const data = await get(`/api/bootcamp/${kind}/${encodeURIComponent(item.id)}/leaderboard`);
      if (token !== rankingRequest) return;
      const scores = kind === "routes" ? data.runs : data.scores;
      if (!scores.length) return message(target, "No results yet.");
      const headers = ["Rank", "Player", "Class", kind === "routes" ? "Time" : "Score"];
      if (kind === "routes") headers.push("Replay");
      target.replaceChildren(table(headers, scores.map((row, index) => {
        const cells = [index + 1, row.playerName || row.steamId, className(row.classId),
          kind === "routes" ? time(row.timeMs) : Number(row.score).toFixed(2)];
        if (kind === "routes") {
          if (row.hasReplay && Number.isSafeInteger(Number(row.runId)) && Number(row.runId) > 0) {
            const link = element("a", "Watch");
            link.href = `speedrun-replay.html?source=bootcamp&runId=${encodeURIComponent(row.runId)}`;
            link.setAttribute("aria-label", `Watch ${row.playerName || row.steamId}'s replay`);
            cells.push(link);
          } else cells.push("Unavailable");
        }
        return cells;
      })));
    } catch {
      if (token === rankingRequest) message(target, "Could not load the leaderboard. Please try again.", true);
    }
  }
  async function selectMap(map) {
    const token = ++mapRequest;
    ++rankingRequest; byId("bc-ranking").hidden = true;
    const section = byId("bc-map-detail"), target = byId("bc-map-content");
    section.hidden = false; byId("bc-map-title").textContent = map;
    message(target, "Loading routes and drills…");
    try {
      const [routeData, drillData] = await Promise.all([
        get(`/api/bootcamp/maps/${encodeURIComponent(map)}/routes`),
        get(`/api/bootcamp/maps/${encodeURIComponent(map)}/drills`)
      ]);
      if (token !== mapRequest) return;
      target.replaceChildren(element("h3", "Routes"));
      if (routeData.routes.length) target.append(itemList(routeData.routes, row => row.name, row => row.type, row => showRanking("routes", row)));
      else target.append(element("p", "No routes configured.", "bc-empty"));
      target.append(element("h3", "Drills"));
      if (drillData.drills.length) target.append(itemList(drillData.drills, row => row.name, row => row.kind, row => showRanking("drills", row)));
      else target.append(element("p", "No drills configured.", "bc-empty"));
    } catch {
      if (token === mapRequest) message(target, "Could not load this map. Please try again.", true);
    }
  }
  async function loadMaps() {
    const target = byId("bc-maps");
    try {
      const data = await get("/api/bootcamp/maps");
      if (!data.maps.length) return message(target, "No training maps are available yet.");
      const list = element("ul", undefined, "bc-list");
      data.maps.forEach(row => {
        const li = element("li"), label = element("span", `${row.map} · ${row.routeCount} routes`), button = element("button", "View map");
        button.type = "button"; button.setAttribute("aria-label", `View ${row.map}`);
        button.addEventListener("click", () => selectMap(row.map)); li.append(label, button); list.append(li);
      });
      target.replaceChildren(list);
    } catch { message(target, "Could not load training maps. Please refresh to try again.", true); }
  }
  async function loadChallenge() {
    const target = byId("bc-challenge-content");
    try {
      const data = await get("/api/bootcamp/challenge/current");
      if (!data.challenge) return message(target, "No weekly challenge is active right now.");
      const challenge = data.challenge;
      target.replaceChildren(element("h3", challenge.title),
        element("p", `${challenge.map} · ${challenge.targetName} · ${challenge.targetType === "route" ? "Fastest valid time wins" : "Highest published score wins"}`, "bc-detail"));
      if (!data.standings.length) return target.append(element("p", "No eligible results this week yet.", "bc-empty"));
      const rows = data.standings.slice(0, 10).map((row, index) => [index + 1, row.playerName || row.steamId,
        className(row.classId), challenge.targetType === "route" ? time(row.timeMs) : Number(row.score).toFixed(2)]);
      target.append(table(["Rank", "Player", "Class", challenge.targetType === "route" ? "Time" : "Score"], rows));
    } catch { message(target, "Could not load this week's challenge. Please try again.", true); }
  }
  const profileForm = byId("bc-profile-form");
  profileForm.addEventListener("submit", async event => {
    event.preventDefault();
    const steam = byId("bc-steam").value.trim(), target = byId("bc-profile"), token = ++profileRequest;
    if (!/^STEAM_[0-5]:[01]:\d{1,20}$/.test(steam)) return message(target, "Enter a Steam ID such as STEAM_0:1:12345.", true);
    message(target, "Loading player progress…");
    try {
      const profile = await get(`/api/bootcamp/players/${encodeURIComponent(steam)}`);
      if (token !== profileRequest) return;
      target.replaceChildren(element("h3", profile.license ? (licenses[profile.license.level] || "License recorded") : "No license recorded"));
      if (profile.license?.endorsements.length) target.append(element("p", `Endorsements: ${profile.license.endorsements.join(", ")}`, "bc-detail"));
      target.append(element("h3", "Personal bests"));
      if (profile.personalBests.length) target.append(table(["Map", "Route", "Class", "Time", "Tier"], profile.personalBests.map(row =>
        [row.map, row.routeName, className(row.classId), time(row.timeMs), tiers[row.tier] || "Unranked"])));
      else target.append(element("p", "No published personal bests yet.", "bc-empty"));
      target.append(element("h3", "Drill bests"));
      if (profile.drillBests?.length) target.append(table(["Map", "Drill", "Class", "Score", "Tier"], profile.drillBests.map(row =>
        [row.map, row.drillName, className(row.classId), Number(row.score).toFixed(2), tiers[row.tier] || "Unranked"])));
      else target.append(element("p", "No finalized drill scores yet.", "bc-empty"));
    } catch {
      if (token === profileRequest) message(target, "Could not load this player. Please try again.", true);
    }
  });
  const profileId = new URLSearchParams(location.search).get("steamid") || new URLSearchParams(location.search).get("id") || "";
  if (profileId) {
    byId("bc-steam").value = profileId;
    profileForm.requestSubmit();
  }
  loadChallenge();
  loadMaps();
}());
