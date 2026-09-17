// ─── Data loading ─────────────────────────────────────────────────────────
async function loadWeek(week) {
  const key = `${lid()}:${week}`;
  if (S.weekCache[key]) return S.weekCache[key];
  const season = S.league.season;
  const [matchups, stats] = await Promise.all([
    fetchJ(`${API}/league/${lid()}/matchups/${week}`),
    fetchJ(`${API}/stats/nfl/regular/${season}/${week}`),
  ]);
  S.weekCache[key] = { matchups: matchups || [], stats: stats || {} };
  return S.weekCache[key];
}

async function loadAllWeeks(onProgress) {
  if (S.allLoadedFor === lid()) return;
  // Only load the 14 regular-season weeks — playoff weeks are not counted in standings/leaders
  const maxWeek = Math.min(S.currentWeek, REGULAR_SEASON_WEEKS);
  const weeks = Array.from({length: maxWeek}, (_, i) => i + 1);
  const BATCH = 4;
  for (let i = 0; i < weeks.length; i += BATCH) {
    const chunk = weeks.slice(i, i + BATCH);
    await Promise.all(chunk.map(w => loadWeek(w).catch(() => null)));
    if (onProgress) onProgress(Math.min(i + BATCH, weeks.length), weeks.length);
  }
  S.allLoadedFor = lid();
}

// Load matchup structure only (no stats) — used for DH computation
async function loadSchedule(week) {
  const fullKey = `${lid()}:${week}`;
  if (S.weekCache[fullKey]) return S.weekCache[fullKey].matchups;
  const sKey = `${lid()}:sched:${week}`;
  if (S.schedCache[sKey]) return S.schedCache[sKey];
  const m = await fetchJ(`${API}/league/${lid()}/matchups/${week}`).catch(() => []);
  S.schedCache[sKey] = m || [];
  return S.schedCache[sKey];
}

// Which teams play a double header each DH week — derived from the schedule, so a new season
// needs nothing pinned. The principle: a double header is a game against a team you would
// otherwise face only once, and every such pair gets exactly one.
//
// Sleeper's 14-week slate for a 10-team league has each team meeting 5 opponents twice and
// 4 once; those 20 once-only pairs are the double headers, four per team, one per DH week.
// Sleeper builds the season as nine distinct weeks plus five repeats, which leaves four
// "source weeks" whose matchups are entirely once-only pairs. Every pinned season (2023–2025)
// used exactly those weeks' matchups as its double headers; which DH week each landed in is
// the one thing that has varied. 2025's convention is followed here:
//   source weeks [6,7,8,9] → DH weeks [2,3,13,14], lower half to the late weeks (6→13, 7→14)
//   and upper half to the early ones (8→2, 9→3).
// (2023 and 2024 mapped them in straight order, 6→2 … 9→14 — same pairs, different weeks.)
// A schedule without clean source weeks falls to dhFactorization, which splits the once-only
// pairs into four perfect matchings by backtracking. Either way the result is checked by
// dhProblems: every team once per DH week, every pair once-only, no pair repeated.
async function getDHMatchups() {
  if (S.dhMatchups !== null) return S.dhMatchups;
  if (!S.seasonStarted) { S.dhMatchups = {}; return S.dhMatchups; }

  // Use exact historical data when available (keyed by season year, e.g. "2025")
  // Add entries to double_headers.json to lock in accurate data for past seasons.
  const histExact = S.dhHistory[String(S.league.season)];
  if (histExact) {
    S.dhMatchups = {};
    for (const [wk, pairs] of Object.entries(histExact)) {
      S.dhMatchups[parseInt(wk)] = pairs;
    }
    return S.dhMatchups;
  }

  const allMatchups = await Promise.all(
    Array.from({length: REGULAR_SEASON_WEEKS}, (_, i) => loadSchedule(i + 1))
  );

  // Count how many times each pair plays and record pairs per week
  const pairCount = {};
  const weekPairs = [];

  for (let wi = 0; wi < REGULAR_SEASON_WEEKS; wi++) {
    const matchups = allMatchups[wi];
    const pairs = [];
    const groups = {};
    for (const m of matchups) {
      if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
      groups[m.matchup_id].push(m.roster_id);
    }
    for (const rids of Object.values(groups)) {
      if (rids.length < 2) continue;
      const lo = Math.min(...rids), hi = Math.max(...rids);
      const key = `${lo}:${hi}`;
      pairCount[key] = (pairCount[key] || 0) + 1;
      pairs.push({ lo, hi, key });
    }
    weekPairs.push(pairs);
  }

  // Once-only pairs: teams that play each other only once in the regular season
  const oncePairs = new Set(
    Object.entries(pairCount).filter(([, c]) => c === 1).map(([k]) => k)
  );

  // Source weeks: regular-season weeks where every matchup is a once-only pair.
  // These are used as the DH opponent templates.
  const sourceWeeks = weekPairs
    .map((pairs, wi) => ({ week: wi + 1, pairs }))
    .filter(({ pairs }) => pairs.length === 5 && pairs.every(p => oncePairs.has(p.key)))
    .sort((a, b) => a.week - b.week);

  const sortedDHWeeks = [...DH_WEEKS].sort((a, b) => a - b);
  const dh = {};

  if (sourceWeeks.length === DH_WEEKS.length) {
    // Interleave: lower source weeks -> upper DH weeks; upper source -> lower DH weeks
    const n = sourceWeeks.length;
    const half = Math.floor(n / 2);
    for (let i = 0; i < n; i++) {
      const dhIdx = i < half ? i + half : i - half;
      const dhWk  = sortedDHWeeks[dhIdx];
      dh[dhWk] = sourceWeeks[i].pairs
        .sort((a, b) => a.lo - b.lo || a.hi - b.hi)
        .map(({ lo, hi }) => ({ r1: lo, r2: hi }));
    }
  } else {
    // Fallback for a schedule without clean source weeks: split the once-only pairs into one
    // perfect matching per DH week. This backtracks across ALL the weeks — choosing week 2's
    // matching greedily could leave a remainder that no later week can pair off — and only
    // if no full split exists does it settle for the greedy week-by-week matching.
    const edges = [...oncePairs]
      .map(k => k.split(':').map(Number))
      .sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    const teams = [...new Set(edges.flat())].sort((a, b) => a - b);
    let rounds = dhFactorization(edges, sortedDHWeeks.length, teams);
    if (!rounds) {
      rounds = [];
      let remaining = edges;
      for (let i = 0; i < sortedDHWeeks.length; i++) {
        const matching = findPerfectMatching(remaining);
        const used = new Set(matching.map(([a, b]) => `${a}:${b}`));
        rounds.push(matching);
        remaining = remaining.filter(([a, b]) => !used.has(`${a}:${b}`));
      }
    }
    sortedDHWeeks.forEach((wk, i) => {
      dh[wk] = (rounds[i] || []).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(([r1, r2]) => ({ r1, r2 }));
    });
  }

  const problems = dhProblems(dh, oncePairs, S.rosters.map(r => r.roster_id));
  if (problems.length) console.warn('Double headers: ' + problems.join('; '));
  S.dhMatchups = dh;
  return dh;
}

