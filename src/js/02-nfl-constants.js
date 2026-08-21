// ─── NFL reference constants ──────────────────────────────────────────────
// Fixed lookup tables (32 teams, never changes mid-season) plus the CDN URL builders the
// player card and roster views use for logos and headshots. Keeping these as literals means
// no extra network round-trip and no CORS surface — they're pure string builders.

const NFL_LOGO = t => `https://static.www.nfl.com/t_headshot_desktop/f_auto/league/api/clubs/logos/${t === 'JAX' ? 'JAC' : t}`;
const SLEEPER_HEADSHOT = pid => `https://sleepercdn.com/content/nfl/players/${pid}.jpg`;
const SLEEPER_HEADSHOT_THUMB = pid => `https://sleepercdn.com/content/nfl/players/thumb/${pid}.jpg`;
// ESPN athlete headshot — the fallback when Sleeper has no photo (common for rookies and
// recent signings). league = 'nfl' | 'college-football'.
const ESPN_HEADSHOT = (league, id) => `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;
const NCAA_LOGO = id => `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png`;

// Primary club colors, used to tint the player-card hero.
const TEAM_COLORS = {
  ARI:'#97233F', ATL:'#A71930', BAL:'#241773', BUF:'#00338D', CAR:'#0085CA',
  CHI:'#0B162A', CIN:'#FB4F14', CLE:'#311D00', DAL:'#003594', DEN:'#FB4F14',
  DET:'#0076B6', GB:'#203731',  HOU:'#03202F', IND:'#002C5F', JAX:'#006778',
  KC:'#E31837',  LAC:'#0080C6', LAR:'#003594', LV:'#000000',  MIA:'#008E97',
  MIN:'#4F2683', NE:'#002244',  NO:'#D3BC8D',  NYG:'#0B2265', NYJ:'#125740',
  PHI:'#004C54', PIT:'#FFB612', SEA:'#002244', SF:'#AA0000',  TB:'#D50A0A',
  TEN:'#0C2340', WAS:'#5A1414',
};
const TEAM_NAMES = {
  ARI:'Arizona Cardinals', ATL:'Atlanta Falcons', BAL:'Baltimore Ravens', BUF:'Buffalo Bills',
  CAR:'Carolina Panthers', CHI:'Chicago Bears', CIN:'Cincinnati Bengals', CLE:'Cleveland Browns',
  DAL:'Dallas Cowboys', DEN:'Denver Broncos', DET:'Detroit Lions', GB:'Green Bay Packers',
  HOU:'Houston Texans', IND:'Indianapolis Colts', JAX:'Jacksonville Jaguars', KC:'Kansas City Chiefs',
  LAC:'Los Angeles Chargers', LAR:'Los Angeles Rams', LV:'Las Vegas Raiders', MIA:'Miami Dolphins',
  MIN:'Minnesota Vikings', NE:'New England Patriots', NO:'New Orleans Saints', NYG:'New York Giants',
  NYJ:'New York Jets', PHI:'Philadelphia Eagles', PIT:'Pittsburgh Steelers', SEA:'Seattle Seahawks',
  SF:'San Francisco 49ers', TB:'Tampa Bay Buccaneers', TEN:'Tennessee Titans', WAS:'Washington Commanders',
};
function teamColor(t){ return TEAM_COLORS[String(t || '').toUpperCase()] || '#2b2f3a'; }
function teamDisplayName(code){ return TEAM_NAMES[String(code || '').toUpperCase()] || code || ''; }

// Relative luminance (0..1) of a hex color, for choosing readable text over it.
function hexLum(hex){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
// Mix a hex color toward black by `amt` (0..1) — a few club primaries (PIT gold, NO gold) are
// light enough that white hero text on them is unreadable.
function darkenHex(hex, amt){
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r * (1 - amt)); g = Math.round(g * (1 - amt)); b = Math.round(b * (1 - amt));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

// Height comes off Sleeper as total inches ("76") or occasionally pre-formatted. Render 6'4".
function fmtHeight(h){
  if (h == null || h === '') return '–';
  const s = String(h).trim();
  if (s.includes("'")) return s;
  const inches = parseInt(s, 10);
  if (isNaN(inches) || inches <= 0) return '–';
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}
