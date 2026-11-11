"use strict";
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../assets/js/defense-ratings.js'),'utf8');
const html=fs.readFileSync(path.join(__dirname,'../../analytics.html'),'utf8');

test('Defense Ratings exposes the estimated contract without changing the existing controls',()=>{
  assert.match(html,/data-analytics-tab="defense-ratings"/);
  assert.match(html,/id="defense-player"[^>]+role="combobox"/);
  assert.match(html,/id="defense-minimum"[^>]*><option value="5">/);
  assert.match(source,/statusBadge\.textContent='Estimated telemetry'/);
  assert.match(source,/round-level role\/class data/);
});

test('Defense Ratings keeps filtering, selection synchronization, and empty states client-side',()=>{
  assert.match(source,/filter\(p=>p\.games>=\+\$\('minimum'\)\.value\)/);
  assert.match(source,/selectedPlayer=String\(p\.id\)/);
  assert.match(source,/No \$\{current\.label\} players meet the selected minimum/);
  assert.match(source,/createPlayerPicker\('defense'/);
  assert.match(source,/data-defense-view/);
});

test('Defense Ratings supports keyboard-accessible leaderboard row selection',()=>{
  assert.match(source,/tr\.tabIndex=0/);
  assert.match(source,/\.key==='Enter'\|\|e\.key===' '/);
  assert.match(source,/row|tr\.addEventListener\('click'/);
});
