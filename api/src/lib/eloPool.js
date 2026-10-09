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
  // Read a wider UTC interval, then assign calendar days using DST-aware Eastern time.
  const rows = db.prepare(`
    SELECT rc.match_id, rc.player_id, rc.before, rc.after, rc.delta,
      COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at) AS timestamp
    FROM rating_changes rc
    JOIN matches m ON m.match_id = rc.match_id
    WHERE m.status = 'completed'
      AND COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at) >= ?
      AND COALESCE(rc.ts, rc.created_at, m.processed_at, m.created_at) <= ?
  `).all(Math.floor(now / 1000) - 16 * 86400, Math.floor(now / 1000));
  let fallbackRows = 0;
  let inconsistentRows = 0;
  let unmeasuredRows = 0;
  for (const row of rows) {
    const bucket = buckets.get(dayKey(Number(row.timestamp) * 1000));
    if (!bucket) continue;
    bucket.matches.add(String(row.match_id));
    const hasBalances = row.before != null && row.after != null;
    if (!hasBalances && row.delta == null) { unmeasuredRows++; continue; }
    // Balance movement is authoritative when historical delta metadata disagrees.
    const delta = hasBalances ? Number(row.after) - Number(row.before) : Number(row.delta);
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
  return { time_zone: TIME_ZONE, generated_at: Math.floor(now / 1000),
    latest_change_at: latest?.timestamp || null, days, totals,
    quality: { fallback_rows: fallbackRows, inconsistent_rows: inconsistentRows, unmeasured_rows: unmeasuredRows } };
}

module.exports = { buildEloPool };
