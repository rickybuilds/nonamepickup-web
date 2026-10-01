const ART_ROOT = '../assets/images/classes/';
const INTERVAL = 12000;

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [result[index], result[other]] = [result[other], result[index]];
  }
  return result;
}

export async function initHeroClasses() {
  const hero = document.querySelector('.hero-soldier');
  const next = document.getElementById('next-class');
  const toggle = document.getElementById('class-toggle');
  const label = document.getElementById('hero-class-name');
  if (!hero || !next || !toggle || !label) return;
  let files;
  try {
    const response = await fetch(`${ART_ROOT}manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const manifest = await response.json();
    if (!Array.isArray(manifest)) return;
    files = [...new Set(manifest.filter((file) => typeof file === 'string' && /^[a-z0-9_-]+\.png$/i.test(file)))];
  } catch { return; }
  if (files.length < 2) return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !motion.matches;
  let bag = shuffle(files);
  let current = 'Soldierold_tfc.png';
  let timer;
  let busy = false;
  const failed = new Set();

  function refill() {
    bag = shuffle(files.filter((file) => !failed.has(file)));
    if (bag.length > 1 && bag[0] === current) [bag[0], bag[1]] = [bag[1], bag[0]];
  }

  function schedule() {
    clearTimeout(timer);
    if (playing && !document.hidden) timer = setTimeout(() => change(), INTERVAL);
  }

  function updateToggle() {
    const action = playing ? 'Pause class rotation' : 'Play class rotation';
    toggle.setAttribute('aria-label', action);
    toggle.title = action;
    toggle.innerHTML = `<svg class="icon" aria-hidden="true"><use href="#${playing ? 'i-pause' : 'i-play'}"/></svg>`;
  }

  async function change(initial = false) {
    if (busy) return;
    if (!bag.length) refill();
    // Avoid an immediate repeat when the initial random pick is the fallback.
    if (initial && bag.length > 1 && bag[0] === current) [bag[0], bag[1]] = [bag[1], bag[0]];
    const file = bag.shift();
    if (!file) return;
    busy = true;
    next.disabled = true;
    try {
      const image = new Image();
      image.src = `${ART_ROOT}${encodeURIComponent(file)}`;
      await image.decode();
      if (document.hidden) { bag.unshift(file); return; }
      if (!initial && !motion.matches) {
        hero.classList.add('is-changing');
        await new Promise((resolve) => setTimeout(resolve, 180));
      }
      hero.src = image.src;
      current = file;
      label.textContent = file.replace(/old_tfc\.png$/i, '').replace(/_/g, ' ');
      hero.classList.remove('is-changing');
    } catch {
      failed.add(file);
      hero.classList.remove('is-changing');
    } finally {
      busy = false;
      next.disabled = false;
      schedule();
    }
  }

  next.hidden = false;
  toggle.hidden = false;
  updateToggle();
  next.addEventListener('click', () => { clearTimeout(timer); change(); });
  toggle.addEventListener('click', () => { playing = !playing; updateToggle(); schedule(); });
  motion.addEventListener('change', () => { playing = !motion.matches; updateToggle(); schedule(); });
  document.addEventListener('visibilitychange', schedule);
  await change(true);
}
