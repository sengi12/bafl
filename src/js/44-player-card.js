// ═══════════════════════════════════════════════════════════════════════════
// Player card
// ═══════════════════════════════════════════════════════════════════════════
// Click any player anywhere in the app and this opens: who he is, where he was drafted, who
// rosters him in BAFL, and what he actually produced — week by week, season by season.
//
// TWO DESIGN CONSTRAINTS SHAPE EVERYTHING BELOW.
//
// 1. NO SEED. There is no pre-baked history file, so every season comes live from Sleeper's
//    per-player weekly endpoint, ONE SEASON PER REQUEST, and only when its tab is clicked.
//    The candidate season list is derived from `years_exp` (see eligibleSeasons) so the tabs
//    render instantly; a season that turns out to be empty greys itself out on first click,
//    which quietly corrects Sleeper's frequently-wrong years_exp.
//
// 2. BAFL SCORING, NOT FANTASY POINTS. This league is scored on five categories, so grading a
//    game on PPR points would be answering a question nobody here asks. The leading column
//    group is the player's BAFL CATEGORY CONTRIBUTION for that game — passing yards net of the
//    interception penalty, rush yards, receiving yards, total TDs, kicking points — graded
//    green/yellow/red against per-position, per-game benchmarks. The raw box score follows.
//
// The card's LAYOUT and mobile behaviour (never off screen, nothing scrolls behind it, swipe
// to dismiss, sticky game-log headers) are shared with TripleCrown — see the sizing contract
// at the top of 72-player-card.css and the scroll guard in 07-viewport-guard.js.
// ═══════════════════════════════════════════════════════════════════════════

// Which BAFL categories a position actually contributes to, and what a good game looks like
// in each.
//
// These per-game thresholds were re-derived from real positional data rather than guessed.
// For each position, take the per-game output of the LAST STARTABLE player at that position
// (rank N, where N is how many the league starts league-wide — see leagueStarterCount) and
// set green at ~1.15x that and yellow at ~0.75x. The originals were guesses and ran badly
// hot: "good" for a tight end was 60 receiving yards in a season where the NFL's best tight
// end averaged 72.9, so even an elite TE was mostly yellow.
//
// Anchors (2025, BAFL's 2QB/2RB/2WR/1TE/2K lineup):
//   QB passing 204/g · RB rushing 60/g · WR receiving 60/g · TE receiving 48/g · K 7.2/g
//                                    [category,   good≥,  ok≥ ]
const PC_CATS_BY_POS = {
  QB: [['passing', 235, 150], ['rushing', 30, 10],  ['tds', 2, 1]],
  RB: [['rushing', 70, 45],   ['receiving', 30, 12], ['tds', 1, 0.5]],
  WR: [['receiving', 70, 45], ['rushing', 15, 5],   ['tds', 1, 0.5]],
  TE: [['receiving', 55, 35], ['rushing', 15, 5],   ['tds', 1, 0.5]],
  K:  [['kicking', 8, 5]],
};
// Total-yardage benchmarks (the BAFL tiebreaker) per position, per game — same derivation.
const PC_TOTAL_BENCH = { QB: [255, 165], RB: [93, 60], WR: [70, 45], TE: [55, 35] };
const PC_CAT_LABEL = { passing: 'PASS', rushing: 'RUSH', receiving: 'REC', tds: 'TD', kicking: 'KICK' };
// Raw box-score columns per position, after the BAFL group. Each column is
// {key, label, grp, get(stats), color(v), fmt(v)}.
const PC_BOX_SCHEMA = {
  QB: {
    groups: ['PASSING', 'RUSHING'],
    cols: [
      { key: 'pass_att', label: 'ATT', grp: 0, color: v => triHigh(v, 35, 25) },
      { key: 'pass_cmp', label: 'CMP', grp: 0, color: v => triHigh(v, 24, 16) },
      { key: '_cmp_pct', label: 'PCT', grp: 0, fmt: v => v == null ? '–' : v.toFixed(1) + '%', color: v => triHigh(v, 68, 58) },
      { key: 'pass_yd',  label: 'YD',  grp: 0, color: v => triHigh(v, 275, 200) },
      { key: 'pass_td',  label: 'TD',  grp: 0, color: v => triHigh(v, 2, 1) },
      { key: 'pass_int', label: 'INT', grp: 0, color: v => triLow(v, 0, 1) },
      { key: 'pass_sack',label: 'SK',  grp: 0, color: v => triLow(v, 1, 3) },
      { key: 'rush_att', label: 'ATT', grp: 1, color: () => '' },
      { key: 'rush_yd',  label: 'YD',  grp: 1, color: v => triHigh(v, 40, 15) },
      { key: '_ru_ypc',  label: 'YPC', grp: 1, fmt: v => v == null ? '–' : v.toFixed(1), color: v => triHigh(v, 5, 3.5) },
      { key: 'rush_td',  label: 'TD',  grp: 1, color: v => triHigh(v, 1, 0.5) },
    ],
  },
  RB: {
    groups: ['RUSHING', 'RECEIVING'],
    cols: [
      { key: 'rush_att', label: 'ATT', grp: 0, color: () => '' },
      { key: 'rush_yd',  label: 'YD',  grp: 0, color: v => triHigh(v, 80, 45) },
      { key: '_ru_ypc',  label: 'YPC', grp: 0, fmt: v => v == null ? '–' : v.toFixed(1), color: v => triHigh(v, 4.5, 3.5) },
      { key: 'rush_lng', label: 'LNG', grp: 0, color: v => triHigh(v, 20, 10) },
      { key: 'rush_td',  label: 'TD',  grp: 0, color: v => triHigh(v, 1, 0.5) },
      { key: 'rec_tgt',  label: 'TAR', grp: 1, color: v => triHigh(v, 5, 3) },
      { key: 'rec',      label: 'REC', grp: 1, color: v => triHigh(v, 4, 2) },
      { key: 'rec_yd',   label: 'YD',  grp: 1, color: v => triHigh(v, 40, 20) },
      { key: 'rec_td',   label: 'TD',  grp: 1, color: v => triHigh(v, 1, 0.5) },
    ],
  },
  WR: {
    groups: ['RECEIVING', 'RUSHING'],
    cols: [
      { key: 'rec_tgt',  label: 'TAR', grp: 0, color: v => triHigh(v, 8, 5) },
      { key: 'rec',      label: 'REC', grp: 0, color: v => triHigh(v, 6, 4) },
      { key: 'rec_yd',   label: 'YD',  grp: 0, color: v => triHigh(v, 80, 50) },
      { key: '_re_ypc',  label: 'YPC', grp: 0, fmt: v => v == null ? '–' : v.toFixed(1), color: v => triHigh(v, 14, 10) },
      { key: 'rec_lng',  label: 'LNG', grp: 0, color: v => triHigh(v, 25, 15) },
      { key: 'rec_td',   label: 'TD',  grp: 0, color: v => triHigh(v, 1, 0.5) },
      { key: 'rush_att', label: 'ATT', grp: 1, color: () => '' },
      { key: 'rush_yd',  label: 'YD',  grp: 1, color: v => triHigh(v, 20, 8) },
      { key: 'rush_td',  label: 'TD',  grp: 1, color: v => triHigh(v, 1, 0.5) },
    ],
  },
  K: {
    groups: ['KICKING'],
    cols: [
      { key: 'fgm',      label: 'FGM', grp: 0, color: v => triHigh(v, 2, 1) },
      { key: 'fga',      label: 'FGA', grp: 0, color: () => '' },
      { key: 'fgm_lng',  label: 'LNG', grp: 0, color: v => triHigh(v, 50, 40) },
      { key: 'xpm',      label: 'XPM', grp: 0, color: () => '' },
      { key: 'xpa',      label: 'XPA', grp: 0, color: () => '' },
      { key: 'fgmiss',   label: 'MISS',grp: 0, color: v => triLow(v, 0, 1) },
    ],
  },
};
PC_BOX_SCHEMA.TE = PC_BOX_SCHEMA.WR;