// What a correct double-header slate looks like, as a list of violations (empty = sound):
// every DH week pairs every team exactly once; every pair is one the two teams meet only
// once in the regular schedule; no pair is used in two DH weeks.
function dhProblems(dh, oncePairs, teams) {
  const out = [], seen = new Set();
  const all = new Set((teams || []).map(Number));
  for (const wk of Object.keys(dh)) {
    const pairs = dh[wk] || [];
    const used = new Set();
    for (const { r1, r2 } of pairs) {
      const key = `${Math.min(r1, r2)}:${Math.max(r1, r2)}`;
      if (oncePairs && !oncePairs.has(key)) out.push(`week ${wk}: ${r1} v ${r2} already meet twice`);
      if (seen.has(key)) out.push(`week ${wk}: ${r1} v ${r2} is a repeat double header`);
      seen.add(key);
      for (const r of [r1, r2]) { if (used.has(r)) out.push(`week ${wk}: team ${r} listed twice`); used.add(r); }
    }
    if (all.size && used.size !== all.size) out.push(`week ${wk}: ${used.size} of ${all.size} teams have a double header`);
  }
  return out;
}

// Every perfect matching of `edges` over `verts`, lazily, each as an array of [a, b].
function* perfectMatchings(edges, verts) {
  if (!verts.length) { yield []; return; }
  const v = verts[0];
  for (const [a, b] of edges) {
    if (a !== v && b !== v) continue;
    const u = a === v ? b : a;
    if (!verts.includes(u)) continue;
    const rest = verts.filter(x => x !== v && x !== u);
    const restEdges = edges.filter(([x, y]) => x !== v && y !== v && x !== u && y !== u);
    for (const m of perfectMatchings(restEdges, rest)) yield [[v, u], ...m];
  }
}
// Split `edges` into `rounds` edge-disjoint perfect matchings over `teams`, or null if no
// such split exists. Depth-first over the rounds, so an early choice that strands the
// remainder is undone rather than shipped.
function dhFactorization(edges, rounds, teams) {
  if (rounds === 0) return [];
  for (const m of perfectMatchings(edges, teams)) {
    const used = new Set(m.map(([a, b]) => `${a}:${b}`));
    const rest = dhFactorization(edges.filter(([a, b]) => !used.has(`${a}:${b}`)), rounds - 1, teams);
    if (rest) return [m, ...rest];
  }
  return null;
}
function findPerfectMatching(edges) {
  if (!edges.length) return [];
  const verts = [...new Set(edges.flatMap(([a,b]) => [a,b]))].sort((a,b) => a-b);
  const result = [];
  const used   = new Set();
  function bt(el) {
    let pivot = -1;
    for (const v of verts) { if (!used.has(v)) { pivot = v; break; } }
    if (pivot === -1) return true;
    for (const [a, b] of el) {
      if (used.has(a) || used.has(b) || (a !== pivot && b !== pivot)) continue;
      used.add(a); used.add(b);
      result.push([Math.min(a,b), Math.max(a,b)]);
      if (bt(el.filter(([x,y]) => !used.has(x) && !used.has(y)))) return true;
      result.pop(); used.delete(a); used.delete(b);
    }
    return false;
  }
  bt(edges);
  return result;
}


