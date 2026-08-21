// ─── ESPN enrichment (draft info + college game logs) ─────────────────────
// Everything here is browser-reachable and needs no pre-baked data, which is the whole reason
// it survives the "no seed" constraint. Two things come from ESPN that Sleeper simply doesn't
// carry: where a player was drafted, and what he did in college. Both are optional — every
// lookup degrades to "show nothing" rather than failing the card.
const ESPN_SEARCH_URL   = q => `https://site.web.api.espn.com/apis/search/v2?query=${encodeURIComponent(q)}&limit=10`;
const ESPN_GAMELOG_URL  = (league, aid, season) =>
  `https://site.api.espn.com/apis/common/v3/sports/football/${league}/athletes/${aid}/gamelog${season ? `?season=${season}` : ''}`;
const ESPN_CORE_ATHLETE_URL = (season, aid) =>
  `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${season}/athletes/${aid}?lang=en&region=us`;

const ESPN_TEAM_ID = {ATL:1,BUF:2,CHI:3,CIN:4,CLE:5,DAL:6,DEN:7,DET:8,GB:9,TEN:10,
  IND:11,KC:12,LV:13,LAR:14,MIA:15,MIN:16,NE:17,NO:18,NYG:19,NYJ:20,PHI:21,ARI:22,
  PIT:23,LAC:24,SF:25,SEA:26,TB:27,WAS:28,CAR:29,JAX:30,BAL:33,HOU:34};
const ESPN_ID_TO_CODE = Object.fromEntries(Object.entries(ESPN_TEAM_ID).map(([c, i]) => [i, c]));

let espnAthleteIdCache = {};   // `${pid}:${league}` → athlete id ('' = looked up, none found)
let espnGamelogCache   = {};   // `${league}:${aid}:${season}` → gamelog json
let espnDraftCache     = {};   // aid → {year,round,selection,teamCode} | {undrafted} | null

// Search ESPN for an athlete id by name, preferring the wanted league (uid `~l:<id>~`:
// 28 = NFL, 23 = college). Falls back to the first player result so a last-resort lookup
// still resolves something.
async function searchEspnAthleteId(nm, wantLeagueId) {
  const s = await fetchSoft(ESPN_SEARCH_URL(nm));
  const results = (s && s.results) || [];
  let fallbackId = null;
  for (const r of results) {
    if (r.type !== 'player') continue;
    for (const it of (r.contents || [])) {
      const uid = it.uid || '';
      let m = /a:(\d+)/.exec(uid);
      if (!m) m = /\/id\/(\d+)\//.exec((it.link && it.link.web) || '');
      if (!m) continue;
      if (!fallbackId) fallbackId = m[1];
      const lm = /~l:(\d+)~/.exec(uid);
      if (lm && lm[1] === wantLeagueId) return m[1];
    }
  }
  return fallbackId;
}

// Resolve a player's ESPN athlete id. NFL: Sleeper's espn_id, else a name search. College:
// ESPN uses different ids per sport and a raw college name search often lands on a different
// same-named player, so we route through the NFL athlete record's authoritative
// `collegeAthlete` link and only name-search as a last resort.
async function resolveEspnAthleteId(pid, name, league) {
  const lg = league || 'nfl';
  const ck = `${pid}:${lg}`;
  if (espnAthleteIdCache[ck] != null) return espnAthleteIdCache[ck] || null;
  const p = playerRec(pid);
  const nm = name || (p && p.name) || '';
  if (lg === 'college-football') {
    const nflId = await resolveEspnAthleteId(pid, nm, 'nfl');
    if (nflId) {
      const season = await currentNflSeason();
      const core = await fetchSoft(ESPN_CORE_ATHLETE_URL(season, nflId));
      const cm = /\/athletes\/(\d+)/.exec((core && core.collegeAthlete && core.collegeAthlete.$ref) || '');
      if (cm) { espnAthleteIdCache[ck] = cm[1]; return cm[1]; }
    }
    const cid = nm ? await searchEspnAthleteId(nm, '23') : null;
    espnAthleteIdCache[ck] = cid || '';
    return cid || null;
  }
  if (p && p.espn_id) { espnAthleteIdCache[ck] = p.espn_id; return p.espn_id; }
  if (!nm) { espnAthleteIdCache[ck] = ''; return null; }
  const id = await searchEspnAthleteId(nm, '28');
  espnAthleteIdCache[ck] = id || '';
  return id || null;
}

