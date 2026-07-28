"use strict";

const fetch = require("node-fetch");

const DEFAULT_TIMEOUT_MS = 20_000;
const USER_AGENT = "NoName-External-Speedrun-Baseline-Importer/1.0";

async function fetchHtml(url, options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const retries = options.retries == null ? 2 : options.retries;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml"
        },
        redirect: "follow",
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      return await response.text();
    } catch (error) {
      lastError = error.name === "AbortError"
        ? new Error(`request timed out after ${timeoutMs}ms`)
        : error;
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`failed to fetch ${url}: ${lastError?.message || "unknown error"}`);
}

module.exports = { fetchHtml, USER_AGENT };
