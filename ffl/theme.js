/* FFL theme controller: independent of app.js, compatible with restrictive inline-script policies. */
(function () {
  'use strict';
  const root = document.documentElement;
  let saved = null;
  try { saved = localStorage.getItem('ffl-theme'); } catch (_) {}
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const initial = saved === 'dark' || saved === 'light' ? saved : (prefersDark ? 'dark' : 'light');
  function apply(theme) {
    const dark = theme === 'dark';
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    const meta = document.getElementById('theme-color');
    if (meta) meta.content = dark ? '#111827' : '#1c2440';
    const button = document.getElementById('theme-toggle');
    if (button) {
      button.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
      button.title = dark ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-pressed', String(dark));
    }
  }
  apply(initial);
  function bind() {
    const button = document.getElementById('theme-toggle');
    if (!button) return;
    button.addEventListener('click', function () {
      const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(next);
      try { localStorage.setItem('ffl-theme', next); } catch (_) {}
    });
    apply(root.dataset.theme);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind, { once: true });
  else bind();
})();