async function fetchEspnGamelog(aid, league, season) {
  const key = `${league}:${aid}:${season || '_'}`;
  if (espnGamelogCache[key]) return espnGamelogCache[key];
  const data = await fetchJ(ESPN_GAMELOG_URL(league, aid, season));
  espnGamelogCache[key] = data;
  return data;
}

// Normalize ESPN's core-athlete `draft` object. {undrafted:true} means the record loaded but
// carries no draft (a real UDFA); null means the lookup itself failed — the difference matters,
// because one should render "Undrafted" and the other should render nothing at all.
function normalizeEspnDraft(d) {
  if (!d || typeof d !== 'object') return null;
  const dr = d.draft;
  if (!(dr && dr.year)) return { undrafted: true };
  const m = /\/teams\/(\d+)/.exec((dr.team && dr.team.$ref) || '');
  return {
    year: dr.year, round: dr.round, selection: dr.selection,
    teamCode: m ? (ESPN_ID_TO_CODE[parseInt(m[1])] || null) : null,
  };
}
async function fetchEspnDraftInfo(aid) {
  if (espnDraftCache[aid] !== undefined) return espnDraftCache[aid];
  const season = await currentNflSeason();
  const d = await fetchSoft(ESPN_CORE_ATHLETE_URL(season, aid));
  espnDraftCache[aid] = normalizeEspnDraft(d);
  return espnDraftCache[aid];
}
// Compact draft line for the card hero: "DRAFT 2021 · Rd 1, Pk 5 · CIN", or "Undrafted".
function espnDraftHero(info) {
  if (!info) return '';
  if (info.undrafted) {
    return `<span class="pc-draft-line"><span class="pc-draft-lbl">DRAFT</span><span class="muted">Undrafted</span></span>`;
  }
  const logo = info.teamCode
    ? `<img src="${NFL_LOGO(info.teamCode)}" class="pc-draft-logo" onerror="this.style.display='none'">` : '';
  const team = info.teamCode ? `<span class="pc-draft-team">${logo}${info.teamCode}</span>` : '';
  return `<span class="pc-draft-line"><span class="pc-draft-lbl">DRAFT</span>` +
    `<span>${info.year} · <span class="muted">Rd</span> ${info.round}, <span class="muted">Pk</span> ${info.selection}</span>${team}</span>`;
}

