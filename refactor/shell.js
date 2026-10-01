// Navigation belongs to /refactor/; data and game assets remain shared with the original site.
const root = new URL('./', import.meta.url);
if (window.Chart) {
  window.Chart.defaults.font.family = 'Barlow, sans-serif';
  window.Chart.defaults.color = '#aaaeb0';
  window.Chart.defaults.borderColor = '#34383b';
}
const route = location.pathname.startsWith(new URL('live/', root).pathname) ? 'live/' : location.pathname.split('/').pop() || 'index.html';
const $ = id => document.getElementById(id);
const category = route.startsWith('speedrun') ? 'speedruns.html' : ['player.html','leaderboard.html'].includes(route) ? 'leaderboard.html' : ['matches.html','match.html','map.html','pickup-replay.html','replay-v2.html'].includes(route) ? 'matches.html' : route;
document.querySelectorAll('.desktop-nav a, #mobile-nav a').forEach(link => {
  if (new URL(link.href).pathname === new URL(category, root).pathname) link.setAttribute('aria-current', 'page');
});
const search = $('search-panel');
const mobile = $('mobile-nav');
const searchButton = document.querySelector('.search-toggle');
const menuButton = document.querySelector('.menu-toggle');
let timer, controller;
const closeSearch = (focus = false) => {
  search.hidden = true;
  searchButton.setAttribute('aria-expanded', 'false');
  clearTimeout(timer); controller?.abort();
  if (focus) searchButton.focus();
};
searchButton?.addEventListener('click', () => {
  const open = search.hidden;
  search.hidden = !open; searchButton.setAttribute('aria-expanded', String(open));
  if (open) { mobile.hidden = true; menuButton.setAttribute('aria-expanded', 'false'); $('player-search').focus(); }
});
document.querySelector('.search-close')?.addEventListener('click', () => closeSearch(true));
menuButton?.addEventListener('click', () => {
  const open = mobile.hidden;
  mobile.hidden = !open; menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  if (open) closeSearch();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (search && !search.hidden) closeSearch(true);
  if (mobile && !mobile.hidden) { mobile.hidden = true; menuButton.setAttribute('aria-expanded','false'); menuButton.focus(); }
  document.querySelectorAll('.more-nav[open]').forEach(details => { details.open = false; details.querySelector('summary').focus(); });
});
document.addEventListener('click', event => {
  document.querySelectorAll('.more-nav[open]').forEach(details => { if (!details.contains(event.target)) details.open = false; });
});
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
$('player-search')?.addEventListener('input', () => {
  clearTimeout(timer); controller?.abort();
  const query = $('player-search').value.trim();
  if (query.length < 2) { $('search-results').innerHTML = '<p>Type at least two characters to search the community.</p>'; return; }
  $('search-results').innerHTML = '<p>Searching the player record…</p>';
  timer = setTimeout(async () => {
    controller = new AbortController(); const current = controller;
    const timeout = setTimeout(() => current.abort(), 12000);
    try {
      const response = await fetch(`/api/players/search?q=${encodeURIComponent(query)}&limit=8`, {signal:current.signal});
      if (!response.ok) throw new Error('Search unavailable');
      const payload = await response.json();
      if (current.signal.aborted || $('player-search').value.trim() !== query || search.hidden) return;
      const rows = Array.isArray(payload.data) ? payload.data : [];
      $('search-results').innerHTML = rows.length ? rows.map(row => `<a class="search-result" href="${new URL(`player.html?id=${encodeURIComponent(row.id)}`,root).href}"><span class="avatar" aria-hidden="true">${escape(String(row.player || '?').slice(0,1))}</span><strong>${escape(row.player)}</strong><span class="search-rating">${row.hidden || row.elo == null ? 'Private Elo' : `${Math.round(Number(row.elo))} Elo`}</span><svg class="icon"><use href="#i-arrow"/></svg></a>`).join('') : '<p>No players found. Try another name or player ID.</p>';
    } catch {
      if ($('player-search').value.trim() === query && !search.hidden) $('search-results').innerHTML = '<p>Search is unavailable. Please try again.</p>';
    } finally { clearTimeout(timeout); }
  },250);
});