// Positions with a hand-built box score. Anything else (defenders, punters) still gets a card
// — hero, draft, ownership, BAFL categories — it just falls back to the ESPN gamelog for the
// box score, which is data-driven and covers every position.
function pcHasSchema(pos) { return !!PC_BOX_SCHEMA[String(pos || '').toUpperCase()]; }
function pcCatsForPos(pos) { return PC_CATS_BY_POS[String(pos || '').toUpperCase()] || null; }

// ─── Card state ───────────────────────────────────────────────────────────
let PC = null;        // {pid, pos, team, mode, season, seasons, seasonState:{}} | null
let pcToken = 0;      // bumped per load, so a slow request can't overwrite a newer view

// ─── Open / close ─────────────────────────────────────────────────────────
async function openPlayerCard(pid) {
  pid = String(pid || '');
  if (!pid) return;
  if (!S.playersCache) {
    // The card can't render a hero without the player record; load it, then re-enter.
    try { await loadPlayers(); }
    catch { toast('Player data still loading — try again in a moment', 'err'); return; }
  }
  const p = playerRec(pid);
  if (!p) { toast('No player record found', 'err'); return; }

  // Positions with neither a BAFL category mapping nor a hand-built box score (defenders,
  // punters) have nothing to render from Sleeper's weekly feed — route their NFL tab to ESPN.
  const espnOnly = !pcHasSchema(p.pos) && !pcCatsForPos(p.pos);
  PC = { pid, pos: p.pos || '', team: p.team || '', mode: 'nfl', season: null, seasons: [], seasonState: {}, espnOnly };
  pcLockPage(true);
  renderPcShell(pid, p);

  loadPcDraft(pid);
  if (espnOnly) { renderPcSeasonTabs(); loadPcEspn('nfl'); return; }

  const seasons = await eligibleSeasons(pid);
  if (!PC || PC.pid !== pid) return;   // closed or switched while resolving the season list
  PC.seasons = seasons;
  seasons.forEach(s => { PC.seasonState[s] = 'unknown'; });
  renderPcSeasonTabs();
  pcSelectSeason(seasons[0], { autoAdvance: true });
}

function closePlayerCard() {
  PC = null;
  pcToken++;
  const el = document.getElementById('pcOverlay');
  if (el) el.remove();
  // A card is often opened FROM the roster modal, which stays open behind it. Releasing the
  // scroll lock unconditionally would let the page scroll under a modal that's still up.
  const rosterOpen = document.getElementById('rosterOverlay')?.classList.contains('active');
  if (!rosterOpen) pcLockPage(false);
}

// While the card is open the page behind it must not scroll. Setting body.overflow alone
// isn't enough on iOS — the browser will still run pull-to-refresh from the backdrop — so the
// lock goes on <html> as a class and the CSS pairs it with overscroll-behavior:contain.
function pcLockPage(on) {
  try { document.documentElement.classList.toggle('pc-locked', !!on); } catch { /* no-op */ }
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && PC) closePlayerCard(); });

