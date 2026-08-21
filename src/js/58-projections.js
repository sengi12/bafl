// ─── Live matchup projections ─────────────────────────────────────────────
// In a category league the useful in-season question isn't "am I ahead", it's "which
// categories are still winnable". Sleeper publishes a full-week projection for every player,
// so we can run the EXACT SAME category math over projected stat lines as over real ones —
// calcCatStats doesn't care whether the numbers it's handed already happened.
//
// Deliberate honesty about what this is: these are FULL-WEEK projections for the starting
// lineups, not "current score plus what's left". Sleeper's feed doesn't expose reliable
// per-game clock state, and a projection that silently mixes finished and unplayed games
// would be worse than one that's clearly labelled. The card shows actual and projected side
// by side and lets you read the gap yourself.

// One week of projections for every player: pid → stats. ~1000 rows, one request, cached.
async function loadWeekProjections(season, week) {
  const key = `${season}:${week}`;
  if (S.projCache[key]) return S.projCache[key];
  const rows = await fetchSoft(SLEEPER_WEEK_PROJ_URL(season, week), []);
  const out = {};
  for (const r of (rows || [])) {
    const pid = r.player_id || (r.player && r.player.player_id);
    if (pid && r.stats) out[String(pid)] = r.stats;
  }
  S.projCache[key] = out;
  return out;
}

// Projections are only meaningful for a week that hasn't finished — for any past week the
// actual result IS the answer, and showing a projection next to it is just noise.
function projectionsApply() {
  return isCurrentSeason() && S.selectedWeek === S.currentWeek && S.seasonStarted;
}

// Projected category totals in the same shape calcCatStats returns, so every downstream
// consumer (matchup card, score line, swing detection) treats them identically.
async function loadProjectedCats(matchups) {
  if (!projectionsApply()) return null;
  const proj = await loadWeekProjections(S.league.season, S.selectedWeek);
  if (!proj || !Object.keys(proj).length) return null;
  // calcCatStats skips any starter missing from players_points ("did not participate").
  // For a projection that check is wrong — nobody has participated yet — so hand it lineups
  // whose players_points marks every starter as present.
  const asIfPlayed = matchups.map(m => ({
    roster_id: m.roster_id,
    starters: m.starters || [],
    players_points: Object.fromEntries((m.starters || []).map(pid => [pid, 0])),
  }));
  return calcCatStats(asIfPlayed, proj);
}

// Which categories are close enough to still flip. Early in a week EVERY category is close,
// and a list naming all five is no signal at all — so the threshold is tight and the list is
// capped at the three closest, ordered by how close they are. When all five genuinely qualify
// we say so in three words instead of listing them.
const PROJ_SWING_PCT = 0.08;
const PROJ_SWING_MAX = 3;
function projSwingCategories(pcs, rid1, rid2) {
  if (!pcs) return { list: [], all: false };
  const close = [];
  for (const c of BAFL_CATS) {
    const a = pcs[c.key][rid1] || 0, b = pcs[c.key][rid2] || 0;
    const hi = Math.max(a, b);
    if (hi <= 0) continue;
    const gap = Math.abs(a - b) / hi;
    if (gap <= PROJ_SWING_PCT) close.push({ label: c.label, gap });
  }
  close.sort((x, y) => x.gap - y.gap);
  return { list: close.slice(0, PROJ_SWING_MAX).map(c => c.label), all: close.length === BAFL_CATS.length };
}

// The projected score line shown in the matchup card header, e.g. "Proj 3–2".
function projScoreHTML(pcs, rid1, rid2) {
  if (!pcs) return '';
  const r = calcResult(pcs, rid1, rid2);
  const swing = projSwingCategories(pcs, rid1, rid2);
  const tip = `Projected gap under ${Math.round(PROJ_SWING_PCT * 100)}% — still winnable`;
  const swingTxt = swing.all
    ? `<span class="proj-swing" title="${escAttr(tip)}">every category in play</span>`
    : swing.list.length
      ? `<span class="proj-swing" title="${escAttr(tip)}">${esc(swing.list.join(' · '))} in play</span>`
      : '';
  return `<div class="proj-bar">
    <span class="proj-lbl">PROJECTED</span>
    <span class="proj-score">${r.s1}<span class="proj-dash">–</span>${r.s2}</span>
    ${swingTxt}
  </div>`;
}
