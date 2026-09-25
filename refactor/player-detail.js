const completed = (row) => row.status === "completed" && !/^(admin-|seed-)/.test(String(row.id || ""));
const num = (value) => Number(value) || 0;
const signed = (value) => `${num(value) > 0 ? "+" : ""}${Math.round(num(value))}`;
const tier = (value) => {
  const n = num(value);
  for (const [threshold, rank] of [[3600, "S"], [3201, "10"], [3011, "9"], [2731, "8"], [2461, "7"], [2001, "6"], [1641, "5"], [1391, "4"], [1051, "3"], [721, "2"], [300, "1"]]) {
    if (n >= threshold) return rank;
  }
  return "NR";
};
const teamOf = (row, id) =>
  (row.blueTeam || []).some((p) => String(p.id) === String(id)) ? "BLUE" :
  (row.redTeam || []).some((p) => String(p.id) === String(id)) ? "RED" : "";
const resultOf = (row, id) => {
  const team = teamOf(row, id);
  const winner = String(row.winner || "").toUpperCase();
  return winner === "TIE" ? "T" : team && winner === team ? "W" : team && ["BLUE", "RED"].includes(winner) ? "L" : "?";
};
const roleOf = (name) => {
  const key = String(name || "").toLowerCase().replace(/[^a-z]/g, "");
  return ["scout", "medic", "spy"].includes(key) ? "offense" :
    ["soldier", "engineer", "demoman", "hwguy", "heavyweaponsguy"].includes(key) ? "defense" : "other";
};
const weaponNames = ["", "Grenade", "Nailgren", "MIRV", "EMP", "Super Nailgun", "Nails", "Crowbar", "Spanner", "Medkit", "Single Shotgun", "Super Shotgun", "Rocket Launcher", "Assault Cannon", "Railgun", "Sentry Gun", "Dispenser", "", "Yellow Gren Launcher", "Blue Gren Launcher", "DetPack", "Flamethrower", "Napalm Grenade", "", "Hallucination Grenade", "Knife", "Headshot Sniper Rifle", "Sniper Rifle", "Auto Sniper Rifle", "Infection"];
const label = (value) => {
  const raw = String(value || "Unknown");
  if (raw.toLowerCase() === "hwguy") return "HWGuy";
  const weapon = /^weapon-(\d+)$/.exec(raw);
  if (weapon && weaponNames[Number(weapon[1])]) return weaponNames[Number(weapon[1])];
  return raw.replace(/^weapon-/, "Weapon ").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
const ratio = (total, count) => count ? (num(total) / count).toFixed(1) : "—";
const imagePath = (name) => `../assets/images/maps/${encodeURIComponent(String(name || "").trim())}.webp`;

function chart(rows, esc, date) {
  const points = rows.filter((r) => r.after != null).slice(0, 100).reverse();
  if (points.length < 2) return '<p class="dossier-empty">Not enough rated matches to draw a trend.</p>';
  const values = points.map((r) => num(r.after));
  const low = Math.min(...values), high = Math.max(...values), range = Math.max(20, high - low);
  const coords = values.map((v, i) => `${24 + i * 852 / (values.length - 1)},${188 - (v - low) * 150 / range}`).join(" ");
  return `<div class="dossier-chart"><div class="dossier-chart-topline"><span>${points.length} RATED MATCHES</span><span>${date(points[0].created_at)} — ${date(points.at(-1).created_at)}</span></div><svg viewBox="0 0 900 225" role="img" aria-label="ELO over the last ${points.length} rated matches, from ${Math.round(values[0])} to ${Math.round(values.at(-1))}"><line x1="24" y1="38" x2="876" y2="38"/><line x1="24" y1="113" x2="876" y2="113"/><line x1="24" y1="188" x2="876" y2="188"/><polygon points="24,188 ${esc(coords)} 876,188"/><polyline points="${esc(coords)}"/><circle cx="876" cy="${188 - (values.at(-1) - low) * 150 / range}" r="5"/></svg><div><span>${Math.round(low)} LOW</span><strong>${Math.round(values.at(-1))} CURRENT</strong><span>${Math.round(high)} HIGH</span></div></div>`;
}

function heatmap(rows, esc) {
  const days = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
  const cells = Array.from({ length: 7 }, () => Array(12).fill(0));
  for (const row of rows) {
    const raw = num(row.created_at);
    const d = new Date(raw < 1e12 ? raw * 1000 : raw);
    if (Number.isNaN(d.getTime())) continue;
    cells[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 2)]++;
  }
  const max = Math.max(1, ...cells.flat());
  return `<div class="dossier-heatmap" role="img" aria-label="Match activity by local day and two-hour interval"><div class="dossier-heatmap-hours"><span></span>${[0, 4, 8, 12, 16, 20].map((h) => `<span>${String(h).padStart(2, "0")}</span>`).join("")}</div>${cells.map((row, i) => `<div class="dossier-heatmap-row"><span>${days[i]}</span>${row.map((count, j) => `<i style="--heat:${Math.round(count / max * 90)}%" title="${esc(days[i])} ${String(j * 2).padStart(2, "0")}:00–${String(j * 2 + 2).padStart(2, "0")}:00 / ${count} matches"></i>`).join("")}</div>`).join("")}</div>`;
}