// ─── Shell ────────────────────────────────────────────────────────────────
// Sleeper-style hero, shared with TripleCrown: an injury BANNER across the top; the name
// stacked on two lines beside a big headshot anchored to the hero's bottom edge on the flat
// team colour; the BAFL owner as a chip under the name; and a FOOT row — a slanted team plate
// (nickname · pos · code · jersey) under the headshot with the draft band beside it. Every
// dimension is a clamp() of the viewport width (72-player-card.css), which is what lets one
// layout serve a 360px phone and a desktop window without a breakpoint.
function renderPcShell(pid, p) {
  const name = p.name || 'Player';
  const pos = (p.pos || '').toUpperCase();
  const tm = (p.team || '').toUpperCase();
  const age = p.age != null ? (Number.isInteger(p.age) ? p.age : Math.round(p.age * 10) / 10) : '–';
  const exp = p.years_exp != null ? (p.years_exp === 0 ? 'R' : p.years_exp) : '–';
  const jersey = (p.number != null && p.number !== '') ? `#${p.number}` : '';
  // A few club primaries (PIT gold, NO gold) are light enough that white hero text vanishes
  // on them — darken those rather than special-casing the text color. Then every hero gets
  // pulled a notch toward Sleeper's muted tone; full-saturation team paint reads neon.
  let tc = teamColor(tm);
  if (hexLum(tc) > 0.4) tc = darkenHex(tc, 0.45);
  tc = darkenHex(tc, 0.16);
  const heroStyle = tm ? `background:${tc};` : '';

  const meta = (label, val) =>
    `<div class="pc-meta-item"><span class="pc-meta-label">${label}</span>` +
    `<span class="pc-meta-val${(val == null || val === '–' || val === '') ? ' pc-meta-empty' : ''}">${esc(val == null || val === '' ? '–' : val)}</span></div>`;

  const inj = pcInjuryInfo(p);
  const injBanner = inj
    ? `<div class="pc-inj-banner pc-inj-${inj.sev}" title="${escAttr(inj.detail || inj.word)}">` +
      `<span class="pc-inj-dot">${inj.sev === 'q' ? '?' : '!'}</span>${esc(inj.word)}` +
      `${inj.body ? `<span class="pc-inj-note">· ${esc(inj.body)}</span>` : ''}</div>`
    : '';
  const parts = String(name).trim().split(/\s+/);
  const nameHtml = parts.length > 1
    ? `<span class="pc-name-l1">${esc(parts[0])}</span><span class="pc-name-l2">${esc(parts.slice(1).join(' '))}</span>`
    : `<span class="pc-name-l1">${esc(name)}</span>`;
  const nick = tm ? String(teamDisplayName(tm) || tm).trim().split(/\s+/).slice(-1)[0].toUpperCase() : 'FREE AGENT';
  const plateSub = [
    pos ? `<span class="pc-plate-pos pos-${esc(pos)}-t">${esc(pos)}</span>` : '',
    tm ? esc(tm) : '',
    jersey ? `<span class="pc-jersey">${esc(jersey)}</span>` : '',
  ].filter(Boolean).join(' · ');

  const html = `
    <div class="pc" role="dialog" aria-modal="true" aria-label="${escAttr(name)}" onclick="event.stopPropagation()">
      <div class="pc-hero" style="${heroStyle}">
        ${injBanner}
        <div class="pc-hero-row">
          <div class="pc-hero-shot">${pcHeroImg(pid, p, name[0] || '?')}</div>
          <div class="pc-hero-logo" style="${tm ? `background-image:url('${NFL_LOGO(tm)}')` : ''}"></div>
          <div class="pc-hero-main">
            <div class="pc-name">${nameHtml}</div>
            <div class="pc-sub">${pcOwnerChipHTML(pid)}</div>
            <div class="pc-meta">
              ${meta('AGE', age)}${meta('HT', fmtHeight(p.height))}
              ${meta('WT', p.weight ? `${p.weight} lbs` : '–')}
              ${meta('EXP', exp)}${meta('COLLEGE', p.college || '–')}
            </div>
          </div>
        </div>
        <div class="pc-hero-foot">
          <div class="pc-team-plate">
            <div class="pc-plate-team">${esc(nick)}</div>
            <div class="pc-plate-sub">${plateSub}</div>
          </div>
          <div class="pc-hero-draft" id="pcHeroDraft"></div>
        </div>
        <button class="pc-close" onclick="closePlayerCard()" aria-label="Close">✕</button>
      </div>
      <div class="pc-tabs" id="pcTabs"></div>
      <div class="pc-seasons" id="pcSeasons"></div>
      <div class="pc-body" id="pcBody"><div class="pc-loading">Loading game logs…</div></div>
    </div>`;

  let overlay = document.getElementById('pcOverlay');
  if (overlay) {
    // Re-used for a second player while open (search → card → search → card): undo anything a
    // swipe-dismiss in flight may have left on the backdrop.
    overlay.style.transition = ''; overlay.style.background = '';
    overlay.innerHTML = html;
  } else {
    overlay = document.createElement('div');
    overlay.id = 'pcOverlay';
    overlay.className = 'pc-overlay';
    overlay.onclick = closePlayerCard;
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
  }
  attachPcSwipe(overlay.querySelector('.pc'));
  renderPcModeTabs();
}

// The hero photo. The card's other surfaces use the Sleeper THUMB (small, fast); the hero
// shows the player at up to 142px tall, so it leads with the full-size cutout and falls back
// through ESPN's NFL and college shots to the thumb. All are transparent cutouts, which is
// what lets the photo sit straight on the team colour with no frame.
function pcHeroImg(pid, p, initial) {
  const urls = [];
  const add = u => { const v = String(u || '').trim(); if (v && !urls.includes(v)) urls.push(v); };
  add(SLEEPER_HEADSHOT(pid));
  if (p && p.espn_id) { add(ESPN_HEADSHOT('nfl', p.espn_id)); add(ESPN_HEADSHOT('college-football', p.espn_id)); }
  add(SLEEPER_HEADSHOT_THUMB(pid));
  return `<img class="pc-hero-img" src="${urls[0]}" alt="" decoding="async"
    data-fallbacks="${urls.slice(1).join('|')}" onerror="imgFallback(this)">` +
    `<div class="hs-err pc-hero-img-err">${esc(initial)}</div>`;
}

// The BAFL-native piece of the hero: who rosters this player right now, in the season being
// viewed, as a chip under the name. Tapping it opens that roster.
function pcOwnerChipHTML(pid) {
  const own = ownerOf(pid);
  if (!own) {
    return `<span class="pc-own-chip pc-own-fa" title="Not on any BAFL roster this season">` +
      `<span class="pc-own-lbl">BAFL</span>Free agent</span>`;
  }
  const rid = Number(own.rid);
  const title = `Rostered by ${own.name} — open that roster`;
  return `<span class="pc-own-chip" role="button" tabindex="0" title="${escAttr(title)}"
    onclick="event.stopPropagation();pcJumpToOwner(${rid})"
    onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pcJumpToOwner(${rid});}">` +
    `<span class="pc-own-lbl">BAFL</span>${esc(own.name)}</span>`;
}
function pcJumpToOwner(rid) { closePlayerCard(); openRosterModal(rid); }

// Injury designation from the slim player record, shaped for the banner. Sleeper's status
// strings vary in case and length ("Questionable", "IR", "Sus", "PUP", "COV", "NA"), so they
// are reduced to a code first and worded from that.
function pcInjuryInfo(p) {
  const st = p && p.injury_status ? String(p.injury_status).trim() : '';
  if (!st) return null;
  const code = /^ir/i.test(st) ? 'IR' : /^out/i.test(st) ? 'OUT' : /^doubtful/i.test(st) ? 'D'
    : /^questionable/i.test(st) ? 'Q' : /^sus/i.test(st) ? 'SUS' : /^pup/i.test(st) ? 'PUP'
    : /^cov/i.test(st) ? 'COVID' : /^na$/i.test(st) ? 'NA' : /^dnr/i.test(st) ? 'DNR'
    : st.slice(0, 3).toUpperCase();
  const sev = code === 'Q' ? 'q' : code === 'D' ? 'd' : 'o';
  const body = String(p.injury_body_part || '').trim();
  const note = String(p.injury_note || '').trim();
  // No structured "season-ending" flag exists on Sleeper, but the note nearly always says it.
  const seasonOut = /season[-\s]?ending|out for (the )?(season|year)|miss (the )?(rest of the )?(season|year)|lost for the (season|year)/i
    .test(`${body} ${note}`);
  const word = { Q: 'QUESTIONABLE', D: 'DOUBTFUL', OUT: 'OUT', IR: seasonOut ? 'IR · OUT FOR SEASON' : 'IR',
    SUS: 'SUSPENDED', PUP: 'PUP', COVID: 'COVID', NA: 'INACTIVE', DNR: 'DID NOT REPORT' }[code] || code;
  return { code, sev, word, body, detail: [body, note].filter(Boolean).join(' — ') };
}

