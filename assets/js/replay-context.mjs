export function replayRunPath(id, source) {
  const value = String(id);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error("Invalid replay run ID.");
  return `/api/${source === "bootcamp" ? "bootcamp" : "speedruns"}/replay/run/${encodeURIComponent(value)}`;
}

export function bootcampRunsCompatible(a, b) {
  const positiveInteger = value => value != null && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  return !!a && !!b && a.source === "bootcamp" && b.source === "bootcamp" &&
    !!a.map && a.map === b.map && positiveInteger(a.classId) && Number(a.classId) === Number(b.classId) &&
    positiveInteger(a.routeId) && Number(a.routeId) === Number(b.routeId) &&
    positiveInteger(a.configVersion) && Number(a.configVersion) === Number(b.configVersion);
}
