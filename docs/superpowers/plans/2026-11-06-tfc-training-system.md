# TFC Training System Implementation Plan

**Goal:** Build the six-phase training system in `C:/Projects/bootcamp/TFC Training System — Spec.md`, preserving existing speedrun data and NoName behavior.

**Architecture:** Extend the speedrun plugin and its existing MariaDB and replay formats, and extend the existing NoName web API and Discord bot. Training route identity and ranked validity must be isolated from existing map/class/ruleset leaderboards. The game server is authoritative for eligibility and scoring.

**Tech stack:** AMX Mod X/Pawn, SQLx, MariaDB, Node.js/Express, Discord.js.

## Reuse assessment and dependencies

- `speedrun/sr_timer.inc`, `sr_checkpoints.inc`, `sr_zones.inc`, `sr_admin.inc` and `sr_visuals.inc` provide timing, ordered checkpoints, zones, editing, HUD and beams. Current zones and records are scoped to a map, not multiple routes; generalizing them must not change normal speedrun behavior.
- `sr_sql.inc` stores run history, records, rankings and splits via threaded queries. Splits are persisted in `speedrun_run_splits`, contrary to the older README. Existing record queries assume map/class/ruleset identity; training runs must not enter those leaderboards.
- `sr_ghost_core.inc`, `sr_ghost_db.inc`, `sr_replay.inc` and `sr_projectiles.inc` record and play run-owned, chunked SQL replays. The web API parses that format and exposes the existing replay viewer. Extend these contracts rather than replacing them; the existing format does not capture every event or field required by the spec.
- `tfcbot/services/speedrunPlayerLinkSync.js` synchronizes existing Steam/Discord links; `speedrunWatcher.js` posts records. Reuse those identities and notification patterns. The website is in the separate `nonamepickup-web` checkout; its speedrun endpoints, profile pages, split analysis and replay viewer already consume the same database.
- New work includes per-map multi-route configuration and editing, isolated training run identities, ranked integrity checks, tier and drill scoring, defensive geometry and targets, tours, license evaluation, training UI, and role/queue integration. The current speedrun plugin blocks engineer buildings and uses practice checkpoint returns; training must not silently inherit those policies as ranked behavior.
- A training replay cannot simply be inserted as an ordinary `speedrun_runs` row: existing leaderboards query that table. A compatible extension must give replay ownership a training namespace and preserve existing readers, with a migration and integration tests before changing shared interfaces.

## Phases and verification

1. **Foundation:** Implement versioned map/route definitions, editor, practice/ranked state, ordered traversal and server-side validation. Store training results separately in the existing database; use existing Steam IDs, calculate fixed-reference tiers, and extend PB notifications. Exercise multiple routes on openfire, interrupted runs, invalidation and concurrent database callbacks without altering existing records.
2. **Ghosts:** Extend existing recording and replay ownership for training runs, preserve old chunks and readers, add missing events, target selection, route line and split comparisons. Test old and new replay playback and concurrent viewers.
3. **Defense I:** Implement shared sampled-route coverage, SG placement/build drills, soldier/HWGuy positioning, tours and quiz. Verify geometry with controlled maps and calibrated server measurements.
4. **Defense II:** Prototype damageable ghost behavior on TFC; use the specified trace/explosion fallback if needed. Add live-target waves and pipe placement/detonation/reset drills. Test actual server weapon behavior and calibrated damage.
5. **License:** Evaluate configured curricula and rotation grandfathering from authoritative tiers, expose profiles and replay comparisons, synchronize Discord roles and integrate the queue gate. Test linking, grants, map rotation changes and role retries.
6. **Polish:** Add ghost animation, optional 3D viewing, additional maps, challenges and monthly boards, maintaining replay compatibility.

## Initial task

Implement and test the pure tier-threshold calculation in `api/src/training/tiers.js`, including exact inclusive boundaries, configurable thresholds and invalid inputs. This is a reusable presentation/domain helper; it does not replace authoritative server scoring or award a tier by itself. Add an integration only once training result storage and authoritative validation exist.