// The draft banner is independent of which season or source tab is showing, so it must NOT be
// gated on pcToken — that counter is bumped by every season load, and since openPlayerCard
// starts this lookup and then immediately selects a season, a token check here would discard
// the result every single time. The only thing that matters is that the same player is still
// on screen when it lands.
async function loadPcDraft(pid) {
  const p = playerRec(pid);
  const aid = await resolveEspnAthleteId(pid, p && p.name, 'nfl');
  if (!aid || !PC || PC.pid !== pid) return;
  const info = await fetchEspnDraftInfo(aid);
  const el = document.getElementById('pcHeroDraft');
  if (el && PC && PC.pid === pid) el.innerHTML = espnDraftHero(info);
}

// ─── Mode tabs (NFL / College) ────────────────────────────────────────────
function renderPcModeTabs() {
  const el = document.getElementById('pcTabs');
  if (!el || !PC) return;
  const tab = (mode, label) =>
    `<button class="pc-tab ${PC.mode === mode ? 'active' : ''}" onclick="setPcMode('${mode}')">${label}</button>`;
  el.innerHTML = tab('nfl', 'NFL') + tab('college', 'College');
}
function setPcMode(mode) {
  if (!PC || PC.mode === mode) return;
  PC.mode = mode;
  renderPcModeTabs();
  renderPcSeasonTabs();
  if (mode === 'college') loadPcCollege();
  else if (PC.espnOnly) loadPcEspn('nfl');
  else pcSelectSeason(PC.season || PC.seasons[0], { autoAdvance: true });
}

// ─── Season tabs ──────────────────────────────────────────────────────────
// The pills are the heart of the seedless design. They render immediately from the derived
// candidate list, and each one is an independent lazy load. A season proven empty is disabled
// rather than removed, so the row doesn't reflow under the user's finger mid-tap.
function renderPcSeasonTabs() {
  const el = document.getElementById('pcSeasons');
  if (!el || !PC) return;
  // ESPN-sourced views carry their own season list inside the payload, so the derived pills
  // don't apply — hide them rather than show a row that controls nothing.
  if (PC.mode === 'college' || PC.espnOnly) { el.innerHTML = ''; return; }
  if (!PC.seasons.length) { el.innerHTML = ''; return; }
  el.innerHTML = PC.seasons.map(s => {
    const st = PC.seasonState[s] || 'unknown';
    const cls = ['pc-season-pill'];
    if (PC.season === s) cls.push('active');
    if (st === 'empty') cls.push('empty');
    if (st === 'loading') cls.push('loading');
    const title = st === 'empty' ? 'No games recorded this season' : `View ${s} game log`;
    return `<button class="${cls.join(' ')}" title="${escAttr(title)}"
      ${st === 'empty' ? 'disabled' : ''} onclick="pcSelectSeason('${s}')">${s}</button>`;
  }).join('');
}

// Load and show one season. `autoAdvance` walks down to the next season with data — needed
// because in the offseason (and for anyone who missed a year) the newest candidate season is
// legitimately empty for everybody.
async function pcSelectSeason(season, opts) {
  if (!PC || !season) return;
  opts = opts || {};
  const pid = PC.pid;
  const tok = ++pcToken;
  PC.season = String(season);
  PC.seasonState[PC.season] = PC.seasonState[PC.season] === 'ok' ? 'ok' : 'loading';
  renderPcSeasonTabs();
  const body = document.getElementById('pcBody');
  if (body) body.innerHTML = `<div class="pc-loading">Loading ${esc(season)} game log…</div>`;

  // The live season also carries the games still to come, from the NFL schedule, so the
  // card shows the whole slate — and the defense-vs-position colours can be laid over it.
  const live = String(await currentNflSeason()) === String(PC.season) && !!PC.team;
  if (tok !== pcToken || !PC) return;
  let weekly, sched = null;
  try {
    [weekly, sched] = await Promise.all([
      fetchPlayerWeekly(pid, PC.season),
      live ? loadNflSchedule(PC.season) : null,
    ]);
  } catch {
    if (tok !== pcToken || !PC) return;
    PC.seasonState[PC.season] = 'unknown';
    renderPcSeasonTabs();
    if (body) body.innerHTML = pcRetryHTML("Couldn't load that season. Check your connection.");
    return;
  }
  if (tok !== pcToken || !PC || PC.pid !== pid) return;

  const rows = pcSeasonRows(weekly);
  if (live && sched) pcFillSchedule(rows, sched, PC.team);
  if (!rows.length) {
    PC.seasonState[PC.season] = 'empty';
    // Walk to the next-newest candidate with data, but bound the search — a genuinely
    // seasonless player shouldn't trigger a cascade of requests.
    const idx = PC.seasons.indexOf(PC.season);
    const next = opts.autoAdvance
      ? PC.seasons.slice(idx + 1, idx + 4).find(s => PC.seasonState[s] !== 'empty')
      : null;
    renderPcSeasonTabs();
    if (next) return pcSelectSeason(next, { autoAdvance: true });
    if (body) body.innerHTML = `<div class="pc-empty">No ${esc(PC.season)} game log for this player.</div>`;
    return;
  }
  PC.seasonState[PC.season] = 'ok';
  renderPcSeasonTabs();
  if (body) {
    body.innerHTML = renderPcSeason(PC.season, rows, PC.pos, { live }) +
      `<div class="pc-src">Per-game stats via Sleeper · category values use BAFL scoring.</div>`;
    applyConsistencyBadge(PC.season, rows, PC.pos);
    if (live) applyDvpColors(PC.season, PC.pos);
    pcEnableStickyStatHeaders();
  }
}

// Fill the live season's missing weeks from the NFL schedule, in place: a game still to be
// played becomes an upcoming row (opponent shown, stats blank); a finished game the player
// has no row for is a DNP; a week with no game is a bye. Weeks the feed already covers are
// left alone. Nothing here counts toward totals or the consistency grade — those only ever
// read games actually played.
function pcFillSchedule(rows, sched, team) {
  const byWeek = sched && sched.byTeam && sched.byTeam[String(team || '').toUpperCase()];
  if (!byWeek) return rows;
  const have = new Set(rows.map(r => r.wk));
  const empty = baflPlayerCats({});
  for (let wk = 1; wk <= 18; wk++) {
    if (have.has(wk)) continue;
    const g = byWeek[wk];
    if (!g) { rows.push({ wk, opp: null, isAway: false, gp: 0, team, stats: {}, cats: empty, bye: true, dnp: false, future: false }); continue; }
    const done = g.status === 'complete';
    rows.push({ wk, opp: g.opp, isAway: !g.home, gp: 0, team, stats: {}, cats: empty,
      bye: false, dnp: done, future: !done });
  }
  rows.sort((a, b) => a.wk - b.wk);
  return rows;
}

