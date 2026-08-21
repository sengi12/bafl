// ─── Player search ────────────────────────────────────────────────────────
// Type a name, get every matching NFL player with the one piece of information this league
// actually wants: WHO ROSTERS HIM. Rostered players sort to the top and carry their BAFL
// owner; everyone else reads "Free agent". Clicking a result opens the player card.
let psOpen = false;
let psRosteredOnly = false;

// Normalized name matching, so "aj brown", "A.J. Brown" and "aj brown jr" all match.
function psNorm(s) {
  return String(s || '').toLowerCase()
    .replace(/[.'\-]/g, '')
    .replace(/\s+(jr|sr|ii|iii|iv|v)$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function openPlayerSearch() {
  if (psOpen) return;
  if (!S.playersCache) {
    try { await loadPlayers(); }
    catch { toast('Player data still loading — try again in a moment', 'err'); return; }
  }
  psOpen = true;
  const ov = document.createElement('div');
  ov.id = 'psOverlay';
  ov.className = 'ps-overlay';
  ov.innerHTML = `
    <div class="ps-modal" role="dialog" aria-label="Search players">
      <div class="ps-head">
        <span class="ps-ico">🔍</span>
        <input id="psInput" class="ps-input" type="text" autocomplete="off" spellcheck="false"
               placeholder="Search any NFL player…" aria-label="Player name">
        <button id="psRosterToggle" class="ps-toggle" onclick="psToggleRostered()"
                aria-pressed="false" title="Show only players rostered in BAFL">BAFL</button>
        <button class="ps-close" onclick="closePlayerSearch()" aria-label="Close">✕</button>
      </div>
      <div id="psResults" class="ps-results"></div>
    </div>`;
  ov.addEventListener('mousedown', e => { if (e.target === ov) closePlayerSearch(); });
  document.body.appendChild(ov);
  pcLockPage(true);
  const inp = document.getElementById('psInput');
  inp.addEventListener('input', () => psRender(inp.value));
  inp.addEventListener('keydown', psKey);
  psRender('');
  setTimeout(() => inp.focus(), 30);
}

function closePlayerSearch() {
  psOpen = false;
  const el = document.getElementById('psOverlay');
  if (el) el.remove();
  if (!PC && !document.getElementById('rosterOverlay')?.classList.contains('active')) pcLockPage(false);
}
function psToggleRostered() {
  psRosteredOnly = !psRosteredOnly;
  const btn = document.getElementById('psRosterToggle');
  if (btn) { btn.classList.toggle('on', psRosteredOnly); btn.setAttribute('aria-pressed', String(psRosteredOnly)); }
  psRender(document.getElementById('psInput')?.value || '');
}
function psKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closePlayerSearch(); return; }
  if (e.key === 'Enter') {
    const first = document.querySelector('#psResults .ps-row');
    if (first) first.click();
  }
}

// With no query, show the league itself — every rostered player — which doubles as a quick
// "who's on a roster right now" view. With a query, search the whole NFL.
function psCandidates(q) {
  const players = S.playersCache || {};
  const nq = psNorm(q);
  const out = [];
  for (const pid in players) {
    const p = players[pid];
    const owned = !!(S.ownerByPid && S.ownerByPid[pid]);
    if (psRosteredOnly && !owned) continue;
    if (!nq) { if (owned) out.push({ pid, p, owned }); continue; }
    const n = psNorm(p.name);
    if (!n.includes(nq)) continue;
    out.push({ pid, p, owned, exact: n.startsWith(nq) });
  }
  out.sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;          // rostered first
    if (!!a.exact !== !!b.exact) return a.exact ? -1 : 1;      // then prefix matches
    return (a.p.name || '').localeCompare(b.p.name || '');
  });
  return out;
}

function psRender(q) {
  const el = document.getElementById('psResults');
  if (!el) return;
  const all = psCandidates(q);
  const CAP = 60;
  const hits = all.slice(0, CAP);
  if (!hits.length) {
    el.innerHTML = `<div class="ps-empty">${q ? 'No players match that name.' : 'No rostered players loaded yet.'}</div>`;
    return;
  }
  el.innerHTML = hits.map(({ pid, p, owned }) => {
    const pos = (p.pos || '?').toUpperCase();
    const own = owned ? ownerOf(pid) : null;
    const ownTag = own
      ? `<span class="ps-owner">${esc(own.name)}</span>`
      : `<span class="ps-owner ps-fa">FA</span>`;
    return `<div class="ps-row" onclick="closePlayerSearch();openPlayerCard(${jsArg(pid)})">
      ${headshotImg(pid, p, 'ps-hs', (p.name || '?')[0])}
      <span class="pos-badge pos-${esc(pos)}">${esc(pos)}</span>
      <div class="ps-name-block">
        <span class="ps-name">${esc(p.name || pid)}</span>
        <span class="ps-team">${esc(p.team || 'FA')}</span>
      </div>
      ${ownTag}
    </div>`;
  }).join('');
  // Never silently truncate: say so, so an absent player reads as "narrow your search" rather
  // than "he isn't in the database".
  if (all.length > CAP) {
    el.innerHTML += `<div class="ps-more">Showing ${CAP} of ${all.length} matches — keep typing to narrow.</div>`;
  }
}
