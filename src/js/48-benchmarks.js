// ═══════════════════════════════════════════════════════════════════════════
// Positional benchmarks
// ═══════════════════════════════════════════════════════════════════════════
// What counts as a good game depends entirely on the position and the season. Hard-coded
// numbers get this wrong in both directions and age badly: the original TE benchmark of 60
// receiving yards sat ABOVE what the NFL's best tight end averaged, so no tight end could
// ever grade well no matter how good he was.
//
// So the benchmark is derived from the season being viewed:
//
//   1. Pull season totals for every player at the position (one request per position per
//      season, ~45–140KB gzipped, cached).
//   2. Reduce each to a per-game figure in the metric that matters in BAFL — total yards
//      (net of the interception penalty) for skill positions, kicking points for kickers.
//   3. Rank them, and find the LAST STARTABLE player: rank N, where N is how many of that
//      position the league actually starts league-wide (2 QB × 10 teams = 20, 1 TE × 10 = 10,
//      and so on, read from the league's own roster settings).
//   4. Benchmark = 85% of that player's per-game figure — roughly replacement level.
//
// Why a FRACTION of the last starter rather than a deeper rank: rank offsets don't mean the
// same thing in a 65-deep QB pool as in a 217-deep WR pool, which made wide receivers grade
// systematically worse than quarterbacks for no reason but positional depth. Scaling by
// production instead of rank is depth-independent — checked against 2025, it holds the median
// starter's hit rate within 58–76% across all five positions, versus a 21-point spread for
// rank-based definitions.
const BENCH_FACTOR = 0.85;   // share of the last starter's per-game output = replacement level
const BENCH_MIN_GP = 4;      // ignore tiny samples when ranking the pool
const BENCH_SEASON_STATS_URL = (season, pos) =>
  `${API2}/stats/nfl/${season}?season_type=regular&grouping=season&position%5B%5D=${pos}`;

// Slots per team, if the league object can't be read (matches BAFL's own settings).
const DEFAULT_STARTER_SLOTS = { QB: 2, RB: 2, WR: 2, TE: 1, K: 2 };
// Which positions each flex slot can be filled by.
const FLEX_ELIGIBLE = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};

// How many of this position get started across the whole league. Flex slots are counted
// toward every position eligible for them, which over-counts slightly in leagues that have
// them — harmless here, since BAFL has none, and it only nudges which player defines the bar.
function leagueStarterCount(pos) {
  const P = String(pos || '').toUpperCase();
  const teams = (S.rosters && S.rosters.length) || (S.league && S.league.total_rosters) || 10;
  const slots = (S.league && S.league.roster_positions) || null;
  if (!slots) return (DEFAULT_STARTER_SLOTS[P] || 1) * teams;
  let per = 0;
  for (const slot of slots) {
    if (slot === P) per++;
    else if (FLEX_ELIGIBLE[slot] && FLEX_ELIGIBLE[slot].includes(P)) per++;
  }
  if (!per) per = DEFAULT_STARTER_SLOTS[P] || 1;
  return per * teams;
}

// The BAFL value of one stat line, as a single number, for ranking and grading. Kickers are
// measured in kicking points; everyone else in total yards. This is the same figure the
// card's "yd/g" badge shows, so the badge and the grade always describe the same thing.
function benchMetric(stats, pos) {
  const c = baflPlayerCats(stats);
  return String(pos).toUpperCase() === 'K' ? c.kicking : baflTotalYards(c);
}

// Resolve (and cache) the benchmark for one position in one season.
// Returns {value, lastStarter, rank, pool} or null when the season has no usable data.
S.benchCache = S.benchCache || {};
function positionalBenchmark(pos, season) {
  const P = String(pos || '').toUpperCase();
  const key = `${season}:${P}`;
  if (S.benchCache[key] !== undefined) return S.benchCache[key];
  S.benchCache[key] = (async () => {
    const rows = await fetchSoft(BENCH_SEASON_STATS_URL(season, P), null);
    if (!Array.isArray(rows) || !rows.length) return null;
    const perGame = [];
    for (const r of rows) {
      const s = r.stats || {};
      const gp = s.gp || 0;
      if (gp < BENCH_MIN_GP) continue;    // one huge game shouldn't set the league's bar
      perGame.push(benchMetric(s, P) / gp);
    }
    if (perGame.length < 5) return null;
    perGame.sort((a, b) => b - a);
    const n = Math.min(leagueStarterCount(P), perGame.length);
    const lastStarter = perGame[n - 1];
    if (!(lastStarter > 0)) return null;
    return { value: lastStarter * BENCH_FACTOR, lastStarter, rank: n, pool: perGame.length };
  })().catch(() => null);
  return S.benchCache[key];
}

// ─── Grade curve ──────────────────────────────────────────────────────────
// Calibrated against every startable player at all five positions in 2025. Median starter
// hit rates by position landed at QB 76% / RB 66% / WR 64% / K 64% / TE 58%, so the C band
// starts at 50% to put a typical starter in C/B at every position — tight end included, which
// is the position the old fixed benchmarks punished hardest. A is reserved for players who
// clear replacement level in roughly five games out of six.
// Adjust these four numbers to move the curve; nothing else reads them.
const CONSISTENCY_CURVE = [
  [0.82, 'A'],
  [0.66, 'B'],
  [0.50, 'C'],
  [0.38, 'D'],
];
function consistencyGrade(rate) {
  for (const [floor, g] of CONSISTENCY_CURVE) if (rate >= floor) return g;
  return 'F';
}
