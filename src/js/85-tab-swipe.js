// ─── Swipe between tabs ───────────────────────────────────────────────────
// Ported from TripleCrown. The gesture itself is trivial; knowing when NOT to fire is the
// whole job:
//   • horizontal scrollers (the standings grid, a game-log table, the bracket) must win — a
//     swipe that starts inside one is the user scrolling it, not changing tabs;
//   • vertical scrolling must never be hijacked, so the axis is decided before we commit;
//   • once we do commit we claim the gesture with preventDefault, or the browser keeps running
//     pull-to-refresh and back-swipe underneath it;
//   • the iOS left-edge back-swipe can't be reliably cancelled, so we don't engage there at
//     all rather than fighting it and feeling broken.
const TS_COMMIT = 60;   // px of horizontal travel before a tab change commits
const TS_DECIDE = 10;   // px before we decide the gesture's axis
const TS_EDGE   = 24;   // ignore starts this close to the left edge (iOS back-swipe zone)

function tsTabs() { return Array.from(document.querySelectorAll('.tabs .tab')); }

function tsGo(dir) {
  const tabs = tsTabs();
  const i = tabs.findIndex(t => t.classList.contains('active'));
  const next = tabs[i + dir];
  if (!next) return;
  next.click();
}

(function wireTabSwipe() {
  let x0 = null, y0 = null, axis = null, active = false;

  document.addEventListener('touchstart', e => {
    axis = null; active = false; x0 = null;
    if (e.touches.length !== 1) return;
    // Any layer above the page owns its own gestures.
    if (PC || psOpen) return;
    if (document.getElementById('rosterOverlay')?.classList.contains('active')) return;
    const t = e.touches[0];
    if (t.clientX <= TS_EDGE) return;                 // iOS back-swipe zone
    // A swipe beginning inside something that scrolls sideways belongs to that element.
    if (e.target.closest && e.target.closest('.table-scroll,.bkt-scroll,.pc-table-scroll,.mc-table-scroll,.tabs')) return;
    x0 = t.clientX; y0 = t.clientY; active = true;
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!active || x0 == null) return;
    const dx = e.touches[0].clientX - x0;
    const dy = e.touches[0].clientY - y0;
    if (axis === null) {
      if (Math.abs(dx) < TS_DECIDE && Math.abs(dy) < TS_DECIDE) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (axis === 'y') { active = false; return; }   // vertical scroll is never ours
    }
    if (axis === 'x' && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('touchend', e => {
    if (!active || axis !== 'x' || x0 == null) { active = false; return; }
    const dx = (e.changedTouches[0] || {}).clientX - x0;
    active = false;
    if (Math.abs(dx) < TS_COMMIT) return;
    tsGo(dx < 0 ? 1 : -1);   // swipe left → next tab
  }, { passive: true });
})();
