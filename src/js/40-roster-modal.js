// ─── Roster modal ─────────────────────────────────────────────────────────
// Click a team name anywhere and this shows its lineup for the selected week: starters first,
// then the bench, each with the week's stat line. Every row opens that player's card.
const POS_ORDER = { QB: 0, RB: 1, WR: 2, TE: 3, K: 4 };

async function openRosterModal(rid) {
  const overlay = document.getElementById('rosterOverlay');
  const titleEl = document.getElementById('rosterModalTitle');
  const body    = document.getElementById('rosterModalBody');

  titleEl.textContent = S.rosterMap[rid] || `Team ${rid}`;
  body.innerHTML = '<div class="loading"><div class="spin"></div><div>Loading roster…</div></div>';
  overlay.classList.add('active');
  pcLockPage(true);

  try {
    const roster = S.rosters.find(r => r.roster_id === rid);
    if (!roster) { body.innerHTML = '<div class="empty-box">Roster not found.</div>'; return; }

    // Starters and weekly stats for the currently-selected week.
    const weekData  = S.weekCache[`${lid()}:${S.selectedWeek}`];
    const weekEntry = weekData?.matchups?.find(m => m.roster_id === rid);
    const starters  = new Set(weekEntry?.starters || []);
    const weekStats = weekData?.stats || {};
    const playedIn  = weekEntry?.players_points || {};

    const players   = await loadPlayers();
    const playerIds = roster.players || [];

    const sorted = playerIds
      .map(pid => ({ pid, p: players[pid] || {} }))
      .filter(({ p }) => p.last_name || p.name)
      .sort((a, b) => {
        const aS = starters.has(a.pid) ? 0 : 1;
        const bS = starters.has(b.pid) ? 0 : 1;
        if (aS !== bS) return aS - bS;
        const aO = POS_ORDER[a.p.pos] ?? 9;
        const bO = POS_ORDER[b.p.pos] ?? 9;
        if (aO !== bO) return aO - bO;
        return (a.p.name || '').localeCompare(b.p.name || '');
      });

    const starterList = sorted.filter(({ pid }) => starters.has(pid));
    const benchList   = sorted.filter(({ pid }) => !starters.has(pid));

    const hasStats = Object.keys(weekStats).length > 0;
    let html = '';
    if (starterList.length) {
      const wkLabel = hasStats ? `Week ${S.selectedWeek}` : `Week ${S.selectedWeek} (no stats yet)`;
      html += `<div class="roster-sec-head">Starting Lineup — ${wkLabel}</div>`;
      // What this lineup actually produced in each BAFL category — the number the matchup is
      // decided on, broken out before the individual lines that add up to it.
      if (hasStats) html += lineupCatSummary(starterList, weekStats, playedIn);
      html += starterList.map(({ pid, p }) => playerRowHTML(pid, p, true, weekStats[pid])).join('');
    }
    if (benchList.length) {
      html += `<div class="roster-sec-head">Bench</div>`;
      html += benchList.map(({ pid, p }) => playerRowHTML(pid, p, false, weekStats[pid])).join('');
    }
    if (!html) html = '<div class="empty-box">No players found.</div>';
    body.innerHTML = html;
  } catch (e) {
    body.innerHTML = `<div class="error-box">⚠ ${esc(e.message)}</div>`;
  }
}

// Per-category totals for the starting lineup shown. Mirrors calcCatStats exactly (including
// the "player did not participate" check) so this can never disagree with the matchup card.
function lineupCatSummary(starterList, weekStats, playedIn) {
  const tot = { passing: 0, rushing: 0, receiving: 0, tds: 0, kicking: 0 };
  for (const { pid } of starterList) {
    if (!(pid in playedIn)) continue;
    const c = baflPlayerCats(weekStats[pid]);
    for (const k in tot) tot[k] += c[k];
  }
  const chips = BAFL_CATS.map(c =>
    `<div class="lcs-chip"><span class="lcs-lbl">${c.label}</span>` +
    `<span class="lcs-val">${Math.round(tot[c.key])}</span></div>`).join('');
  return `<div class="lineup-cat-summary">${chips}
    <div class="lcs-chip lcs-total"><span class="lcs-lbl">Total Yds</span>
      <span class="lcs-val">${Math.round(baflTotalYards(tot))}</span></div>
  </div>`;
}

function playerRowHTML(pid, p, isStarter, ps) {
  const name = p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || pid;
  const pos  = (p.pos || '?').toUpperCase();
  const team = p.team || '';
  const starterTag = isStarter ? '<span class="roster-starter-tag">STARTER</span>' : '';

  // Build a stat line from this week's stats, tuned to the position.
  let statLine = '';
  if (ps) {
    const parts = [];
    if (ps.pass_att) {
      parts.push(`${Math.round(ps.pass_yd || 0)}yd`);
      if (ps.pass_td)  parts.push(`${ps.pass_td}TD`);
      if (ps.pass_int) parts.push(`${ps.pass_int}INT`);
      if ((ps.rush_yd || 0) > 0) parts.push(`${Math.round(ps.rush_yd)}rush`);
    } else if ((ps.rush_att || 0) > 0 || (ps.rush_yd || 0) > 0) {
      parts.push(`${Math.round(ps.rush_yd || 0)}rush`);
      if (ps.rush_td) parts.push(`${ps.rush_td}TD`);
      if ((ps.rec_yd || 0) > 0) parts.push(`${ps.rec || 0}/${ps.rec_tgt || 0} ${Math.round(ps.rec_yd)}rec`);
    } else if ((ps.rec_tgt || 0) > 0 || (ps.rec_yd || 0) > 0) {
      parts.push(`${ps.rec || 0}/${ps.rec_tgt || 0} ${Math.round(ps.rec_yd || 0)}yd`);
      if (ps.rec_td) parts.push(`${ps.rec_td}TD`);
    } else if (pos === 'K') {
      if (ps.xpa !== undefined) parts.push(`${ps.xpm || 0}/${ps.xpa}XP`);
      if (ps.fga !== undefined) parts.push(`${ps.fgm || 0}/${ps.fga}FG`);
    }
    if (parts.length) statLine = `<span class="roster-player-stats">${esc(parts.join(' · '))}</span>`;
  }

  return `<div class="roster-player${isStarter ? ' starter' : ''} clickable" onclick="openPlayerCard(${jsArg(pid)})"
       role="button" tabindex="0" aria-label="${escAttr(`Open ${name} player card`)}">
    ${headshotImg(pid, p, 'roster-hs', (pos[0] || '?'))}
    <span class="pos-badge pos-${esc(pos)}">${esc(pos)}</span>
    <div class="roster-player-info">
      <span class="roster-player-name">${esc(name)}</span>
      <span class="roster-player-team">${esc(team)}${statLine}</span>
    </div>
    ${starterTag}
  </div>`;
}

function closeRosterModal() {
  document.getElementById('rosterOverlay').classList.remove('active');
  // Only release the page lock if a player card isn't still open on top of the modal.
  if (!PC) pcLockPage(false);
}

// Escape closes the topmost layer: the player card first, then the roster modal.
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (PC) return;   // the card's own handler takes this one
  closeRosterModal();
});
