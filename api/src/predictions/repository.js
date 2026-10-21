"use strict";

const { summarize } = require("./metrics");

// Do not import the bot's PredictionStore: its constructor performs schema writes.
function createPredictionRepository(db) {
  const required = ["prediction_accounts", "prediction_markets", "prediction_bets", "prediction_transactions", "prediction_meta"];
  for (const name of required) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) {
      throw new Error("Prediction schema unavailable");
    }
  }
  if (db.prepare("SELECT value FROM prediction_meta WHERE key='schema_version'").get()?.value !== "2") {
    throw new Error("Prediction schema version 2 required");
  }
  const hasDiscordNames = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='discord_names'").get());
  const accounts = db.prepare(hasDiscordNames ? `
    SELECT a.discord_id, COALESCE(NULLIF(TRIM(r.display_name),''), NULLIF(TRIM(d.display_name),''),
      NULLIF(TRIM(d.global_name),''), NULLIF(TRIM(d.username),''), 'Unknown player') AS display_name
    FROM prediction_accounts a LEFT JOIN ratings r ON r.player_id=a.discord_id
    LEFT JOIN discord_names d ON d.discord_id=a.discord_id ORDER BY a.discord_id` : `
    SELECT a.discord_id, COALESCE(NULLIF(TRIM(r.display_name),''),'Unknown player') AS display_name
    FROM prediction_accounts a LEFT JOIN ratings r ON r.player_id=a.discord_id ORDER BY a.discord_id`);
  const bets = db.prepare("SELECT * FROM prediction_bets WHERE discord_id=?");
  const markets = db.prepare(`SELECT m.* FROM prediction_markets m
    WHERE EXISTS (SELECT 1 FROM prediction_bets b WHERE b.market_id=m.id AND b.discord_id=?)`);
  const credits = db.prepare(`SELECT t.market_id,t.amount FROM prediction_transactions t
    WHERE t.account_id=? AND t.kind IN ('settlement','correction')`);
  return {
    publicRows() {
      return db.transaction(() => accounts.all().map(account => {
        const id = account.discord_id;
        const metrics = summarize(bets.all(id), markets.all(id), credits.all(id));
        return { displayName: account.display_name, netProfit: metrics.netProfit,
          settledGames: metrics.settledGames, winRate: metrics.winRate };
      }).filter(row => row.settledGames > 0))();
    }
  };
}

module.exports = { createPredictionRepository };
