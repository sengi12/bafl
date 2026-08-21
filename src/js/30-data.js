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

// Deterministically compute which teams need a double header each DH week.
// Algorithm:
//   1. Fetch the full 14-week schedule to count how often each pair plays.
//   2. Pairs that play only once are the "missing" matchups.
//   3. Sort missing pairs by (lower_rid ASC, higher_rid ASC) for stability.
//   4. Chunk evenly into DH_WEEKS in order.
// Compute DH matchups by finding "source weeks" - regular-season weeks
// whose matchups are all once-only pairs - then assigning them to DH weeks.
// Pattern verified against 2025 double_headers.json:
//   source weeks [6,7,8,9], DH weeks [2,3,13,14]
//   lower half source -> upper DH:  6->13, 7->14
//   upper half source -> lower DH:  8->2,  9->3
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
    // Fallback: backtracking perfect matching
    let remaining = [...oncePairs]
      .map(k => k.split(':').map(Number))
      .sort((a, b) => a[0] !== b[0] ? a[0] - b[0] : a[1] - b[1]);
    for (const wk of sortedDHWeeks) {
      const matching = findPerfectMatching(remaining);
      const usedSet  = new Set(matching.map(([a,b]) => `${a}:${b}`));
      dh[wk]    = matching.sort((a,b) => a[0]-b[0]||a[1]-b[1]).map(([r1,r2]) => ({r1,r2}));
      remaining = remaining.filter(([a,b]) => !usedSet.has(`${a}:${b}`));
    }
  }

  S.dhMatchups = dh;
  return dh;
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


