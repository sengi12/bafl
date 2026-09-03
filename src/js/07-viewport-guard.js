// ─── Viewport tracking + scroll containment ───────────────────────────────
// Ported from TripleCrown. Two jobs, both about phones, both app-wide so no overlay has to
// carry its own copy of the logic.
//
// 1. --vvh: the VISIBLE viewport height, as a CSS variable. Every overlay sizes itself from
//    it (72-player-card.css and friends). 100vh on iOS includes the strip behind the
//    collapsing URL bar; dvh fixes that but not the on-screen keyboard; visualViewport is
//    the one measure that tracks both, so it wins whenever the browser provides it.
//
// 2. A document-level scroll guard. While an overlay is up, a swipe or wheel must never move
//    the page behind it. The CSS lock (html.pc-locked) handles most of it declaratively; this
//    catches what CSS can't express — a gesture that starts on a non-scrolling part of the
//    overlay (the hero, a tab row, the backdrop) and would otherwise chain out to the page —
//    and, with nothing open, kills iOS's rubber-band at the page edges, which is what reads as
//    "the whole app bouncing" after a fling.

// ── 1. The visible viewport ──────────────────────────────────────────────
(function trackVisibleViewport() {
  const root = document.documentElement;
  let raf = 0;
  function apply() {
    raf = 0;
    const vv = window.visualViewport;
    // A pinch-zoomed viewport is small because the user zoomed, not because the screen is —
    // don't shrink the overlays to match; wait for the zoom to reset.
    const zoomed = !!(vv && vv.scale && Math.abs(vv.scale - 1) > 0.02);
    const h = (vv && !zoomed && vv.height) || window.innerHeight || 0;
    if (h > 0) root.style.setProperty('--vvh', `${Math.round(h)}px`);
  }
  // Coalesced to one write per frame: iOS fires visualViewport resize continuously while the
  // toolbar animates, and each write invalidates every overlay's layout.
  function schedule() { if (!raf) raf = requestAnimationFrame(apply); }
  apply();
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('orientationchange', schedule, { passive: true });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', schedule, { passive: true });
})();

// ── 2. Scroll guard ──────────────────────────────────────────────────────
// The floating surfaces. The roster overlay is always in the DOM (display:none until active),
// so visibility is checked rather than presence.
const FLOAT_SEL = '.pc-overlay,.roster-overlay,.ps-overlay';
let _sgLastY = null, _sgLastX = null;
let _sgFloaters = null;                  // visible floaters, resolved once per gesture
let _sgInner = null, _sgInnerFor = null; // nearest scrollable ancestor of the touchstart target
let _sgFloatOk = null;                   // floater-branch verdict, cached lazily per gesture

