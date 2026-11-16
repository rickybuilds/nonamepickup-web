"use strict";
// Integration boundary only. No detector or parser is bundled or dynamically loaded.
const SEVERITIES = ["info", "low", "medium", "high"];
function validateResult(input, result) {
  if (!result || result.contract_version !== 1 || result.demo_id !== input.demo_id || result.sha256 !== input.sha256 ||
      !["complete", "unsupported", "failed"].includes(result.status) || typeof result.parser_version !== "string" ||
      typeof result.detector_version !== "string" || !Array.isArray(result.anomalies) || result.anomalies.length > 10000) throw new Error("Invalid analyzer result");
  if (result.status !== "complete" && result.anomalies.length) throw new Error("Incomplete results cannot create detections");
  const keys = new Set();
  for (const a of result.anomalies) {
    if (!a || typeof a.event_id !== "string" || !a.event_id || keys.has(a.event_id) ||
        !SEVERITIES.includes(a.severity) || typeof a.type !== "string" || !a.type ||
        typeof a.rule_id !== "string" || !a.rule_id || typeof a.rule_version !== "string" ||
        typeof a.summary !== "string" || !a.summary || !a.evidence || typeof a.evidence !== "object" || Array.isArray(a.evidence)) throw new Error("Invalid anomaly");
    keys.add(a.event_id);
    for (const field of ["start_tick", "end_tick", "time_seconds"]) {
      if (a[field] != null && (!Number.isFinite(a[field]) || a[field] < 0 || (field !== "time_seconds" && !Number.isSafeInteger(a[field])))) throw new Error("Invalid anomaly location");
    }
    if (a.start_tick == null && a.time_seconds == null) throw new Error("Anomaly location required");
    if (a.end_tick != null && (a.start_tick == null || a.end_tick < a.start_tick)) throw new Error("Invalid tick range");
    if (a.confidence != null && (!Number.isFinite(a.confidence) || a.confidence < 0 || a.confidence > 1 || typeof a.confidence_basis !== "string" || !a.confidence_basis)) throw new Error("Invalid confidence");
  }
  if (JSON.stringify(result).length > 1048576) throw new Error("Analyzer output too large");
  return result;
}
class UnavailableAnalyzer {
  async analyze(input) { return { contract_version: 1, demo_id: input.demo_id, sha256: input.sha256,
    status: "unsupported", parser_version: "unavailable", detector_version: "unavailable", anomalies: [], error: "external_parser_not_integrated" }; }
}
module.exports = { validateResult, UnavailableAnalyzer };
