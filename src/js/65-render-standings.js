// ─── Render: Standings tab ────────────────────────────────────────────────
// Beyond W/L, the standings now carry each team's season category totals, heat-mapped by
// league rank. In a category league that grid is the most informative thing on the page: it
// shows at a glance who is a kicking specialist propped up by one category, who is a passing
// juggernaut, and exactly where a trade could help.
//
// The table is wide by design, so it lives in a horizontal scroll container with the RANK and
// TEAM columns frozen — you never lose track of whose row you're reading.

// Colour a value by its rank within the league: best fifth green through worst fifth red.
function heatClass(rank, n) {
  if (!n || rank == null) return '';
  const q = (rank - 1) / Math.max(1, n - 1);   // 0 = best, 1 = worst
  if (q <= 0.2) return 'hm1';
  if (q <= 0.4) return 'hm2';
  if (q <= 0.6) return 'hm3';
  if (q <= 0.8) return 'hm4';
  return 'hm5';
}
// rid → 1-based rank for one category (highest total ranks first).
function rankMapFor(totals, key) {
  const order = Object.keys(totals).sort((a, b) => totals[b][key] - totals[a][key]);
  const out = {};
  order.forEach((rid, i) => { out[rid] = i + 1; });
  return out;
}

// Season category totals per roster — the same accumulation the Leaders tab does, kept here
// so the standings never has to wait on that tab having been visited.
function seasonCatTotals(rsWeek) {
  const totals = {};
  for (const r of S.rosters) {
    totals[r.roster_id] = { passing: 0, rushing: 0, receiving: 0, tds: 0, kicking: 0 };
  }
  for (let w = 1; w <= rsWeek; w++) {
    const wd = S.weekCache[`${lid()}:${w}`];
    if (!wd || !wd.matchups.length) continue;
    const cs = calcCatStats(wd.matchups, wd.stats);
    for (const r of S.rosters) {
      const rid = r.roster_id;
      for (const c of BAFL_CATS) totals[rid][c.key] += cs[c.key][rid] || 0;
    }
  }
  return totals;
}

// ─── Sortable table ───────────────────────────────────────────────────────
// The expensive part of the standings — loading every week and scoring every matchup — runs
// once per render into `standingsView`; a header click only re-sorts those rows and rewrites
// the table. Sort state lives in S so it survives a refresh and a week change.
//
// The RANK column is always the team's standings position (wins, then points for), whatever
// the table is sorted by: sorted by Passing, you can still see that the league's top passing
// team is sitting 7th. The playoff divider only makes sense in standings order, so it is drawn
// only then; the trophy on the rank cell marks the playoff teams in every order.
let standingsView = null;

const STANDINGS_COLS = [
  { key: 'rank',   label: 'Rank',   dir: 'asc'  },
  { key: 'team',   label: 'Team',   dir: 'asc'  },
  { key: 'record', label: 'Record', dir: 'desc' },
  { key: 'pf',     label: 'PF',     dir: 'desc', num: true },
  { key: 'pa',     label: 'PA',     dir: 'desc', num: true },
  ...BAFL_CATS.map(c => ({ key: c.key, label: c.label, short: c.short, dir: 'desc', num: true, cat: true })),
];

// Value a row sorts on for a column. `rank` is the standings position, so its ascending order
// IS the standings; `record` ranks wins, then points for, which is the same thing.
function standingsSortValue(row, key) {
  switch (key) {
    case 'rank':   return row.rank;
    case 'team':   return String(row.name || '').toLowerCase();
    case 'record': return row.wins + row.ties / 2 + row.pf / 1e6;
    case 'pf':     return row.pf;
    case 'pa':     return row.pa;
    default:       return row.cats[key] || 0;
  }
}
// Pure: rows sorted by one column in one direction, standings order breaking ties.
function sortStandingsRows(rows, key, dir) {
  const sign = dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = standingsSortValue(a, key), vb = standingsSortValue(b, key);
    const c = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return c !== 0 ? c * sign : a.rank - b.rank;
  });
}

function sortStandings(key) {
  const col = STANDINGS_COLS.find(c => c.key === key);
  if (!col || !standingsView) return;
  const cur = S.standingsSort || { key: 'rank', dir: 'asc' };
  // Same column again flips the direction; a new column starts on its natural side —
  // highest first for anything numeric, A→Z for names, 1st first for rank.
  S.standingsSort = cur.key === key ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: col.dir };
  const wrap = document.querySelector('.standings-wrap');
  if (wrap) wrap.outerHTML = standingsTableHTML(standingsView);
}

