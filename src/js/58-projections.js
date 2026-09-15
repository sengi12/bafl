// ─── Live matchup projections ─────────────────────────────────────────────
// In a category league the useful in-season question isn't "am I ahead", it's "which
// categories are still winnable". Sleeper publishes a full-week projection for every player,
// and the SAME category math runs over projected stat lines as over real ones —
// baflPlayerCats doesn't care whether the numbers it's handed already happened.
//
// A projection here is what has happened plus what is still to come, per starter:
//
//     projected = actual so far + (share of his game still unplayed) × full-game projection
//
// Before kickoff that is the plain Sleeper projection; at the final whistle it IS the box
// score; in between it moves with the clock. The unplayed share comes from two feeds —
// Sleeper's schedule (pre_game / in_game / complete, keyed by the same game_id the projection
// rows carry) and ESPN's scoreboard (period and clock, so a game at halftime counts as half
// played). Either can fail without breaking the view: with no scoreboard an in-progress game
// counts as half played; with no game state at all every projection is taken in full, which
// is exactly what the app showed before it knew about game clocks.
//
// The same pass records a variance for every projected total, which is what the win
// probability in 59-winprob.js runs on: a team projected to 240 passing yards with three
// starters still to play is a very different thing from 240 with all of them showered.

// One week of projections for every player: pid → stats, plus the game and team each row
// belongs to. ~3,300 rows, one request, cached for PROJ_TTL_MS.
async function loadWeekProjections(season, week) {
  const key = `${season}:${week}`;
  const hit = S.projCache[key];
  if (hit && Date.now() - hit.at < PROJ_TTL_MS) return hit;
  const rows = await fetchSoft(SLEEPER_WEEK_PROJ_URL(season, week), []);
  const stats = {}, game = {}, team = {}, who = {};
  for (const r of (rows || [])) {
    const pid = r.player_id || (r.player && r.player.player_id);
    if (!pid || !r.stats) continue;
    stats[String(pid)] = r.stats;
    if (r.game_id) game[String(pid)] = String(r.game_id);
    if (r.team)    team[String(pid)] = String(r.team);
    // Position and a short name ride on every row, so the path-to-win callout can say "WR
    // T. Hill still to play" without waiting on the 10MB player dictionary.
    const pl = r.player || {};
    const pos = String(pl.position || (r.stats && r.stats.pos) || '').toUpperCase();
    const name = pl.last_name ? `${pl.first_name ? pl.first_name[0] + '. ' : ''}${pl.last_name}` : '';
    if (pos || name) who[String(pid)] = { pos, name };
  }
  // A failed refresh keeps the copy we have rather than blanking the card.
  if (!Object.keys(stats).length && hit) return hit;
  S.projCache[key] = { stats, game, team, who, at: Date.now() };
  return S.projCache[key];
}

// The NFL schedule for a season — every game with its status — cached briefly and shared by
// the game-progress blend, the player card's upcoming-schedule rows and the defense-vs-
// position ranks. Status changes during games, so the TTL is short; a failed refresh keeps
// the copy in hand. `byTeam` is CODE → week → {opp, home, status, game_id, date}.
const NFL_SCHED_TTL_MS = 60 * 1000;
async function loadNflSchedule(season) {
  const key = String(season);
  const hit = S.nflSchedCache[key];
  if (hit && Date.now() - hit.at < NFL_SCHED_TTL_MS) return hit;
  const games = await fetchSoft(SLEEPER_SCHEDULE_URL(season), null);
  if (!Array.isArray(games) || !games.length) return hit || null;
  const byTeam = {};
  for (const g of games) {
    const wk = Number(g.week);
    if (!wk || !g.home || !g.away) continue;
    const status = String(g.status || '').toLowerCase();
    (byTeam[g.home] = byTeam[g.home] || {})[wk] = { opp: g.away, home: true,  status, game_id: g.game_id, date: g.date };
    (byTeam[g.away] = byTeam[g.away] || {})[wk] = { opp: g.home, home: false, status, game_id: g.game_id, date: g.date };
  }
  S.nflSchedCache[key] = { at: Date.now(), games, byTeam };
  return S.nflSchedCache[key];
}

// Projections are only meaningful for a week that hasn't finished — for any past week the
// actual result IS the answer, and showing a projection next to it is just noise.
// That is the week in view and, before the Wednesday rollover, the one Sleeper has already
// opened (S.maxWeek) — its Thursday-night forecast is the reason to tap › early.
function projectionsApply() {
  return isCurrentSeason() && S.seasonStarted
      && S.selectedWeek >= S.currentWeek && S.selectedWeek <= S.maxWeek;
}

// Share of a game still to be played, from an ESPN scoreboard status block: 1 before kickoff,
// 0 once final, and between those the clock. Four 15-minute periods; overtime is treated as
// a short tail so a tied game in OT still reads as nearly — not entirely — decided.
function gameRemainingFromEspn(st) {
  const state = st && st.type && st.type.state;
  if (state === 'post') return 0;
  if (state !== 'in') return 1;
  const period = Number(st.period || 1), clock = Number(st.clock || 0);
  if (period >= 5) return Math.max(0.02, Math.min(0.15, clock / 3600));
  return Math.max(0.02, Math.min(1, ((4 - period) * 900 + clock) / 3600));
}

