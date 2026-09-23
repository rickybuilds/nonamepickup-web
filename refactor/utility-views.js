const queryParams = () => new URLSearchParams(location.search);
const text = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const weaponName = (id) => window.nnHelpers?.weaponName?.(id) || ({
  "weapon-1": "Grenade",
  "weapon-2": "Nailgren",
  "weapon-3": "MIRV",
  "weapon-4": "EMP",
  "weapon-5": "Super Nailgun",
  "weapon-6": "Nails",
  "weapon-7": "Crowbar",
  "weapon-8": "Spanner",
  "weapon-9": "Medkit",
  "weapon-10": "Single Shotgun",
  "weapon-11": "Super Shotgun",
  "weapon-12": "Rocket Launcher",
  "weapon-13": "Assault Cannon",
  "weapon-14": "Railgun",
  "weapon-15": "Sentry Gun",
  "weapon-16": "Dispenser",
  "weapon-18": "Yellow Gren Launcher",
  "weapon-19": "Blue Gren Launcher",
  "weapon-20": "DetPack",
  "weapon-21": "Flamethrower",
  "weapon-22": "Napalm Grenade",
  "weapon-24": "Hallucination Grenade",
  "weapon-25": "Knife",
  "weapon-26": "Headshot Sniper Rifle",
  "weapon-27": "Sniper Rifle",
  "weapon-28": "Auto Sniper Rifle",
  "weapon-29": "Infection",
  suicide: "Suicides",
})[id] || id;