// Lay the defense-vs-position tiers over every opponent code in the body once the ranks
// arrive (49-dvp.js). Patches in place — the table rendered without waiting for this.
async function applyDvpColors(season, pos) {
  const P = String(pos || '').toUpperCase();
  if (!BAFL_POSITIONS.includes(P)) return;
  const dvp = await loadDvp(season);
  if (!dvp || !PC || String(PC.season) !== String(season) || PC.mode !== 'nfl') return;
  const body = document.getElementById('pcBody');
  if (!body) return;
  const n = dvp.n[P] || 0;
  const what = P === 'K' ? 'kicking points' : 'yards + TDs';
  body.querySelectorAll('.pc-opp-code[data-opp]').forEach(el => {
    const def = el.dataset.opp;
    const rank = dvp.ranks[def] && dvp.ranks[def][P];
    const tier = dvpTier(rank, n);
    if (!tier) return;
    el.classList.add('pc-dvp', `pc-dvp-${tier}`);
    const pg = dvp.perGame[def][P];
    el.title = `${def} allows the ${ordinal(rank)}-most ${what} to ${P}s of ${n} defenses `
      + `(${Math.round(pg * 10) / 10} per game${dvp.prior ? ', blended with last season this early in the year' : ''}) — `
      + (tier === 'easy' ? 'a matchup to attack' : tier === 'hard' ? 'a tough draw' : 'middle of the pack');
  });
  const slot = body.querySelector('.pc-dvp-slot');
  if (slot) {
    slot.innerHTML = `<span class="pc-dvp-key pc-dvp-easy">soft</span><span class="pc-dvp-key pc-dvp-mid">average</span>`
      + `<span class="pc-dvp-key pc-dvp-hard">tough</span> matchups for ${P}s — by ${what} each defense allows per game`
      + `${dvp.prior ? ', last season filling in until six games are played' : ` over ${dvp.weeks} week${dvp.weeks === 1 ? '' : 's'}`}.`;
  }
}

function pcRetryHTML(msg) {
  return `<div class="pc-loading pc-retry-wrap"><span>${esc(msg)}</span>
    <button class="pc-retry-btn" onclick="pcSelectSeason(PC && PC.season)">Retry</button></div>`;
}

// One player-season of weekly stats, cached. This is the only network call the NFL tab makes.
async function fetchPlayerWeekly(pid, season) {
  const key = `${season}:${pid}`;
  if (S.weeklyCache[key]) return S.weeklyCache[key];
  const data = await fetchJ(SLEEPER_WEEKLY_URL(pid, season));
  return cachePut(S.weeklyCache, key, data || {}, 120);
}

// ─── Row building ─────────────────────────────────────────────────────────
// Sleeper's weekly payload is {week: {stats, opponent, team, ...}} with nulls for weeks the
// player wasn't on a roster. A week with gp===0 and no opponent is a bye; a week with an
// opponent but gp===0 is an inactive/DNP, which is a different thing and reads differently.
function pcSeasonRows(weekly) {
  const rows = [];
  for (const wk in (weekly || {})) {
    const wn = parseInt(wk);
    if (isNaN(wn)) continue;
    const row = weekly[wk];
    if (!row || typeof row !== 'object') continue;
    const s = row.stats || {};
    const opp = row.opponent || row.opp || null;
    const team = row.team || null;
    const isAway = (typeof row.is_away_team === 'boolean') ? row.is_away_team
      : ((row.game_id && team && opp) ? (row.game_id.indexOf(team) > row.game_id.indexOf(opp)) : false);
    const gp = s.gp || 0;
    rows.push({
      wk: wn, opp, isAway, gp, team, stats: s,
      bye: gp === 0 && !opp,
      dnp: gp === 0 && !!opp,
      cats: baflPlayerCats(s),
    });
  }
  rows.sort((a, b) => a.wk - b.wk);
  return rows;
}

// The games that actually count toward per-game figures and consistency.
//
// Sleeper omits `gp` for a week the player missed, which pcSeasonRows already turns into a
// DNP row — those never counted. This adds the subtler case: a player who was ACTIVE but
// never took the field. He has gp, so he looks like a game played, but he had no opportunity
// to produce and grading him on it would be grading him for being healthy. Only excluded
// when the snap counts are actually present, since Sleeper doesn't carry them for every
// season, and never for kickers (who take no offensive snaps by definition).
function pcPlayedRows(rows, pos) {
  const isK = String(pos || '').toUpperCase() === 'K';
  return (rows || []).filter(r => {
    if (r.bye || r.dnp || !(r.gp > 0)) return false;
    if (isK) return true;
    const s = r.stats || {};
    if (s.off_snp === 0 && (s.tm_off_snp || 0) > 0) return false;   // dressed, never played
    return true;
  });
}

// Derived box-score values that aren't raw Sleeper fields (rates, and the K miss count).
// Stats Sleeper genuinely may not have, as opposed to ones it merely omits when zero.
const PC_NULLABLE = new Set(['pass_lng', 'rush_lng', 'rec_lng', 'fgm_lng']);
function pcDerived(key, s) {
  s = s || {};
  switch (key) {
    case '_cmp_pct': return (s.pass_att > 0) ? (s.pass_cmp || 0) / s.pass_att * 100 : null;
    case '_ru_ypc':  return (s.rush_att > 0) ? (s.rush_yd || 0) / s.rush_att : null;
    case '_re_ypc':  return (s.rec > 0) ? (s.rec_yd || 0) / s.rec : null;
    case 'fgmiss':   return Math.max(0, (s.fga || 0) - (s.fgm || 0));
    default:
      if (s[key] != null) return s[key];
      // Sleeper drops zero-valued counting stats from the payload entirely. Rendering those as
      // "–" implies missing data; they are real zeroes and must read as 0.
      return PC_NULLABLE.has(key) ? null : 0;
  }
}

