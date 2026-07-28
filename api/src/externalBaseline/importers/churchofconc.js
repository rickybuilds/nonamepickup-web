"use strict";

const cheerio = require("cheerio");
const { fetchHtml } = require("../http");
const { normalizeRecord } = require("../normalizer");
const { tableRows, valueByHeader } = require("../table");

const SOURCE = "churchofconc";
const SOURCE_URL = "https://churchofconc.servehalflife.com/CofC.php?tab=stats&subtab=speedruns";
const DATA_URL = "https://churchofconc.servehalflife.com/runrecords.php";

function parseChurchOfConcHtml(html, options = {}) {
  const diagnostics = options.diagnostics || {};
  const logger = options.logger || console;
  const $ = cheerio.load(html);
  const records = [];
  let matchingTables = 0;

  $("table").each((_, table) => {
    const rows = tableRows($, table);
    if (!rows.length) return;
    const sample = rows[0];
    const hasRequiredFields =
      valueByHeader(sample, ["map"]) !== "" &&
      valueByHeader(sample, ["class"]) !== "" &&
      valueByHeader(sample, ["runtime", "completion time"]) !== "";
    if (!hasRequiredFields) return;
    matchingTables += 1;

    for (const row of rows) {
      try {
        records.push(normalizeRecord({
          source: SOURCE,
          source_url: SOURCE_URL,
          map_name_raw: valueByHeader(row, ["map"]),
          class_name_raw: valueByHeader(row, ["class"]),
          player_name: valueByHeader(row, ["nickname", "player", "common name"]),
          time_raw: valueByHeader(row, ["runtime", "completion time"])
        }));
      } catch (error) {
        diagnostics.failed = (diagnostics.failed || 0) + 1;
        logger.warn?.(`[${SOURCE}] skipped row: ${error.message}`);
      }
    }
  });

  if (!matchingTables) {
    throw new Error("unexpected HTML: no record table with Map, Class, and Runtime headers");
  }
  return records;
}

async function scrapeChurchOfConc(options = {}) {
  const html = await (options.fetchHtml || fetchHtml)(DATA_URL);
  return parseChurchOfConcHtml(html, options);
}

module.exports = {
  SOURCE,
  SOURCE_URL,
  DATA_URL,
  parseChurchOfConcHtml,
  scrape: scrapeChurchOfConc
};