function relationships(rows, id) {
  const mates = new Map(), rivals = new Map();
  for (const row of rows) {
    const team = teamOf(row, id);
    if (!team) continue;
    const outcome = resultOf(row, id);
    for (const [people, target] of [
      [team === "BLUE" ? row.blueTeam : row.redTeam, mates],
      [team === "BLUE" ? row.redTeam : row.blueTeam, rivals],
    ]) {
      for (const person of people || []) {
        if (!person.id || String(person.id) === String(id)) continue;
        const key = String(person.id);
        const item = target.get(key) || { id: key, name: person.name || key, avatar: person.avatarfull || person.avatarmedium || person.avatar || "", games: 0, wins: 0, losses: 0 };
        item.games++;
        if (outcome === "W") item.wins++;
        if (outcome === "L") item.losses++;
        target.set(key, item);
      }
    }
  }
  const rate = (p) => p.wins + p.losses ? p.wins / (p.wins + p.losses) : 0;
  return {
    mates: [...mates.values()].filter((p) => p.games >= 2).sort((a, b) => rate(b) - rate(a) || b.games - a.games).slice(0, 4),
    rivals: [...rivals.values()].filter((p) => p.games >= 2).sort((a, b) => rate(a) - rate(b) || b.games - a.games).slice(0, 4),
  };
}

function roleMarkup(data, role, helpers) {
  const { esc, fmt } = helpers;
  const time = (data.roleClassTime || []).filter((r) => String(r.role).toLowerCase() === role);
  const weapons = (data.classWeapons || []).filter((r) => roleOf(r.class) === role);
  const matches = num(data.filteredFlags?.matches) || num(data.sample?.matches);
  const kills = weapons.reduce((sum, r) => sum + num(r.kills), 0);
  const hours = time.reduce((sum, r) => sum + num(r.seconds), 0) / 3600;
  const top = (data.roleWeapons || []).filter((r) => String(r.role).toLowerCase() === role).sort((a, b) => num(b.kills) - num(a.kills))[0] || weapons.slice().sort((a, b) => num(b.kills) - num(a.kills))[0];
  const fc = (data.flagCarrierKills || []).filter((r) => roleOf(r.class) === role).reduce((sum, r) => sum + num(r.kills), 0);
  const conc = (data.concededKills || []).filter((r) => roleOf(r.class) === role).reduce((sum, r) => sum + num(r.kills), 0);
  const metrics = role === "offense" ? [
    ["FRAGS / MATCH", ratio(kills, matches)], ["TOUCHES / MATCH", ratio(data.filteredFlags?.touches, matches)], ["SG KILLS / MATCH", ratio(data.filteredFlags?.sentryKills, matches)],
  ] : [
    ["FRAGS / MATCH", ratio(kills, matches)], ["CONC KILLS / MATCH", ratio(conc, matches)], ["FC KILLS / MATCH", ratio(fc, matches)],
  ];
  const classTotal = Math.max(1, ...time.map((r) => num(r.seconds)));
  return `<div class="dossier-role dossier-role-${role}"><div class="dossier-role-head"><h3>${role === "offense" ? "Offense" : "Defense"}</h3><span>${hours.toFixed(1)} H CLASS TIME</span></div><div class="dossier-role-metrics">${metrics.map(([name, value]) => `<div><b>${esc(value)}</b><small>${name}</small></div>`).join("")}</div><div class="dossier-top-weapon"><span>TOP KILL WEAPON</span><strong>${top ? esc(label(top.weapon)) : "—"}</strong><span>${top ? `${fmt(top.kills)} KILLS` : "NO EVENT DATA"}</span></div><div class="dossier-class-bars">${time.sort((a, b) => num(b.seconds) - num(a.seconds)).slice(0, 5).map((r) => `<div><span>${esc(label(r.class))}</span><i><i style="width:${Math.max(2, num(r.seconds) / classTotal * 100)}%"></i></i><strong>${num(r.hours).toFixed(1)} H</strong></div>`).join("")}</div></div>`;
}

