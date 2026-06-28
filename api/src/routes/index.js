"use strict";

const { createSystemRouter } = require("./system");
const { createVegasOddsRouter } = require("./vegasOdds");
const { createStatsRouter } = require("./stats");
const { createMapsRouter } = require("./maps");
const { createCompareRouter } = require("./compare");
const { createMatchesRouter } = require("./matches");
const { createPlayersRouter } = require("./players");
const { createQueueRouter } = require("./queue");
const { createAnalyticsRouter } = require("./analytics");
const { createHomeRouter } = require("./home");
const { createSpeedrunsRouter } = require("./speedruns");
const { createStatusRouter } = require("./status");

function registerRoutes(app, {
  leaderboardHandler,
  db,
  fs,
  SUPPORTERS_FILE,
  sendError,
  logRouteError,
  positiveInt,
  nonNegativeInt,
  cachedFor,
  MAX_MATCH_LIMIT,
  cleanString,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  MAX_PLAYER_MATCH_LIMIT,
  parseIdList,
  cached,
  statsSummaryStmt,
  QUEUE_FILE,
  DATA_DIR,
  compareProfileStmt,
  compareMatchesStmt,
  safePublicUrl,
  checkSpeedrunDatabase   // ← ADD THIS
}) {
app.use("/api", createSystemRouter({
  db,
  fs,
  supportersFile: SUPPORTERS_FILE,
  sendError,
  logRouteError
}));

// Leaderboard
app.get("/api/leaderboard", leaderboardHandler);

// Matches
app.use("/api", createMatchesRouter({
  db,
  cachedFor,
  positiveInt,
  nonNegativeInt,
  maxMatchLimit: MAX_MATCH_LIMIT,
  cleanString,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  sendError,
  logRouteError
}));
app.use("/api", createPlayersRouter({
  db,
  cleanString,
  positiveInt,
  sendError,
  logRouteError,
  MAX_PLAYER_MATCH_LIMIT,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  parseIdList,
  cached
}));
// Map player breakdown
// Map matches
// Map stats
// ✅ CACHED: simple aggregation but called on every hub load
// Map averages
// ✅ CACHED
app.use("/api", createMapsRouter({
  db,
  cached,
  maxMatchLimit: MAX_MATCH_LIMIT,
  positiveInt,
  cleanString,
  matchColumns,
  loadMatchPlayers,
  serializeMatch,
  sendError,
  logRouteError
}));

// Most games in 24h + total ties
// ✅ CACHED: the correlated subquery (SELECT MAX(cnt) FROM ...) is expensive
app.use("/api", createStatsRouter({
  db,
  cached,
  statsSummaryStmt,
  sendError,
  logRouteError
}));
app.use("/api", createAnalyticsRouter({
  db,
  cachedFor,
  positiveInt,
  sendError,
  logRouteError
}));
app.use("/api", createHomeRouter({
  db,
  cached,
  logRouteError,
  sendError
}));

app.use("/api/speedruns", createSpeedrunsRouter({
  logRouteError
}));

app.use("/api", createQueueRouter({
  queueFile: QUEUE_FILE,
  dataDir: DATA_DIR,
  cleanString,
  logRouteError
}));
// Player vs Player compare
app.use("/api", createCompareRouter({
  compareProfileStmt,
  compareMatchesStmt,
  cleanString,
  parseIdList,
  loadMatchPlayers,
  safePublicUrl,
  sendError,
  logRouteError
}));
app.use("/api", createVegasOddsRouter({
  db,
  cleanString,
  sendError,
  logRouteError
}));

app.use("/api", createStatusRouter({
  db,
  checkSpeedrunDatabase
}));
}

module.exports = { registerRoutes };