function sgVisibleFloaters() {
  const out = [];
  try {
    document.querySelectorAll(FLOAT_SEL).forEach(f => { if (f.offsetWidth || f.offsetHeight) out.push(f); });
  } catch { /* no DOM — nothing to guard */ }
  return out;
}
// Touch events dispatch to the touchstart element for the whole gesture, so everything the
// guard needs about the target can be resolved ONCE here rather than per touchmove at 60-120Hz
// (the ancestor walk below calls getComputedStyle, a forced style recalc mid-scroll).
function sgTouchAnchor(e) {
  const t = e.touches && e.touches[0];
  _sgLastY = t ? t.clientY : null; _sgLastX = t ? t.clientX : null;
  _sgFloaters = sgVisibleFloaters();
  _sgInnerFor = e.target || null;
  _sgInner = sgInnerScrollerEl(e.target);
  _sgFloatOk = null;
}
// The nearest ancestor that actually scrolls, or null when the gesture belongs to the page.
function sgInnerScrollerEl(el) {
  let n = (el && el.nodeType === 1) ? el : (el && el.parentElement);
  while (n && n !== document.body && n !== document.documentElement) {
    if (n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1) {
      let st = null; try { st = getComputedStyle(n); } catch { /* detached */ }
      if (st && (/(auto|scroll)/.test(st.overflowY) || /(auto|scroll)/.test(st.overflowX))) return n;
    }
    n = n.parentElement;
  }
  return null;
}
// Should this drag be cancelled? Only a pull PAST the scroller's edge on the gesture's dominant
// axis — that pull is what starts iOS's rubber-band and the chain into the page. An in-range
// scroll is never touched. Returns 'page' when the scroller can't handle the dominant axis.
function sgEdgeCancel(sc, dx, dy) {
  const vert = Math.abs(dy) >= Math.abs(dx);
  if (vert) {
    if (!(sc.scrollHeight > sc.clientHeight + 1)) return 'page';
    const atTop = sc.scrollTop <= 0, atBot = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1;
    return ((atTop && dy > 0) || (atBot && dy < 0));
  }
  if (!(sc.scrollWidth > sc.clientWidth + 1)) return 'page';
  const atL = sc.scrollLeft <= 0, atR = sc.scrollLeft + sc.clientWidth >= sc.scrollWidth - 1;
  return ((atL && dx > 0) || (atR && dx < 0));
}
function sgScrollGuard(e) {
  // Touch gestures reuse the touchstart snapshot; wheel events (no gesture anchor) resolve fresh.
  const floaters = (e.type === 'touchmove' && _sgFloaters) ? _sgFloaters : sgVisibleFloaters();
  if (!floaters.length) {
    // Nothing open. One job remains, touch only: cancel the rubber-band — a pull past an edge,
    // whether the edge belongs to an inner scroller (a game log, the standings grid) or to the
    // page itself. Never cancel an in-range scroll.
    if (e.type !== 'touchmove' || _sgLastY == null) return;
    const t0 = e.touches && e.touches[0]; if (!t0) return;
    const dy = t0.clientY - _sgLastY, dx = t0.clientX - (_sgLastX != null ? _sgLastX : t0.clientX);
    _sgLastY = t0.clientY; _sgLastX = t0.clientX;
    if (!dy && !dx) return;
    const inner = (e.target === _sgInnerFor) ? _sgInner : sgInnerScrollerEl(e.target);
    if (inner) {
      const verdict = sgEdgeCancel(inner, dx, dy);
      if (verdict === true) { if (e.cancelable) e.preventDefault(); return; }
      if (verdict === false) return;             // the scroller owns it, in range
      // 'page': the scroller can't handle this axis — fall through to the page edges.
    }
    if (Math.abs(dy) < Math.abs(dx)) return;      // horizontal on the page: nothing to bounce
    const sc = document.scrollingElement || document.documentElement;
    const atTop = sc.scrollTop <= 0, atBottom = sc.scrollTop + window.innerHeight >= sc.scrollHeight - 1;
    if ((atTop && dy > 0) || (atBottom && dy < 0)) { if (e.cancelable) e.preventDefault(); }
    return;
  }
  const t = e.target;
  let within = null;
  floaters.forEach(f => { if (f.contains(t)) within = f; });
  if (!within) { if (e.cancelable) e.preventDefault(); return; }   // the backdrop: never scrolls
  // Inside the surface: fine as long as the gesture lands in something that can actually
  // scroll on either axis (cards hold horizontally-scrolling tables). The verdict is constant
  // for a touch gesture, so it's computed once and reused.
  let ok;
  if (e.type === 'touchmove' && t === _sgInnerFor && _sgFloatOk !== null) {
    ok = _sgFloatOk;
  } else {
    ok = false;
    let n = (t && t.nodeType === 1) ? t : (t && t.parentElement);
    while (n) {
      const canY = n.scrollHeight > n.clientHeight + 1, canX = n.scrollWidth > n.clientWidth + 1;
      if (canY || canX) {
        let st = null; try { st = getComputedStyle(n); } catch { /* detached */ }
        if (st && ((canY && /(auto|scroll)/.test(st.overflowY)) || (canX && /(auto|scroll)/.test(st.overflowX)))) { ok = true; break; }
      }
      if (n === within) break;
      n = n.parentElement;
    }
    if (e.type === 'touchmove' && t === _sgInnerFor) _sgFloatOk = ok;
  }
  if (ok) return;
  if (e.cancelable) e.preventDefault();
}
try {
  document.addEventListener('touchstart', sgTouchAnchor, { passive: true });
  // NON-passive on purpose: a passive listener can't call preventDefault.
  document.addEventListener('touchmove', sgScrollGuard, { passive: false });
  document.addEventListener('wheel', sgScrollGuard, { passive: false });
} catch { /* no DOM */ }
