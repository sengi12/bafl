#!/usr/bin/env node
'use strict';
// Blended projections + win probability. Loads the real partials into a vm so the test runs the
// shipped code, not a copy.   Run:  node tests/test_projections.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');

const ROOT = path.join(__dirname, '..');
const PARTIALS = ['00-config.js', '05-helpers.js', '50-stats.js', '58-projections.js', '59-winprob.js', '55-matchup-card.js'];
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error,
  document: { getElementById: () => ({ textContent: '', style: {}, classList: { add() {}, remove() {}, toggle() {} } }), addEventListener() {} },
  window: {}, navigator: {},
  fetch: async () => { throw new Error('no network in tests'); },
  setTimeout, clearTimeout, setInterval, clearInterval,
});
for (const f of PARTIALS) vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const g = name => vm.runInContext(name, ctx);
const S = g('S'), BAFL_CATS = g('BAFL_CATS');
const blendProjections = g('blendProjections'), winProbability = g('winProbability');
const decidedWinProb = g('decidedWinProb'), calcResult = g('calcResult'), calcCatStats = g('calcCatStats');
const gameRemainingFromEspn = g('gameRemainingFromEspn'), gameRemaining = g('gameRemaining');
const loadGameProgress = g('loadGameProgress'), matchupCard = g('matchupCard'), normCdf = g('normCdf');