// ─── Season table ─────────────────────────────────────────────────────────
// `opts.live` marks the season in progress: its rows include the games still to come, and
// a legend slot for the defense-vs-position colours is rendered under the table.
function renderPcSeason(season, rows, pos, opts) {
  opts = opts || {};
  const P = String(pos || '').toUpperCase();
  const cats = pcCatsForPos(P);
  const box = PC_BOX_SCHEMA[P];
  const totalBench = PC_TOTAL_BENCH[P];
  // Positions with no BAFL category mapping (defenders, punters) still get their box score —
  // they just don't get a category group, because they don't score in this league.
  const catCols = cats ? cats.map(([k, g, o]) => ({ key: k, label: PC_CAT_LABEL[k], good: g, ok: o })) : [];
  const showTotal = !!(cats && totalBench);

  // Header: a BAFL group, then the raw box-score groups, with a spacer column between each.
  const gap = !!(catCols.length && box);   // spacer column between the two groups
  let grpRow = '';
  if (catCols.length) {
    grpRow += `<th class="pc-grp pc-grp-bafl" colspan="${catCols.length + (showTotal ? 1 : 0)}">BAFL CATEGORIES</th>`;
    if (gap) grpRow += '<th></th>';
  }
  let colRow = catCols.map(c => `<th>${c.label}</th>`).join('') + (showTotal ? '<th>TOT</th>' : '');
  if (gap) colRow += '<th></th>';
  if (box) {
    box.groups.forEach((g, gi) => {
      const span = box.cols.filter(c => c.grp === gi).length;
      grpRow += `<th class="pc-grp" colspan="${span}">${g}</th>` + (gi < box.groups.length - 1 ? '<th></th>' : '');
    });
    box.cols.forEach((c, i) => {
      const prev = box.cols[i - 1];
      colRow += ((prev && prev.grp !== c.grp) ? '<th></th>' : '') + `<th>${c.label}</th>`;
    });
  }

  const bodyRows = rows.map(r => {
    const nCells = catCols.length + (showTotal ? 1 : 0) + (gap ? 1 : 0) +
      (box ? box.cols.length + (box.groups.length - 1) : 0);
    // A missed or upcoming game keeps its opponent — it is still a real matchup on a real
    // schedule, and the defense-vs-position colour belongs on it. Only a true bye says BYE.
    if (r.bye || r.dnp || r.future) {
      const kind = r.bye ? 'bye' : r.dnp ? 'dnp' : 'future';
      const oppCell = r.opp ? pcOppInner(r) : (r.bye ? 'BYE' : '–');
      const title = r.bye ? 'Bye week' : r.dnp ? 'Did not play — not counted in totals or the consistency grade' : 'Upcoming game';
      return `<tr class="pc-row-${kind}"><td class="pc-wk">${r.wk}</td>` +
        `<td class="pc-opp ${r.opp ? (r.isAway ? 'away' : 'home') : ''}" title="${title}">${oppCell}</td>` +
        `<td class="pc-cell bye" colspan="${nCells}">${r.dnp ? 'DNP' : '–'}</td></tr>`;
    }
    let cells = catCols.map(c => {
      const v = r.cats[c.key] || 0;
      return `<td class="pc-cell pc-cat-cell ${triHigh(v, c.good, c.ok)}">${Math.round(v)}</td>`;
    }).join('');
    if (showTotal) {
      const ty = baflTotalYards(r.cats);
      cells += `<td class="pc-cell pc-cat-cell pc-tot-cell ${triHigh(ty, totalBench[0], totalBench[1])}">${Math.round(ty)}</td>`;
    }
    if (gap) cells += '<td></td>';
    if (box) {
      cells += box.cols.map((c, i) => {
        const prev = box.cols[i - 1];
        const sep = (prev && prev.grp !== c.grp) ? '<td></td>' : '';
        const v = pcDerived(c.key, r.stats);
        const display = c.fmt ? c.fmt(v) : (v == null ? '–' : fmtNum(v, 1));
        return sep + `<td class="pc-cell ${c.color ? c.color(v) : ''}">${display}</td>`;
      }).join('');
    }
    const oppTxt = r.opp ? pcOppInner(r) : '–';
    const started = pcStartedFlag(season, r.wk);
    return `<tr><td class="pc-wk">${r.wk}${started}</td>` +
      `<td class="pc-opp ${r.isAway ? 'away' : 'home'}">${oppTxt}</td>${cells}</tr>`;
  }).join('');

  const totalsRow = pcTotalsRow(rows, P, catCols, showTotal, totalBench, box);
  const teamTag = pcSeasonTeamTag(rows);
  const dvpSlot = (opts.live && BAFL_POSITIONS.includes(P)) ? `<div class="pc-dvp-slot"></div>` : '';
  return `<div class="pc-season">
    <div class="pc-season-title">${esc(season)}${teamTag}${pcSeasonBadges(rows, P, season)}</div>
    <div class="pc-table-scroll"><table class="pc-table">
      <thead>
        <tr><th></th><th></th>${grpRow}</tr>
        <tr><th class="pc-th-wk">WK</th><th>OPP</th>${colRow}</tr>
      </thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table></div>
    ${dvpSlot}
  </div>`;
}

// "@ PHI" / "vs PHI" with the club logo. The code carries data-opp so the defense-vs-
// position pass can find and tint it.
function pcOppInner(r) {
  return `<span class="pc-opp-inner">${r.isAway ? '<span class="pc-at">@</span>' : '<span class="pc-vs">vs</span>'}` +
    `<img src="${NFL_LOGO(r.opp)}" class="pc-opp-logo" onerror="this.style.display='none'">` +
    `<span class="pc-opp-code" data-opp="${escAttr(r.opp)}">${esc(r.opp)}</span></span>`;
}

// Season totals: category values sum, counting stats sum, "long" columns take the max, and
// rates are recomputed from the summed components rather than averaged (averaging a per-game
// YPC across games is simply the wrong number).
function pcTotalsRow(rows, pos, catCols, showTotal, totalBench, box) {
  const played = pcPlayedRows(rows, pos);
  if (!played.length) return '';
  const games = played.length;
  const catSum = {};
  BAFL_CATS.forEach(c => { catSum[c.key] = 0; });
  const t = {};
  const SUM = ['pass_cmp','pass_att','pass_yd','pass_td','pass_int','pass_sack',
               'rush_att','rush_yd','rush_td','rec_tgt','rec','rec_yd','rec_td','fgm','fga','xpm','xpa'];
  const MAX = ['pass_lng','rush_lng','rec_lng','fgm_lng'];
  for (const r of played) {
    BAFL_CATS.forEach(c => { catSum[c.key] += r.cats[c.key] || 0; });
    const s = r.stats || {};
    for (const k of SUM) t[k] = (t[k] || 0) + (s[k] || 0);
    for (const k of MAX) t[k] = Math.max(t[k] || 0, s[k] || 0);
  }
  // The totals row is graded on the PER-GAME average, so its colors mean the same thing as
  // the weekly rows above it — a green season total is a season of green weeks.
  let cells = catCols.map(c => {
    const tot = catSum[c.key], pg = tot / games;
    return `<td class="pc-cell pc-total-cell pc-cat-cell ${triHigh(pg, c.good, c.ok)}"
      title="${escAttr(`${Math.round(pg)} per game over ${games} games`)}">${Math.round(tot)}</td>`;
  }).join('');
  if (showTotal) {
    const ty = catSum.passing + catSum.rushing + catSum.receiving;
    cells += `<td class="pc-cell pc-total-cell pc-cat-cell pc-tot-cell ${triHigh(ty / games, totalBench[0], totalBench[1])}"
      title="${escAttr(`${Math.round(ty / games)} yards per game`)}">${Math.round(ty)}</td>`;
  }
  if (catCols.length && box) cells += '<td></td>';
  if (box) {
    cells += box.cols.map((c, i) => {
      const prev = box.cols[i - 1];
      const sep = (prev && prev.grp !== c.grp) ? '<td></td>' : '';
      const v = pcDerived(c.key, t);
      const display = c.fmt ? c.fmt(v) : (v == null ? '–' : fmtNum(v, 1));
      return sep + `<td class="pc-cell pc-total-cell">${display}</td>`;
    }).join('');
  }
  return `<tr class="pc-total-row"><td class="pc-wk">TOT</td><td class="pc-opp">${games}g</td>${cells}</tr>`;
}

