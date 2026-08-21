'use strict';
// ─── Config ───────────────────────────────────────────────────────────────
const ROOT_LEAGUE_ID       = '1389348066355609601';
const API                  = 'https://api.sleeper.app/v1';
// api.sleeper.com (no /v1) is the newer host carrying per-player weekly stats and weekly
// projections. Both are public, read-only and CORS-open, same as the /v1 endpoints.
const API2                 = 'https://api.sleeper.com';
const AR_INTERVAL_MS       = 5 * 60 * 1000;  // auto-refresh every 5 min
const REGULAR_SEASON_WEEKS = 14;              // weeks 1–14 are regular season
const DH_WEEKS             = [2, 3, 13, 14];  // weeks that have a double header
const PLAYOFF_CUTOFF       = 4;              // top 4 teams make playoffs

// ─── Sleeper endpoints ────────────────────────────────────────────────────
const SLEEPER_PLAYERS_URL    = `${API}/players/nfl`;
const SLEEPER_STATE_URL      = `${API}/state/nfl`;
// One player's whole season, week by week. This is what makes the player card work without a
// pre-baked seed: one request per player-season, fetched only when that season tab is opened.
const SLEEPER_WEEKLY_URL     = (pid, season) =>
  `${API2}/stats/nfl/player/${pid}?season_type=regular&season=${season}&grouping=week`;
// Projections for one week — the basis of the live matchup projections. Filtered to the five
// positions BAFL actually rosters: unfiltered this response is ~9,400 rows / 625KB gzipped,
// and the filter cuts it to ~3,300 rows / 230KB. Nothing outside these positions can ever
// appear in a BAFL starting lineup, so the rest is pure download cost.
const BAFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K'];
const SLEEPER_WEEK_PROJ_URL  = (season, week) =>
  `${API2}/projections/nfl/${season}/${week}?season_type=regular`
  + BAFL_POSITIONS.map(p => `&position[]=${p}`).join('');

// Sleeper's weekly stats thin out badly before this; don't offer season tabs we can't fill.
const EARLIEST_STAT_SEASON = 2009;

// ─── State ────────────────────────────────────────────────────────────────
const S = {
  seasons: [],       // [{id, season, name, league}] newest-first
  seasonIdx: 0,
  league: null,
  users: [],
  rosters: [],
  userMap:   {},
  rosterMap: {},
  currentWeek: 1,
  selectedWeek: 1,
  activeTab: 'matchups',
  weekCache: {},     // `${leagueId}:${week}` → {matchups, stats}
  schedCache: {},    // `${leagueId}:sched:${week}` → [matchup,...] (structure only)
  dhMatchups: null,  // null = not computed; {2:[{r1,r2}],...} when computed
  dhHistory: {},     // exact DH data keyed by season year, loaded from double_headers.json
  allLoadedFor: '',
  playersCache: null,   // slimmed player dict: pid → {name, pos, team, …}
  playersPromise: null, // in-flight load, so concurrent callers share one fetch
  ownerByPid: null,     // pid → roster_id, rebuilt per season (drives "who rosters him?")
  nflSeason: null,      // current NFL season year, from Sleeper's state endpoint
  weeklyCache: {},      // `${season}:${pid}` → raw weekly json (player card)
  projCache: {},        // `${season}:${week}` → pid → projected stats
  seasonStarted: false, // false when league is pre_draft / not yet scheduled
  arEnabled: true,
  arTimer: null,
  arCountTimer: null,
  arNextAt: null,
};

// Convenience: ID of the league currently in view
function lid() { return S.seasons[S.seasonIdx]?.id || ROOT_LEAGUE_ID; }
function isCurrentSeason() { return S.seasonIdx === 0; }
