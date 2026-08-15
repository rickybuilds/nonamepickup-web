"use strict";

const fs = require("fs");
const net = require("net");

let maxmind = null;
try {
  maxmind = require("maxmind");
} catch (_error) {
  // The API can still serve the Players view when the optional reader is absent.
}

const DEFAULT_SOURCE = "dbip-lite-city";

function normalizeIp(value) {
  let ip = String(value ?? "").trim();
  if (ip.startsWith("[") && ip.endsWith("]")) ip = ip.slice(1, -1);
  return ip.toLowerCase();
}

function ipv4ToNumber(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256) + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function expandIpv6(ip) {
  let value = ip;
  if (value.includes(".")) {
    const splitAt = value.lastIndexOf(":");
    if (splitAt < 0) return null;
    const ipv4 = ipv4ToNumber(value.slice(splitAt + 1));
    if (ipv4 == null) return null;
    const high = ((ipv4 >>> 16) & 0xffff).toString(16);
    const low = (ipv4 & 0xffff).toString(16);
    value = `${value.slice(0, splitAt)}:${high}:${low}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some(part => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  return [...left, ...Array.from({ length: missing }, () => "0"), ...right].map(part => Number.parseInt(part || "0", 16));
}

function ipv6ToBigInt(ip) {
  const groups = expandIpv6(ip);
  if (!groups) return null;
  return groups.reduce((result, group) => (result << 16n) + BigInt(group), 0n);
}

function ipv6InRange(value, prefix, bits) {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (value & mask) === (prefix & mask);
}

function isPrivateOrLocal(ip, family = net.isIP(ip)) {
  if (family === 4) {
    const value = ipv4ToNumber(ip);
    if (value == null) return true;
    const first = value >>> 24;
    const second = (value >>> 16) & 255;
    return first === 0 || first === 10 || first === 127 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 0) ||
      (first === 192 && second === 168) ||
      (first === 198 && (second === 18 || second === 19)) ||
      (first === 198 && second === 51) ||
      (first === 203 && second === 0 && ((value >>> 8) & 255) === 113) ||
      first >= 224;
  }

  if (family === 6) {
    const value = ipv6ToBigInt(ip);
    if (value == null) return true;
    return value === 0n || value === 1n ||
      ipv6InRange(value, 0xfc000000000000000000000000000000n, 7) ||
      ipv6InRange(value, 0xfe800000000000000000000000000000n, 10) ||
      ipv6InRange(value, 0xff000000000000000000000000000000n, 8) ||
      ipv6InRange(value, 0x20010db8000000000000000000000000n, 32) ||
      ipv6InRange(value, 0x20010002000000000000000000000000n, 48) ||
      ipv6InRange(value, 0x200100000000000000000000000000000n, 28);
  }

  return true;
}

function classifyIp(value) {
  const ip = normalizeIp(value);
  const family = net.isIP(ip);
  if (!family) return { ip, family: 0, status: "invalid" };
  if (isPrivateOrLocal(ip, family)) return { ip, family, status: "private" };
  return { ip, family, status: "eligible" };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nameFrom(value) {
  if (typeof value === "string") return value.trim() || null;
  if (!value || typeof value !== "object") return null;
  return firstString(value.en, value["en-US"], ...Object.values(value));
}

function normalizeRecord(record) {
  if (!record || typeof record !== "object") return null;
  const location = record.location || {};
  const subdivision = Array.isArray(record.subdivisions) ? record.subdivisions[0] : record.subdivision;
  const countryValue = record.country || {};
  const cityValue = record.city || {};
  const regionValue = subdivision || record.region || record.stateProv || record.state_prov || {};
  const latitude = Number(location.latitude ?? record.latitude);
  const longitude = Number(location.longitude ?? record.longitude);
  const countryCode = typeof countryValue === "string" && countryValue.length <= 3 ? countryValue : firstString(countryValue.iso_code, countryValue.isoCode, record.country_code, record.countryCode);
  const countryName = typeof countryValue === "string" && countryValue.length > 2 ? countryValue : nameFrom(countryValue.names) || nameFrom(countryValue.name) || firstString(record.country_name, record.countryName);
  return {
    country_code: countryCode,
    country: countryName,
    region: nameFrom(regionValue.names) || nameFrom(regionValue.name) || firstString(record.region_name, record.regionName),
    city: nameFrom(cityValue.names) || nameFrom(cityValue.name) || (typeof cityValue === "string" ? cityValue : null) || firstString(record.city_name, record.cityName),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    timezone: firstString(location.time_zone, location.timezone, record.timezone, record.time_zone, record.timeZone)
  };
}

function createGeoIpLookup({ dbPath = "", source = DEFAULT_SOURCE, databaseVersion = "" } = {}) {
  let databasePromise = null;
  let unavailableReason = null;

  async function openDatabase() {
    if (databasePromise) return databasePromise;
    databasePromise = (async () => {
      if (!dbPath) {
        unavailableReason = "GEOIP_DB_PATH is not configured";
        return null;
      }
      if (!maxmind) {
        unavailableReason = "The maxmind package is not installed";
        return null;
      }
      if (!fs.existsSync(dbPath)) {
        unavailableReason = `GeoIP database not found at ${dbPath}`;
        return null;
      }
      try {
        return await maxmind.open(dbPath);
      } catch (error) {
        unavailableReason = error.message || "GeoIP database could not be opened";
        return null;
      }
    })();
    return databasePromise;
  }

  async function lookup(value) {
    const classification = classifyIp(value);
    if (classification.status !== "eligible") return { ...classification, source, database_version: databaseVersion };
    const database = await openDatabase();
    if (!database) return { ...classification, status: "unavailable", source, database_version: databaseVersion, error: unavailableReason };
    try {
      const normalized = normalizeRecord(database.get(classification.ip));
      if (!normalized) return { ...classification, status: "no_match", source, database_version: databaseVersion };
      return { ...classification, status: "resolved", source, database_version: databaseVersion, ...normalized };
    } catch (error) {
      return { ...classification, status: "unavailable", source, database_version: databaseVersion, error: error.message || "GeoIP lookup failed" };
    }
  }

  return {
    lookup,
    classifyIp,
    getUnavailableReason: () => unavailableReason,
    isAvailable: () => Boolean(dbPath && maxmind && fs.existsSync(dbPath))
  };
}

module.exports = {
  DEFAULT_SOURCE,
  classifyIp,
  createGeoIpLookup,
  isPrivateOrLocal,
  normalizeIp
};