export function createUtilityViews({ get, set, pageHead, section, message, fmt, date, link }) {
  async function tracker() {
    const params = queryParams();
    const search = params.get("q") || "";
    const filter = params.get("identityFilter") || "all";
    const page = Math.max(1, Number(params.get("identityPage") || 1));
    const response = await get(`player-identities/public?q=${encodeURIComponent(search)}&filter=${encodeURIComponent(filter)}&page=${page}&limit=20`);
    const rows = response.data || [];
    set(`${pageHead("08", "Identity directory", "Search player names, Steam IDs, Discord IDs and recorded aliases. Raw IP addresses and shared-IP relationships are excluded.")}<div class="data-strip"><div class="strip-cell"><span class="micro">KNOWN PLAYERS</span><strong>${fmt(response.summary?.known_players)}</strong></div><div class="strip-cell"><span class="micro">CONNECTIONS</span><strong>${fmt(response.summary?.total_connections)}</strong></div><div class="strip-cell"><span class="micro">UNLINKED</span><strong>${fmt(response.summary?.unlinked_players)}</strong></div></div><form class="control-bar" id="identity-search-form"><input type="search" name="q" value="${text(search)}" placeholder="Name, alias, SteamID or Discord ID" aria-label="Search identities"><select name="filter" aria-label="Filter player identities"><option value="all" ${filter === "all" ? "selected" : ""}>All identities</option><option value="recent" ${filter === "recent" ? "selected" : ""}>Seen in 7 days</option><option value="unlinked" ${filter === "unlinked" ? "selected" : ""}>Unlinked</option><option value="multiple_aliases" ${filter === "multiple_aliases" ? "selected" : ""}>Multiple aliases</option></select><button type="submit">SEARCH ↗</button></form><div class="table-head identity-table"><span>PLAYER / IDENTITY</span><span>LAST SERVER</span><span>CONNECTIONS</span><span>LAST SEEN</span><span>ALIASES</span></div><div id="identity-rows">${rows.map((row) => `<button class="table-row identity-table identity-row" type="button" data-steam="${text(row.steam_id)}"><span class="table-name">${text(row.current_name || row.steam_id)}<small class="table-mobile-meta">${text(row.discord_name || "No Discord link")} / ${text(row.steam_id)}</small></span><span>${text(row.current_server || "—")}</span><span>${fmt(row.connection_count)}</span><span>${date(row.last_seen)}</span><span>${fmt(row.alias_count)}</span></button>`).join("") || message("No player identities match this search.")}</div><div id="identity-detail"></div><div class="action-row"><button id="identity-prev" type="button" ${page <= 1 ? "disabled" : ""}>← Previous</button><span class="micro">PAGE ${page} / ${Math.max(1, Math.ceil(Number(response.pagination?.total || 0) / 20))} · ${fmt(response.pagination?.total)} IDENTITIES</span><button id="identity-next" type="button" ${page * 20 >= Number(response.pagination?.total || 0) ? "disabled" : ""}>Next →</button></div>`);
    document.querySelector("#identity-search-form").onsubmit = (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const url = new URL(link("tracker"), location.href);
      url.searchParams.set("q", String(values.get("q") || ""));
      url.searchParams.set("identityFilter", String(values.get("filter") || "all"));
      url.searchParams.set("identityPage", "1");
      location.href = url;
    };
    for (const [selector, delta] of [["#identity-prev", -1], ["#identity-next", 1]]) {
      document.querySelector(selector).onclick = () => {
        const url = new URL(location.href);
        url.searchParams.set("identityPage", String(page + delta));
        location.href = url;
      };
    }
    document.querySelector("#identity-rows").onclick = async (event) => {
      const row = event.target.closest("[data-steam]");
      if (!row) return;
      const detail = await get(`player-identities/public/${encodeURIComponent(row.dataset.steam)}`);
      const aliases = (detail.aliases || []).map((alias) => `<div class="stat-line"><span>${text(alias.alias)}</span><strong>${fmt(alias.times_seen)} / ${date(alias.last_seen)}</strong></div>`).join("") || message("No alias history recorded.");
      document.querySelector("#identity-detail").innerHTML = `${section("", text(detail.player.current_name || detail.player.steam_id))}<div class="detail-meta"><span>STEAM / ${text(detail.player.steam_id)}</span><span>DISCORD / ${text(detail.player.discord_name || "UNLINKED")}</span><span>FIRST SEEN / ${date(detail.player.first_seen)}</span><span>LAST SEEN / ${date(detail.player.last_seen)}</span></div>${section("", "Alias history")}${aliases}${detail.player.discord_id ? `<div class="action-row"><a href="${link("player", "id", detail.player.discord_id)}">Pickup player file ↗</a></div>` : ""}`;
    };
  }

  async function kicked() {
    const params = queryParams();
    const data = await get("kicked");
    const events = data.events || [];
    const leaderboard = data.leaderboard || [];
    const query = (params.get("q") || "").toLowerCase();
    const rows = events.filter((event) => !query || event.players?.some((player) => `${player.name} ${player.id}`.toLowerCase().includes(query)));
    const shown = Number(params.get("limit") || 50);
    set(`${pageHead("08", "Missed votes", "Community queue voting history from the maintained event archive.")}<div class="data-strip"><div class="strip-cell"><span class="micro">VOTE EVENTS</span><strong>${fmt(data.summary?.missed_votes)}</strong></div><div class="strip-cell"><span class="micro">KICK EVENTS</span><strong>${fmt(data.summary?.kick_events)}</strong></div><div class="strip-cell"><span class="micro">PLAYERS</span><strong>${fmt(data.summary?.unique_players)}</strong></div><div class="strip-cell"><span class="micro">TOP MISSED</span><strong>${text(leaderboard[0]?.name || "—")}</strong></div></div>${section("", "Missed-vote rankings")}${leaderboard.slice(0, 20).map((player) => `<a class="rank-row" href="${link("player", "id", player.id)}"><span class="rank-number">${fmt(player.rank)}</span><span class="rank-name">${text(player.name)}</span><span class="rank-elo">${fmt(player.kicks)}</span><span class="rank-games">VOTES</span></a>`).join("") || message("No vote history recorded.")}<form id="kicked-filter-form" class="control-bar"><input name="q" type="search" value="${text(params.get("q") || "")}" placeholder="Filter history by player" aria-label="Filter missed-vote history"><button type="submit">FILTER ↗</button></form>${section("", "Recent events")}${rows.slice(0, shown).map((event) => `<div class="stat-line"><span>${text(event.timestamp || "Unknown date")} · ${text(String(event.reason || "unknown").replaceAll("_", " "))}</span><strong>${(event.players || []).map((player) => text(player.name)).join(" / ")}</strong></div>`).join("") || message("No vote events match this search.")}<div class="action-row"><button id="kicked-more" type="button" ${shown >= rows.length ? "disabled" : ""}>Show more events ↓</button><span class="micro">${fmt(Math.min(shown, rows.length))} / ${fmt(rows.length)}</span></div>`);
    document.querySelector("#kicked-filter-form").onsubmit = (event) => {
      event.preventDefault();
      const url = new URL(link("kicked"), location.href);
      url.searchParams.set("q", String(new FormData(event.currentTarget).get("q") || ""));
      url.searchParams.delete("limit");
      location.href = url;
    };
    document.querySelector("#kicked-more").onclick = () => {
      const url = new URL(location.href);
      url.searchParams.set("limit", String(shown + 50));
      location.href = url;
    };
  }

  async function odds() {
    const params = queryParams();
    const query = params.get("player") || "";
    let result = null;
    let error = "";
    if (query) {
      try { result = await get(`vegasodds/${encodeURIComponent(query)}`); }
      catch (failure) { error = failure.message === "API 404" ? "No player matched that name or ID." : "Odds service is unavailable. Try again."; }
    }
    set(`${pageHead("08", "Vegas odds", "A playful activity estimate based on completed pickup dates.")}<form id="odds-form" class="compare-form"><label>PLAYER / NAME OR DISCORD ID<input name="player" required value="${text(query)}" autocomplete="off"></label><button type="submit">RUN ODDS ↗</button></form>${error ? message(error, "error") : ""}${result ? `<div class="detail-hero"><div><span class="eyebrow">ACTIVITY FORECAST</span><h2>${text(result.player?.display_name || result.player?.player_id)}</h2></div><div class="detail-stat"><b>${text(result.status || "Unknown")}</b><small>STATUS</small></div></div>${result.enough_data ? `<div class="profile-values"><div><small>LAST PLAYED</small><b>${text(result.last_played || "—")}</b></div><div><small>DAYS SINCE</small><b>${fmt(result.days_since_last_played)}</b></div><div><small>AVERAGE GAP</small><b>${fmt(result.avg_gap_days)} D</b></div><div><small>LONGEST GAP</small><b>${fmt(result.longest_gap_days)} D</b></div><div><small>VEGAS LINE</small><b>${fmt(result.vegas_line)}</b></div><div><small>LAST ACTIVE GAMES</small><b>${fmt(result.games_last_active_day)}</b></div></div>` : message(result.message || "Not enough match history to estimate activity.")}` : message("Enter a player name or Discord ID to calculate the community odds.")}`);
    document.querySelector("#odds-form").onsubmit = (event) => {
      event.preventDefault();
      const url = new URL(link("odds"), location.href);
      url.searchParams.set("player", String(new FormData(event.currentTarget).get("player") || ""));
      location.href = url;
    };
  }

  async function mvp() {
    const params = queryParams();
    const matchId = params.get("match") || "";
    let matchData = null;
    let error = "";
    if (matchId) {
      try { matchData = (await get(`match/${encodeURIComponent(matchId)}`)).match; }
      catch { error = "Match details are unavailable. Check the ID and try again."; }
    }
    set(`${pageHead("08", "MVP breakdown", "Match and round awards from the recorded pickup ledger.")}<form id="mvp-form" class="compare-form"><label>MATCH ID<input name="match" required value="${text(matchId)}" placeholder="Enter a match ID"></label><button type="submit">OPEN BREAKDOWN ↗</button></form>${error ? message(error, "error") : ""}${matchData ? `<div class="detail-hero"><div><span class="eyebrow">MATCH / ${text(matchData.id)}</span><h2>${text(matchData.map_name || "Unknown map")}</h2></div><div class="detail-stat"><b>${text(matchData.winner || "—")}</b><small>WINNER</small></div></div>${section("", "Match standouts")}${(matchData.match_mvps || []).map((row) => `<div class="stat-line"><span>${text(row.display_name || row.player || "MVP")}</span><strong>${fmt(row.mvp_count || row.value || 1)} MVP</strong></div>`).join("") || message("No match MVP is recorded.")}${section("", "Round awards")}${(matchData.round_mvps || []).map((row) => `<div class="stat-line"><span>ROUND ${fmt(row.round_num)}</span><strong>${text(row.mvp_display_name || "MVP unavailable")}</strong></div>`).join("") || message("No round MVPs are recorded.")}<div class="action-row"><a href="${link("match", "id", matchId)}">Full match record ↗</a><a href="${link("map", "id", matchData.map_name)}">Map file ↗</a></div>` : message("Enter a match ID to review its recorded MVP awards.")}`);
    document.querySelector("#mvp-form").onsubmit = (event) => {
      event.preventDefault();
      const url = new URL(link("mvp"), location.href);
      url.searchParams.set("match", String(new FormData(event.currentTarget).get("match") || ""));
      location.href = url;
    };
  }

  async function honors() {
    const response = await get("coolest-dude/tags?limit=100");
    const tags = response.data || [];
    set(`${pageHead("08", "Community honors", "Short, positive notes for the players who make the community better.")}<form id="honor-form" class="compare-form"><label>YOUR TAG<input name="message" maxlength="120" required placeholder="Write a short, positive tag"></label><button type="submit">POST TAG ↗</button></form><p id="honor-status" class="rank-note">Tags follow the existing server moderation rules and rate limit.</p><div id="honor-list">${tags.map((tag) => `<div class="stat-line"><span>${text(tag.message)}</span><strong>${date(tag.created_at)}</strong></div>`).join("") || message("No tags yet. Be the first to leave a positive note.")}</div>`);
    document.querySelector("#honor-form").onsubmit = async (event) => {
      event.preventDefault();
      const input = event.currentTarget.elements.message;
      const status = document.querySelector("#honor-status");
      const button = event.currentTarget.querySelector("button");
      button.disabled = true;
      status.textContent = "Checking your tag…";
      try {
        const response = await fetch("/api/coolest-dude/tags", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: input.value.trim() }) });
        const payload = await response.json();
        if (!response.ok || !payload.ok) throw Error(payload.error || "post_failed");
        document.querySelector("#honor-list").insertAdjacentHTML("afterbegin", `<div class="stat-line"><span>${text(payload.data.message)}</span><strong>${date(payload.data.created_at)}</strong></div>`);
        input.value = "";
        status.textContent = "Tag posted.";
      } catch (failure) {
        status.textContent = failure.message === "tag_not_allowed" ? "That tag was blocked. Keep it positive and avoid links." : failure.message === "tag_rate_limited" ? "Please wait before posting another tag." : "Could not post this tag. Please try again.";
      } finally { button.disabled = false; }
    };
  }

  async function playerEvents() {
    const params = queryParams();
    const playerId = params.get("id") || "";
    if (!playerId) throw Error("Player ID missing");
    const limit = 100;
    const offset = Math.max(0, Number(params.get("offset") || 0));
    const filters = {
      map: params.get("map") || "",
      class: params.get("class") || "",
      weapon: params.get("weapon") || "",
      objective: params.get("objective") || "",
    };
    const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
    const response = await get(`player/${encodeURIComponent(playerId)}/granular/events?${qs}`);
    const data = response.data || {};
    const events = data.events || [];
    const external = (value) => {
      try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) ? url.href : "";
      } catch { return ""; }
    };
    set(`${pageHead("03", "Combat events", `${text(data.player?.name || playerId)} / chronological detailed kill events.`)}<form id="player-events-filter" class="control-bar"><input name="map" value="${text(filters.map)}" placeholder="Map"><input name="class" value="${text(filters.class)}" placeholder="Class"><input name="weapon" value="${text(filters.weapon)}" placeholder="Weapon"><select name="objective"><option value="">All events</option><option value="flag" ${filters.objective === "flag" ? "selected" : ""}>Flag carrier kills</option><option value="conced" ${filters.objective === "conced" ? "selected" : ""}>Conced kills</option></select><button type="submit">FILTER ↗</button></form>${events.map((event) => {
      const source = external(event.source_url);
      return `<div class="stat-line"><span>${text(event.map_name || "Unknown map")} · ROUND ${fmt(event.round_num)} · ${text(event.event_time_text || "Time unknown")}<small class="table-mobile-meta">${text(event.attacker_class || "Unknown class")} / ${text(event.weapon || "Unknown weapon")}${event.is_flag_carrier_kill ? " / FLAG CARRIER" : ""}${event.is_conced ? " / CONCED" : ""}</small></span><strong>${text(event.attacker_name || "Unknown")} → ${text(event.victim_name || "Unknown")}${source ? ` · <a href="${text(source)}" target="_blank" rel="noopener noreferrer">Source ↗</a>` : ""} · <a href="${link("match", "id", event.match_id)}">Match ↗</a></strong></div>`;
    }).join("") || message("No combat events match these filters.")}<div class="action-row"><button id="events-prev" type="button" ${offset <= 0 ? "disabled" : ""}>← Newer</button><span class="micro">${fmt(offset + (events.length ? 1 : 0))}–${fmt(offset + events.length)} / ${data.total == null ? "MORE AVAILABLE" : fmt(data.total)}</span><button id="events-next" type="button" ${!data.hasMore ? "disabled" : ""}>Older →</button><a href="${link("player", "id", playerId)}">← Player file</a></div>`);
    document.querySelector("#player-events-filter").onsubmit = (event) => {
      event.preventDefault();
      const values = new FormData(event.currentTarget);
      const url = new URL(link("player-events", "id", playerId), location.href);
      for (const key of ["map", "class", "weapon", "objective"]) if (values.get(key)) url.searchParams.set(key, String(values.get(key)));
      location.href = url;
    };
    for (const [selector, delta] of [["#events-prev", -limit], ["#events-next", limit]]) {
      document.querySelector(selector).onclick = () => {
        const url = new URL(location.href);
        url.searchParams.set("offset", String(Math.max(0, offset + delta)));
        location.href = url;
      };
    }
  }

  async function analytics() {
    const params = queryParams();
    const group = params.get("group") || "overview";
    const [payload, outcomes, streaks] = await Promise.all([
      get("analytics?limit=10"),
      get("stats/matchOutcomes").catch(() => null),
      get("stats/streaks").catch(() => null),
    ]);
    const data = payload.data || {};
    const summary = data.summary || {};
    const groups = {
      overview: ["Archive overview", "Activity and archive totals"],
      combat: ["Career combat", "combat"],
      flags: ["Flag work", "flags"],
      roles: ["Class and role records", "roles"],
      rounds: ["Round records", "rounds"],
      matches: ["Match records", "matches"],
      performance: ["Per game", "per_game"],
      mvps: ["MVP records", "mvps"],
      maps: ["Map archive", "maps"],
      chaos: ["Unusual records", "chaos"],
      weapons: ["Weapon records", "weapons"],
    };
    const active = groups[group] ? group : "overview";
    const linkForLeader = (row) => row?.id ? link("player", "id", row.id) : "";
    const recordLink = (row) => {
      const urls = [row?.match_id ? `<a href="${link("match", "id", row.match_id)}">NoName</a>` : ""];
      for (const [field, label] of [["hampalyzer_url", "Hampalyzer"], ["tfcstats_url", "TFCStats"]]) {
        try {
          const url = new URL(row?.[field]);
          if (["http:", "https:"].includes(url.protocol)) urls.push(`<a href="${text(url.href)}" target="_blank" rel="noopener noreferrer">${label}</a>`);
        } catch { /* Missing or unsafe report link. */ }
      }
      return urls.filter(Boolean).join(" / ");
    };
    const valueWithUnit = (value, metric) => {
      const units = { games: "GAMES", matches: "GAMES", kills: "KILLS", round_kills: "KILLS", damage: "DMG", enemy_damage: "DMG", round_damage: "DMG", caps: "CAPS", touches: "TOUCHES", initial_touches: "TOUCHES", conc_jumps: "JUMPS", suicides: "SUICIDES", deaths: "DEATHS", team_kills: "TEAM KILLS", team_damage: "DMG", flag_time: "SEC" };
      const number = Number(value);
      const formatted = Number.isFinite(number) ? (Number.isInteger(number) ? fmt(number) : number.toLocaleString(undefined, { maximumFractionDigits: 2 })) : text(value);
      if (["kdr", "worst_kdr", "team_kills_per_match", "suicides_per_match"].includes(metric)) return formatted;
      if (metric === "conversion") return `${formatted}%`;
      return `${formatted}${units[metric] ? ` ${units[metric]}` : ""}`;
    };
    const leaderRows = (rows, metric = "", contextForRow = null) => (rows || []).map((row, index) => {
      const target = linkForLeader(row);
      const player = target ? `<a href="${target}">${text(row.player || "Unknown player")}</a>` : text(row.player || row.weapon || "Unknown");
      const matchLink = row.match_id ? `<a href="${link("match", "id", row.match_id)}">Match ↗</a>` : "";
      const mapLink = row.map ? `<a href="${link("map", "id", row.map)}">${text(row.map)}</a>` : "";
      const rowContext = contextForRow ? contextForRow(row) : [mapLink, row.round_num ? `ROUND ${fmt(row.round_num)}` : "", row.matches ? `${fmt(row.matches)} GAMES` : ""].filter(Boolean).join(" / ");
      return `<div class="table-row analytics-row"><span class="number muted">${index + 1}</span><span class="table-name">${player}${rowContext ? `<small class="analytics-context">${rowContext}</small>` : ""}</span><strong>${valueWithUnit(row.value, metric)}${row.secondary != null && !contextForRow ? `<small>${fmt(row.secondary)} TOTAL</small>` : ""}</strong><span>${matchLink || recordLink(row)}</span></div>`;
    }).join("") || message("No records in this measure.");
    const recordSection = (title, rows, metric, contextForRow = null) => `${section("", title)}<div class="table-head analytics-row"><span>RANK</span><span>PLAYER / CONTEXT</span><span>VALUE</span><span>RECORD</span></div>${leaderRows(rows, metric, contextForRow)}`;
    const activity = data.activity || [];
    const activityMax = Math.max(1, ...activity.map((point) => Number(point.matches) || 0));
    const chartPoints = activity.map((point, index) => {
      const x = activity.length < 2 ? 50 : 16 + (index / (activity.length - 1)) * 968;
      const y = 184 - ((Number(point.matches) || 0) / activityMax) * 150;
      return { x, y, ...point };
    });
    const polyline = chartPoints.map((point) => `${point.x},${point.y}`).join(" ");
    const selectedData = data[groups[active][1]];
    let content = "";
    if (active === "overview") {
      const outcome = outcomes?.data || {};
      const currentStreak = streaks?.data?.currentStreakLeaders || [];
      content = `<div class="profile-ribbon"><span>${fmt(summary.matches)} COMPLETED MATCHES / ${fmt(summary.players)} PLAYERS / ${fmt(summary.rounds)} ROUNDS</span><span>${fmt(summary.total_kills)} RECORDED KILLS</span></div>${section("", "Match activity / 12 months")}<div class="analytics-chart"><svg viewBox="0 0 1000 220" role="img" aria-label="Completed matches per month over the past year"><line x1="16" y1="184" x2="984" y2="184"></line><line x1="16" y1="109" x2="984" y2="109"></line><line x1="16" y1="34" x2="984" y2="34"></line><polyline points="${polyline}"></polyline>${chartPoints.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3"><title>${text(point.month)} / ${fmt(point.matches)} matches</title></circle>`).join("")}</svg><div class="analytics-months">${chartPoints.map((point) => `<span>${text(point.month?.slice(5) || "")}</span>`).join("")}</div></div><div class="data-strip"><div class="strip-cell"><span class="micro">TIES</span><strong>${fmt(outcome.ties)}</strong></div><div class="strip-cell"><span class="micro">CLOSE GAMES</span><strong>${fmt(outcome.closeGames)}</strong></div><div class="strip-cell"><span class="micro">BLOWOUTS</span><strong>${fmt(outcome.blowouts)}</strong></div><div class="strip-cell"><span class="micro">CURRENT WIN STREAK</span><strong>${fmt(currentStreak[0]?.wins)}</strong></div></div>${recordSection("Career leaders", data.combat?.kills, "")}${recordSection("Per-game leaders", data.per_game?.kills, "")}${recordSection("MVP leaders", data.mvps, "")}${section("", "Maps by match volume")}${(data.maps?.details || []).slice(0, 20).map((row) => `<a class="map-row" href="${link("map", "id", row.map)}"><b>${text(row.map)}</b><span>${fmt(row.matches)} GAMES</span><span>${fmt(row.total_kills)} KILLS</span><span>AVG TEAM SCORE ${fmt(row.average_team_score)} ↗</span></a>`).join("")}`;
    } else if (active === "maps") {
      const rows = (selectedData?.details || []).map((row) => ({ ...row, player: row.map, id: "", secondary: row.total_kills }));
      content = `${recordSection("Map archive / games and combat", rows, "")}${section("", "Top players by map")}${(selectedData?.leaders || []).map((row) => `<div class="stat-line"><span><a href="${link("map", "id", row.map)}">${text(row.map)}</a> / <a href="${link("player", "id", row.id)}">${text(row.player)}</a></span><strong>${fmt(row.value)} / ${fmt(row.matches)} G</strong></div>`).join("")}`;
    } else if (active === "weapons") {
      content = `${section("", "Weapon totals")}${(selectedData?.totals || []).map((row) => `<div class="stat-line"><span>${text(weaponName(row.weapon))}</span><strong>${fmt(row.value)} KILLS / ${fmt(row.matches)} MATCHES</strong></div>`).join("")}${section("", "Players by weapon")}${(selectedData?.leaders || []).map((row) => `<div class="stat-line"><span>${text(weaponName(row.weapon))} / <a href="${link("player", "id", row.id)}">${text(row.player)}</a></span><strong>${fmt(row.value)} KILLS / ${fmt(row.matches)} G</strong></div>`).join("")}${section("", "Maps by weapon")}${(selectedData?.maps || []).map((row) => `<div class="stat-line"><span>${text(weaponName(row.weapon))} / <a href="${link("map", "id", row.map)}">${text(row.map)}</a></span><strong>${fmt(row.value)} KILLS / ${fmt(row.matches)} G</strong></div>`).join("")}`;
    } else if (active === "mvps") {
      content = `${recordSection("Match MVPs", selectedData, "")}${recordSection("MVP efficiency", data.mvp_rate, "")}`;
    } else if (active === "chaos") {
      const titles = {
        least_flag_touches: "Least Flag Touches In A Match",
        suicides: "Most Suicides",
        team_kills: "Most Team Kills",
        team_damage: "Most Team Damage",
        deaths: "Most Deaths",
        worst_kdr: "Worst Career K/D",
        team_kills_per_match: "Most Team Kills Per Match",
        suicides_per_match: "Most Suicides Per Match",
      };
      const orderedKeys = ["least_flag_touches", "suicides", "team_kills", "team_damage", "deaths", "worst_kdr", "team_kills_per_match", "suicides_per_match"];
      content = orderedKeys.map((key) => {
        const rows = selectedData?.[key] || [];
        const isShame = key === "least_flag_touches";
        const metric = isShame ? "touches" : key;
        const context = isShame ? (row) => {
          const seconds = Math.max(0, Number(row.played_seconds) || 0);
          const minutes = Math.floor(seconds / 60);
          const duration = `${minutes}M ${String(Math.floor(seconds % 60)).padStart(2, "0")}S GAME TIME`;
          return [duration, row.class_name && text(row.class_name), row.map && `<a href="${link("map", "id", row.map)}">${text(row.map)}</a>`].filter(Boolean).join(" / ");
        } : null;
        return recordSection(titles[key], rows, metric, context);
      }).join("");
    } else {
      content = Object.entries(selectedData || {}).map(([key, rows]) => recordSection(key.replaceAll("_", " "), rows, key)).join("") || message("No analytics data is available for this section.");
    }
    set(`${pageHead("06", "Analytics", "A record of performance, activity and the shape of the pickup archive.")}<div class="control-bar"><label>ANALYTICS VIEW<select id="analytics-group">${Object.entries(groups).map(([key, [label]]) => `<option value="${key}" ${active === key ? "selected" : ""}>${text(label)}</option>`).join("")}</select></label><span class="micro">QUALIFICATION / ${fmt(data.qualification?.minimum_games)} GAMES FOR PERFORMANCE</span></div>${content}`);
    document.querySelector("#analytics-group").onchange = (event) => {
      const url = new URL(link("analytics"), location.href);
      url.searchParams.set("group", event.target.value);
      location.href = url;
    };
  }

  return { tracker, kicked, odds, mvp, honors, analytics, "player-events": playerEvents };
}
