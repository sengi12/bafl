// ═══════════════════════════════════════════════════════════════════════════
// Defense vs position
// ═══════════════════════════════════════════════════════════════════════════
// The player card lists a player's whole season — games played and games to come — and
// colours each opponent by how generous that defense has been to his position, the way
// Sleeper does: green for a defense that gives up a lot to the position, red for one that
// shuts it down. "Generous" is measured in BAFL terms, not fantasy points: the category
// yards a defense allows plus 20 per touchdown (roughly what a score is worth against the
// yardage categories), or kicking points allowed for kickers.
//
// NO SEED, same as everything else here. Sleeper's weekly stat rows carry the opponent on
// every line, so one position-filtered request per week (~90KB gzipped) gives every
// defense's allowed production for that week. Each completed week's aggregate is tiny and
// never changes, so it is persisted in Cache Storage — the season is downloaded once per
// device, not once per card. Only the week in progress is refetched.
//
// "The season as a whole" is thin in September. Until DVP_PRIOR_GAMES games have been
// played, last season's per-game figure fills in for the games not yet played (a defense
// with two games this year is judged on those two plus four games' worth of last year's
// average), so week 2 colours are still worth reading and the blend fades out by October.

const DVP_PRIOR_GAMES = 6;
const DVP_CACHE = 'bafl-dvp-v1';
const DVP_BATCH = 4;

// One stat line → the production BAFL cares about, as one number.
function dvpMetric(stats, pos) {
  const c = baflPlayerCats(stats);
  return pos === 'K' ? c.kicking : baflTotalYards(c) + 20 * c.tds;
}

// One week of Sleeper rows → { DEF: { POS: total allowed } }. Only players who actually
// played count, and — for a week still in progress — only rows from games that are over,
// so a half-played game can't be credited as a full one. `doneGames` is null for a
// completed week (everything counts) or the set of finished game_ids otherwise.
function dvpWeekAggregate(rows, doneGames) {
  const agg = {};
  for (const r of (rows || [])) {
    const s = r.stats;
    if (!s || !(s.gp > 0)) continue;
    if (doneGames && !doneGames.has(String(r.game_id))) continue;
    const def = String(r.opponent || '').toUpperCase();
    if (!def) continue;
    const pos = String((r.player && r.player.position) || s.pos || '').toUpperCase();
    if (!BAFL_POSITIONS.includes(pos)) continue;
    const t = agg[def] = agg[def] || {};
    t[pos] = (t[pos] || 0) + dvpMetric(s, pos);
  }
  return agg;
}

// Rank 1 = the MOST allowed = the matchup to attack. Per position, over the defenses that
// have a figure; `n` is how many were ranked, for the tier bands.
function dvpRanks(perGame) {
  const ranks = {}, n = {};
  for (const pos of BAFL_POSITIONS) {
    const order = Object.keys(perGame).filter(d => perGame[d][pos] != null)
      .sort((a, b) => perGame[b][pos] - perGame[a][pos]);
    n[pos] = order.length;
    order.forEach((d, i) => { (ranks[d] = ranks[d] || {})[pos] = i + 1; });
  }
  return { ranks, n };
}
// 'easy' for the top ~30%, 'hard' for the bottom ~30%, 'mid' between; '' when unranked.
function dvpTier(rank, n) {
  if (!rank || !n) return '';
  const band = Math.ceil(n * 0.3);
  return rank <= band ? 'easy' : rank > n - band ? 'hard' : 'mid';
}

