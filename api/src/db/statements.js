"use strict";

function createStatements(db, matchColumns) {
  const analyticsInsertStmt = db.prepare(`
  INSERT INTO web_analytics
  (ts, ip, method, path, user_agent)
  VALUES (?, ?, ?, ?, ?)
`);

  const statsSummaryStmt = db.prepare(`
  SELECT
    COUNT(*) AS totalMatches,
    SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches1d,
    SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches7d,
    SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS matches30d
  FROM matches
  WHERE status='completed'
`);

  const compareProfileStmt = db.prepare(`
  SELECT r.player_id, r.display_name, r.rating, COALESCE(u.hide_elo,0) AS hide_elo
  FROM ratings r
  LEFT JOIN user_prefs u ON u.player_id = r.player_id
  WHERE r.player_id = ?
`);

  const compareMatchesStmt = db.prepare(`
  SELECT ${matchColumns("m")}
  FROM matches m
  JOIN rating_changes rc1 ON rc1.match_id = m.match_id AND rc1.player_id = ?
  JOIN rating_changes rc2 ON rc2.match_id = m.match_id AND rc2.player_id = ?
  WHERE m.status = 'completed'
  ORDER BY m.created_at DESC
`);

  return {
    analyticsInsertStmt,
    statsSummaryStmt,
    compareProfileStmt,
    compareMatchesStmt
  };
}

module.exports = { createStatements };
