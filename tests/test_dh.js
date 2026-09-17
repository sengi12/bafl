#!/usr/bin/env node
'use strict';
// Double headers: the derivation against the REAL 2023–2026 Sleeper schedules (pair lists
// captured in fixtures_schedules.json), the pinned history it must reproduce, the soundness
// rules, and the backtracking fallback.   Run:  node tests/test_dh.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures_schedules.json'), 'utf8'));
const PINNED = JSON.parse(fs.readFileSync(path.join(ROOT, 'double_headers.json'), 'utf8'));
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error, parseInt,
  window: {}, document: { addEventListener() {}, getElementById: () => ({ style: {}, classList: { toggle() {} } }) },
  fetch: async () => { throw new Error('x'); }, setTimeout, clearTimeout, setInterval, clearInterval,
});
for (const f of ['00-config.js', '05-helpers.js', '30-data.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const g = n => vm.runInContext(n, ctx);
const S = g('S'), getDHMatchups = g('getDHMatchups'), dhProblems = g('dhProblems'), dhFactorization = g('dhFactorization');
const same = (a, b, msg) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), msg);
const queue = []; let passed = 0;
function test(name, fn) { queue.push({ name, fn }); }

// A season's week → pairs map, served as Sleeper matchup rows.
function useSeason(weeks) {
  ctx.fetch = async url => {
    const w = /matchups\/(\d+)/.exec(String(url))[1];
    const rows = [];
    (weeks[w] || []).forEach(([a, b], i) => { rows.push({ roster_id: a, matchup_id: i + 1 }, { roster_id: b, matchup_id: i + 1 }); });
    return { ok: true, json: async () => rows };
  };
  S.seasonStarted = true; S.dhMatchups = null; S.schedCache = {}; S.weekCache = {}; S.dhHistory = {};
  S.league = { season: 'x' }; S.seasons = [{ id: 'x' }]; S.seasonIdx = 0;
  S.rosters = Array.from({ length: 10 }, (_, i) => ({ roster_id: i + 1 }));
}
const key = (a, b) => `${Math.min(a, b)}:${Math.max(a, b)}`;
const oncePairsOf = weeks => {
  const n = {};
  for (const w in weeks) for (const [a, b] of weeks[w]) n[key(a, b)] = (n[key(a, b)] || 0) + 1;
  return new Set(Object.keys(n).filter(k => n[k] === 1));
};
const norm = dh => Object.fromEntries(Object.keys(dh).sort((a, b) => a - b).map(w =>
  [w, dh[w].map(({ r1, r2 }) => [Math.min(r1, r2), Math.max(r1, r2)]).sort((a, b) => a[0] - b[0] || a[1] - b[1])]));

