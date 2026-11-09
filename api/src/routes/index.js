"use strict";

const { createSystemRouter } = require("./system");
const { createVegasOddsRouter } = require("./vegasOdds");
const { createStatsRouter } = require("./stats");
const { createMapsRouter } = require("./maps");
const { createCompareRouter } = require("./compare");
const { createMatchesRouter } = require("./matches");
const { createPlayersRouter } = require("./players");
const { createQueueRouter } = require("./queue");
const { createKickedRouter } = require("./kicked");
const { createMutedRouter } = require("./muted");
const { createAnalyticsRouter } = require("./analytics");
const { createHomeRouter } = require("./home");
const { createSpeedrunsRouter } = require("./speedruns");
const { createStatusRouter } = require("./status");
const { createPlayerIdentitiesRouter } = require("./playerIdentities");
const { createSpeedrunComparisonsRouter } = require("./speedrunComparisons");
const { createShadowEloRouter } = require("./shadowElo");
const { createCoolestDudeRouter } = require("./coolestDude");
const { createSpellingRouter } = require("./spelling");
const { createDefenseIqRouter } = require("./defenseIq");

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
  KICKED_FILE,
  MUTED_LOGS_FILE,
  SPELLING_LISTS_FILE,
  SPELLING_SCORES_FILE,
  SPELLING_ADMIN_USER,
  SPELLING_ADMIN_PASSWORD,
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
app.use("/api", createDefenseIqRouter({ db, cleanString, sendError, logRouteError }));

// Matches
app.use("/api", createMatchesRouter({
  db,
  cachedFor,
  positiveInt,
  nonNegativeInt,
  maxMatchLimit: MAX_MATCH_LIMIT,
  cleanString,
  dataDir: DATA_DIR,
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
app.use("/api", createPlayerIdentitiesRouter({
  db,
  cleanString,
  sendError,
  logRouteError
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
app.use("/api/speedruns/comparisons", createSpeedrunComparisonsRouter({
  logRouteError
}));

app.use("/api", createQueueRouter({
  queueFile: QUEUE_FILE,
  dataDir: DATA_DIR,
  cleanString,
  logRouteError
}));
app.use("/api", createKickedRouter({
  db,
  kickedFile: KICKED_FILE,
  fs,
  cleanString,
  logRouteError
}));
app.use("/api", createMutedRouter({
  mutedLogsFile: MUTED_LOGS_FILE,
  fs,
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
app.use("/api", createShadowEloRouter({
  db,
  positiveInt,
  sendError,
  logRouteError
}));

app.use("/api", createStatusRouter({
  db,
  checkSpeedrunDatabase
}));
app.use("/api", createCoolestDudeRouter({
  db,
  cleanString,
  positiveInt,
  sendError,
  logRouteError
}));
app.use("/api", createSpellingRouter({ fs, file: SPELLING_LISTS_FILE, scoresFile: SPELLING_SCORES_FILE, adminUser: SPELLING_ADMIN_USER, adminPassword: SPELLING_ADMIN_PASSWORD }));
}

module.exports = { registerRoutes };