// Teams the player logged games for — makes a midseason trade legible at a glance.
function pcSeasonTeamTag(rows) {
  const teams = [...new Set(rows.filter(r => !r.bye && r.team).map(r => r.team))];
  if (!teams.length) return '';
  const inner = teams.map(t =>
    `<img src="${NFL_LOGO(t)}" class="pc-season-logo" onerror="this.style.display='none'">${esc(t)}`).join(' / ');
  return ` <span class="pc-season-team">· ${inner}</span>`;
}

// Headline badges. The yards-per-game figure is available immediately; the consistency grade
// needs the league's positional benchmark for that season, so it is fetched separately and
// dropped in when it lands (same pattern as the draft banner) rather than delaying the table.
function pcSeasonBadges(rows, pos, season) {
  const played = pcPlayedRows(rows, pos);
  if (!pcCatsForPos(pos) || played.length < 2) return '';
  const isK = String(pos || '').toUpperCase() === 'K';
  const perGame = played.reduce((a, r) => a + benchMetric(r.stats, pos), 0) / played.length;
  const unit = isK ? 'pts/g' : 'yd/g';
  const what = isK ? 'kicking points' : 'total yards';
  const tip = `${perGame.toFixed(1)} ${what} per game over ${played.length} games played.`;
  const hasScale = isK || !!PC_TOTAL_BENCH[String(pos).toUpperCase()];
  const ypg = hasScale
    ? ` <span class="pc-badge pc-badge-ypg" title="${escAttr(tip)}">${Math.round(perGame)} ${unit}</span>` : '';
  // Slot filled asynchronously by applyConsistencyBadge().
  return `${ypg}<span class="pc-cons-slot" data-season="${escAttr(season)}"></span>`;
}

// Share of games played in which the player beat replacement level at his position, that
// season. This is the whole point of deriving the benchmark from league data: a grade is only
// meaningful relative to what everyone else at the position was doing.
async function applyConsistencyBadge(season, rows, pos) {
  const slot = document.querySelector(`.pc-cons-slot[data-season="${CSS.escape(String(season))}"]`);
  if (!slot) return;
  const played = pcPlayedRows(rows, pos);
  // Four games is the floor for saying anything about consistency; below that it's one hot
  // or cold stretch, not a trait.
  if (played.length < 4) return;
  const bench = await positionalBenchmark(pos, season);
  if (!bench || !slot.isConnected) return;
  const hits = played.filter(r => benchMetric(r.stats, pos) >= bench.value).length;
  const rate = hits / played.length;
  const grade = consistencyGrade(rate);
  const isK = String(pos || '').toUpperCase() === 'K';
  const unit = isK ? 'kicking points' : 'total yards';
  const tip = `Beat ${Math.round(bench.value)} ${unit} in ${hits} of ${played.length} games played `
    + `(${(rate * 100).toFixed(0)}%).\n\nThat bar is 85% of what the #${bench.rank} ${String(pos).toUpperCase()} `
    + `averaged per game in ${season} (${Math.round(bench.lastStarter)}/g) — the last player at the position `
    + `this league starts, so roughly replacement level.`;
  slot.outerHTML = ` <span class="pc-badge pc-cons-${grade}" title="${escAttr(tip)}">Consistency ${grade}</span>`;
}

// A dot on the week number when the player was in a BAFL starting lineup that week. Only
// meaningful for the league season currently loaded, and only for weeks already in the cache —
// this deliberately does not trigger a 14-week fetch just to draw a dot.
function pcStartedFlag(season, week) {
  if (!S.league || String(S.league.season) !== String(season)) return '';
  const wd = S.weekCache[`${lid()}:${week}`];
  if (!wd) return '';
  const pid = PC && PC.pid;
  const inLineup = (wd.matchups || []).some(m => (m.starters || []).includes(pid));
  return inLineup ? `<span class="pc-started" title="Started in BAFL this week">●</span>` : '';
}

// ─── ESPN-sourced game logs ───────────────────────────────────────────────
// Serves two cases with one code path:
//   • the College tab, for any player;
//   • the NFL tab for positions with no hand-built box score (defenders, punters). Those
//     players never appear in a BAFL lineup, but player search can reach anyone in the NFL, and
//     a card that renders a header with no stat columns is worse than no card. ESPN's gamelog
//     is self-describing, so it supplies the right columns for whatever the position is.
// ESPN publishes its own season list inside the payload, so the derived season pills don't
// apply here — they're hidden for this mode.
async function loadPcCollege() { return loadPcEspn('college-football'); }

async function loadPcEspn(league) {
  if (!PC) return;
  const pid = PC.pid, tok = ++pcToken;
  const isCollege = league === 'college-football';
  const body = document.getElementById('pcBody');
  if (body) body.innerHTML = `<div class="pc-loading">Loading ${isCollege ? 'college ' : ''}game logs…</div>`;
  const p = playerRec(pid);
  const aid = await resolveEspnAthleteId(pid, p && p.name, league);
  if (!PC || PC.pid !== pid || tok !== pcToken) return;
  if (!aid) {
    if (body) body.innerHTML = `<div class="pc-empty">No ESPN ${isCollege ? 'college ' : ''}record found for this player.</div>`;
    return;
  }
  // fetchSoft, not fetchEspnGamelog: ESPN simply has no college gamelog for many players
  // (notably anyone whose college career predates its coverage), and that is an ordinary
  // outcome to report — not an error to offer a pointless retry for.
  const base = await fetchSoft(ESPN_GAMELOG_URL(league, aid, null));
  if (!PC || PC.pid !== pid || tok !== pcToken) return;
  if (!base) {
    if (body) body.innerHTML = `<div class="pc-empty">ESPN has no ${isCollege ? 'college ' : ''}game log for this player.
      ${isCollege ? `<div class="pc-empty-sub">Coverage thins out for players whose college careers predate ESPN's game-by-game data.</div>` : ''}</div>`;
    return;
  }
  try {
    let seasons = [];
    for (const f of (base.filters || [])) if (f.name === 'season') seasons = (f.options || []).map(o => o.value);
    if (!seasons.length) {
      const m = /\d{4}/.exec((base.seasonTypes && base.seasonTypes[0] && base.seasonTypes[0].displayName) || '');
      if (m) seasons = [m[0]];
    }
    seasons.sort((a, b) => Number(b) - Number(a));
    const perSeason = await Promise.all(seasons.map(async s =>
      ({ season: s, gl: await fetchSoft(ESPN_GAMELOG_URL(league, aid, s)) })));
    if (!PC || PC.pid !== pid || tok !== pcToken) return;
    let out = '';
    for (const { season, gl } of perSeason) if (gl) out += renderEspnSeason(season, gl, league);
    if (!out) out = `<div class="pc-empty">No ${isCollege ? 'college ' : ''}game data found for this player.</div>`;
    else out += `<div class="pc-src">${isCollege ? 'College' : 'NFL'} per-game stats via ESPN · AVG shown as YPC.</div>`;
    if (body) { body.innerHTML = out; pcEnableStickyStatHeaders(); }
  } catch {
    if (body) body.innerHTML = pcRetryHTML(`Couldn't load ${isCollege ? 'college ' : ''}game logs.`);
  }
}

