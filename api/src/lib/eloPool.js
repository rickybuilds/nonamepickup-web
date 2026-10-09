"use strict";

const TIME_ZONE = "America/New_York";
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
});

function dayKey(timestamp) {
  const parts = Object.fromEntries(dayFormatter.formatToParts(timestamp).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function buildEloPool(db, now = Date.now()) {
  const today = dayKey(now);
  const calendar = new Date(`${today}T12:00:00Z`);
  const days = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date(calendar);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push({ date: date.toISOString().slice(0, 10), gained: 0, lost: 0, net: 0,
      matches: 0, players_up: 0, players_down: 0, players_even: 0, partial: offset === 0 });
  }
  const buckets = new Map(days.map(day => [day.date, { day, matches: new Set(), players: new Map() }]));
  // Include all recorded history for daily records, using DST-aware Eastern dates.
  const rows = db.prepare(`
    SELECT rc.match_id, rc.player_id, rc.before, rc.after, rc.delta,
      COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at) AS timestamp
    FROM rating_changes rc
    JOIN matches m ON m.match_id = rc.match_id
    WHERE m.status = 'completed'
      AND COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at) <= ?
  `).all(Math.floor(now / 1000));
  const historicalDays = new Map();
  let fallbackRows = 0;
  let inconsistentRows = 0;
  let unmeasuredRows = 0;
  for (const row of rows) {
    const date = dayKey(Number(row.timestamp) * 1000);
    const bucket = buckets.get(date);
    if (bucket) bucket.matches.add(String(row.match_id));
    if (!historicalDays.has(date)) historicalDays.set(date, {
      date, gained: 0, lost: 0, net: 0, matches: new Set(), partial: date === today,
      players: new Map(), quality: { fallback_rows: 0, inconsistent_rows: 0, unmeasured_rows: 0 }
    });
    const historicalDay = historicalDays.get(date);
    historicalDay.matches.add(String(row.match_id));
    const hasBalances = row.before != null && row.after != null;
    if (!hasBalances && row.delta == null) {
      historicalDay.quality.unmeasured_rows++;
      if (bucket) unmeasuredRows++;
      continue;
    }
    // Balance movement is authoritative when historical delta metadata disagrees.
    const delta = hasBalances ? Number(row.after) - Number(row.before) : Number(row.delta);
    historicalDay.gained += Math.max(0, delta);
    historicalDay.lost += Math.max(0, -delta);
    historicalDay.net += delta;
    historicalDay.matches.add(String(row.match_id));
    const playerId = String(row.player_id);
    historicalDay.players.set(playerId, (historicalDay.players.get(playerId) || 0) + delta);
    if (!hasBalances) historicalDay.quality.fallback_rows++;
    if (hasBalances && row.delta != null && delta !== Number(row.delta)) historicalDay.quality.inconsistent_rows++;
    if (!bucket) continue;
    if (!hasBalances) fallbackRows++;
    if (hasBalances && row.delta != null && delta !== Number(row.delta)) inconsistentRows++;
    bucket.day.gained += Math.max(0, delta);
    bucket.day.lost += Math.max(0, -delta);
    const id = String(row.player_id);
    bucket.players.set(id, (bucket.players.get(id) || 0) + delta);
  }
  for (const { day, matches, players } of buckets.values()) {
    day.net = day.gained - day.lost;
    day.matches = matches.size;
    for (const net of players.values()) {
      if (net > 0) day.players_up++;
      else if (net < 0) day.players_down++;
      else day.players_even++;
    }
  }
  const latest = db.prepare(`
    SELECT MAX(COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at)) AS timestamp
    FROM rating_changes rc JOIN matches m ON m.match_id = rc.match_id
    WHERE m.status = 'completed'
  `).get();
  const totals = days.reduce((sum, day) => ({
    gained: sum.gained + day.gained, lost: sum.lost + day.lost,
    net: sum.net + day.net, matches: sum.matches + day.matches
  }), { gained: 0, lost: 0, net: 0, matches: 0 });
  const history = [...historicalDays.values()].sort((a, b) => a.date.localeCompare(b.date));
  const dailyHistory = history.map(day => {
    const playerNets = [...day.players.values()];
    return { date: day.date, gained: day.gained, lost: day.lost, net: day.net,
      matches: day.matches.size, partial: day.partial, quality: day.quality,
      players_up: playerNets.filter(net => net > 0).length,
      players_down: playerNets.filter(net => net < 0).length,
      players_even: playerNets.filter(net => net === 0).length };
  });
  function recordFor(metric, direction) {
    let record = null;
    for (const day of history) {
      if (day[metric] * direction <= 0) continue;
      if (!record || day[metric] * direction > record.value * direction) {
        record = { date: day.date, value: day[metric], matches: day.matches.size,
          partial: day.partial, tied_days: 1 };
      } else if (day[metric] === record.value) record.tied_days++;
    }
    return record;
  }
  return { time_zone: TIME_ZONE, generated_at: Math.floor(now / 1000),
    latest_change_at: latest?.timestamp || null, days, totals,
    history: dailyHistory,
    records: { net_gain: recordFor("net", 1), net_loss: recordFor("net", -1),
      awarded: recordFor("gained", 1), deducted: recordFor("lost", 1) },
    quality: { fallback_rows: fallbackRows, inconsistent_rows: inconsistentRows, unmeasured_rows: unmeasuredRows } };
}

function selectEloPoolWindow(snapshot, requestedPage = 0) {
  const { history, ...data } = snapshot;
  const today = snapshot.days[snapshot.days.length - 1].date;
  const earliest = history[0]?.date || today;
  const maxPage = Math.max(0, Math.floor((Date.parse(today) - Date.parse(earliest)) / 86400000 / 14));
  const page = Math.min(requestedPage, maxPage);
  const byDate = new Map(history.map(day => [day.date, day]));
  const days = [];
  const end = new Date(`${today}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - page * 14);
  const quality = { fallback_rows: 0, inconsistent_rows: 0, unmeasured_rows: 0 };
  for (let offset = 13; offset >= 0; offset--) {
    const calendar = new Date(end);
    calendar.setUTCDate(calendar.getUTCDate() - offset);
    const date = calendar.toISOString().slice(0, 10);
    const source = byDate.get(date);
    const day = source ? { ...source } : { date, gained: 0, lost: 0, net: 0,
      matches: 0, players_up: 0, players_down: 0, players_even: 0, partial: date === today };
    if (source) for (const key of Object.keys(quality)) quality[key] += source.quality[key];
    delete day.quality;
    days.push(day);
  }
  const totals = days.reduce((sum, day) => ({ gained: sum.gained + day.gained,
    lost: sum.lost + day.lost, net: sum.net + day.net, matches: sum.matches + day.matches
  }), { gained: 0, lost: 0, net: 0, matches: 0 });
  return { ...data, days, totals, quality,
    pagination: { page, has_older: page < maxPage, has_newer: page > 0,
      start_date: days[0].date, end_date: days[days.length - 1].date } };
}

module.exports = { buildEloPool, selectEloPoolWindow };
