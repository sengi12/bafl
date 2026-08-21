// ─── NFL player database ──────────────────────────────────────────────────
// Sleeper's player dictionary is the single largest thing this app downloads — roughly 10MB
// of JSON covering every player it has ever known. The old code fetched it in full on the
// first roster-modal open of every session and held the raw object in memory.
//
// Two changes here:
//   1. SLIM IT. We keep ~12 fields per player out of the ~40 Sleeper sends; the retained
//      object is a small fraction of the original, which matters on a phone where the raw
//      parse is the peak memory moment of the session.
//   2. PERSIST IT. The slim dict goes into Cache Storage under a day-stamped key, so the
//      second visit (and every roster open after a reload) is a local read instead of a 10MB
//      download. Rosters change daily at most, so a 1-day TTL is not a meaningful staleness
//      risk — and a stale hit still beats no data.
const PLAYERS_CACHE = 'bafl-players-v1';
const PLAYERS_TTL_MS = 24 * 60 * 60 * 1000;

function slimPlayers(raw) {
  const slim = {};
  for (const pid in raw) {
    const p = raw[pid];
    // Team defenses have no person behind them and never appear in a BAFL starting lineup
    // as a scoring category — skip them rather than carry 32 stub records.
    if (!p || !p.position || p.position === 'DEF') continue;
    slim[pid] = {
      player_id: pid,
      name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
      first_name: p.first_name || '',
      last_name: p.last_name || '',
      pos: p.position,
      team: p.team || null,
      age: p.age != null ? p.age : null,
      years_exp: p.years_exp != null ? p.years_exp : null,
      height: p.height || null,
      weight: p.weight || null,
      college: p.college || null,
      number: p.number != null ? p.number : null,
      espn_id: p.espn_id != null ? String(p.espn_id) : null,
    };
  }
  return slim;
}

// Cache Storage rather than localStorage: localStorage is a synchronous ~5MB-quota store and
// this payload would either blow the quota or block the main thread writing it.
async function readPlayersCache() {
  try {
    if (!('caches' in window)) return null;
    const c = await caches.open(PLAYERS_CACHE);
    const hit = await c.match('players');
    if (!hit) return null;
    const stamp = Number(hit.headers.get('x-bafl-cached-at') || 0);
    if (!stamp || Date.now() - stamp > PLAYERS_TTL_MS) return null;
    return await hit.json();
  } catch { return null; }
}
async function writePlayersCache(slim) {
  try {
    if (!('caches' in window)) return;
    const c = await caches.open(PLAYERS_CACHE);
    await c.put('players', new Response(JSON.stringify(slim), {
      headers: { 'Content-Type': 'application/json', 'x-bafl-cached-at': String(Date.now()) },
    }));
  } catch { /* quota or private mode — the in-memory copy still works this session */ }
}

async function loadPlayers() {
  if (S.playersCache) return S.playersCache;
  if (S.playersPromise) return S.playersPromise;   // a load is already running — share it
  S.playersPromise = (async () => {
    const cached = await readPlayersCache();
    if (cached) { S.playersCache = cached; return cached; }
    const raw = await fetchJ(SLEEPER_PLAYERS_URL);
    const slim = slimPlayers(raw);
    S.playersCache = slim;
    writePlayersCache(slim);   // fire-and-forget; nothing waits on the write
    return slim;
  })();
  try {
    return await S.playersPromise;
  } catch (e) {
    S.playersPromise = null;   // clear so a later attempt can retry
    throw e;
  }
}

function playerRec(pid) {
  return (S.playersCache && S.playersCache[String(pid)]) || null;
}
function playerName(pid) {
  const p = playerRec(pid);
  return (p && p.name) || String(pid);
}

// ─── Ownership index ──────────────────────────────────────────────────────
// pid → roster_id for every rostered player in the season being viewed. Rebuilt whenever the
// season loads. This is what lets a player card, or a search result, say who owns him.
function buildOwnerIndex() {
  const idx = {};
  for (const r of S.rosters) {
    for (const pid of (r.players || [])) idx[String(pid)] = r.roster_id;
  }
  S.ownerByPid = idx;
}
function ownerOf(pid) {
  const rid = S.ownerByPid && S.ownerByPid[String(pid)];
  return rid ? { rid, name: S.rosterMap[rid] || `Team ${rid}` } : null;
}

// ─── Season eligibility ───────────────────────────────────────────────────
// Which NFL seasons is it worth offering a tab for? Sleeper carries `years_exp`, so a player's
// rookie year is (current season − years_exp). That's a candidate list, not a guarantee —
// years_exp is wrong or missing often enough that the card also treats an empty stats response
// as "no games that year" and greys the tab out. Deriving the list up front means the tabs
// render instantly; verifying lazily means a bad years_exp self-corrects on first click.
async function currentNflSeason() {
  if (S.nflSeason) return S.nflSeason;
  const st = await fetchSoft(SLEEPER_STATE_URL);
  const yr = st && (st.season || st.league_season);
  // Fall back to the league we're viewing rather than the wall clock — in January the calendar
  // year has already rolled over but the NFL season being played has not.
  S.nflSeason = Number(yr) || Number(S.league && S.league.season) || new Date().getFullYear();
  return S.nflSeason;
}
async function eligibleSeasons(pid) {
  const cur = await currentNflSeason();
  const p = playerRec(pid);
  const exp = p && Number.isFinite(Number(p.years_exp)) ? Number(p.years_exp) : null;
  // No years_exp at all → offer a conservative recent window rather than nothing.
  const first = exp == null ? cur - 4 : cur - exp;
  const start = Math.max(EARLIEST_STAT_SEASON, Math.min(first, cur));
  const out = [];
  for (let y = cur; y >= start; y--) out.push(String(y));
  return out;
}
