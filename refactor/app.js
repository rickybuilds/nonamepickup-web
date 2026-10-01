import { initHeroClasses } from './hero-classes.js';

const $ = (id) => document.getElementById(id);
const state = { matches: [], filter: 'all', searchTimer: null, searchController: null, queueBusy: false, dataBusy: false };
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const format = (value) => number(value).toLocaleString('en-US');
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const arrow = '<svg class="icon" aria-hidden="true"><use href="#i-arrow"/></svg>';
const playerUrl = (id) => `player.html?id=${encodeURIComponent(id)}`;
const mapUrl = (map) => `map.html?map=${encodeURIComponent(map)}`;
const availableMaps = new Set(['waterwar_lg', 'mortality_lg', 'monkey_lg', 'mm_crossfaded2_b9', 'massive2_b7', 'hammer2_b4', 'demolish2_b6', 'siden_lg', 'demolish2_b4r', 'shutdown2_lg2', 'castra_b5', 'raiden9', 'brutalist_b8', '2mesa3_lg', 'nexus_b4', 'phantom_lg', 'toasted_b16', 'stowaway2_lg2', 'stormz2_lg', 'torch2', 'voltage_lg']);

function mapImage(map) {
  const filename = availableMaps.has(String(map)) ? String(map) : 'NoMap';
  return `../assets/images/maps/${encodeURIComponent(filename)}.webp`;
}

function safeImage(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && parsed.hostname === 'avatars.steamstatic.com' ? parsed.href : null;
  } catch { return null; }
}

