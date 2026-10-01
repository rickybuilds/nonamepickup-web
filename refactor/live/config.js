import { LIVE_CONFIG as ORIGINAL_CONFIG, serverAddress } from "/live/config.js?v=20260827ac";

// The engine resolves downloads against the page URL. Keep its existing
// runtime at /live/ when the launcher is opened under /refactor/live/.
const runtimeUrl = value => value ? new URL(value, new URL("/live/", location.origin)).href : value;

export const LIVE_CONFIG = Object.freeze({
  ...ORIGINAL_CONFIG,
  runtimeModule: runtimeUrl(ORIGINAL_CONFIG.runtimeModule),
  gameAssetsManifest: runtimeUrl(ORIGINAL_CONFIG.gameAssetsManifest),
  extrasArchive: runtimeUrl(ORIGINAL_CONFIG.extrasArchive),
  valveExtrasArchive: runtimeUrl(ORIGINAL_CONFIG.valveExtrasArchive),
  runtimeLibraries: Object.freeze(Object.fromEntries(
    Object.entries(ORIGINAL_CONFIG.runtimeLibraries).map(([key, value]) => [key, runtimeUrl(value)])
  ))
});

export { serverAddress };