// ── Per-week aggregates, persisted ────────────────────────────────────────
async function readDvpWeek(key) {
  try {
    if (!('caches' in window)) return null;
    const c = await caches.open(DVP_CACHE);
    const hit = await c.match(`dvp/${key}`);
    return hit ? await hit.json() : null;
  } catch { return null; }
}
async function writeDvpWeek(key, agg) {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open(DVP_CACHE);
    await c.put(`dvp/${key}`, new Response(JSON.stringify(agg), { headers: { 'Content-Type': 'application/json' } }));
  } catch { /* private mode or quota — recomputed next session */ }
}
async function dvpWeek(season, week, doneGames) {
  const key = `${season}:${week}`;
  const complete = !doneGames;
  if (complete) { const hit = await readDvpWeek(key); if (hit) return hit; }
  const rows = await fetchSoft(SLEEPER_WEEK_STATS_URL(season, week), null);
  if (!Array.isArray(rows)) return null;
  const agg = dvpWeekAggregate(rows, doneGames);
  if (complete && Object.keys(agg).length) writeDvpWeek(key, agg);
  return agg;
}

// ── The season ────────────────────────────────────────────────────────────
// Resolves to {perGame: DEF → POS → allowed per game, ranks, n, games, weeks, prior} or
// null when nothing could be loaded. Cached per season for the session; a failure is not
// cached, so the next card gets another try.
function loadDvp(season, opts) {
  const key = String(season);
  if (S.dvpCache[key]) return S.dvpCache[key];
  S.dvpCache[key] = buildDvp(season, opts || {}).catch(() => null)
    .then(v => { if (!v) delete S.dvpCache[key]; return v; });
  return S.dvpCache[key];
}

async function buildDvp(season, opts) {
  const sched = await loadNflSchedule(season);
  if (!sched) return null;
  // Completed games per defense, and the weeks with any — the schedule is the divisor, so a
  // shutout (no rows for a position) still counts as a game the defense played.
  const games = {}, byWeek = {};
  for (const g of sched.games) {
    const wk = Number(g.week);
    if (!wk || wk > 18) continue;
    const st = String(g.status || '').toLowerCase();
    (byWeek[wk] = byWeek[wk] || { all: 0, done: new Set() }).all++;
    if (st !== 'complete') continue;
    byWeek[wk].done.add(String(g.game_id));
    games[g.home] = (games[g.home] || 0) + 1;
    games[g.away] = (games[g.away] || 0) + 1;
  }
  const weeks = Object.keys(byWeek).map(Number).filter(w => byWeek[w].done.size > 0).sort((a, b) => a - b);
  const totals = {};
  for (let i = 0; i < weeks.length; i += DVP_BATCH) {
    const chunk = weeks.slice(i, i + DVP_BATCH);
    const aggs = await Promise.all(chunk.map(w => {
      const b = byWeek[w];
      return dvpWeek(season, w, b.done.size === b.all ? null : b.done);
    }));
    for (const agg of aggs) {
      for (const def in (agg || {})) {
        const t = totals[def] = totals[def] || {};
        for (const pos in agg[def]) t[pos] = (t[pos] || 0) + agg[def][pos];
      }
    }
  }
  // Early season: last year's per-game figure stands in for the games not yet played.
  let prior = null;
  const thin = weeks.length < DVP_PRIOR_GAMES;
  if (thin && !opts.noPrior && Number(season) - 1 >= EARLIEST_STAT_SEASON) {
    prior = await loadDvp(Number(season) - 1, { noPrior: true });
  }
  if (!weeks.length && !prior) return null;
  const perGame = {};
  const codes = new Set([...Object.keys(games), ...Object.keys(prior ? prior.perGame : {})]);
  for (const def of codes) {
    const g = games[def] || 0;
    const w = prior ? Math.max(0, DVP_PRIOR_GAMES - g) : 0;
    perGame[def] = {};
    for (const pos of BAFL_POSITIONS) {
      const v = (totals[def] && totals[def][pos]) || 0;
      const pv = prior && prior.perGame[def] ? prior.perGame[def][pos] : null;
      const num = v + (pv != null ? pv * w : 0);
      const den = g + (pv != null ? w : 0);
      if (den > 0) perGame[def][pos] = num / den;
    }
  }
  const { ranks, n } = dvpRanks(perGame);
  return { season: String(season), weeks: weeks.length, games, perGame, ranks, n, prior: !!prior };
}
