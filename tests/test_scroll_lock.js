#!/usr/bin/env node
'use strict';
// The page-scroll lock keeps the scroll position across stacked overlays.
//   Run:  node tests/test_scroll_lock.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.join(__dirname, '..');
const classes = new Set(), styles = {};
let scrollY = 0; const scrolledTo = [];
const el = () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, innerHTML: '', querySelector: () => null, querySelectorAll: () => [] });
const ctx = vm.createContext({
  console, Math, Date, Map, Set, Number, String, Object, Array, Promise, JSON, Error, RegExp, CSS: { escape: s => s },
  document: {
    documentElement: { classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle() {} },
      style: { setProperty: (k, v) => { styles[k] = v; }, removeProperty: k => { delete styles[k]; } }, scrollTop: 0 },
    scrollingElement: null, body: el(), getElementById: () => el(), querySelector: () => null, querySelectorAll: () => [], addEventListener() {},
  },
  window: { get scrollY() { return scrollY; }, scrollTo: (x, y) => { scrolledTo.push(y); scrollY = y; }, addEventListener() {}, innerHeight: 800 },
  navigator: {}, requestAnimationFrame: f => f(), setTimeout, clearTimeout, fetch: async () => { throw new Error('x'); },
});
for (const f of ['00-config.js', '02-nfl-constants.js', '05-helpers.js', '50-stats.js', '44-player-card.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src/js', f), 'utf8'), ctx, { filename: f });
const pcLockPage = vm.runInContext('pcLockPage', ctx);
let passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  ✓ ' + name); } catch (e) { console.log('  ✗ ' + name); console.error(e); process.exit(1); } }

test('locking records the offset and pins the body; unlocking scrolls back to it', () => {
  scrollY = 1234;
  pcLockPage(true);
  assert.ok(classes.has('pc-locked')); assert.strictEqual(styles['--pc-scroll-y'], '-1234px');
  scrollY = 0;                                  // a fixed body reports no scroll
  pcLockPage(false);
  assert.ok(!classes.has('pc-locked')); assert.strictEqual(styles['--pc-scroll-y'], undefined);
  assert.strictEqual(scrolledTo.pop(), 1234);
});
test('a second lock (card opened over a roster) does not clobber the recorded offset', () => {
  scrollY = 640;
  pcLockPage(true); scrollY = 0;
  pcLockPage(true);                             // the card asks again
  assert.strictEqual(styles['--pc-scroll-y'], '-640px');
  pcLockPage(false);
  assert.strictEqual(scrolledTo.pop(), 640);
  pcLockPage(false);                            // unlocking twice is harmless
  assert.strictEqual(scrolledTo.length, 0);
});
console.log(`\n${passed} passed`);
