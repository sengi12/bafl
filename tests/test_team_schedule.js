#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error, parseInt,
  window: {}, document: { addEventListener() {}, getElementById: () => null },
  fetch: async () => { throw new Error('unexpected fetch'); },
});
for (const file of ['00-config.js', '05-helpers.js', '50-stats.js', '41-team-schedule.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', file), 'utf8'), ctx, { filename: file });
}
const run = expression => vm.runInContext(expression, ctx);

const weeks = {
  1: [
    { roster_id: 1, matchup_id: 10 }, { roster_id: 2, matchup_id: 10 },
    { roster_id: 3, matchup_id: 11 }, { roster_id: 4, matchup_id: 11 },
  ],
  2: [
    { roster_id: 1, matchup_id: 20 }, { roster_id: 3, matchup_id: 20 },
    { roster_id: 2, matchup_id: 21 }, { roster_id: 4, matchup_id: 21 },
  ],
};
ctx.fixtureWeeks = weeks;
ctx.fixtureDh = { 2: [{ r1: 1, r2: 4 }, { r1: 2, r2: 3 }] };
const games = run('scheduleGames(fixtureWeeks, fixtureDh, 1)');
assert.strictEqual(JSON.stringify(games), JSON.stringify([
  { week: 1, opponent: 2, dh: false },
  { week: 2, opponent: 3, dh: false },
  { week: 2, opponent: 4, dh: true },
]));

ctx.fixtureCats = {
  passing: { 1: 200, 2: 100 }, receiving: { 1: 50, 2: 75 },
  rushing: { 1: 80, 2: 60 }, tds: { 1: 2, 2: 1 }, kicking: { 1: 4, 2: 8 },
};
assert.strictEqual(JSON.stringify(run('scheduleOutcome(fixtureCats, 1, 2, false)')),
  JSON.stringify({ state: 'win', label: 'WIN', score: '3–2' }));
assert.strictEqual(JSON.stringify(run('scheduleOutcome(fixtureCats, 2, 1, true)')),
  JSON.stringify({ state: 'loss', label: 'Projected LOSS', score: '2–3' }));

console.log('2 passed');