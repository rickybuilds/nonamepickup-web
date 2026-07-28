"use strict";

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tableRows($, table) {
  const rows = $(table)
    .children("thead,tbody,tfoot")
    .children("tr")
    .add($(table).children("tr"))
    .toArray();
  if (!rows.length) return [];

  let headerIndex = -1;
  let headers = [];
  for (let index = 0; index < Math.min(rows.length, 5); index += 1) {
    const candidate = $(rows[index]).find("th,td").toArray()
      .map(cell => normalizeHeader($(cell).text()));
    if (candidate.length > headers.length) {
      headers = candidate;
      headerIndex = index;
    }
    if ($(rows[index]).find("th").length) {
      headers = candidate;
      headerIndex = index;
      break;
    }
  }

  if (headerIndex < 0 || !headers.length) return [];

  return rows.slice(headerIndex + 1).map(row => {
    const cells = $(row).find("td").toArray();
    const values = {};
    headers.forEach((header, index) => {
      if (!header || !cells[index]) return;
      values[header] = $(cells[index]).text().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    });
    return values;
  }).filter(values => Object.keys(values).length);
}

function valueByHeader(row, aliases) {
  for (const alias of aliases) {
    const key = normalizeHeader(alias);
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return "";
}

module.exports = { normalizeHeader, tableRows, valueByHeader };
