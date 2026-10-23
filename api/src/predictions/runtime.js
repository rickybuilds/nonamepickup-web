"use strict";

const { createPredictionsRouter } = require("./router");

function predictionRuntime(env = process.env) {
  const mode = env.PREDICTIONS_WEB_MODE || "live";
  let db, repository, retryAt = 0, failureCode = "predictions_database_unavailable";
  const unavailable = () => { const error = new Error(failureCode); error.code = failureCode; throw error; };
  function getRepository() {
    if (repository) return repository;
    if (Date.now() < retryAt) return unavailable();
    let stage = "database";
    try {
      if (mode !== "live") { stage = "configuration"; throw new Error("Invalid prediction mode"); }
      const Database = require("better-sqlite3");
      const { createPredictionRepository } = require("./repository");
      const file = env.ELO_DB || require("../config").ELO_DB;
      db = new Database(file, { readonly: true, fileMustExist: true });
      stage = "schema";
      repository = createPredictionRepository(db);
      return repository;
    } catch {
      db?.close(); db = null;
      failureCode = stage === "schema" ? "predictions_schema_unavailable" :
        stage === "configuration" ? "predictions_configuration_unavailable" : "predictions_database_unavailable";
      retryAt = Date.now() + 30000;
      console.warn("[predictions] " + failureCode + "; retrying after 30 seconds");
      return unavailable();
    }
  }
  return { router: createPredictionsRouter({ mode, getRepository }),
    close() { repository = null; db?.close(); db = null; } };
}

module.exports = { predictionRuntime };
