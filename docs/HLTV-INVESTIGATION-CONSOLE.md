# HLTV investigation console — implementation checkpoint

## Status

| Capability | Status |
| --- | --- |
| Authenticated registry, priority/analysis filters, review actions, notes, holds, jobs, and responsive investigation layout | Implemented; HLTV API tests pass. Browser appearance requires operator review. |
| Ghosty wall-track and pre-shot snap scanner | Integrated through the pinned upstream `runAnalysis` function inside the bounded statistics worker; no upstream checkout changes. The private-asset integration fixture was unavailable locally, so scanner behavior is not live verified. |
| Player timeline and event inspector | Implemented for scanner findings, recorded firing, and estimated concussion windows, with stable payload-derived IDs, source references, limits, filters, pagination, and authentication. Synthetic timeline tests pass. |
| Viewer | Verified demo download and copyable demo-relative timestamp handoff. Hosted playback is not implemented; the upstream viewer expects private map/model assets and an unrestricted local upload/filesystem service. |
| Automatic analysis failure retention | Failed or skipped statistics jobs block routine cleanup even after their scheduler hold is released. Regression test passes. |
| Raw log replacement | The bot parser now retains the previous private archive under `.history/<match id>/<UUID>/`. Parser test passes. |
| Review notes on the timeline | Deferred: existing notes store unverified ticks with no validated tick-to-demo-time mapping. Notes remain in the review controls. |
| Sound/awareness context and hosted playback | Deferred pending source-data and secure viewer contracts. No cheating probability is generated. |

## Data and APIs

The existing `hltv_statistics_payloads` content-addressed store now includes `scanner.version=upstream-runAnalysis`, findings, and the source demo's start time. `hltv_statistics_observations.config_hash` includes the scanner version, so older firing-only observations stay distinct. No SQLite migration is needed. The original upstream SHA, private asset hashes, demo SHA, log SHA, and settings continue to travel with each observation. Reprocessing a recording with a new scanner-capable worker is necessary before its scanner tabs contain findings.

All routes below are under `/api/admin/hltv` and use the existing reviewer authentication:

- `GET /demos/:id/investigation` — observation status and player list.
- `GET /demos/:id/players/:steam/timeline` — up to 100 events per page; `category`, `weapon`, `quality`, `source`, `start`, `end`, `offset`, and `limit` filters.
- `GET /demos/:id/events/:event` — one event with source and limitations.
- `GET /jobs` — latest 50 upstream jobs, bounded metadata only.

Times in the new event API are seconds relative to the demo's start. Scanner events are reconstructed geometry or sampled aim leads. Firing events are recorded upstream events; hit evidence remains an inferred association. Concussion windows are server-log aligned estimates. Source event indexes are stable only within the immutable payload. Old firing payloads without `source_start_seconds` do not enter the new timeline because their coordinate cannot be established safely.

The local viewer handoff uses the existing authenticated `/demos/:id/file` route, which verifies the source and records a temporary download hold. Open the downloaded demo in the pinned Ghosty viewer and seek to the copied time. No private demo or asset is served from a public static route.

## Deployment and rollback

1. Deploy the website/API and bot parser commits together through the existing operator workflow. Do not enable cleanup as part of this rollout.
2. Keep existing `HLTV_REGISTRY_ENABLED`, `HLTV_UPSTREAM_ENABLED`, `HLTV_STATISTICS_ENABLED`, upstream release pin, and private asset root configuration. No new secret or database migration is required.
3. Restart the API and bounded worker through normal operations. Requeue one retained, verified demo for upstream analysis; check its observation, player list, timeline, scanner status, and download handoff with a reviewer account.
4. Inspect the registry, responsive layout, review actions, and parser replacement history on staging or a nonproduction copy before relying on them operationally.
5. Roll back the API and bot commits through normal release deployment if needed. Content-addressed statistics and `.history` archives are additive and should be retained; do not delete them during rollback.

Local checks: `node --test api/test/hltv.test.js` in the website repository; `node node_modules/vitest/vitest.mjs run test/store.test.ts` and `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` in `tfcbot/parser`.
