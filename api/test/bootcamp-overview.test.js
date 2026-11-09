const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let helperModule;
const helpers = () => helperModule ||= import('../../assets/js/bootcamp-overview.mjs');

test('applies the authoritative GoldSrc zoom, origin, and rotation projection to 2fort', async () => {
  const { projectWorldPoint } = await helpers();
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/bootcamp-overviews.json'), 'utf8'));
  const map = manifest.maps['2fort'];
  const { zoom, origin, rotated } = map.transformSource.overview;
  const scale = map.width * zoom / 8192;
  const expected = rotated
    ? [scale, 0, map.width / 2 - scale * origin[0], 0, -scale, map.height / 2 + scale * origin[1]]
    : [0, -scale, map.width / 2 + scale * origin[1], -scale, 0, map.height / 2 + scale * origin[0]];
  assert.ok(map.transform.every((value, index) => Math.abs(value - expected[index]) < 1e-10));
  assert.deepEqual(projectWorldPoint({ x: origin[0], y: origin[1] }, map), { x: map.width / 2, y: map.height / 2 });
});

test('covers every bundled TFC overview map with a transparent raster and world transform', async () => {
  const { projectWorldPoint } = await helpers();
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/bootcamp-overviews.json'), 'utf8'));
  const requiredMaps = ['2fort', 'avanti', 'badlands', 'casbah', 'crossover2', 'cz2', 'dustbowl', 'epicenter', 'flagrun', 'hunted', 'push', 'ravelin', 'rock2', 'warpath', 'well'];
  assert.deepEqual(Object.keys(manifest.maps).sort(), requiredMaps.sort());
  for (const name of requiredMaps) {
    const map = manifest.maps[name];
    assert.ok(fs.existsSync(path.join(root, map.image.replace(/^\//, ''))), `missing overview image for ${name}`);
    assert.equal(map.transform.length, 6, `missing affine transform for ${name}`);
    assert.ok(map.transformSource.worldBounds && map.transformSource.contentBounds && map.transformSource.overview, `missing transform provenance for ${name}`);
    const { zoom, origin, rotated } = map.transformSource.overview;
    const scale = map.width * zoom / 8192;
    const expected = rotated
      ? [scale, 0, map.width / 2 - scale * origin[0], 0, -scale, map.height / 2 + scale * origin[1]]
      : [0, -scale, map.width / 2 + scale * origin[1], -scale, 0, map.height / 2 + scale * origin[0]];
    assert.ok(map.transform.every((value, index) => Math.abs(value - expected[index]) < 1e-10), `GoldSrc transform mismatch for ${name}`);
  }
});

test('projects rotated map coordinates with the full affine transform', async () => {
  const { projectWorldPoint } = await helpers();
  assert.deepEqual(projectWorldPoint({ x: 2, y: 3 }, { width: 20, height: 20, transform: [0, 1, 10, -1, 0, 20] }), { x: 13, y: 18 });
});

test('fits the overview without distortion and projects into its letterboxed viewport', async () => {
  const { fitOverviewView, projectToCanvas } = await helpers();
  const view = fitOverviewView(1024, 768, 600, 600);
  assert.equal(view.scale, 600 / 1024);
  assert.equal(view.offsetX, 0);
  assert.equal(view.offsetY, 75);
  assert.deepEqual(projectToCanvas({ x: 512, y: 384 }, view), { x: 300, y: 300 });
});

test('derives game-unit speed from valid timed frames', async () => {
  const { speedSeries } = await helpers();
  assert.deepEqual(speedSeries([
    { t: 0, x: 0, y: 0, z: 0 },
    { t: 0.5, x: 300, y: 400, z: 0 },
    { t: 1, x: 600, y: 400, z: 0 }
  ]), [{ t: 0.25, speed: 1000 }, { t: 0.75, speed: 600 }]);
});

test('labels recorded replay events without trusting event payload as HTML', async () => {
  const { eventTitle } = await helpers();
  assert.equal(eventTitle({ code: 2 }), 'Conc primed');
  assert.equal(eventTitle({ code: 8, a: 0 }), 'Checkpoint 1');
  assert.equal(eventTitle({ code: 999, a: 0 }), 'Event 999');
});

test('rejects invalid coordinates, transforms, and empty viewports', async () => {
  const { projectWorldPoint, fitOverviewView } = await helpers();
  assert.equal(projectWorldPoint({ x: Number.NaN, y: 0 }, { width: 1, height: 1, transform: [1, 0, 0, 0, 1, 0] }), null);
  assert.equal(projectWorldPoint({ x: 0, y: 0 }, { width: 1, height: 1, transform: [1, 0, 0] }), null);
  assert.equal(fitOverviewView(0, 768, 600, 600), null);
});

test('maps clicks on the plotted timeline area to the correct replay time', async () => {
  const { timelineTimeAtPoint } = await helpers();
  const rect = { left: 100, width: 1000 };
  assert.equal(timelineTimeAtPoint(134, rect, 12), 0);
  assert.equal(timelineTimeAtPoint(1090, rect, 12), 12);
  assert.equal(timelineTimeAtPoint(612, rect, 12), 6);
  assert.equal(timelineTimeAtPoint(0, rect, 12), 0);
  assert.equal(timelineTimeAtPoint(1200, rect, 12), 12);
});

function canvasStub() {
  const strokes = [];
  const context = {
    strokeStyle: "", fillStyle: "", lineWidth: 1,
    setTransform() {}, clearRect() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc() {}, fill() {}, fillText() {}, drawImage() {},
    stroke() { strokes.push(this.strokeStyle); },
  };
  return {
    strokes,
    width: 0,
    height: 0,
    getBoundingClientRect: () => ({ width: 640, height: 320, left: 0 }),
    getContext: () => context,
    addEventListener() {},
  };
}

function nodeStub(isFragment = false) {
  return {
    children: [],
    isFragment,
    appendChild(child) {
      if (child?.isFragment) this.children.push(...child.children);
      else this.children.push(child);
      return child;
    },
    replaceChildren(...children) { this.children = children; },
    addEventListener(name, listener) { (this.listeners ||= {})[name] = listener; },
  };
}

test("Bootcamp 2D overview overlays both compatible runs and exposes both event timelines", async () => {
  const oldGlobals = { fetch: globalThis.fetch, document: globalThis.document, window: globalThis.window };
  const nodes = new Map();
  const events = nodeStub();
  const seeks = [];
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ maps: { testmap: {} } }) });
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = {
    getElementById: id => nodes.get(id) || (nodes.set(id, nodeStub()), nodes.get(id)),
    createDocumentFragment: () => nodeStub(true),
    createElement: () => nodeStub(),
  };
  nodes.set("bootcamp-replay-events", events);

  try {
    const { BootcampReplayOverview } = await import("../../assets/js/bootcamp-overview.mjs");
    const mapCanvas = canvasStub();
    const speedCanvas = canvasStub();
    const status = { textContent: "" };
    const overview = new BootcampReplayOverview({ mapCanvas, speedCanvas, status, onSeek: time => seeks.push(time) });
    await overview.loadManifest();
    overview.render({
      replay: { runId: 1, map: "testmap", frames: [
        { t: 0, x: 0, y: 0, z: 0 }, { t: 0.5, x: 50, y: 0, z: 25 }, { t: 1, x: 100, y: 0, z: 50 },
      ], events: [{ t: 0.5, code: 8, a: 0 }] },
      comparison: { runId: 2, map: "testmap", frames: [
        { t: 10, x: 20, y: 20, z: 0 }, { t: 10.5, x: 70, y: 20, z: 25 }, { t: 11, x: 120, y: 20, z: 50 },
      ], events: [{ t: 10.25, code: 2 }] },
      primaryFrame: { x: 50, y: 25 }, comparisonFrame: { x: 70, y: 25 },
      timelineStart: 0, comparisonStart: 10, time: 0.5, duration: 1,
    });

    assert.ok(mapCanvas.strokes.includes("#53c5ff"), "primary route path is drawn");
    assert.ok(mapCanvas.strokes.includes("#ff76bb"), "comparison route path is drawn");
    assert.ok(speedCanvas.strokes.includes("#53c5ff"), "primary movement-speed plot is drawn");
    assert.ok(speedCanvas.strokes.includes("#ff76bb"), "comparison movement-speed plot is drawn");
    assert.equal(events.children.length, 2);
    assert.match(events.children[0].textContent, /Checkpoint 1/);
    assert.match(events.children[1].textContent, /Conc primed/);
    events.children.forEach(button => button.listeners.click());
    assert.deepEqual(seeks, [0.5, 0.25]);
  } finally {
    globalThis.fetch = oldGlobals.fetch;
    globalThis.document = oldGlobals.document;
    globalThis.window = oldGlobals.window;
  }
});
