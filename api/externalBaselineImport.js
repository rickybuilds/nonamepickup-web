"use strict";

require("dotenv").config();

const { getSpeedrunPool, closeSpeedrunPool } = require("./src/db/mariadb");
const squishy = require("./src/externalBaseline/importers/squishy");
const churchofconc = require("./src/externalBaseline/importers/churchofconc");
const { deduplicateRecords } = require("./src/externalBaseline/normalizer");
const { ExternalRecordRepository } = require("./src/externalBaseline/repository");

const SOURCES = [squishy, churchofconc];

function blankSummary() {
  return { processed: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0 };
}

function addSummary(target, value) {
  for (const field of Object.keys(target)) target[field] += Number(value[field] || 0);
  return target;
}

function printSummary(sourceSummaries, logger = console) {
  const total = blankSummary();
  for (const [source, summary] of Object.entries(sourceSummaries)) {
    addSummary(total, summary);
    logger.log(`\n${source}:`);
    logger.log(`  ${summary.processed} records processed`);
    logger.log(`  ${summary.inserted} inserted`);
    logger.log(`  ${summary.updated} updated`);
    logger.log(`  ${summary.unchanged} unchanged`);
    logger.log(`  ${summary.failed} failed`);
  }
  logger.log("\nTotal:");
  logger.log(`  ${total.processed} processed`);
  logger.log(`  ${total.inserted} inserted`);
  logger.log(`  ${total.updated} updated`);
  logger.log(`  ${total.unchanged} unchanged`);
  logger.log(`  ${total.failed} failed`);
  return total;
}

async function runImport(options = {}) {
  const logger = options.logger || console;
  const pool = options.pool || getSpeedrunPool();
  const repository = options.repository || new ExternalRecordRepository(pool, { logger });

  // Database unavailability is the only condition that aborts the whole run.
  await repository.initialize();
  const mapLookup = await repository.loadMapLookup();
  const existing = await repository.loadExisting();
  const sourceSummaries = {};

  const scrapeResults = await Promise.allSettled(
    SOURCES.map(async source => {
      const diagnostics = { failed: 0 };
      const rawRecords = await source.scrape({ logger, diagnostics });
      return {
        source: source.SOURCE,
        records: deduplicateRecords(rawRecords),
        diagnostics
      };
    })
  );

  for (let index = 0; index < scrapeResults.length; index += 1) {
    const result = scrapeResults[index];
    const source = SOURCES[index].SOURCE;
    if (result.status === "rejected") {
      logger.error(`[${source}] scrape failed: ${result.reason?.message || result.reason}`);
      sourceSummaries[source] = { ...blankSummary(), failed: 1 };
      continue;
    }

    const summary = await repository.upsert(result.value.records, { mapLookup, existing });
    summary.failed += result.value.diagnostics.failed || 0;
    sourceSummaries[source] = summary;
  }

  const total = printSummary(sourceSummaries, logger);
  return { sources: sourceSummaries, total };
}

if (require.main === module) {
  runImport()
    .then(result => {
      process.exitCode = result.total.failed > 0 ? 2 : 0;
    })
    .catch(error => {
      console.error(`[external-baseline] fatal database error: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => closeSpeedrunPool().catch(error => {
      console.error(`[external-baseline] failed to close database pool: ${error.message}`);
    }));
}

module.exports = { runImport, printSummary };