test('2025: the derivation reproduces the pinned double headers exactly', async () => {
  useSeason(FIX['2025']);
  same(norm(await getDHMatchups()), norm(PINNED['2025']));
});
for (const yr of ['2023', '2024']) {
  // Those seasons used the same twenty pairs and the same four source weeks, but mapped them
  // in straight order (6→2, 7→3, 8→13, 9→14). The derivation follows 2025's convention, so
  // the slates agree on WHO plays whom and differ only in which DH week each pair lands in.
  // Those seasons are pinned, so nothing in the app depends on this.
  test(`${yr}: same twenty pairs as pinned, in the pre-2025 week order`, async () => {
    useSeason(FIX[yr]);
    const dh = norm(await getDHMatchups()), pin = norm(PINNED[yr]);
    same(dh['2'], pin['13']); same(dh['3'], pin['14']); same(dh['13'], pin['2']); same(dh['14'], pin['3']);
    same(dhProblems(await getDHMatchups(), oncePairsOf(FIX[yr]), [1,2,3,4,5,6,7,8,9,10]), []);
  });
}
test('2026: every team gets four double headers, each against a team it otherwise meets once', async () => {
  useSeason(FIX['2026']);
  const dh = await getDHMatchups();
  same(Object.keys(dh).map(Number).sort((a, b) => a - b), [2, 3, 13, 14]);
  const once = oncePairsOf(FIX['2026']);
  assert.strictEqual(once.size, 20, '10 teams × 4 once-only opponents / 2');
  same(dhProblems(dh, once, [1,2,3,4,5,6,7,8,9,10]), []);
  const used = new Set(Object.values(dh).flat().map(({ r1, r2 }) => key(r1, r2)));
  assert.strictEqual(used.size, 20, 'all twenty once-only pairs are used, none twice');
  // The convention: weeks 2/3 take weeks 8/9's slate, weeks 13/14 take weeks 6/7's.
  same(norm(dh)['2'], FIX['2026']['8']); same(norm(dh)['3'], FIX['2026']['9']);
  same(norm(dh)['13'], FIX['2026']['6']); same(norm(dh)['14'], FIX['2026']['7']);
});
test('dhProblems names a repeat, a twice-met pair, a duplicated team and a missing team', () => {
  const once = new Set(['1:2', '3:4', '1:3', '2:4']);
  same(dhProblems({ 2: [{ r1: 1, r2: 2 }, { r1: 3, r2: 4 }], 3: [{ r1: 1, r2: 2 }, { r1: 3, r2: 4 }] }, once, [1, 2, 3, 4]),
    ['week 3: 1 v 2 is a repeat double header', 'week 3: 3 v 4 is a repeat double header']);
  same(dhProblems({ 2: [{ r1: 1, r2: 4 }, { r1: 2, r2: 3 }] }, once, [1, 2, 3, 4]),
    ['week 2: 1 v 4 already meet twice', 'week 2: 2 v 3 already meet twice']);
  same(dhProblems({ 2: [{ r1: 1, r2: 2 }, { r1: 1, r2: 3 }] }, once, [1, 2, 3, 4]),
    ['week 2: team 1 listed twice', 'week 2: 3 of 4 teams have a double header']);
});
test('dhFactorization splits once-only pairs into disjoint perfect matchings, backtracking past a bad first pick', () => {
  // K4 minus nothing: 6 edges, 3 rounds. The greedy first matching {1-2, 3-4} works; but
  // order the edges so the first matching tried is {1-2,3-4}, then {1-3,2-4}, then {1-4,2-3}.
  const edges = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
  const rounds = dhFactorization(edges, 3, [1, 2, 3, 4]);
  assert.strictEqual(rounds.length, 3);
  const flat = rounds.flat().map(([a, b]) => key(a, b)).sort();
  same(flat, edges.map(([a, b]) => key(a, b)).sort(), 'every edge used exactly once');
  rounds.forEach(m => same([...new Set(m.flat())].sort(), [1, 2, 3, 4], 'each round covers every team'));
  // 6 teams, a 6-cycle plus its three long diagonals is 3-regular and has a 1-factorization
  // — but a greedy first matching of {1-2, 3-4, 5-6} (the cycle's alternate edges) leaves the
  // other alternate edges and the diagonals, which is fine; the backtracker must return SOME
  // full split and never null.
  const hex = [[1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [1, 6], [1, 4], [2, 5], [3, 6]];
  const r3 = dhFactorization(hex, 3, [1, 2, 3, 4, 5, 6]);
  assert.ok(r3 && r3.length === 3);
  same(r3.flat().map(([a, b]) => key(a, b)).sort(), hex.map(([a, b]) => key(a, b)).sort());
  assert.strictEqual(dhFactorization([[1, 2], [3, 4], [1, 3]], 2, [1, 2, 3, 4]), null, 'no split exists → null, not a partial');
});
test('a season with no clean source weeks still gets a sound slate from the fallback', async () => {
  // Scramble 2026: swap one matchup between weeks 6 and 1 so neither is all once-only.
  const weeks = JSON.parse(JSON.stringify(FIX['2026']));
  const t = weeks['6'][0]; weeks['6'][0] = weeks['1'][0]; weeks['1'][0] = t;
  // (the once-only SET is unchanged — the same games are played, just in different weeks)
  useSeason(weeks);
  const dh = await getDHMatchups();
  same(dhProblems(dh, oncePairsOf(weeks), [1,2,3,4,5,6,7,8,9,10]), []);
  assert.strictEqual(Object.values(dh).flat().length, 20);
});
test('pinned history wins over the derivation when the season is listed', async () => {
  useSeason(FIX['2026']);
  S.league = { season: '2025' }; S.dhHistory = PINNED;
  same(norm(await getDHMatchups()), norm(PINNED['2025']));
});

(async () => {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { console.log('  ✗ ' + t.name); console.error(e); process.exit(1); }
  }
  console.log(`\n${passed} passed`);
})();
