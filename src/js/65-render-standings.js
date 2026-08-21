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
    const n = S.rosters.length;

    const sorted = Object.values(st).sort((a, b) => b.wins !== a.wins ? b.wins - a.wins : b.pf - a.pf);

    let rows = '';
    sorted.forEach((s, i) => {
      const cutoff = i === PLAYOFF_CUTOFF ? ' class="playoff-divider"' : '';
      const lbl    = i === PLAYOFF_CUTOFF ? '<span class="divider-lbl">Out of Playoffs</span>' : '';
      const catCells = BAFL_CATS.map(c => {
        const v = cats[s.rid][c.key] || 0;
        const rk = ranks[c.key][s.rid];
        return `<td class="s-cat ${heatClass(rk, n)}" title="${escAttr(`${c.label}: ${Math.round(v).toLocaleString()} — ${ordinal(rk)} in the league`)}">
          ${Math.round(v).toLocaleString()}</td>`;
      }).join('');
      rows += `<tr${cutoff}>
        <td class="s-rank">${i + 1}${i < PLAYOFF_CUTOFF ? ' 🏆' : ''}</td>
        <td class="s-team"><span class="team-link" onclick="openRosterModal(${s.rid})">${esc(s.name)}</span>${lbl}</td>
        <td class="s-rec"><span class="rec-w">${s.wins}</span>-<span class="rec-l">${s.losses}</span>${s.ties ? `-${s.ties}` : ''}</td>
        <td class="s-num s-pf">${fmtPts(s.pf)}</td>
        <td class="s-num">${fmtPts(s.pa)}</td>
        ${catCells}
      </tr>`;
    });

    const catHead = BAFL_CATS.map(c => `<th class="r s-cat-h">${c.label.slice(0, 4).toUpperCase()}</th>`).join('');
    setPage(`
      <div class="sec-head">Standings — Through Week ${rsWeek}
        <span class="sec-note">includes double headers</span></div>
      <div class="standings-wrap">
        <div class="table-scroll">
          <table class="stbl">
            <thead>
              <tr>
                <th>Rank</th><th>Team</th><th>Record</th>
                <th class="r">PF</th><th class="r">PA</th>
                ${catHead}
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="heat-legend">
        <span class="heat-legend-lbl">Category totals ranked league-wide</span>
        <span class="hm1">best</span><span class="hm2"></span><span class="hm3"></span><span class="hm4"></span><span class="hm5">worst</span>
      </div>`);
  } catch (e) {
    setError('Failed to calculate standings: ' + e.message);
  }
}