function granularMarkup(data, helpers) {
  const { esc, fmt, link, playerIdentity } = helpers;
  if (!data?.source?.granularAvailable) return '<p class="dossier-empty">Granular kill events are not available for this player or filter.</p>';
  const byClass = new Map();
  for (const row of data.classWeapons || []) {
    const key = row.class || "Unknown";
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(row);
  }
  const groups = [...byClass.entries()].sort((a, b) => b[1].reduce((n, r) => n + num(r.kills), 0) - a[1].reduce((n, r) => n + num(r.kills), 0));
  const list = (rows, render) => rows.length ? rows.slice(0, 10).map(render).join("") : '<p class="dossier-empty">No events in this selection.</p>';
  const roleTimes = (data.roleClassTime || []).reduce((out, row) => {
    const role = String(row.role || "").toLowerCase();
    if (role === "offense" || role === "defense") out[role] += num(row.seconds);
    return out;
  }, { offense: 0, defense: 0 });
  const roleTotal = roleTimes.offense + roleTimes.defense;
  const offenseShare = roleTotal ? roleTimes.offense / roleTotal * 100 : 50;
  const defenseShare = 100 - offenseShare;
  const roleBalance = `<div class="dossier-role-balance" aria-label="Offense ${(roleTimes.offense / 3600).toFixed(1)} hours, defense ${(roleTimes.defense / 3600).toFixed(1)} hours"><div class="dossier-role-balance-bar"><i class="offense" style="width:${offenseShare}%"></i><i class="defense" style="width:${defenseShare}%"></i></div><div><span><b>${(roleTimes.offense / 3600).toFixed(1)} H</b> OFFENSE</span><span><b>${(roleTimes.defense / 3600).toFixed(1)} H</b> DEFENSE</span></div></div>`;
  return `${roleBalance}<div class="dossier-role-pair">${roleMarkup(data, "offense", helpers)}${roleMarkup(data, "defense", helpers)}</div><div class="dossier-granular-lists"><details><summary>Class / weapon breakdown <span>${groups.length} CLASSES</span></summary><div class="dossier-weapon-ledger">${groups.map(([name, rows]) => `<div class="dossier-weapon-group"><h4>${esc(label(name))}<span>${fmt(rows.reduce((n, r) => n + num(r.kills), 0))} KILLS</span></h4>${rows.sort((a, b) => num(b.kills) - num(a.kills)).map((r) => `<div><span>${esc(label(r.weapon))}</span><span>${fmt(r.kills)} K</span><span>${fmt(r.matchesWithKill)} M</span><strong>${num(r.killsPerMatch).toFixed(1)} K/M</strong></div>`).join("")}</div>`).join("")}</div></details><div class="dossier-two-lists"><div><h3>Favorite victims</h3>${list(data.favoriteVictims || [], (r) => `<div><span>${r.victimId && String(r.victimId) !== String(r.victimSteamId || "") && /^\d{16,20}$/.test(String(r.victimId)) ? playerIdentity({ id: r.victimId, name: r.victimName }, { href: link("player", "id", r.victimId) }) : esc(r.victimName)}</span><strong>${fmt(r.kills)} K</strong></div>`)}</div><div><h3>Alias history</h3>${list(data.aliasHistory || [], (r) => `<div><span>${esc(r.name)}</span><strong>${fmt(r.kills)} K</strong></div>`)}</div></div></div>`;
}

