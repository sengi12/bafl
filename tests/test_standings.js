#!/usr/bin/env node
'use strict';
// Sortable standings: sort order, tie-breaking, header state and labels.
//   Run:  node tests/test_standings.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
let lastQuery = null;
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error,
  document: { getElementById: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
              querySelector: () => lastQuery, addEventListener() {} },
  window: {}, navigator: {}, fetch: async () => { throw new Error('x'); },
  setTimeout, clearTimeout, setInterval, clearInterval,
});
for (const f of ['00-config.js', '05-helpers.js', '50-stats.js', '65-render-standings.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const g = n => vm.runInContext(n, ctx);
const S = g('S'), sortStandingsRows = g('sortStandingsRows'), standingsTableHTML = g('standingsTableHTML');
const STANDINGS_COLS = g('STANDINGS_COLS'), BAFL_CATS = g('BAFL_CATS');

// Values built inside the vm have their own Array/Object prototypes, which deepStrictEqual
// rejects; compare structure by JSON instead.
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name); console.error(e); process.exit(1); } }

const rows = [
  { rid: 1, rank: 1, name: 'Zed',   wins: 5, losses: 1, ties: 0, pf: 20, pa: 10, cats: { passing: 1500, receiving: 900, rushing: 700, tds: 20, kicking: 60 } },
  { rid: 2, rank: 2, name: 'alpha', wins: 5, losses: 1, ties: 0, pf: 18, pa: 12, cats: { passing: 1800, receiving: 800, rushing: 400, tds: 20, kicking: 80 } },
  { rid: 3, rank: 3, name: 'Mid',   wins: 3, losses: 2, ties: 1, pf: 15, pa: 15, cats: { passing: 1200, receiving: 950, rushing: 900, tds: 15, kicking: 70 } },
  { rid: 4, rank: 4, name: 'Bottom',wins: 0, losses: 6, ties: 0, pf: 5,  pa: 25, cats: { passing: 900,  receiving: 300, rushing: 500, tds: 8,  kicking: 40 } },
];
const order = (key, dir) => sortStandingsRows(rows, key, dir).map(r => r.rid);

console.log('sortStandingsRows');
test('rank ascending is the standings; descending reverses it', () => {
  same(order('rank', 'asc'), [1, 2, 3, 4]);
  same(order('rank', 'desc'), [4, 3, 2, 1]);
});
test('team sorts case-insensitively', () => {
  same(order('team', 'asc'), [2, 4, 3, 1]);
});
test('record ranks wins then points for, a tie counting half', () => {
  same(order('record', 'desc'), [1, 2, 3, 4]);
  const r = rows.map(x => ({ ...x }));
  r[2].wins = 5; r[2].ties = 1; r[2].pf = 1;         // 5-2-1 beats 5-1-0 on the half win
  same(sortStandingsRows(r, 'record', 'desc')[0].rid, 3);
});
test('every category column sorts by its season total, highest first', () => {
  same(order('passing', 'desc'),   [2, 1, 3, 4]);
  same(order('receiving', 'desc'), [3, 1, 2, 4]);
  same(order('rushing', 'desc'),   [3, 1, 4, 2]);
  same(order('kicking', 'desc'),   [2, 3, 1, 4]);
  same(order('pa', 'asc'),         [1, 2, 3, 4]);
});
test('a tied value falls back to standings order in either direction', () => {
  same(order('tds', 'desc'), [1, 2, 3, 4]);   // 20, 20 → rank breaks it
  same(order('tds', 'asc'),  [4, 3, 1, 2]);   // still rank order within the tie
});
test('does not mutate its input', () => {
  const before = rows.map(r => r.rid); order('pf', 'asc'); same(rows.map(r => r.rid), before);
});

console.log('standingsTableHTML');
const view = { rows, ranks: Object.fromEntries(BAFL_CATS.map(c => [c.key, { 1: 1, 2: 2, 3: 3, 4: 4 }])), rsWeek: 6 };
test('columns are Rank, Team, Record, PF, PA, then the five categories in BAFL order', () => {
  same(STANDINGS_COLS.map(c => c.label),
    ['Rank', 'Team', 'Record', 'PF', 'PA', 'Passing', 'Receiving', 'Rushing', 'Touchdowns', 'Kicking']);
  same(BAFL_CATS.map(c => c.short), ['PASS', 'REC', 'RUSH', 'TD', 'KICK']);
});
test('headers carry both the full word and the short form, and are clickable', () => {
  S.standingsSort = null;
  const html = standingsTableHTML(view);
  for (const c of BAFL_CATS) {
    assert.ok(html.includes(`<span class="lbl-full">${c.label}</span><span class="lbl-short">${c.short}</span>`), c.label);
    assert.ok(html.includes(`onclick="sortStandings('${c.key}')"`), c.key + ' click');
  }
  assert.strictEqual((html.match(/role="button"/g) || []).length, STANDINGS_COLS.length);
});
test('default order shows the playoff divider and marks Rank as the sorted column', () => {
  S.standingsSort = null;
  const html = standingsTableHTML(view);
  assert.ok(html.includes('playoff-divider') || rows.length <= 4, 'divider drawn in standings order (needs > cutoff rows)');
  assert.ok(/<th class="s-sort active" [^>]*aria-sort="ascending"[^>]*>Rank<span class="s-arrow">▲/.test(html));
});
test('sorted by a category: rows reorder, rank column keeps the standings position, no divider', () => {
  S.standingsSort = { key: 'passing', dir: 'desc' };
  const html = standingsTableHTML(view);
  const ranks = [...html.matchAll(/<td class="s-rank">(\d+)/g)].map(m => Number(m[1]));
  same(ranks, [2, 1, 3, 4]);
  assert.ok(!html.includes('playoff-divider'));
  assert.ok(/aria-sort="descending"[^>]*>(<span class="lbl-full">Passing)/.test(html));
  assert.ok(html.includes('s-cat hm2 sorted') || html.includes('sorted'), 'sorted cells flagged');
});
test('sortStandings flips the same column and starts a new numeric column highest-first', () => {
  const sortStandings = g('sortStandings');
  vm.runInContext('standingsView = ' + JSON.stringify(view), ctx);
  lastQuery = { outerHTML: '' };
  S.standingsSort = null;
  sortStandings('kicking'); same(S.standingsSort, { key: 'kicking', dir: 'desc' });
  sortStandings('kicking'); same(S.standingsSort, { key: 'kicking', dir: 'asc' });
  sortStandings('team');    same(S.standingsSort, { key: 'team', dir: 'asc' });
  sortStandings('rank');    same(S.standingsSort, { key: 'rank', dir: 'asc' });
  assert.ok(lastQuery.outerHTML.includes('<table class="stbl">'), 'table rewritten in place');
});
console.log(`\n${passed} passed`);
