// ─── Render: Leaders tab ──────────────────────────────────────────────────
// Two views over the same loaded data. TEAMS is the original league-wide category race.
// PLAYERS is new: which individual players actually produced those totals. It costs no extra
// network at all — the weekly matchups and stats needed to build it are already in the cache
// the standings put there, so it's a second pass over data we've paid for.
let leadersMode = 'teams';

const LEADER_SECTIONS = [
  { key: 'passing',   label: 'Passing Leaders',       unit: 'yds' },
  { key: 'receiving', label: 'Receiving Leaders',     unit: 'yds' },
  { key: 'rushing',   label: 'Rushing Leaders',       unit: 'yds' },
  { key: 'tds',       label: 'Touchdown Leaders',     unit: 'TDs' },
  { key: 'kicking',   label: 'Kicking Leaders',       unit: 'pts' },
  { key: 'yardage',   label: 'Total Yardage Leaders', unit: 'yds' },
];
const fmtLeaderVal = (v, unit) =>
  (unit === 'TDs' ? v.toFixed(0) : Math.round(v).toLocaleString()) + ' ' + unit;

function setLeadersMode(mode) {
  if (leadersMode === mode) return;
  leadersMode = mode;
  renderLeaders();
}
function leadersModeBar(rsWeek) {
  const btn = (m, label) =>
    `<button class="seg-btn ${leadersMode === m ? 'active' : ''}" onclick="setLeadersMode('${m}')">${label}</button>`;
  return `<div class="sec-head">League Leaders — Through Week ${rsWeek}
      <span class="seg">${btn('teams', 'Teams')}${btn('players', 'Players')}</span>
    </div>`;
}

async function renderLeaders() {
  if (!S.seasonStarted) return preDraftNotice();
  const rsWeek = Math.min(S.currentWeek, REGULAR_SEASON_WEEKS);
  setLoading('Calculating leaders…', `Loading weeks 1–${rsWeek}…`);
  try {
    await loadAllWeeks((done, total) => {
      const el = document.querySelector('.loading-sub');
      if (el) el.textContent = `Loaded ${done} / ${total} weeks…`;
    });
    if (leadersMode === 'players') await renderPlayerLeaders(rsWeek);
    else renderTeamLeaders(rsWeek);
  } catch (e) {
    setError('Failed to calculate leaders: ' + e.message);
  }
}

function renderTeamLeaders(rsWeek) {
  const totals = {};
  for (const r of S.rosters) {
    totals[r.roster_id] = { passing: 0, rushing: 0, receiving: 0, tds: 0, kicking: 0, yardage: 0 };
  }
  for (let w = 1; w <= rsWeek; w++) {
    const wd = S.weekCache[`${lid()}:${w}`];
    if (!wd || !wd.matchups.length) continue;
    const cs = calcCatStats(wd.matchups, wd.stats);
    for (const r of S.rosters) {
      const rid = r.roster_id, t = totals[rid];
      t.passing   += cs.passing[rid]   || 0;
      t.rushing   += cs.rushing[rid]   || 0;
      t.receiving += cs.receiving[rid] || 0;
      t.tds       += cs.tds[rid]       || 0;
      t.kicking   += cs.kicking[rid]   || 0;
      t.yardage   += (cs.passing[rid] || 0) + (cs.rushing[rid] || 0) + (cs.receiving[rid] || 0);
    }
  }

  let html = leadersModeBar(rsWeek) + '<div class="leaders-grid">';
  for (const { key, label, unit } of LEADER_SECTIONS) {
    const sorted = Object.entries(totals).sort((a, b) => b[1][key] - a[1][key]).slice(0, 5);
    html += `<div class="lcard"><div class="lcard-title">${label}</div>`;
    sorted.forEach(([rid, vals], i) => {
      const name = S.rosterMap[parseInt(rid)] || `Team ${rid}`;
      html += `<div class="lrow">
        <span class="lrank ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</span>
        <span class="lname"><span class="team-link" onclick="openRosterModal(${parseInt(rid)})">${esc(name)}</span></span>
        <span class="lval">${fmtLeaderVal(vals[key], unit)}</span>
      </div>`;
    });
    html += '</div>';
  }
  setPage(html + '</div>');
}

// Per-player season totals, accumulated only from weeks in which a BAFL team STARTED them —
// which is the only production that counted for anything in this league. Bench weeks are
// deliberately excluded; a 200-yard game on someone's bench won no categories.
function accumulatePlayerTotals(rsWeek) {
  const tot = {};   // pid → {passing,…, yardage, games, startedBy:Set}
  for (let w = 1; w <= rsWeek; w++) {
    const wd = S.weekCache[`${lid()}:${w}`];
    if (!wd || !wd.matchups.length) continue;
    for (const m of wd.matchups) {
      const pp = m.players_points || {};
      for (const pid of (m.starters || [])) {
        if (!(pid in pp)) continue;   // same "did not participate" rule as the matchup math
        const c = baflPlayerCats(wd.stats[pid]);
        const t = tot[pid] || (tot[pid] = {
          passing: 0, rushing: 0, receiving: 0, tds: 0, kicking: 0, yardage: 0,
          games: 0, startedBy: new Set(),
        });
        t.passing += c.passing; t.rushing += c.rushing; t.receiving += c.receiving;
        t.tds += c.tds; t.kicking += c.kicking;
        t.yardage += baflTotalYards(c);
        t.games++;
        t.startedBy.add(m.roster_id);
      }
    }
  }
  return tot;
}

async function renderPlayerLeaders(rsWeek) {
  const players = await loadPlayers().catch(() => ({}));
  const tot = accumulatePlayerTotals(rsWeek);
  if (!Object.keys(tot).length) {
    setPage(leadersModeBar(rsWeek) + '<div class="empty-box">No started-player data yet this season.</div>');
    return;
  }

  let html = leadersModeBar(rsWeek) +
    `<div class="leaders-note">Totals count only the weeks a BAFL team started the player — bench
      production never won a category.</div><div class="leaders-grid">`;

  for (const { key, label, unit } of LEADER_SECTIONS) {
    const sorted = Object.entries(tot)
      .filter(([, v]) => v[key] > 0)
      .sort((a, b) => b[1][key] - a[1][key])
      .slice(0, 6);
    html += `<div class="lcard"><div class="lcard-title">${label}</div>`;
    if (!sorted.length) html += `<div class="lrow lrow-empty">No production yet</div>`;
    sorted.forEach(([pid, v], i) => {
      const p = players[pid] || {};
      const pos = (p.pos || '?').toUpperCase();
      const own = ownerOf(pid);
      // Whoever started him most is the meaningful attribution over a season; his current
      // owner may have picked him up last week.
      const ownTag = own ? `<span class="lowner">${esc(own.name)}</span>` : '';
      html += `<div class="lrow lrow-player" onclick="openPlayerCard(${jsArg(pid)})" role="button" tabindex="0">
        <span class="lrank ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</span>
        ${headshotImg(pid, p, 'lhs', (p.name || '?')[0])}
        <div class="lname-block">
          <span class="lname">${esc(p.name || pid)}</span>
          <span class="lsub"><span class="pos-badge pos-${esc(pos)}">${esc(pos)}</span>${ownTag}
            <span class="lgames">${v.games}g</span></span>
        </div>
        <span class="lval">${fmtLeaderVal(v[key], unit)}</span>
      </div>`;
    });
    html += '</div>';
  }
  setPage(html + '</div>');
}
