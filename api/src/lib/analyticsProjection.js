"use strict";

// Only limit-dependent lists are sliced. Archive, fixed top-5 map lists,
// weapon totals, and the fixed top-50 hall of shame retain their contracts.
function projectAnalytics(payload, limit) {
  const data = { ...payload.data, limit };
  for (const key of ["mvps", "mvp_rate"]) data[key] = data[key].slice(0, limit);
  for (const section of ["mvp_results", "streaks", "per_game", "combat", "flags", "roles", "rounds", "matches", "chaos"]) {
    data[section] = Object.fromEntries(Object.entries(data[section]).map(([key, rows]) =>
      [key, section === "chaos" && key === "least_flag_touches" ? rows : rows.slice(0, limit)]));
  }
  const counts = new Map();
  data.weapons = { ...data.weapons, leaders: data.weapons.leaders.filter(row => {
    const count = (counts.get(row.weapon) || 0) + 1;
    counts.set(row.weapon, count);
    return count <= limit;
  }) };
  data.maps = { ...data.maps };
  for (const key of ["most_played", "total_kills", "average_team_score"]) data.maps[key] = data.maps[key].slice(0, limit);
  return { ...payload, data };
}

module.exports = { projectAnalytics };
