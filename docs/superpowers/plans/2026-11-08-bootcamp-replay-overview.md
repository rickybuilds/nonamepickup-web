# Bootcamp 2D Replay Overview Implementation Plan

> Execute inline against `ricky-bootcamp`; the full delivery directive authorizes continuous implementation without intermediate approval.

**Goal:** Add the spec's 2D route overview, synchronized speed/event timeline, and two-run overlay to Bootcamp replay pages while preserving the existing 3D and speedrun experience.

**Architecture:** Extend the existing `speedrun-replay.html` page and its playback clock. A small ES module owns overview metadata loading, world-to-image projection, timeline drawing, and bounded canvas rendering. A static per-map manifest provides official TFC overview images and explicit affine transforms; unknown maps receive an honest coordinate-grid fallback. The current replay endpoint already returns frames and event codes, and the viewer already enforces Bootcamp comparison compatibility.

**Tech Stack:** Existing HTML/CSS, browser Canvas 2D, ES modules, Node's built-in test runner.

**Spec:** `C:/Projects/bootcamp/TFC Training System — Spec.md`, Website → Replay viewer v1.

## Global Constraints

- Preserve existing NoName speedrun replay behavior and Bootcamp API review/publication gates.
- Only compare Bootcamp runs when map, route, class, and config version match.
- Do not invent map coordinates, event payloads, or replay data.
- Responsive UI, keyboard access, and reduced browser dependency footprint.
- Keep production untouched; push to `ricky-bootcamp` only.

## Review Focus

- Missing map transform or image must use a clearly labeled fallback without breaking the replay page.
- Comparison frame time may exceed the shorter run; hold the marker at the last sample and stop the primary timeline at its duration.
- Invalid or non-finite frame/event input must not crash drawing or inject markup.
- Canvas must resize for device-pixel ratio and remain usable on narrow screens.
- Existing speedrun routes must not receive Bootcamp overview requests or Bootcamp-only controls.

### Task 1: Projection and static overview data

**Files:** Create `assets/js/bootcamp-overview.mjs`, `assets/data/bootcamp-overviews.json`, and `api/test/bootcamp-overview.test.js`; add a normalized 2fort overview PNG from the local TFC install.

- [x] Test affine coordinate mapping against the measured manifest bounds, image Y inversion, rotated transforms, invalid points, and viewport fitting.
- [x] Implement pure projection/viewport helpers with invalid-transform rejection.
- [x] Convert the 2fort overview BMP's green transparent key to PNG alpha and record the BSP bounds-derived transform in the manifest.

### Task 2: Replay controls and timeline UI

**Files:** Modify `speedrun-replay.html`, create `assets/css/bootcamp-replay-overview.css`.

- [x] Add an overview canvas, loading/unsupported-map status, legend, speed graph, and event lane.
- [x] Ensure the section is hidden for speedrun replays and accessible for Bootcamp runs; enable page scrolling only when this Bootcamp panel is active.
- [x] Style for desktop and mobile within the existing NoName visual system; render the isolated overview fixture in headless Edge at desktop and mobile widths.

### Task 3: Playback integration

**Files:** Modify `assets/js/speedrun-replay.js`; extend `api/test/bootcamp-static.test.js` and create browser-independent tests if needed.

- [x] Emit primary/comparison frames and time to the overview module from the existing update loop.
- [x] Draw both route paths, current markers, event ticks, and derived speed over time; clicking the speed plot or event buttons seeks the existing scrubber.
- [x] Keep run/event labels safe and avoid replay compatibility changes.

### Task 4: Verification and delivery record

- [x] Run focused static/helper tests, Bootcamp API replay tests, and the broader website Bootcamp suite.
- [x] Inspect the isolated overview in headless Edge at desktop and mobile viewport widths; run Impeccable detector once. Full shared-viewer playback remains unverified in browser.
- [ ] Update `docs/IMPLEMENTATION_PROGRESS.md` and the plugin continuation checkpoint, commit and push the website branch.

## Rulings

- Use the existing shared replay page instead of creating a second viewer so its playback controls and comparison state remain authoritative.
- Include only verified map imagery/transform data; initial raster coverage is 2fort because that is the only Bootcamp map with a local measured run and available client overview in this environment. The rest use the coordinate-grid fallback until their metadata is supplied.