// ─── Sticky game-log headers ──────────────────────────────────────────────
// .pc-body is the scroller; each season's table sits inside its own horizontal wrapper. A
// CSS position:sticky thead can't reach past that wrapper to the body, so the header is
// moved by hand: on every body scroll, each thead is translated down by exactly how far its
// table has passed under the body's top edge, clamped so it never leaves its own table.
// Reads are batched before writes (the old read→write→read alternation forced a layout pass
// per table per tick) and the whole thing is coalesced to one frame — iOS fires scroll far
// faster than it paints during momentum.
let _pcStickyRaf = 0;
let _pcStickyResizeBound = false;

function pcRefreshStickyStatHeaders() {
  _pcStickyRaf = 0;
  const body = document.getElementById('pcBody');
  if (!body || typeof body.getBoundingClientRect !== 'function') return;
  const stickyTop = body.getBoundingClientRect().top;
  const jobs = [];
  body.querySelectorAll('.pc-table-scroll').forEach(wrap => {
    const table = wrap.querySelector('.pc-table');
    const thead = table && table.tHead;
    if (!thead || !thead.rows || !thead.rows.length) return;
    const wrapRect = wrap.getBoundingClientRect();
    let headerHeight = 0;
    for (let i = 0; i < thead.rows.length; i++) headerHeight += (thead.rows[i].getBoundingClientRect().height || 0);
    const maxOffset = Math.max(0, (wrapRect.bottom - wrapRect.top) - headerHeight);
    const offset = Math.max(0, Math.min(maxOffset, stickyTop - wrapRect.top));
    jobs.push([thead, offset]);
  });
  jobs.forEach(([thead, offset]) => { thead.style.transform = offset > 0 ? `translateY(${offset}px)` : ''; });
}
function pcScheduleStickyStatHeaders() {
  if (_pcStickyRaf) return;
  _pcStickyRaf = (typeof requestAnimationFrame === 'function')
    ? requestAnimationFrame(pcRefreshStickyStatHeaders)
    : setTimeout(pcRefreshStickyStatHeaders, 16);
}
// Called after every body render. The overlay — and with it #pcBody — is rebuilt per card, so
// the scroll listener binds PER ELEMENT; a module-wide "already bound" flag would attach it to
// the first card only and every card after that would lose its headers.
function pcEnableStickyStatHeaders() {
  const body = document.getElementById('pcBody');
  if (!body) return;
  if (!body._pcStickyBound) {
    body._pcStickyBound = true;
    body.addEventListener('scroll', pcScheduleStickyStatHeaders, { passive: true });
  }
  if (!_pcStickyResizeBound) {
    window.addEventListener('resize', pcScheduleStickyStatHeaders, { passive: true });
    _pcStickyResizeBound = true;   // the window listener really is once per session
  }
  pcScheduleStickyStatHeaders();
}

// ─── Swipe-down to close ──────────────────────────────────────────────────
// Standard mobile sheet behaviour. The drag must START ON THE HERO: that region doesn't
// scroll, so a downward swipe there is unambiguous, whereas starting inside the body would
// fight the game log's own scrolling (a scrollTop check still misbehaves with momentum and
// overscroll on iOS). The card follows the finger 1:1 — no resistance, no fading — and past
// the threshold it keeps going and slides off the BOTTOM of the screen from wherever the
// finger let go, Sleeper-style, while the backdrop fades. Pointer events aren't used: they'd
// also capture mouse drags on desktop, where the ✕ is the right affordance.
function attachPcSwipe(cardEl) {
  if (!cardEl || cardEl._swipeWired) return;
  cardEl._swipeWired = true;
  const CLOSE_AT = 110;   // px dragged before it dismisses
  let y0 = null, dy = 0, dragging = false;
  const reset = anim => {
    cardEl.style.transition = anim ? 'transform .18s ease-out' : '';
    cardEl.style.transform = '';
    if (anim) setTimeout(() => { cardEl.style.transition = ''; }, 200);
  };

  cardEl.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { dragging = false; y0 = null; return; }
    const t = e.target;
    const onHero = t && t.closest && t.closest('.pc-hero');
    const onControl = t && t.closest && t.closest('.pc-close,.pc-own-chip');
    if (!onHero || onControl) { dragging = false; y0 = null; return; }
    y0 = e.touches[0].clientY; dy = 0; dragging = true;
    cardEl.style.transition = '';
  }, { passive: true });

  // NON-passive on purpose. A passive listener cannot call preventDefault(), which would leave
  // the browser running its own gesture underneath the drag — pull-to-refresh at the top of
  // the page, and scrolling the content behind the card. Claiming the gesture stops both.
  cardEl.addEventListener('touchmove', e => {
    if (!dragging || y0 == null) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0) { cardEl.style.transform = ''; return; }
    if (e.cancelable) e.preventDefault();
    cardEl.style.transform = `translateY(${dy.toFixed(1)}px)`;
  }, { passive: false });

  const finish = () => {
    if (!dragging) return;
    dragging = false; y0 = null;
    if (dy > CLOSE_AT) pcDismissFrom(cardEl, dy);
    else reset(true);
    dy = 0;
  };
  cardEl.addEventListener('touchend', finish, { passive: true });
  cardEl.addEventListener('touchcancel', finish, { passive: true });
}

// The slide-off. Duration scales with the distance left to travel so a card released near the
// bottom doesn't crawl; the overlay fades in step and the real close runs once both are done.
function pcDismissFrom(cardEl, dy) {
  const vh = window.innerHeight || 800;
  const rest = Math.max(200, vh - dy);
  cardEl.style.transition = `transform ${Math.min(0.32, rest / 1600).toFixed(2)}s ease-in`;
  cardEl.style.transform = `translateY(${vh + 60}px)`;
  const ov = document.getElementById('pcOverlay');
  if (ov) { ov.style.transition = 'background .25s ease'; ov.style.background = 'rgba(0,0,0,0)'; }
  setTimeout(closePlayerCard, 300);
}
