#!/usr/bin/env node
'use strict';
// The Wednesday-morning week rollover. Runs the shipped partials in a vm.
//   Run:  node tests/test_week_clock.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Math, Date, Intl, Number, String, Object, Array, JSON, Error, RegExp });
for (const f of ['00-config.js', '12-week-clock.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const g = n => vm.runInContext(n, ctx);
const calendarWeek = g('calendarWeek'), heldWeek = g('heldWeek'), etClock = g('etClock');

let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name); console.error(e); process.exit(1); } }
// An instant from an Eastern wall-clock time (EDT until the first Sunday of November).
const et = (iso, edt = true) => Date.parse(iso + (edt ? '-04:00' : '-05:00'));
const START = '2026-09-09';   // the Wednesday before the 2026 opener

test('etClock reads the Eastern date and hour', () => {
  const c = etClock(et('2026-09-15T05:30:00'));
  assert.deepStrictEqual([c.y, c.m, c.d, c.h], [2026, 9, 15, 5]);
  const m = etClock(et('2026-09-16T00:10:00'));
  assert.strictEqual(m.h, 0, 'midnight is hour 0, not 24');
});
test('week 1 runs from the opener through Monday night and into Tuesday', () => {
  assert.strictEqual(calendarWeek(START, et('2026-09-10T20:15:00')), 1, 'Thursday kickoff');
  assert.strictEqual(calendarWeek(START, et('2026-09-14T23:30:00')), 1, 'Monday night');
  assert.strictEqual(calendarWeek(START, et('2026-09-15T12:00:00')), 1, 'all of Tuesday');
  assert.strictEqual(calendarWeek(START, et('2026-09-16T05:59:00')), 1, 'Wednesday before the rollover hour');
});
test('the week turns over at the rollover hour on Wednesday morning, Eastern', () => {
  assert.strictEqual(calendarWeek(START, et('2026-09-16T06:00:00')), 2);
  assert.strictEqual(calendarWeek(START, et('2026-09-16T06:00:00') - 1000), 1, 'a second earlier is still week 1');
  assert.strictEqual(calendarWeek(START, et('2026-09-23T06:00:00')), 3);
  assert.strictEqual(calendarWeek(START, et('2026-12-16T06:00:00', false)), 15, 'after the clocks change too');
  assert.strictEqual(calendarWeek(START, et('2026-12-16T05:00:00', false)), 14);
});
test('before the season it is week 1; a bad date is null; a Thursday start snaps to Wednesday', () => {
  assert.strictEqual(calendarWeek(START, et('2026-08-01T12:00:00')), 1);
  assert.strictEqual(calendarWeek('', 0), null);
  assert.strictEqual(calendarWeek('2026-09-10', et('2026-09-16T06:00:00')), 2, 'opening Thursday given instead');
  assert.strictEqual(calendarWeek('2026-09-10', et('2026-09-16T05:00:00')), 1);
});
test('heldWeek caps Sleeper\'s week by the calendar, and only for the season in view', () => {
  const state = { season: '2026', season_start_date: START };
  assert.strictEqual(heldWeek(2, state, '2026', et('2026-09-15T12:00:00')), 1, 'Tuesday: Sleeper says 2, the app stays on 1');
  assert.strictEqual(heldWeek(2, state, '2026', et('2026-09-16T07:00:00')), 2, 'Wednesday morning: turned over');
  assert.strictEqual(heldWeek(2, state, '2026', et('2026-10-30T12:00:00')), 2, 'the calendar never runs AHEAD of Sleeper');
  assert.strictEqual(heldWeek(14, state, '2025', et('2026-09-15T12:00:00')), 14, 'a past season opens on its last week');
  assert.strictEqual(heldWeek(2, null, '2026', et('2026-09-15T12:00:00')), 2, 'no state → Sleeper\'s week');
  assert.strictEqual(heldWeek(0, state, '2026', et('2026-09-15T12:00:00')), 1, 'never below 1');
});
console.log(`\n${passed} passed`);