// Tests run in order, and one that returns a promise is awaited before the next starts.
const queue = [];
let passed = 0;
function test(name, fn) { queue.push({ name, fn }); }
function section(label) { queue.push({ label }); }
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b}±${tol}, got ${a}`);

// ── Fixture: two rosters, three starters each ─────────────────────────────
const matchups = [
  { roster_id: 1, matchup_id: 1, starters: ['q1', 'r1', 'k1', '0'] },
  { roster_id: 2, matchup_id: 1, starters: ['q2', 'w2', 'k2'] },
];
const projStats = {
  q1: { pass_yd: 260, pass_int: 0.8, pass_td: 1.8, rush_yd: 12 },
  r1: { rush_yd: 75, rec_yd: 20, rush_td: 0.6 },
  k1: { xpm: 2.5, fgm: 1.6 },
  q2: { pass_yd: 230, pass_int: 0.6, pass_td: 1.5, rush_yd: 30, rush_td: 0.3 },
  w2: { rec_yd: 70, rec_td: 0.5 },
  k2: { xpm: 2.0, fgm: 1.9 },
};
const proj = {
  stats: projStats,
  game: { q1: 'A', r1: 'B', k1: 'A', q2: 'C', w2: 'B', k2: 'C' },
  team: { q1: 'KC', r1: 'DAL', k1: 'KC', q2: 'BUF', w2: 'PHI', k2: 'BUF' },
  at: Date.now(),
};
const prog = (a, b, c) => ({ rem: { A: a, B: b, C: c }, byTeam: {}, weekDone: a === 0 && b === 0 && c === 0 });
const sum = o => Object.values(o).reduce((s, v) => s + v, 0);

section('normal CDF');
test('normCdf hits the textbook values', () => {
  near(normCdf(0), 0.5, 1e-7); near(normCdf(1.96), 0.975, 1e-4); near(normCdf(-1.96), 0.025, 1e-4);
});

section('blendProjections');
test('before kickoff the blend IS the full projection, for every category', () => {
  const pcs = blendProjections(matchups, {}, proj, prog(1, 1, 1));
  const full = calcCatStats(matchups.map(m => ({ ...m, players_points: Object.fromEntries(m.starters.map(p => [p, 0])) })), projStats);
  for (const c of BAFL_CATS) for (const rid of [1, 2]) near(pcs[c.key][rid], full[c.key][rid], 1e-9, c.key + ' rid ' + rid);
  assert.strictEqual(pcs.rem[1], 3); assert.strictEqual(pcs.rem[2], 3);
  assert.ok(sum(pcs.var.passing) > 0 && sum(pcs.var.tds) > 0 && sum(pcs.var.kicking) > 0);
});
test('after the final whistle the blend IS the box score and carries no variance', () => {
  const stats = { q1: { pass_yd: 301, pass_int: 2, pass_td: 3 }, r1: { rush_yd: 44 }, k1: { xpm: 4, fgm: 1 },
                  q2: { pass_yd: 188, pass_td: 1 }, w2: { rec_yd: 121, rec_td: 1 }, k2: { xpm: 1, fgm: 3 } };
  const pcs = blendProjections(matchups, stats, proj, prog(0, 0, 0));
  const cs = calcCatStats(matchups.map(m => ({ ...m, players_points: Object.fromEntries(m.starters.map(p => [p, 0])) })), stats);
  for (const c of BAFL_CATS) for (const rid of [1, 2]) near(pcs[c.key][rid], cs[c.key][rid], 1e-9, c.key);
  assert.strictEqual(pcs.rem[1], 0); assert.strictEqual(pcs.rem[2], 0);
  for (const c of BAFL_CATS) assert.strictEqual(sum(pcs.var[c.key]), 0, c.key + ' variance');
});
test('mid-game: actual so far plus the unplayed share of the projection', () => {
  const stats = { q1: { pass_yd: 140, pass_td: 1 } };
  const pcs = blendProjections(matchups, stats, proj, prog(0.5, 1, 1));
  // q1 at half: 140 + 0.5*(260 - 20*0.8) ; k1 same game at half: 0 + 0.5*(2.5 + 3*1.6)
  near(pcs.passing[1], 140 + 0.5 * (260 - 16), 1e-9, 'passing');
  near(pcs.kicking[1], 0.5 * (2.5 + 4.8), 1e-9, 'kicking');
  near(pcs.tds[1], 1 + 0.5 * 1.8 + 1 * 0.6, 1e-9, 'tds');
  near(pcs.rem[1], 0.5 + 1 + 0.5, 1e-9, 'rem');
  // variance scales with the unplayed share: half a game is half the variance
  const full = blendProjections(matchups, {}, proj, prog(1, 1, 1));
  const half = blendProjections(matchups, {}, proj, prog(0.5, 1, 1));
  const q1var = k => full.var[k][1] - half.var[k][1];
  near(q1var('tds'), 0.5 * (1.8 + 0.6) - 0.5 * 0.6 - 0 /* r1 unchanged */, 1e-6, 'td var delta');
});
test('a starter with no projection contributes his actuals and no unplayed share', () => {
  const m = [{ roster_id: 9, matchup_id: 5, starters: ['zz'] }];
  const pcs = blendProjections(m, { zz: { rec_yd: 30 } }, proj, prog(1, 1, 1));
  assert.strictEqual(pcs.receiving[9], 30); assert.strictEqual(pcs.rem[9], 0); assert.strictEqual(pcs.var.receiving[9], 0);
});

section('game state');
test('ESPN status → unplayed share', () => {
  assert.strictEqual(gameRemainingFromEspn({ type: { state: 'pre' } }), 1);
  assert.strictEqual(gameRemainingFromEspn({ type: { state: 'post' }, period: 4, clock: 0 }), 0);
  near(gameRemainingFromEspn({ type: { state: 'in' }, period: 2, clock: 0 }), 0.5, 1e-9, 'halftime');
  near(gameRemainingFromEspn({ type: { state: 'in' }, period: 1, clock: 900 }), 1, 1e-9, 'kickoff');
  near(gameRemainingFromEspn({ type: { state: 'in' }, period: 4, clock: 120 }), 120 / 3600, 1e-9, 'two minutes left');
  assert.ok(gameRemainingFromEspn({ type: { state: 'in' }, period: 5, clock: 600 }) <= 0.15, 'OT is a short tail');
  assert.ok(gameRemainingFromEspn({ type: { state: 'in' }, period: 4, clock: 0 }) > 0, 'never 0 until final');
  assert.strictEqual(gameRemainingFromEspn(null), 1);
});
test('gameRemaining falls back: game_id → team → week done?', () => {
  const p = { rem: { X: 0.25 }, byTeam: { KC: 0 }, weekDone: false };
  assert.strictEqual(gameRemaining(p, 'X', 'KC'), 0.25);
  assert.strictEqual(gameRemaining(p, 'nope', 'KC'), 0);
  assert.strictEqual(gameRemaining(p, 'nope', 'ZZ'), 1);
  assert.strictEqual(gameRemaining({ rem: {}, byTeam: {}, weekDone: true }, 'nope', 'ZZ'), 0);
  assert.strictEqual(gameRemaining(null, 'X', 'KC'), 1);
});
test('loadGameProgress merges Sleeper status with the ESPN clock and maps WSH→WAS', async () => {
  const sched = [
    { week: 1, game_id: '1', home: 'PHI', away: 'WAS', status: 'pre_game' },
    { week: 1, game_id: '2', home: 'KC',  away: 'DEN', status: 'complete' },
    { week: 1, game_id: '3', home: 'SEA', away: 'NE',  status: 'in_game' },   // no ESPN row → half
    { week: 2, game_id: '4', home: 'KC',  away: 'BUF', status: 'pre_game' },  // wrong week, ignored
  ];
  const board = { events: [
    { competitions: [{ status: { type: { state: 'in' }, period: 3, clock: 900 },
      competitors: [{ homeAway: 'home', team: { abbreviation: 'PHI' } }, { homeAway: 'away', team: { abbreviation: 'WSH' } }] }] },
    { competitions: [{ status: { type: { state: 'post' } },
      competitors: [{ homeAway: 'home', team: { abbreviation: 'MIA' } }, { homeAway: 'away', team: { abbreviation: 'LV' } }] }] },  // not in schedule
  ] };
  ctx.fetch = async url => ({ ok: true, json: async () => (String(url).includes('schedule') ? sched : board) });
  return loadGameProgress(2026, 1).then(p => {
    near(p.rem['1'], 0.5, 1e-9, 'ESPN clock refines a pre_game row');
    assert.strictEqual(p.rem['2'], 0);
    assert.strictEqual(p.rem['3'], 0.5);
    assert.strictEqual(p.rem['4'], undefined);
    assert.strictEqual(p.byTeam.WAS, 0.5, 'WSH mapped to WAS via the away side');
    assert.strictEqual(p.byTeam.MIA, 0, 'ESPN-only game reachable by team');
    assert.strictEqual(p.byTeam.LV, 0);
    assert.strictEqual(p.weekDone, false);
  });
});
test('loadGameProgress survives both feeds failing', async () => {
  ctx.fetch = async () => { throw new Error('down'); };
  return loadGameProgress(2026, 1).then(p => {
    assert.strictEqual(Object.keys(p.rem).length, 0); assert.strictEqual(p.weekDone, false);
    assert.strictEqual(gameRemaining(p, 'A', 'KC'), 1, 'no state → full projection, as before');
  });
});

section('winProbability');
test('probabilities are complementary and symmetric under swapping teams', () => {
  const pcs = blendProjections(matchups, { q1: { pass_yd: 90 } }, proj, prog(0.6, 1, 1));
  const a = winProbability(pcs, 1, 2), b = winProbability(pcs, 2, 1);
  near(a.p1 + a.p2, 1, 1e-9); near(a.p1, b.p2, 1e-9); near(a.p2, b.p1, 1e-9);
  assert.ok(a.p1 > 0 && a.p1 < 1);
});
test('a finished week is 0/1 and agrees with calcResult', () => {
  const stats = { q1: { pass_yd: 301, pass_td: 3 }, r1: { rush_yd: 44 }, k1: { xpm: 4, fgm: 1 },
                  q2: { pass_yd: 188, pass_td: 1 }, w2: { rec_yd: 121, rec_td: 1 }, k2: { xpm: 1, fgm: 3 } };
  const pcs = blendProjections(matchups, stats, proj, prog(0, 0, 0));
  const r = calcResult(pcs, 1, 2);
  const wp = winProbability(pcs, 1, 2);
  assert.strictEqual(wp.p1, r.s1dec > r.s2dec ? 1 : 0);
  assert.deepStrictEqual(decidedWinProb(r), wp);
});
test('three categories locked → 100% with games still to play', () => {
  // Team 1 has already won passing, rushing and receiving outright (those starters are done);
  // only the kickers are still to play, and TDs are level with variance left.
  const m = [
    { roster_id: 1, matchup_id: 1, starters: ['q1', 'k1'] },
    { roster_id: 2, matchup_id: 1, starters: ['q2', 'k2'] },
  ];
  const pr = { stats: { q1: projStats.q1, q2: projStats.q2, k1: projStats.k1, k2: projStats.k2 },
               game: { q1: 'A', q2: 'A', k1: 'B', k2: 'B' }, team: {}, at: 0 };
  const stats = { q1: { pass_yd: 300, rush_yd: 20, rec_yd: 5, pass_td: 2 }, q2: { pass_yd: 100, rush_yd: 1, rec_yd: 0, pass_td: 2 } };
  const pcs = blendProjections(m, stats, pr, { rem: { A: 0, B: 1 }, byTeam: {}, weekDone: false });
  assert.ok(pcs.rem[1] > 0, 'kicker still to play');
  near(winProbability(pcs, 1, 2).p1, 1, 1e-9, 'locked');
  near(winProbability(pcs, 2, 1).p1, 0, 1e-9, 'locked, other side');
});
test('a lead gets safer as the clock runs', () => {
  const stats = { q1: { pass_yd: 200 }, q2: { pass_yd: 100 } };   // team 1 ahead in passing
  const early = winProbability(blendProjections(matchups, stats, proj, prog(0.9, 1, 0.9)), 1, 2).p1;
  const late  = winProbability(blendProjections(matchups, stats, proj, prog(0.1, 1, 0.1)), 1, 2).p1;
  assert.ok(late > early, `late ${late} should exceed early ${early}`);
});
test('an exact dead heat with nothing left is 50/50', () => {
  const m = [{ roster_id: 1, matchup_id: 1, starters: ['a'] }, { roster_id: 2, matchup_id: 1, starters: ['b'] }];
  const pr = { stats: { a: { rec_yd: 1 }, b: { rec_yd: 1 } }, game: { a: 'A', b: 'A' }, team: {}, at: 0 };
  const pcs = blendProjections(m, { a: { rec_yd: 50 }, b: { rec_yd: 50 } }, pr, { rem: { A: 0 }, byTeam: {}, weekDone: true });
  near(winProbability(pcs, 1, 2).p1, 0.5, 1e-9);
});

section('matchupCard');
S.rosterMap = { 1: 'Alpha', 2: 'Bravo' }; S.seasonIdx = 0; S.currentWeek = 1; S.selectedWeek = 1; S.seasonStarted = true;
const liveStats = { q1: { pass_yd: 140, pass_td: 1 } };
const cs = calcCatStats(matchups.map(m => ({ ...m, players_points: { q1: 0 } })), liveStats);
test('live week, projections not yet in: no bar, no projection lines', () => {
  const html = matchupCard(1, 2, cs, null);
  assert.ok(!html.includes('mc-wp'), 'no bar'); assert.ok(!html.includes('mc-proj'), 'no proj');
});
test('live week with projections: bar + projection lines, live percentages never 0 or 100', () => {
  const pcs = blendProjections(matchups, liveStats, proj, prog(0.5, 1, 1));
  const html = matchupCard(1, 2, cs, pcs);
  assert.ok(html.includes('class="mc-wp"'), 'bar present, not decided');
  assert.ok(html.includes('mc-proj'), 'projection lines present');
  const pcts = [...html.matchAll(/(\d+)%<\/span>/g)].map(m => Number(m[1]));
  assert.strictEqual(pcts.length, 2); assert.strictEqual(pcts[0] + pcts[1], 100);
  assert.ok(pcts.every(p => p >= 1 && p <= 99));
  assert.ok(/mc-wp-fill" style="width:\d+%"/.test(html));
});
test('both lineups finished: decided bar at 100/0, projection lines gone', () => {
  const stats = { q1: { pass_yd: 301, pass_td: 3 }, r1: { rush_yd: 44 }, k1: { xpm: 4, fgm: 1 },
                  q2: { pass_yd: 188, pass_td: 1 }, w2: { rec_yd: 121, rec_td: 1 }, k2: { xpm: 1, fgm: 3 } };
  const cs2 = calcCatStats(matchups.map(m => ({ ...m, players_points: Object.fromEntries(m.starters.map(p => [p, 0])) })), stats);
  const pcs = blendProjections(matchups, stats, proj, prog(0, 0, 0));
  const html = matchupCard(1, 2, cs2, pcs);
  assert.ok(html.includes('mc-wp decided'), 'decided');
  assert.ok(!html.includes('mc-proj') && !html.includes('proj-bar'), 'no projections on a final');
  const r = calcResult(cs2, 1, 2);
  const want = r.s1dec > r.s2dec ? ['100%', '0%'] : ['0%', '100%'];
  assert.ok(html.includes(`>${want[0]}</span>`) && html.includes(`>${want[1]}</span>`), html);
});
test('past week: decided bar from the result, no projections requested', () => {
  S.selectedWeek = 1; S.currentWeek = 3;
  const html = matchupCard(1, 2, cs, null);
  assert.ok(html.includes('mc-wp decided'), 'past weeks are decided');
  assert.ok(!html.includes('mc-proj'));
  S.currentWeek = 1;
});

(async () => {
  for (const t of queue) {
    if (t.label) { console.log(t.label); continue; }
    try { await t.fn(); passed++; console.log('  ✓ ' + t.name); }
    catch (e) { console.log('  ✗ ' + t.name); console.error(e); process.exit(1); }
  }
  console.log(`\n${passed} passed`);
})();