// ─── College gamelog rendering ────────────────────────────────────────────
// ESPN's gamelog payload is self-describing: it ships `labels`/`names` for whatever columns
// suit the player's position, so this renders whatever it's handed rather than hard-coding a
// schema per position.
function espnStatGroup(name) {
  const n = name || '';
  if (/^fieldGoal/i.test(n) || /^extraPoint/i.test(n) ||
      ['longFieldGoalMade','totalKickingPoints','kickExtraPoints'].includes(n)) return 'KICKING';
  if (/^punt/i.test(n) || ['grossAvgPuntYards','netAvgPuntYards','longPunt','touchbacks','puntsInside20'].includes(n)) return 'PUNTING';
  // yardsPerPassAttempt sits between CMP% and TD in ESPN's ordering, so leaving it unmatched
  // split the passing block into two groups with a stray gap in the middle.
  if (/^passing/.test(n) || ['completions','passingAttempts','completionPct','interceptions',
      'interceptionPct','longPassing','sacks','sackYardsLost','QBRating','adjQBR','ESPNQBRating',
      'yardsPerPassAttempt','avgGain','quarterbackRating','totalQBRating'].includes(n)) return 'PASSING';
  if (/^rushing/.test(n) || ['yardsPerRushAttempt','longRushing'].includes(n)) return 'RUSHING';
  if (/^receiving/.test(n) || ['receptions','yardsPerReception','longReception'].includes(n)) return 'RECEIVING';
  if (/^(totalTackles|soloTackles|assistTackles)$/.test(n)) return 'TACKLES';
  if (/^(passesDefended|interceptionYards|interceptionTouchdowns)$/.test(n)) return 'COVERAGE';
  if (/fumble/i.test(n)) return 'FUM';
  return 'MISC';
}
function espnColor(name, v) {
  if (v == null) return '';
  switch (name) {
    case 'receptions':            return triHigh(v, 6, 4);
    case 'receivingYards':        return triHigh(v, 80, 50);
    case 'yardsPerReception':     return triHigh(v, 14, 10);
    case 'receivingTouchdowns':   return triHigh(v, 1, 0.5);
    case 'longReception':         return triHigh(v, 25, 15);
    case 'rushingYards':          return triHigh(v, 80, 45);
    case 'yardsPerRushAttempt':   return triHigh(v, 5, 3.5);
    case 'rushingTouchdowns':     return triHigh(v, 1, 0.5);
    case 'longRushing':           return triHigh(v, 20, 10);
    case 'passingYards':          return triHigh(v, 275, 200);
    case 'completionPct':         return triHigh(v, 68, 58);
    case 'passingTouchdowns':     return triHigh(v, 2, 1);
    case 'interceptions':         return triLow(v, 0, 1);   // thrown → lower is better
    case 'sacks':                 return triLow(v, 1, 3);   // taken → lower is better
    case 'fumbles': case 'fumblesLost': return triLow(v, 0, 1);
    case 'totalTackles':          return triHigh(v, 7, 4);
    case 'passesDefended':        return triHigh(v, 2, 1);
    default: return '';
  }
}
function espnNum(s) {
  const n = parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Render one ESPN season into the same table shell the NFL gamelog uses, so the two tabs read
// identically — same frozen WK/OPP columns, same color grading, same totals row.
function renderEspnSeason(season, gl, league) {
  const labels = gl.labels || [], names = gl.names || [];
  if (!labels.length) return '';
  // Per-game stat arrays live under seasonTypes[].categories[].events[], keyed by event id;
  // the opponent/team metadata lives in a separate events{} map.
  const statsByEvent = {};
  (gl.seasonTypes || []).forEach(st => (st.categories || []).forEach(c => (c.events || []).forEach(ev => {
    statsByEvent[ev.eventId] = ev.stats;
  })));
  const events = gl.events || {};
  const teamMap = new Map();
  const rows = [];
  Object.keys(events).forEach(k => {
    const e = events[k];
    const stats = statsByEvent[e.id];
    if (!stats) return;
    const opp = e.opponent || {}, tm = e.team || {};
    if (tm.abbreviation) teamMap.set(tm.abbreviation, tm.logo || (tm.id ? NCAA_LOGO(tm.id) : ''));
    rows.push({
      week: e.week, date: e.gameDate, atVs: e.atVs || 'vs',
      oppAbbr: opp.abbreviation || '', oppLogo: opp.logo || (opp.id ? NCAA_LOGO(opp.id) : ''), stats,
    });
  });
  if (!rows.length) return '';
  rows.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const dispLabel = i => (names[i] === 'yardsPerReception' || names[i] === 'yardsPerRushAttempt') ? 'YPC' : labels[i];
  const grpOf = i => espnStatGroup(names[i]);
  let grpCells = '', colHead = '', gi = 0;
  while (gi < labels.length) {
    const g = grpOf(gi);
    let span = 1;
    while (gi + span < labels.length && grpOf(gi + span) === g) span++;
    grpCells += `<th class="pc-grp" colspan="${span}">${g === 'MISC' ? '' : g}</th><th></th>`;
    gi += span;
  }
  grpCells = grpCells.replace(/<th><\/th>$/, '');
  labels.forEach((l, i) => {
    colHead += ((i > 0 && grpOf(i) !== grpOf(i - 1)) ? '<th></th>' : '') + `<th>${esc(dispLabel(i))}</th>`;
  });
  const bodyRows = rows.map(r => {
    const cells = labels.map((l, i) => {
      const sep = (i > 0 && grpOf(i) !== grpOf(i - 1)) ? '<td></td>' : '';
      const v = r.stats[i];
      return sep + `<td class="pc-cell ${espnColor(names[i], espnNum(v))}">${(v == null || v === '') ? '–' : esc(v)}</td>`;
    }).join('');
    const oppTxt = r.oppAbbr
      ? `<span class="pc-opp-inner">${r.atVs === '@' ? '<span class="pc-at">@</span>' : '<span class="pc-vs">vs</span>'}` +
        `${r.oppLogo ? `<img src="${r.oppLogo}" class="pc-opp-logo" onerror="this.style.display='none'">` : ''}` +
        `<span>${esc(r.oppAbbr)}</span></span>`
      : '–';
    return `<tr><td class="pc-wk">${r.week != null ? r.week : ''}</td>` +
      `<td class="pc-opp ${r.atVs === '@' ? 'away' : 'home'}">${oppTxt}</td>${cells}</tr>`;
  }).join('');

  const totals = espnSeasonTotals(rows, names);
  let totalsRow = '';
  if (totals) {
    const tcells = labels.map((l, i) => {
      const sep = (i > 0 && grpOf(i) !== grpOf(i - 1)) ? '<td></td>' : '';
      return sep + `<td class="pc-cell pc-total-cell">${totals[i] == null ? '–' : esc(totals[i])}</td>`;
    }).join('');
    totalsRow = `<tr class="pc-total-row"><td class="pc-wk">TOT</td><td class="pc-opp">${rows.length}g</td>${tcells}</tr>`;
  }
  const teamTag = teamMap.size
    ? ` <span class="pc-season-team">· ${[...teamMap].map(([ab, lg]) =>
        `${lg ? `<img src="${lg}" class="pc-season-logo" onerror="this.style.display='none'">` : ''}${esc(ab)}`).join(' / ')}</span>`
    : '';
  const collegeTag = league === 'college-football' ? ` <span class="pc-college-tag">COLLEGE</span>` : '';
  return `<div class="pc-season">
    <div class="pc-season-title">${esc(season)}${collegeTag}${teamTag}</div>
    <div class="pc-table-scroll"><table class="pc-table">
      <thead>
        <tr><th></th><th></th>${grpCells}</tr>
        <tr><th class="pc-th-wk">WK</th><th>OPP</th>${colHead}</tr>
      </thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table></div>
  </div>`;
}
// Counting stats sum, "long" columns take the max, YPC/CMP% are recomputed from their summed
// components; every other rate is left blank rather than averaged into nonsense.
function espnSeasonTotals(rows, names) {
  if (!rows.length) return null;
  const n = names.length;
  const sum = new Array(n).fill(0), max = new Array(n).fill(null), seen = new Array(n).fill(false);
  const idxByName = {};
  names.forEach((nm, i) => { idxByName[nm] = i; });
  const isLong = nm => /^long/i.test(nm);
  const isRate = nm => /Pct$|yardsPer|Rating|QBR|avgGain|^avg/i.test(nm);
  rows.forEach(r => names.forEach((nm, i) => {
    const v = espnNum(r.stats[i]);
    if (v == null) return;
    seen[i] = true;
    if (isLong(nm)) max[i] = Math.max(max[i] == null ? -Infinity : max[i], v);
    else sum[i] += v;
  }));
  const out = new Array(n).fill(null);
  names.forEach((nm, i) => {
    if (!seen[i]) return;
    if (isLong(nm)) { out[i] = max[i] == null ? null : String(max[i]); return; }
    if (isRate(nm)) return;
    out[i] = Number.isInteger(sum[i]) ? String(sum[i]) : String(Math.round(sum[i] * 10) / 10);
  });
  const rec = (rateName, ydName, cntName, mult) => {
    if (idxByName[rateName] == null) return;
    const yd = idxByName[ydName] != null ? sum[idxByName[ydName]] : null;
    const ct = idxByName[cntName] != null ? sum[idxByName[cntName]] : null;
    if (yd != null && ct) out[idxByName[rateName]] = ((yd / ct) * (mult || 1)).toFixed(1);
  };
  rec('yardsPerReception', 'receivingYards', 'receptions');
  rec('yardsPerRushAttempt', 'rushingYards', 'rushingAttempts');
  rec('completionPct', 'completions', 'passingAttempts', 100);
  return out;
}
