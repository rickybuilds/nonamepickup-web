"use strict";

const cheerio = require("cheerio");
const { fetchHtml } = require("../http");
const { normalizeRecord, parseTimeMs } = require("../normalizer");
const { normalizeHeader, tableRows, valueByHeader } = require("../table");

const SOURCE = "squishy";
const SOURCE_URL = "http://squishysbatcave.com/";
const DEFAULT_CONCURRENCY = 2;

function stripEmbeddedScripts(html) {
  // Squishy embeds a multi-megabyte Plotly bundle on every page. The record
  // tables are server-rendered HTML, so retaining script bodies only wastes
  // memory when Cheerio constructs the DOM.
  return String(html || "").replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
}

function findMapPages(html) {
  const $ = cheerio.load(stripEmbeddedScripts(html));
  const pages = [];

  $("table").each((_, table) => {
    const rows = $(table).find("tr").toArray();
    if (!rows.length) return;
    const headerCells = $(rows[0]).find("th,td").toArray().map(cell => normalizeHeader($(cell).text()));
    const mapIndex = headerCells.indexOf("map");
    const timeIndex = headerCells.findIndex(header => header.startsWith("fastest"));
    if (mapIndex < 0 || timeIndex < 0) return;

    for (const row of rows.slice(1)) {
      const cells = $(row).find("td").toArray();
      if (!cells[mapIndex] || !cells[timeIndex]) continue;
      const timeRaw = $(cells[timeIndex]).text().trim();
      if (parseTimeMs(timeRaw) == null) continue;
      const anchor = $(cells[mapIndex]).find("a[href]").first();
      const href = anchor.attr("href");
      const mapName = anchor.text().trim() || $(cells[mapIndex]).text().trim();
      if (!href || !mapName) continue;
      pages.push({ mapName, url: new URL(href, SOURCE_URL).href });
    }
  });

  return pages;
}

function parseSquishyMapHtml(html, mapPage, options = {}) {
  const diagnostics = options.diagnostics || {};
  const logger = options.logger || console;
  const $ = cheerio.load(stripEmbeddedScripts(html));
  const records = [];
  let matchingTables = 0;

  $("table").each((_, table) => {
    const rows = tableRows($, table);
    if (!rows.length) return;
    const sample = rows[0];
    const hasRequiredFields =
      valueByHeader(sample, ["class"]) !== "" &&
      valueByHeader(sample, ["fastest seconds microseconds", "fastest", "completion time"]) !== "";
    if (!hasRequiredFields) return;
    matchingTables += 1;

    for (const row of rows) {
      const timeRaw = valueByHeader(row, [
        "fastest seconds microseconds",
        "fastest",
        "completion time"
      ]);
      if (parseTimeMs(timeRaw) == null) continue;

      try {
        records.push(normalizeRecord({
          source: SOURCE,
          source_url: mapPage.url,
          map_name_raw: mapPage.mapName,
          class_name_raw: valueByHeader(row, ["class"]),
          player_name: valueByHeader(row, ["common name", "nickname", "player"]),
          time_raw: timeRaw
        }));
      } catch (error) {
        diagnostics.failed = (diagnostics.failed || 0) + 1;
        logger.warn?.(`[${SOURCE}] skipped ${mapPage.mapName} row: ${error.message}`);
      }
    }
  });

  if (!matchingTables) {
    throw new Error(`unexpected HTML for ${mapPage.url}: no class record table`);
  }
  return records;
}

async function mapConcurrent(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function runWorker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker())
  );
  return results;
}

async function scrapeSquishy(options = {}) {
  const request = options.fetchHtml || fetchHtml;
  const diagnostics = options.diagnostics || {};
  const logger = options.logger || console;
  const indexHtml = await request(SOURCE_URL);
  const mapPages = findMapPages(indexHtml);
  if (!mapPages.length) {
    throw new Error("unexpected HTML: no completed map links in the All Maps table");
  }

  const configuredConcurrency = Number.parseInt(
    process.env.EXTERNAL_BASELINE_SQUISHY_CONCURRENCY || "",
    10
  );
  const concurrency = options.concurrency || (
    Number.isFinite(configuredConcurrency)
      ? Math.max(1, Math.min(configuredConcurrency, 8))
      : DEFAULT_CONCURRENCY
  );
  let completed = 0;
  let extracted = 0;

  logger.log?.(
    `[${SOURCE}] found ${mapPages.length} completed maps; fetching ${concurrency} at a time`
  );

  const batches = await mapConcurrent(
    mapPages,
    concurrency,
    async mapPage => {
      let records = [];
      try {
        const html = await request(mapPage.url);
        records = parseSquishyMapHtml(html, mapPage, { diagnostics, logger });
      } catch (error) {
        diagnostics.failed = (diagnostics.failed || 0) + 1;
        logger.warn?.(`[${SOURCE}] failed ${mapPage.url}: ${error.message}`);
      } finally {
        completed += 1;
        extracted += records.length;
        if (completed % 25 === 0 || completed === mapPages.length) {
          logger.log?.(
            `[${SOURCE}] ${completed}/${mapPages.length} maps fetched; ${extracted} records extracted`
          );
        }
      }
      return records;
    }
  );

  return batches.flat();
}

module.exports = {
  SOURCE,
  SOURCE_URL,
  stripEmbeddedScripts,
  findMapPages,
  parseSquishyMapHtml,
  scrape: scrapeSquishy
};
