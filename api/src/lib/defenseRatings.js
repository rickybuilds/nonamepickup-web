"use strict";

const CLASSES = [
  { id: "soldier", label: "Soldier" }, { id: "demoman", label: "Demoman" },
  { id: "hwguy", label: "HWGuy" }, { id: "engineer", label: "Engineer" }
];
const SOURCES = [
  ["match_player_classes", "Class seconds are aggregates, not verified class/role participation intervals."],
  ["match_player_round_stats", "Round role and team do not establish continuous class participation."],
  ["match_rounds", "Round scores and offense/defense teams do not identify player class windows."],
  ["match_role_events", "Isolated role/class events have no verified initial state, transition completeness or coverage contract."],
  ["match_cap_events", "Capture timestamps alone cannot attribute concessions to verified defensive-class windows."],
  ["match_capture_events", "Capture timestamps alone cannot attribute concessions to verified defensive-class windows."],
  ["match_tfcstats_events", "Event class snapshots do not prove uninterrupted defensive participation."],
  ["match_kill_events", "Classes at combat events cannot identify class/role participation between events."]
];

function loadDefenseRatings(db) {
  const maps = db.prepare(`SELECT map_name AS map, COUNT(*) AS completedMatches
    FROM matches WHERE status='completed' AND map_name IS NOT NULL
      AND TRIM(map_name) != '' AND map_name != '(unknown)'
    GROUP BY map_name ORDER BY completedMatches DESC, map_name COLLATE NOCASE`).all()
    .map(row => ({ map: row.map, completedMatches: Number(row.completedMatches),
      games: null, baseline: null, players: [], observations: [], status: "unavailable" }));
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  const sources = SOURCES.map(([id, limitation]) => {
    const available = tables.has(id);
    const columns = available ? new Set(db.prepare(`PRAGMA table_info(${id})`).all().map(row => row.name)) : new Set();
    return { id, available, limitation,
      rows: available ? Number(db.prepare(`SELECT COUNT(*) AS count FROM ${id}`).get().count) : null,
      completedMatchCount: columns.has("match_id") ? Number(db.prepare(`SELECT COUNT(DISTINCT s.match_id) AS count
        FROM ${id} s JOIN matches m ON m.match_id=s.match_id WHERE m.status='completed'`).get().count) : null
    };
  });
  // Presence of events is evidence of records, never evidence of complete participation coverage.
  return {
    status: "unavailable",
    reason: "Verified defensive role and class participation intervals are not available.",
    classes: CLASSES.map(item => ({ ...item })), maps,
    eligibleAppearances: null, qualifyingPlayers: null,
    coverage: { completedMatches: Number(db.prepare("SELECT COUNT(*) AS count FROM matches WHERE status='completed'").get().count), sources },
    methodology: {
      unit: "verified defensive-class participation", baseline: "unavailable",
      formula: "Defense rating = eligible map baseline conceded/game - player team conceded/game",
      missing: [
        "Verified initial class, team and defensive role for each player session.",
        "Complete timestamped class, team, role and substitution transitions with explicit coverage validation.",
        "Capture events aligned to the same verified round clock and participation intervals.",
        "An audited observation unit and denominator before publishing class-conditioned baselines or game thresholds."
      ]
    }
  };
}
module.exports = { loadDefenseRatings };