export async function renderPlayerDossier(helpers) {
  const { id, get, set, section, message, fmt, elo, date, link, esc, safeUrl, playerIdentity, persistViewState } = helpers;
  const validUrl = (value) => value ? safeUrl(value) : "";
  if (!id) throw Error("Player ID missing");
  const key = encodeURIComponent(id);
  const [profile, recent, permap, speedrun] = await Promise.all([
    get(`player/${key}/v3`),
    get(`player/${key}/recent?limit=5000`).catch(() => null),
    get(`player/${key}/permap`).catch(() => null),
    get(`speedruns/players/${key}`).catch(() => null),
  ]);
  const { player: p, ratings: r, hampalyzer: h, classes = [] } = profile.data;
  const all = Array.isArray(recent?.data) ? recent.data : [];
  const matches = all.filter(completed);
  const maps = Array.isArray(permap?.data) ? permap.data : [];
  const movement = r.hidden ? "PRIVATE" : signed(r.elo_window?.delta);
  const form = matches.slice(0, 10).map((m) => resultOf(m, id));
  const avatar = validUrl(p.avatarfull || p.avatarmedium || p.avatar);
  const identity = playerIdentity(p, { href: "" });
  const formHtml = `<div class="dossier-form"><span>RECENT FORM</span><div>${Array.from({ length: 10 }, (_, i) => `<i class="result-${form[i] || "?"}" title="${{ W: "Win", L: "Loss", T: "Tie" }[form[i]] || "Unavailable"}"></i>`).join("")}</div><span>${form.filter((x) => x === "W").length} W / ${form.filter((x) => x === "L").length} L / ${form.filter((x) => x === "T").length} T</span></div>`;
  const [careerWins = 0, careerLosses = 0, careerTies = 0] = String(r.record || "").split(/[-–]/).map(num);
  const careerGames = careerWins + careerLosses + careerTies;
  const winRate = r.win_pct == null ? null : num(r.win_pct);
  const careerSnapshot = `<div class="dossier-career-snapshot"><div class="dossier-career-record"><div class="dossier-career-record-head"><small>CAREER RECORD / W · L · T</small><strong>${esc(r.record || "—")}</strong></div><div class="dossier-record-bar" role="img" aria-label="${careerWins} wins, ${careerLosses} losses, ${careerTies} ties"><i class="win" style="width:${careerGames ? careerWins / careerGames * 100 : 0}%"></i><i class="loss" style="width:${careerGames ? careerLosses / careerGames * 100 : 0}%"></i><i class="tie" style="width:${careerGames ? careerTies / careerGames * 100 : 0}%"></i></div><div class="dossier-record-key"><span>${fmt(careerWins)} W</span><span>${fmt(careerLosses)} L</span><span>${fmt(careerTies)} T</span></div></div><div class="dossier-career-secondary"><div><small>PEAK ELO</small><strong>${r.hidden ? "—" : elo(r.peak_elo)}</strong></div><div><small>WIN RATE</small><strong>${winRate == null ? "—" : `${fmt(winRate)}%`}</strong><i><i style="width:${Math.max(0, Math.min(100, winRate || 0))}%"></i></i></div></div><div class="dossier-career-cadence"><div><strong>${fmt(r.best_streak)}</strong><small>BEST STREAK</small></div><div><strong>${fmt(h.mvp_games)}</strong><small>GAME MVPS</small></div><div><strong>${fmt(r.pugs_per_week)}</strong><small>PUGS / WEEK</small></div></div></div>`;
  const classMax = Math.max(1, ...classes.map((c) => num(c.seconds)));
  const killMax = Math.max(1, num(h.kills), num(h.deaths));
  const perf = `<div class="dossier-performance"><div class="dossier-performance-lead"><div class="dossier-kdr"><small>KILLS / DEATHS</small><strong>${fmt(h.kdr)}</strong><span>K / D</span></div><div class="dossier-kill-comparison"><div><span>KILLS</span><strong>${fmt(h.kills)}</strong><i><i style="width:${num(h.kills) / killMax * 100}%"></i></i></div><div><span>DEATHS</span><strong>${fmt(h.deaths)}</strong><i><i style="width:${num(h.deaths) / killMax * 100}%"></i></i></div></div></div><div class="dossier-performance-support"><div class="dossier-damage-total"><small>DAMAGE DEALT</small><strong>${fmt(h.damage)}</strong></div><div><small>CAPTURES</small><strong>${fmt(h.caps)}</strong></div><div><small>CONC JUMPS</small><strong>${fmt(h.conc_jumps)}</strong></div></div></div>`;
  const classDistribution = `<div class="dossier-class-distribution"><h3>Class time</h3>${classes.length ? classes.slice().sort((a, b) => num(b.seconds) - num(a.seconds)).map((c) => `<div class="${roleOf(c.class)}"><span>${esc(label(c.class))}</span><i><i style="width:${Math.max(2, num(c.seconds) / classMax * 100)}%"></i></i><strong>${num(c.pct).toFixed(1)}%</strong></div>`).join("") : message("No class-time data available.")}</div>`;
  const mapOptions = [...new Set(matches.map((m) => m.map_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const query = new URLSearchParams(location.search);
  let combatMap = mapOptions.includes(query.get("combatMap")) ? query.get("combatMap") : "";
  let combatMatch = matches.some((m) => String(m.id) === query.get("combatMatch")) ? query.get("combatMatch") : "";
  let page = Math.max(0, Number(query.get("matchPage")) || 0);
  const mapSets = [
    ["Most played", maps.slice().sort((a, b) => num(b.gp) - num(a.gp)).slice(0, 3)],
    ["Best record", maps.filter((m) => num(m.gp) >= 5).sort((a, b) => num(b.win_pct) - num(a.win_pct) || num(b.gp) - num(a.gp)).slice(0, 3)],
    ["Toughest maps", maps.filter((m) => num(m.gp) >= 5).sort((a, b) => num(a.win_pct) - num(b.win_pct) || num(b.gp) - num(a.gp)).slice(0, 3)],
  ];
  const relations = relationships(matches, id);
  const relationList = (rows) => rows.length ? rows.map((x) => {
    const rate = Math.round(100 * x.wins / Math.max(1, x.wins + x.losses));
    const photo = validUrl(x.avatar);
    return `<div class="dossier-person"><a class="dossier-person-link" href="${link("player", "id", x.id)}"><span class="dossier-person-avatar">${photo ? `<img src="${esc(photo)}" alt="" loading="lazy">` : esc(String(x.name || "?").slice(0, 1).toUpperCase())}</span><span>${playerIdentity({ id: x.id, name: x.name }, { href: link("player", "id", x.id) })}<small>${fmt(x.games)} SHARED MATCHES</small></span></a><div class="dossier-person-result"><strong>${rate}%</strong><small>${x.wins} W / ${x.losses} L</small><i><i style="width:${rate}%"></i></i></div></div>`;
  }).join("") : '<p class="dossier-empty">No repeated pairing recorded.</p>';
  const mapTile = (m, rank) => `<a href="${link("map", "id", m.map)}" class="dossier-map-tile" style="--map-color:${num(m.win_pct) >= 50 ? "var(--blue)" : "var(--red)"}"><span class="dossier-map-image"><img data-player-map="${esc(m.map)}" src="${imagePath(m.map)}" alt="" loading="lazy"><b><i>${String(rank + 1).padStart(2, "0")}</i>${esc(m.map)}</b></span><span class="dossier-map-stats"><strong>${fmt(m.win_pct)}%</strong><span>WIN RATE</span><small>${fmt(m.gp)} G / ${fmt(m.w)}-${fmt(m.l)}-${fmt(m.t)}</small></span><i class="dossier-map-meter"><i style="width:${Math.max(0, Math.min(100, num(m.win_pct)))}%"></i></i></a>`;
  const renderMapSet = ([title, rows]) => {
    const kind = title === "Most played" ? "played" : title === "Best record" ? "best" : "toughest";
    return `<div class="dossier-map-set dossier-map-set-${kind}"><h3>${title}</h3>${rows.length ? rows.map(mapTile).join("") : '<p class="dossier-empty">Five games required.</p>'}</div>`;
  };
  const identityChapter = `<div class="profile-ribbon"><span>PLAYER FILE / ${esc(p.id)}</span><span>${r.hidden ? "RATING PRIVATE" : `${fmt(r.games)} RATED MATCHES`}</span></div><header class="dossier-header"><div class="dossier-avatar">${avatar ? `<img src="${esc(avatar)}" alt="${esc(p.name || "Player")} player portrait" referrerpolicy="no-referrer">` : ""}<span>${esc(String(p.name || "?").slice(0, 1).toUpperCase())}</span></div><div class="dossier-identity"><div><h1>${identity}</h1><div class="dossier-identity-links">${p.personaname && p.personaname !== p.name ? `<span>STEAM / ${esc(p.personaname)}</span>` : ""}${p.steam_id ? `<span>${esc(p.steam_id)}</span>` : ""}${validUrl(p.profileurl) ? `<a href="${esc(validUrl(p.profileurl))}" target="_blank" rel="noopener noreferrer">STEAM PROFILE ↗</a>` : ""}</div></div>${formHtml}</div><div class="dossier-standing"><div class="dossier-standing-elo"><b>${r.hidden ? "PRIVATE" : elo(r.elo)}</b><small>CURRENT ELO</small></div><div><b>${r.hidden ? "—" : r.rank ? `#${fmt(r.rank)}` : "NR"}</b><small>OVERALL RANK</small></div><div><b>${r.hidden ? "—" : tier(r.elo)}</b><small>ELO TIER</small></div><div><b class="${num(r.elo_window?.delta) >= 0 ? "positive" : "negative"}">${movement}</b><small>LAST ${fmt(r.elo_window?.games || 0)} GAMES</small></div></div></header>${careerSnapshot}`;
  const classScene = `<div class="dossier-style-content">${classDistribution}<div class="dossier-style-events"><div class="dossier-filter"><label>MAP <select id="dossier-combat-map"><option value="">ALL MAPS</option>${mapOptions.map((name) => `<option value="${esc(name)}" ${name === combatMap ? "selected" : ""}>${esc(name)}</option>`).join("")}</select></label><label>RECENT MATCH <select id="dossier-combat-match"></select></label><label>MATCH ID <input id="dossier-combat-match-id" type="search" placeholder="Any recorded match" value="${esc(combatMatch)}"></label><span id="dossier-combat-scope"></span></div><div id="dossier-granular" aria-live="polite">${message("Reading kill-event record…")}</div></div></div>`;
  const mapChapter = maps.length ? `<div class="dossier-map-sets">${mapSets.map(renderMapSet).join("")}</div><details class="dossier-all-maps"><summary>Complete map record <span>${maps.length} MAPS</span></summary>${maps.slice().sort((a, b) => num(b.gp) - num(a.gp)).map((m) => `<a href="${link("map", "id", m.map)}"><strong>${esc(m.map)}</strong><span>${fmt(m.gp)} G</span><span>${fmt(m.w)} W · ${fmt(m.l)} L · ${fmt(m.t)} T</span><span>${fmt(m.win_pct)}% W</span></a>`).join("")}</details>` : message(permap ? "No per-map history recorded." : "Per-map history is unavailable.");
  const connected = `<div class="dossier-connected">${speedrun ? `<a href="${link("speedrun-player", "id", id)}"><strong>Speedrun runner file ↗</strong><span>${fmt(speedrun.summary?.totalRuns)} RUNS / ${fmt(speedrun.summary?.worldRecords)} WORLD RECORDS</span></a>` : ""}<a href="${link("player-events", "id", id)}"><strong>Combat event history ↗</strong><span>CHRONOLOGICAL KILL / OBJECTIVE RECORD</span></a><a href="${link("tracker")}&q=${encodeURIComponent(p.name || id)}"><strong>Identity history ↗</strong><span>ALIAS & CONNECTION RECORD</span></a><a href="${link("compare")}&p1=${encodeURIComponent(id)}"><strong>Compare player ↗</strong><span>SHARED MATCHES & HEAD-TO-HEAD</span></a></div>`;
  set(`<article class="player-dossier">${identityChapter}<section class="dossier-chapter dossier-chapter-career">${section("02", "Career trajectory", `<span class="section-index">${r.hidden ? "RATING PRIVATE" : `${fmt(r.games)} RATED MATCHES`}</span>`)}${r.hidden ? '<p class="dossier-empty">ELO history is private.</p>' : chart(matches, esc, date)}</section><section class="dossier-chapter dossier-chapter-matches">${section("03", "Recent matches", `<span class="section-index">${fmt(matches.length)} MATCHES IN RECORD</span>`)}<div id="dossier-matches"></div><div class="dossier-pager"><button id="dossier-prev" type="button">← Newer</button><span id="dossier-page-count"></span><button id="dossier-next" type="button">Older →</button></div></section><section class="dossier-chapter dossier-chapter-performance">${section("04", "Performance")}${perf}</section><section class="dossier-chapter dossier-chapter-style">${section("05", "Play style / combat", '<span class="section-index">HAMPALYZER EVENT RECORD</span>')}${classScene}</section><section class="dossier-chapter dossier-chapter-activity">${section("06", "Activity")}<div class="dossier-activity"><div><h3>When this player queues</h3><p>Local time / two-hour intervals / completed matches</p></div>${heatmap(matches, esc)}</div></section><section class="dossier-chapter dossier-chapter-relationships">${section("07", "Relationships")}<div class="dossier-relationships"><div><h3>With you <span>BEST TEAMMATES</span></h3>${relationList(relations.mates)}</div><div><h3>Against you <span>NEMESES</span></h3>${relationList(relations.rivals)}</div></div></section><section class="dossier-chapter dossier-chapter-maps">${section("08", "Map tendencies")}${mapChapter}</section><section class="dossier-chapter dossier-chapter-connected">${section("09", "Connected records")}${connected}</section></article>`);

  const matchSelect = document.querySelector("#dossier-combat-match");
  const matchIdInput = document.querySelector("#dossier-combat-match-id");
  const updateMatchOptions = () => {
    const choices = combatMap ? matches.filter((m) => m.map_name === combatMap) : matches;
    matchSelect.innerHTML = `<option value="">ALL MATCHES</option>${choices.slice(0, 300).map((m) => `<option value="${esc(m.id)}" ${String(m.id) === combatMatch ? "selected" : ""}>${esc(m.id)} / ${esc(m.map_name || "Unknown")} / ${date(m.created_at)}</option>`).join("")}`;
    if (combatMatch && !choices.some((m) => String(m.id) === combatMatch)) combatMatch = "";
    matchSelect.value = combatMatch;
  };
  const loadGranular = async () => {
    const body = document.querySelector("#dossier-granular");
    body.innerHTML = message("Reading kill-event record…");
    const scope = `${combatMap}|${combatMatch}`;
    const path = `player/${key}/granular?limit=50&includeSample=1${combatMap ? `&map=${encodeURIComponent(combatMap)}` : ""}${combatMatch ? `&matchId=${encodeURIComponent(combatMatch)}` : ""}`;
    try {
      const response = await get(path);
      if (!document.contains(body) || scope !== `${combatMap}|${combatMatch}`) return;
      body.innerHTML = granularMarkup(response.data, helpers);
      document.querySelector("#dossier-combat-scope").textContent = `${fmt(response.data?.sample?.matches)} MATCHES / ${fmt(response.data?.sample?.enemyKills)} ENEMY KILLS`;
    } catch {
      if (scope !== `${combatMap}|${combatMatch}`) return;
      body.innerHTML = message("Kill-event details are unavailable. Try another map or match.", "error");
    }
  };
  updateMatchOptions();
  document.querySelector("#dossier-combat-map").onchange = (e) => {
    combatMap = e.target.value;
    combatMatch = "";
    matchIdInput.value = "";
    updateMatchOptions();
    persistViewState({ combatMap, combatMatch });
    loadGranular();
  };
  matchSelect.onchange = (e) => {
    combatMatch = e.target.value;
    matchIdInput.value = combatMatch;
    persistViewState({ combatMatch });
    loadGranular();
  };
  matchIdInput.onchange = (e) => {
    combatMatch = e.target.value.trim().slice(0, 100);
    matchSelect.value = combatMatch;
    persistViewState({ combatMatch });
    loadGranular();
  };
  loadGranular();

  const pageSize = 5;
  const totalPages = Math.max(1, Math.ceil(matches.length / pageSize));
  page = Math.min(page, totalPages - 1);
  const renderMatches = () => {
    const rows = matches.slice(page * pageSize, (page + 1) * pageSize);
    document.querySelector("#dossier-matches").innerHTML = rows.length ? rows.map((m, index) => {
      const team = teamOf(m, id);
      const mine = team === "BLUE" ? m.blueTeam : m.redTeam;
      const theirs = team === "BLUE" ? m.redTeam : m.blueTeam;
      const score = `<span class="blue">${esc(m.score_blue ?? "—")}</span> : <span class="red">${esc(m.score_red ?? "—")}</span>`;
      const teamLine = (people, title) => {
        const roster = (people || []).filter((x) => String(x.id) !== String(id));
        const faces = roster.map((x) => {
          const src = validUrl(x.avatarfull || x.avatarmedium || x.avatar);
          return `<i title="${esc(x.name || x.id)}">${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : esc(String(x.name || "?").slice(0, 1).toUpperCase())}</i>`;
        }).join("");
        const names = roster.map((x) => esc(x.name || x.id)).join(" · ") || "—";
        return `<div class="dossier-team-line"><b>${title}</b><div class="dossier-team-detail"><span class="dossier-team-faces">${faces}</span><span>${names}</span></div></div>`;
      };
      const outcome = resultOf(m, id);
      return `<article class="dossier-match dossier-match-${index === 0 ? "feature" : "strip"} result-${outcome}"><a href="${link("match", "id", m.id)}" class="dossier-match-image"><img data-player-map="${esc(m.map_name)}" src="${imagePath(m.map_name)}" alt="" loading="lazy"><span>${esc(m.map_name || "Unknown map")}</span></a><div class="dossier-match-main"><div class="dossier-match-scoreline"><span class="dossier-outcome result-${outcome}">${{ W: "WIN", L: "LOSS", T: "TIE" }[outcome] || "RESULT"}</span><strong>${score}</strong><span class="dossier-delta ${num(m.delta) >= 0 ? "positive" : "negative"}">${r.hidden ? "PRIVATE ELO" : `${signed(m.delta)} ELO`}</span></div><p>${date(m.created_at)} / ${esc(m.id)}</p><div class="dossier-teams">${teamLine(mine, "WITH")}${teamLine(theirs, "AGAINST")}</div><nav aria-label="Reports for ${esc(m.id)}"><a href="${link("match", "id", m.id)}">2080 MATCH ↗</a>${validUrl(m.hampalyzer_url) ? `<a href="${esc(validUrl(m.hampalyzer_url))}" target="_blank" rel="noopener noreferrer">HAMPALYZER ↗</a>` : ""}${validUrl(m.tfcstats_url) ? `<a href="${esc(validUrl(m.tfcstats_url))}" target="_blank" rel="noopener noreferrer">TFCSTATS ↗</a>` : ""}</nav></div></article>`;
    }).join("") : message(recent ? "No completed matches recorded." : "Recent match service unavailable.");
    document.querySelector("#dossier-page-count").textContent = `${page + 1} / ${totalPages}`;
    document.querySelector("#dossier-prev").disabled = page === 0;
    document.querySelector("#dossier-next").disabled = page >= totalPages - 1;
    bindMapImages();
  };
  document.querySelector("#dossier-prev").onclick = () => { page--; persistViewState({ matchPage: page || null }); renderMatches(); };
  document.querySelector("#dossier-next").onclick = () => { page++; persistViewState({ matchPage: page }); renderMatches(); };
  const bindMapImages = () => {
    document.querySelectorAll("img[data-player-map]").forEach((img) => {
      if (img.dataset.bound) return;
      img.dataset.bound = "1";
      const map = img.dataset.playerMap;
      const sources = [`../assets/images/maps/${encodeURIComponent(map)}.jpg`, `https://tfcmaps.net/images/maps/source/${encodeURIComponent(map)}.jpg`];
      img.onerror = () => { if (sources.length) img.src = sources.shift(); else img.remove(); };
    });
  };
  renderMatches();
}