function standingsTableHTML(view) {
  const sort = S.standingsSort || { key: 'rank', dir: 'asc' };
  const rows = sortStandingsRows(view.rows, sort.key, sort.dir);
  const inOrder = sort.key === 'rank' && sort.dir === 'asc';
  const n = view.rows.length;

  const body = rows.map((s, i) => {
    const cutoff = inOrder && i === PLAYOFF_CUTOFF ? ' class="playoff-divider"' : '';
    const lbl    = inOrder && i === PLAYOFF_CUTOFF ? '<span class="divider-lbl">Out of Playoffs</span>' : '';
    const catCells = BAFL_CATS.map(c => {
      const v = s.cats[c.key] || 0;
      const rk = view.ranks[c.key][s.rid];
      const on = sort.key === c.key ? ' sorted' : '';
      return `<td class="s-cat ${heatClass(rk, n)}${on}" title="${escAttr(`${c.label}: ${Math.round(v).toLocaleString()} — ${ordinal(rk)} in the league`)}">
        ${Math.round(v).toLocaleString()}</td>`;
    }).join('');
    return `<tr${cutoff}>
      <td class="s-rank">${s.rank}${s.rank <= PLAYOFF_CUTOFF ? ' 🏆' : ''}</td>
      <td class="s-team"><span class="team-link" onclick="openRosterModal(${s.rid})">${esc(s.name)}</span>${lbl}</td>
      <td class="s-rec"><span class="rec-w">${s.wins}</span>-<span class="rec-l">${s.losses}</span>${s.ties ? `-${s.ties}` : ''}</td>
      <td class="s-num s-pf${sort.key === 'pf' ? ' sorted' : ''}">${fmtPts(s.pf)}</td>
      <td class="s-num${sort.key === 'pa' ? ' sorted' : ''}">${fmtPts(s.pa)}</td>
      ${catCells}
    </tr>`;
  }).join('');

  const head = STANDINGS_COLS.map(col => {
    const active = col.key === sort.key;
    const arrow = active ? `<span class="s-arrow">${sort.dir === 'asc' ? '▲' : '▼'}</span>` : '';
    const label = col.short
      ? `<span class="lbl-full">${esc(col.label)}</span><span class="lbl-short">${esc(col.short)}</span>`
      : esc(col.label);
    const cls = ['s-sort', col.num ? 'r' : '', col.cat ? 's-cat-h' : '', active ? 'active' : ''].filter(Boolean).join(' ');
    const ariaSort = active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th class="${cls}" role="button" tabindex="0" aria-sort="${ariaSort}"
      title="${escAttr(`Sort by ${col.label}`)}"
      onclick="sortStandings('${col.key}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sortStandings('${col.key}')}">${label}${arrow}</th>`;
  }).join('');

  return `<div class="standings-wrap">
    <div class="table-scroll">
      <table class="stbl">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

async function renderStandings() {
  if (!S.seasonStarted) return preDraftNotice();
  const rsWeek = Math.min(S.currentWeek, REGULAR_SEASON_WEEKS);
  setLoading('Calculating standings…', `Loading weeks 1–${rsWeek}…`);
  try {
    await loadAllWeeks((done, total) => {
      const el = document.querySelector('.loading-sub');
      if (el) el.textContent = `Loaded ${done} / ${total} weeks…`;
    });
    const dhData = await getDHMatchups();

    const st = {};
    for (const r of S.rosters) {
      st[r.roster_id] = { rid: r.roster_id, name: S.rosterMap[r.roster_id], wins: 0, losses: 0, ties: 0, pf: 0, pa: 0 };
    }

    for (let w = 1; w <= rsWeek; w++) {
      const wd = S.weekCache[`${lid()}:${w}`];
      if (!wd || !wd.matchups.length) continue;
      const cs = calcCatStats(wd.matchups, wd.stats);

      const groups = {};
      for (const m of wd.matchups) {
        if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
        groups[m.matchup_id].push(m.roster_id);
      }
      for (const rids of Object.values(groups)) {
        if (rids.length < 2) continue;
        applyResult(st, cs, rids[0], rids[1]);
      }
      for (const { r1, r2 } of (dhData[w] || [])) applyResult(st, cs, r1, r2);
    }

    const cats = seasonCatTotals(rsWeek);
    const ranks = {};
    for (const c of BAFL_CATS) ranks[c.key] = rankMapFor(cats, c.key);

    // Standings order fixes each team's rank; every other sort carries it along.
    const rows = Object.values(st).sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : b.pf - a.pf);
    rows.forEach((s, i) => { s.rank = i + 1; s.cats = cats[s.rid] || {}; });
    standingsView = { rows, ranks, rsWeek };

    setPage(`
      <div class="sec-head">Standings — Through Week ${rsWeek}
        <span class="sec-note">includes double headers</span></div>
      ${standingsTableHTML(standingsView)}
      <div class="heat-legend">
        <span class="heat-legend-lbl">Category totals ranked league-wide</span>
        <span class="hm1">best</span><span class="hm2"></span><span class="hm3"></span><span class="hm4"></span><span class="hm5">worst</span>
        <span class="heat-legend-hint">click a column to sort</span>
      </div>`);
  } catch (e) {
    setError('Failed to calculate standings: ' + e.message);
  }
}