function avatar(row) {
  const image = safeImage(row.avatarmedium || row.avatar || row.avatarfull);
  return image
    ? `<img class="avatar" src="${escape(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : `<span class="avatar" aria-hidden="true">${escape(String(row.player || row.name || '?').slice(0, 1).toUpperCase())}</span>`;
}

async function api(path, signal) {
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(`/api/${path}`, { signal: timeout.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.ok === false) throw new Error('Data unavailable');
    return payload;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function failure(id, message) {
  $(id).innerHTML = `<div class="empty-state"><p>${escape(message)}</p><button type="button" data-retry>Try again</button></div>`;
}

function relativeDate(timestamp) {
  const raw = number(timestamp);
  if (!raw) return 'Date unavailable';
  const date = new Date(raw > 1e12 ? raw : raw * 1000);
  const today = new Date();
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const current = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const difference = Math.round((current - day) / 86400000);
  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
  if (difference === 0) return `Today · ${time}`;
  if (difference === 1) return `Yesterday · ${time}`;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }).format(date);
}

function renderMatches() {
  const matches = state.matches.filter((match) => state.filter === 'all' || match.winner === state.filter).slice(0, 5);
  $('matches').innerHTML = matches.length ? matches.map((match) => {
    const result = match.winner === 'BLUE' ? 'BLUE WON' : match.winner === 'RED' ? 'RED WON' : 'TIE';
    const color = match.winner === 'BLUE' ? 'team-blue' : match.winner === 'RED' ? 'team-red' : '';
    const blue = match.score_blue == null ? '—' : format(match.score_blue);
    const red = match.score_red == null ? '—' : format(match.score_red);
    return `<a class="match-row" href="match.html?id=${encodeURIComponent(match.id)}" aria-label="${escape(`${match.map_name || 'Unknown map'}, ${result.toLowerCase()}, blue ${blue} to red ${red}`)}">
      ${availableMaps.has(match.map_name) ? `<img class="match-thumb" src="${mapImage(match.map_name)}" alt="" loading="lazy" />` : '<span class="match-thumb match-thumb-fallback" aria-hidden="true"><svg class="icon"><use href="#i-map"/></svg></span>'}
      <div class="match-info"><div class="match-map">${escape(match.map_name || 'Unknown map')}</div><div class="match-meta">${escape(relativeDate(match.created_at))} · 4v4</div></div>
      <div class="match-score" aria-hidden="true"><span class="team-blue"><small>BLUE</small>${blue}</span><span class="score-divider">:</span><span class="team-red"><small>RED</small>${red}</span></div>
      <span class="match-result ${color}">${result}</span>${arrow}</a>`;
  }).join('') : `<p class="empty-state">${state.matches.length ? 'No matching results in the latest 12 games. Try another filter.' : 'No completed pickups yet. The next game starts a new rivalry.'}</p>`;
}

function renderHome(data) {
  const summary = data.summary || {};
  $('total-matches').textContent = summary.totalMatches == null ? '—' : format(summary.totalMatches);
  $('total-players').textContent = summary.uniquePlayers == null ? '—' : format(summary.uniquePlayers);
  $('weekly-matches').textContent = summary.matches7d == null ? '—' : format(summary.matches7d);
  const legends = Array.isArray(data.playerLegends) ? data.playerLegends : [];
  const hot = legends.find((row) => row.label === 'The Hot Hand');
  const rocket = legends.find((row) => row.label === 'The Rocket');
  const grinder = legends.find((row) => row.label === 'The Grinder');
  const feature = hot || grinder;
  if (!feature) {
    $('community-stories').innerHTML = '<p class="empty-state">Community stories will appear as the record grows.</p>';
    return;
  }
  const side = [rocket, grinder].filter((row) => row && row.id != null);
  $('community-stories').innerHTML = `<article class="feature-story"><h3>${hot ? 'The hot hand.' : 'Putting in the hours.'}</h3><div><a class="story-player" href="${playerUrl(feature.id)}">${escape(feature.player)}</a><div class="story-stat"><strong>${format(feature.value)}</strong><span>${hot ? 'wins in a row' : 'career matches'}</span></div></div><img class="story-art" src="../assets/images/classes/Medicold_tfc.png" alt="" loading="lazy" aria-hidden="true" /></article><div class="story-side">${side.map((row) => `<a class="story-row" href="${playerUrl(row.id)}"><div class="story-number">${row.label === 'The Rocket' && number(row.value) > 0 ? '+' : ''}${format(row.value)}</div><div class="story-copy"><h3>${escape(row.player)}</h3><p>${row.label === 'The Rocket' ? 'Elo gained in the last 30 days' : 'career matches and counting'}</p></div>${arrow}</a>`).join('')}</div>`;
}

function renderLeaderboard(data) {
  const players = data.filter((row) => !row.hidden && row.elo != null && number(row.games) >= 10).sort((a, b) => number(b.elo) - number(a.elo)).slice(0, 5);
  $('leaderboard').innerHTML = players.length ? players.map((row, index) => `<a class="ladder-row" href="${playerUrl(row.id)}"><span class="ladder-rank">${index + 1}</span>${avatar(row)}<span class="ladder-player">${escape(row.player)}<small>${format(row.games)} career games</small></span><span class="ladder-elo">${Math.round(number(row.elo))}</span></a>`).join('') : '<p class="empty-state">No qualifying public ratings yet.</p>';
}

function renderMaps(data) {
  const maps = data.filter((row) => availableMaps.has(row.map)).sort((a, b) => number(b.games) - number(a.games)).slice(0, 3);
  $('maps').innerHTML = maps.length ? maps.map((row) => `<a class="map-tile" href="${mapUrl(row.map)}"><img src="${mapImage(row.map)}" alt="${escape(row.map)} battleground" loading="lazy" /><h3>${escape(row.map)}</h3><div class="map-tile-bottom"><span>${format(row.games)} pickups played</span>${arrow}</div></a>`).join('') : '<p class="empty-state">Map histories will appear after the first completed pickups.</p>';
}

async function loadData() {
  if (state.dataBusy) return;
  state.dataBusy = true;
  $('reload-data').disabled = true;
  $('data-message').textContent = 'Refreshing…';
  const jobs = [
    { path: 'home', render: (payload) => renderHome(payload.data || {}), fail: () => { failure('community-stories', 'Community stories couldn’t load.'); } },
    { path: 'matches?limit=12', render: (payload) => { state.matches = Array.isArray(payload.data) ? payload.data : []; renderMatches(); }, fail: () => { state.matches = []; failure('matches', 'Match results couldn’t load.'); } },
    { path: 'leaderboard?limit=2000&days=0', render: (payload) => renderLeaderboard(Array.isArray(payload.data) ? payload.data : []), fail: () => failure('leaderboard', 'The standings couldn’t load.') },
    { path: 'mapaverages', render: (payload) => renderMaps(Array.isArray(payload.data) ? payload.data : []), fail: () => failure('maps', 'Map histories couldn’t load.') }
  ];
  const results = await Promise.allSettled(jobs.map(async (job) => {
    try { job.render(await api(job.path)); }
    catch (error) { job.fail(); throw error; }
  }));
  const failed = results.filter((result) => result.status === 'rejected').length;
  $('data-message').textContent = failed ? 'Some community data is unavailable. You can try refreshing.' : '';
  $('reload-data').disabled = false;
  state.dataBusy = false;
}

function renderQueue(queue) {
  const max = Math.min(16, Math.max(1, number(queue.max) || 8));
  const players = Array.isArray(queue.players) ? queue.players : [];
  const count = Math.min(max, Math.max(0, number(queue.count ?? players.length)));
  $('queue-count').textContent = String(count);
  $('queue-max').textContent = `/ ${max}`;
  $('queue-status').innerHTML = '<span class="status-dot"></span>QUEUE SNAPSHOT';
  $('queue-slots').innerHTML = Array.from({ length: max }, (_, index) => {
    const player = players[index];
    const filled = index < count;
    const name = player?.name || player?.player || `Queued player ${index + 1}`;
    return `<span class="queue-slot${filled ? ' filled' : ''}" title="${escape(filled ? name : `Open slot ${index + 1}`)}" aria-label="${escape(filled ? name : `Open slot ${index + 1}`)}">${filled ? escape(name.slice(0, 2).toUpperCase()) : index + 1}</span>`;
  }).join('');
  const names = players.map((player) => player.name || player.player).filter(Boolean).join(', ');
  $('queue-message').textContent = count === max ? 'Queue full. Ready when the teams lock.' : count > 0 ? `${max - count} more needed.${names ? ` ${names} ${count === 1 ? 'is' : 'are'} in.` : ''}` : 'The next game starts with you. All eight spots are open.';
  const live = (Array.isArray(queue.liveMatches) ? queue.liveMatches : []).find((match) => match.active);
  $('live-match').classList.toggle('active', !!live);
  $('live-match').innerHTML = live
    ? `<span class="status-dot"></span><a href="live.html">Live now: ${escape(live.map || live.map_name || 'pickup in progress')} · Watch the game</a>`
    : '<span class="status-dot"></span><p>No match live. Next one’s yours.</p>';
  $('queue-updated').textContent = `Updated ${new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date())}`;
}

async function loadQueue() {
  if (state.queueBusy) return;
  state.queueBusy = true;
  $('queue-refresh').disabled = true;
  try { renderQueue(await api('queue')); }
  catch {
    $('queue-count').textContent = '—';
    $('queue-status').textContent = 'UNAVAILABLE';
    $('queue-slots').innerHTML = '<span class="queue-placeholder">Queue connection unavailable.</span>';
    $('queue-message').textContent = 'The queue couldn’t be checked. Refresh to try again, or open Queue & servers.';
    $('live-match').classList.remove('active');
    $('live-match').innerHTML = '<p>Live match status unavailable.</p>';
    $('queue-updated').textContent = 'Couldn’t refresh';
  } finally { state.queueBusy = false; $('queue-refresh').disabled = false; }
}

const searchToggle = document.querySelector('.search-toggle');
const menuToggle = document.querySelector('.menu-toggle');
function closeSearch(restoreFocus = false) {
  $('search-panel').hidden = true;
  searchToggle.setAttribute('aria-expanded', 'false');
  clearTimeout(state.searchTimer);
  state.searchController?.abort();
  if (restoreFocus) searchToggle.focus();
}
searchToggle.addEventListener('click', () => {
  const open = $('search-panel').hidden;
  $('search-panel').hidden = !open;
  searchToggle.setAttribute('aria-expanded', String(open));
  if (open) { $('mobile-nav').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open navigation'); $('player-search').focus(); }
});
document.querySelector('.search-close').addEventListener('click', () => closeSearch(true));
menuToggle.addEventListener('click', () => {
  const open = $('mobile-nav').hidden;
  $('mobile-nav').hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  if (open) closeSearch();
});
document.querySelectorAll('#mobile-nav a').forEach((link) => link.addEventListener('click', () => { $('mobile-nav').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open navigation'); }));
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!$('search-panel').hidden) closeSearch(true);
  else if (!$('mobile-nav').hidden) { $('mobile-nav').hidden = true; menuToggle.setAttribute('aria-expanded', 'false'); menuToggle.setAttribute('aria-label', 'Open navigation'); menuToggle.focus(); }
  const details = document.querySelector('.more-nav');
  if (details.open) { details.open = false; details.querySelector('summary').focus(); }
});
document.addEventListener('click', (event) => {
  const details = document.querySelector('.more-nav');
  if (!details.contains(event.target)) details.open = false;
});
$('player-search').addEventListener('input', () => {
  clearTimeout(state.searchTimer);
  state.searchController?.abort();
  const query = $('player-search').value.trim();
  if (query.length < 2) { $('search-results').innerHTML = '<p>Type at least two characters to search the community.</p>'; return; }
  $('search-results').innerHTML = '<p>Searching the player record…</p>';
  state.searchTimer = setTimeout(async () => {
    const controller = new AbortController();
    state.searchController = controller;
    try {
      const payload = await api(`players/search?q=${encodeURIComponent(query)}&limit=6`, controller.signal);
      if (controller.signal.aborted || $('player-search').value.trim() !== query || $('search-panel').hidden) return;
      const players = Array.isArray(payload.data) ? payload.data : [];
      $('search-results').innerHTML = players.length ? players.map((row) => `<a class="search-result" href="${playerUrl(row.id)}">${avatar(row)}<strong>${escape(row.player)}</strong><span class="search-rating">${row.hidden || row.elo == null ? 'Private Elo' : `${Math.round(number(row.elo))} Elo`}</span>${arrow}</a>`).join('') : '<p>No players found. Try a different name or player ID.</p>';
    } catch {
      if (!controller.signal.aborted && $('player-search').value.trim() === query) $('search-results').innerHTML = '<p>Player search is unavailable. Try again or visit <a href="leaderboard.html">the player standings</a>.</p>';
    }
  }, 250);
});
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === button)));
  if (state.matches.length) renderMatches();
}));
$('queue-refresh').addEventListener('click', loadQueue);
$('reload-data').addEventListener('click', loadData);
document.addEventListener('click', (event) => { if (event.target.closest('[data-retry]')) loadData(); });
document.addEventListener('error', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.classList.contains('avatar')) {
    const fallback = document.createElement('span');
    fallback.className = 'avatar'; fallback.setAttribute('aria-hidden', 'true'); fallback.textContent = '?'; image.replaceWith(fallback);
  }
}, true);
let queueTimer;
function scheduleQueue() {
  clearTimeout(queueTimer);
  queueTimer = setTimeout(async () => { if (!document.hidden) await loadQueue(); scheduleQueue(); }, 15000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { loadQueue(); scheduleQueue(); } });
loadData();
loadQueue();
scheduleQueue();
initHeroClasses();