// Game state for one week: game_id → share still unplayed, and the same by team code as a
// fallback for a projection row that carries a team but no game_id. Sleeper's schedule is the
// authority on "complete" (its stats are what the matchup is scored on); ESPN's clock refines
// the games in between. Nothing here throws — a missing feed just means less precision.
async function loadGameProgress(season, week) {
  const [schedule, board] = await Promise.all([
    loadNflSchedule(season),
    fetchSoft(ESPN_SCOREBOARD_URL(season, week), null),
  ]);
  const sched = schedule && schedule.games;
  // ESPN, keyed by home team in Sleeper's spelling.
  const espn = {};
  for (const ev of (board && Array.isArray(board.events) ? board.events : [])) {
    const comp = ev.competitions && ev.competitions[0];
    if (!comp) continue;
    const side = ha => (comp.competitors || []).find(x => x.homeAway === ha);
    const code = ha => { const s = side(ha); const a = s && s.team && s.team.abbreviation; return a ? (ESPN_TEAM_TO_SLEEPER[a] || a) : ''; };
    const home = code('home'), away = code('away');
    if (!home) continue;
    espn[home] = { rem: gameRemainingFromEspn(comp.status || ev.status), away };
  }
  const rem = {};      // game_id → share
  const byTeam = {};   // `team:CODE` → share
  let games = 0, done = 0;
  const seen = new Set();
  for (const g of (Array.isArray(sched) ? sched : [])) {
    if (Number(g.week) !== Number(week) || !g.game_id) continue;
    const st = String(g.status || '').toLowerCase();
    const e = espn[g.home];
    const r = st === 'complete' ? 0 : e ? e.rem : st.startsWith('in') ? 0.5 : 1;
    rem[String(g.game_id)] = r;
    if (g.home) byTeam[g.home] = r;
    if (g.away) byTeam[g.away] = r;
    seen.add(g.home);
    games++; if (r === 0) done++;
  }
  // Games the schedule feed didn't list (or the whole feed, if it failed) — ESPN alone.
  for (const [home, e] of Object.entries(espn)) {
    if (seen.has(home)) continue;
    byTeam[home] = e.rem;
    if (e.away) byTeam[e.away] = e.rem;
    games++; if (e.rem === 0) done++;
  }
  return { rem, byTeam, weekDone: games > 0 && done === games };
}

// The unplayed share for one player, given his projection row's game_id and team. A game
// neither feed knows about is taken as unplayed — unless every game we DO know about is over,
// in which case the week is done and so is he.
function gameRemaining(prog, gameId, team) {
  if (!prog) return 1;
  if (gameId != null && prog.rem[String(gameId)] != null) return prog.rem[String(gameId)];
  if (team && prog.byTeam[team] != null) return prog.byTeam[team];
  return prog.weekDone ? 0 : 1;
}

// How far a full-game projection typically misses, as a share of itself. Yardage misses scale
// with volume — a 250-yard passer lands within ±80 or so two times in three, a 60-yard
// receiver within ±35 — so those are coefficients of variation. Touchdowns are counting
// events and behave like Poisson draws: variance equal to the mean. The unplayed share of a
// game carries that share of the variance (the usual random-walk assumption), which is what
// makes a lead safer as the clock runs.
const PROJ_CV = { passing: 0.32, rushing: 0.55, receiving: 0.6, kicking: 0.5 };
function projVariance(key, proj, rem) {
  if (rem <= 0 || !proj) return 0;
  const m = Math.abs(proj);
  return key === 'tds' ? rem * m : rem * Math.pow(PROJ_CV[key] * m, 2);
}

// Blend live stats and projections into per-roster category totals in the same shape
// calcCatStats returns — so the matchup card, score line and swing detection treat them
// exactly like actuals — plus `var` (same shape, the unplayed variance), `rem` (roster →
// how many starter-games are still unplayed; 0 means that lineup is finished), `tot`
// (roster → starters in the lineup) and `left` (roster → the starters still to play, each
// with his position, short name and the unplayed share of his projection per category —
// what the path-to-win callout in 57-comeback.js reasons over).
function blendProjections(matchups, stats, proj, prog) {
  const out = { var: {}, rem: {}, tot: {}, left: {} };
  const who = proj.who || {};
  for (const c of BAFL_CATS) { out[c.key] = {}; out.var[c.key] = {}; }
  for (const m of matchups) {
    const rid = m.roster_id;
    out.rem[rid] = 0; out.tot[rid] = 0; out.left[rid] = [];
    for (const c of BAFL_CATS) { out[c.key][rid] = 0; out.var[c.key][rid] = 0; }
    for (const pid of (m.starters || [])) {
      if (!pid || pid === '0') continue;                 // empty lineup slot
      out.tot[rid]++;
      const act  = baflPlayerCats(stats[pid]);
      const prow = proj.stats[pid];
      const pc   = baflPlayerCats(prow);
      const r    = prow ? gameRemaining(prog, proj.game[pid], proj.team[pid]) : 0;
      out.rem[rid] += r;
      const todo = {};
      for (const c of BAFL_CATS) {
        out[c.key][rid]     += act[c.key] + r * pc[c.key];
        out.var[c.key][rid] += projVariance(c.key, pc[c.key], r);
        todo[c.key] = r * pc[c.key];
      }
      if (r > 0) {
        const w = who[pid] || {};
        const rec = (!w.pos && typeof playerRec === 'function') ? playerRec(pid) : null;
        out.left[rid].push({ pid, rem: r, cats: todo,
          pos: String(w.pos || (rec && rec.pos) || '').toUpperCase(),
          name: w.name || (rec && rec.name) || '' });
      }
    }
  }
  return out;
}

// Projected category totals for the week in view, or null when projections don't apply.
async function loadProjectedCats(matchups, stats) {
  if (!projectionsApply()) return null;
  const season = S.league.season, week = S.selectedWeek;
  const [proj, prog] = await Promise.all([
    loadWeekProjections(season, week),
    loadGameProgress(season, week),
  ]);
  if (!proj || !Object.keys(proj.stats).length) return null;
  return blendProjections(matchups, stats || {}, proj, prog);
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
