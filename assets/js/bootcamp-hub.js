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
  function itemList(items, label, detail, action, detailHref) {
    const list = element("ul", undefined, "bc-list");
    items.forEach(item => {
      const li = element("li"), text = element("div"), actions = element("div", undefined, "bc-actions"), button = element("button", "Leaderboard");
      text.append(element("strong", label(item)), element("span", detail(item), "bc-detail"));
      button.type = "button"; button.setAttribute("aria-label", `View ${label(item)} leaderboard`);
      button.addEventListener("click", () => action(item)); actions.append(button);
      if (detailHref) {
        const link = element("a", "Details", "bc-secondary-link");
        link.href = detailHref(item); link.setAttribute("aria-label", `Open ${label(item)} details`); actions.append(link);
      }
      li.append(text, actions); list.append(li);
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
        const player = element("a", row.playerName || row.steamId || "Unknown");
        if (row.steamId) player.href = `bootcamp-player.html?id=${encodeURIComponent(row.steamId)}`;
        const cells = [index + 1, player, className(row.classId),
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
      if (routeData.routes.length) target.append(itemList(routeData.routes, row => row.name, row => row.type,
        row => showRanking("routes", row), row => `bootcamp-route.html?id=${encodeURIComponent(row.id)}`));
      else target.append(element("p", "No routes configured.", "bc-empty"));
      target.append(element("h3", "Drills"));
      if (drillData.drills.length) target.append(itemList(drillData.drills, row => row.name, row => row.kind,
        row => showRanking("drills", row), row => `bootcamp-drill.html?id=${encodeURIComponent(row.id)}`));
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
        const li = element("li"), label = element("span", `${row.map} · ${row.routeCount} routes`), actions = element("div", undefined, "bc-actions"), button = element("button", "View map");
        button.type = "button"; button.setAttribute("aria-label", `View ${row.map}`);
        button.addEventListener("click", () => selectMap(row.map));
        const link = element("a", "Full page", "bc-secondary-link");
        link.href = `bootcamp-map.html?map=${encodeURIComponent(row.map)}`;
        link.setAttribute("aria-label", `Open ${row.map} Bootcamp page`);
        actions.append(button, link); li.append(label, actions); list.append(li);
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
  async function loadSeason() {
    const section = byId("bc-season"), target = byId("bc-season-content");
    try {
      const data = await get("/api/bootcamp/seasons/current");
      if (!data.season) return;
      section.hidden = false;
      const season = data.season;
      target.replaceChildren(element("h3", season.title),
        element("p", `Season standings · ${season.startsAt.slice(0, 10)} to ${season.endsAt.slice(0, 10)} UTC`, "bc-detail"));
      if (!data.standings.length) return target.append(element("p", "No tier improvements recorded this season yet.", "bc-empty"));
      target.append(table(["Rank", "Player", "Points", "Objectives"], data.standings.slice(0, 100).map(row =>
        [row.rank, row.playerName || row.steamId, row.points, row.objectives])));
    } catch {
      section.hidden = false;
      message(target, "Could not load season standings. Please try again.", true);
    }
  }
  async function loadSkillPoints() {
    const monthTarget = byId("bc-monthly-points"), allTimeTarget = byId("bc-alltime-points");
    const month = new Date().toISOString().slice(0, 7);
    try {
      const [monthly, allTime] = await Promise.all([
        get(`/api/bootcamp/leaderboards/skill-points?period=monthly&month=${encodeURIComponent(month)}`),
        get("/api/bootcamp/leaderboards/skill-points?period=all_time")
      ]);
      const render = (target, scores) => {
        if (!scores.length) return message(target, "No tier points recorded yet.");
        target.replaceChildren(table(["Rank", "Player", "Points", "Objectives"], scores.map((row, index) =>
          [index + 1, row.playerName || row.steamId, row.points, row.objectives])));
      };
      byId("bc-monthly-heading").textContent = `Skill points · ${month}`;
      render(monthTarget, monthly.scores);
      render(allTimeTarget, allTime.scores);
    } catch {
      message(monthTarget, "Could not load monthly skill points. Please try again.", true);
      message(allTimeTarget, "Could not load all-time skill points. Please try again.", true);
    }
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
  const accountLink = byId("bc-account-link"), accountLinkStatus = byId("bc-account-link-status");
  const linkResults = {
    linked: "Steam and Discord are linked. Your license role sync will run shortly.",
    steam_conflict: "That Steam account is already linked to another Discord account. Ask a server admin for help if this is a mistake.",
    "steam-failed": "Steam verification did not complete. Restart the link flow and try again.",
    "discord-failed": "Discord verification did not complete. Restart the link flow and try again."
  };
  const linkResult = new URLSearchParams(location.search).get("account_link");
  if (linkResults[linkResult]) {
    accountLinkStatus.textContent = linkResults[linkResult];
    accountLinkStatus.dataset.state = linkResult === "linked" ? "success" : "error";
    accountLinkStatus.hidden = false;
    history.replaceState(null, "", `${location.pathname}${location.hash}`);
  }
  get("/api/bootcamp/account-link/status").then(status => {
    if (status.enabled) accountLink.hidden = false;
  }).catch(() => { /* linking stays hidden if its optional status endpoint is unavailable */ });
  if (profileId) {
    byId("bc-steam").value = profileId;
    profileForm.requestSubmit();
  }
  loadChallenge();
  loadSeason();
  loadSkillPoints();
  loadMaps();
}());
