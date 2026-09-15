#!/usr/bin/env node
'use strict';
// Defense vs position: the per-week aggregate, ranking, tiers and the early-season blend,
// run against the shipped partials with a fake schedule and stat feed.
//   Run:  node tests/test_dvp.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error,
  window: {},                                   // no `caches` → persistence is a no-op
  fetch: async () => { throw new Error('no network'); },
  setTimeout, clearTimeout,
});
for (const f of ['00-config.js', '05-helpers.js', '50-stats.js', '58-projections.js', '49-dvp.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const g = n => vm.runInContext(n, ctx);
const S = g('S'), dvpWeekAggregate = g('dvpWeekAggregate'), dvpRanks = g('dvpRanks'), dvpTier = g('dvpTier');
const dvpMetric = g('dvpMetric'), loadDvp = g('loadDvp');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}±${tol}, got ${a}`);
const queue = []; let passed = 0;
function test(name, fn) { queue.push({ name, fn }); }

const row = (pos, opp, stats, game_id = 'g') => ({ player: { position: pos }, opponent: opp, game_id, stats: { gp: 1, ...stats } });

test('dvpMetric is category yards plus 20 per TD; kicking points for kickers', () => {
  assert.strictEqual(dvpMetric({ rush_yd: 80, rec_yd: 20, rush_td: 1 }, 'RB'), 120);
  assert.strictEqual(dvpMetric({ pass_yd: 300, pass_int: 2, pass_td: 2 }, 'QB'), 300);
  assert.strictEqual(dvpMetric({ xpm: 2, fgm: 3 }, 'K'), 11);
});
test('dvpWeekAggregate sums what each defense allowed, by position, played rows only', () => {
  const agg = dvpWeekAggregate([
    row('RB', 'PHI', { rush_yd: 50 }), row('RB', 'PHI', { rush_yd: 30, rec_td: 1 }),
    row('WR', 'PHI', { rec_yd: 90 }),  row('RB', 'DAL', { rush_yd: 140 }),
    { player: { position: 'RB' }, opponent: 'DAL', stats: { rush_yd: 99 } },          // no gp → inactive
    row('FB', 'DAL', { rush_yd: 10 }), row('RB', '', { rush_yd: 10 }),
  ]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(agg)), { PHI: { RB: 100, WR: 90 }, DAL: { RB: 140 } });
});
test('a week in progress only counts rows from games that are over', () => {
  const agg = dvpWeekAggregate([row('RB', 'PHI', { rush_yd: 50 }, 'done'), row('RB', 'DAL', { rush_yd: 70 }, 'live')], new Set(['done']));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(agg)), { PHI: { RB: 50 } });
});
test('dvpRanks: rank 1 allows the most; tiers band the ends', () => {
  const { ranks, n } = dvpRanks({ A: { RB: 120 }, B: { RB: 60 }, C: { RB: 90 }, D: { WR: 10 } });
  assert.strictEqual(n.RB, 3); assert.strictEqual(ranks.A.RB, 1); assert.strictEqual(ranks.C.RB, 2); assert.strictEqual(ranks.B.RB, 3);
  assert.strictEqual(ranks.D.RB, undefined); assert.strictEqual(ranks.D.WR, 1);
  assert.strictEqual(dvpTier(1, 32), 'easy'); assert.strictEqual(dvpTier(10, 32), 'easy');
  assert.strictEqual(dvpTier(11, 32), 'mid'); assert.strictEqual(dvpTier(22, 32), 'mid');
  assert.strictEqual(dvpTier(23, 32), 'hard'); assert.strictEqual(dvpTier(null, 32), '');
});

// A two-team league: 2026 has one finished week and one in progress; 2025 is complete.
const sched = {
  2026: [
    { week: 1, game_id: '26a', home: 'PHI', away: 'DAL', status: 'complete' },
    { week: 2, game_id: '26b', home: 'DAL', away: 'PHI', status: 'in_game' },
    { week: 2, game_id: '26d', home: 'KC',  away: 'BUF', status: 'complete' },
    { week: 3, game_id: '26c', home: 'PHI', away: 'DAL', status: 'pre_game' },
  ],
  2025: Array.from({ length: 17 }, (_, i) => ({ week: i + 1, game_id: `25-${i}`, home: i % 2 ? 'PHI' : 'DAL', away: i % 2 ? 'DAL' : 'PHI', status: 'complete' })),
};
const weekRows = {
  '2026/1': [row('RB', 'PHI', { rush_yd: 40 }, '26a'), row('RB', 'DAL', { rush_yd: 100 }, '26a')],
  '2026/2': [row('RB', 'PHI', { rush_yd: 999 }, '26b'),                                    // live game — must be ignored
             row('RB', 'KC', { rush_yd: 80 }, '26d'), row('RB', 'BUF', { rush_yd: 20 }, '26d')],
};
const fetched = [];
ctx.fetch = async url => {
  url = String(url); fetched.push(url);
  const m = /schedule\/nfl\/regular\/(\d+)/.exec(url);
  if (m) return { ok: true, json: async () => sched[m[1]] };
  const w = /stats\/nfl\/(\d+)\/(\d+)/.exec(url);
  if (w) {
    if (w[1] === '2025') return { ok: true, json: async () => [row('RB', 'PHI', { rush_yd: 60 }, `25-${w[2] - 1}`), row('RB', 'DAL', { rush_yd: 120 }, `25-${w[2] - 1}`)] };
    return { ok: true, json: async () => weekRows[`${w[1]}/${w[2]}`] || [] };
  }
  throw new Error('unexpected ' + url);
};
test('loadDvp blends one real game with last season until six are played', async () => {
  const d = await loadDvp(2026);
  assert.ok(d && d.prior, 'last season was pulled in');
  assert.strictEqual(d.weeks, 2, 'week 2 counts: one of its games is over');
  assert.strictEqual(d.games.PHI, 1, 'the live game is not a game played yet');
  assert.strictEqual(d.games.KC, 1);
  // PHI allowed 40 this year (1 game) + 5 games' worth of last year's 60/g → (40 + 300) / 6.
  near(d.perGame.PHI.RB, 340 / 6, 1e-9, 'PHI blend');
  near(d.perGame.DAL.RB, (100 + 5 * 120) / 6, 1e-9, 'DAL blend');
  assert.strictEqual(d.perGame.KC.RB, 80, 'no prior figure for a team last season had no rows for');
  // DAL (116.7) > KC (80) > PHI (56.7) > BUF (20)
  assert.deepStrictEqual([d.ranks.DAL.RB, d.ranks.KC.RB, d.ranks.PHI.RB, d.ranks.BUF.RB], [1, 2, 3, 4]);
  assert.strictEqual(d.n.RB, 4);
  assert.ok(!fetched.some(u => /stats\/nfl\/2026\/3/.test(u)), 'a week with nothing finished is never fetched');
  assert.ok(fetched.some(u => /stats\/nfl\/2026\/2/.test(u)), 'the live week is fetched…');
  assert.ok(d.perGame.PHI.RB < 200, '…but its unfinished game is not counted');
  assert.strictEqual(await loadDvp(2026), d, 'cached for the session');
});
test('loadDvp resolves null when the schedule is unavailable, and does not cache that', async () => {
  const before = ctx.fetch;
  ctx.fetch = async () => { throw new Error('down'); };
  S.nflSchedCache = {};
  assert.strictEqual(await loadDvp(2020), null);
  assert.strictEqual(S.dvpCache['2020'], undefined);
  ctx.fetch = before;
});

(async () => {
  for (const t of queue) {
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { console.log('  ✗ ' + t.name); console.error(e); process.exit(1); }
  }
  console.log(`\n${passed} passed`);
})();
