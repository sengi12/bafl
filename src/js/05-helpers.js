// ─── Helpers ──────────────────────────────────────────────────────────────
async function fetchJ(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${url}`);
  return r.json();
}

// Same as fetchJ but resolves to `fallback` instead of throwing. Used for the optional
// enrichment calls (ESPN draft info, projections) where a failure should quietly degrade the
// view rather than blow up the render that requested it.
async function fetchSoft(url, fallback = null) {
  try { return await fetchJ(url); } catch { return fallback; }
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Escape for use inside a double-quoted HTML attribute (title=, aria-label=).
function escAttr(s) { return esc(s).replace(/'/g, '&#39;'); }
// Escape for a single-quoted JS string argument inside an onclick="" attribute.
function jsArg(s) {
  return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;') + "'";
}
function fmtPts(v) {
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}
// Round to a fixed number of decimals but drop a trailing ".0" — keeps stat cells narrow.
function fmtNum(v, dp = 0) {
  if (v == null || !Number.isFinite(Number(v))) return '–';
  const n = Number(v);
  return Number.isInteger(n) ? String(n) : n.toFixed(dp);
}

// ─── Toast ────────────────────────────────────────────────────────────────
// A transient status line, so background failures (a player DB that won't load, a season with
// no data) can report themselves without wiping out whatever the user is looking at.
function toast(msg, type = '') {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.borderColor = type === 'ok' ? 'var(--success)'
                       : type === 'err' ? 'var(--danger)' : 'var(--border)';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Image fallback chain ─────────────────────────────────────────────────
// Headshot sources fail constantly — Sleeper has no photo for most rookies, ESPN 404s for
// players it hasn't ingested. Rather than one URL and a blank circle, every <img> carries a
// pipe-separated `data-fallbacks` list and walks it on error, hiding only once exhausted.
function imgFallback(img) {
  const list = (img.dataset.fallbacks || '').split('|').filter(Boolean);
  if (list.length) {
    img.dataset.fallbacks = list.slice(1).join('|');
    img.src = list[0];
  } else {
    img.onerror = null;
    img.style.visibility = 'hidden';
    const sib = img.nextElementSibling;
    if (sib && sib.classList.contains('hs-err')) sib.style.display = 'flex';
  }
}
// Build the ordered headshot URL list for a player: Sleeper first (best coverage for actives),
// then ESPN NFL, then ESPN college (which is where recent draftees actually have a photo).
function headshotPack(pid, p) {
  const urls = [];
  const add = u => { const s = String(u || '').trim(); if (s && !urls.includes(s)) urls.push(s); };
  if (pid) add(SLEEPER_HEADSHOT_THUMB(pid));
  const aid = p && p.espn_id ? String(p.espn_id) : '';
  if (aid) { add(ESPN_HEADSHOT('nfl', aid)); add(ESPN_HEADSHOT('college-football', aid)); }
  return { src: urls[0] || '', fallbacks: urls.slice(1) };
}
// <img> with the fallback chain wired up, plus an initials placeholder that reveals itself
// once every source has failed.
function headshotImg(pid, p, cls, placeholder) {
  const pack = headshotPack(pid, p);
  const ph = `<div class="hs-err ${cls}-err">${esc(placeholder || '?')}</div>`;
  if (!pack.src) return ph.replace('class="hs-err', 'style="display:flex" class="hs-err');
  return `<img class="${cls}" src="${pack.src}" alt="" loading="lazy" decoding="async"
    data-fallbacks="${pack.fallbacks.join('|')}" onerror="imgFallback(this)">${ph}`;
}

// ─── Stat grading ─────────────────────────────────────────────────────────
// Every graded stat cell in the app resolves to one of three classes — 'g' (good), 'y' (ok),
// 'r' (poor) — or '' for "don't grade this". Thresholds are per-GAME values, so the same
// function grades a weekly row and a per-game average identically.
function triHigh(v, goodAt, okAt) {   // higher is better
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return n >= goodAt ? 'g' : n >= okAt ? 'y' : 'r';
}
function triLow(v, goodBelow, okBelow) {   // lower is better (INTs thrown, sacks taken)
  if (v == null || !Number.isFinite(Number(v))) return '';
  const n = Number(v);
  return n <= goodBelow ? 'g' : n <= okBelow ? 'y' : 'r';
}

// 1 → "1st", 2 → "2nd", 22 → "22nd".
function ordinal(n) {
  if (n == null) return '';
  const s = n % 100;
  const suff = (s >= 11 && s <= 13) ? 'th' : (n % 10 === 1) ? 'st' : (n % 10 === 2) ? 'nd' : (n % 10 === 3) ? 'rd' : 'th';
  return n + suff;
}
