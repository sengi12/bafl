// ─── Render: Matchups tab ─────────────────────────────────────────────────
// Live results render FIRST and projections are patched in afterwards. That ordering is
// deliberate: a week of projections is ~230KB even after position filtering, and the actual
// score is the thing you opened the app for — it must never wait on a forecast.
function matchupsHTML(matchups, cs, pcs, dhPairs) {
  const groups = {};
  for (const m of matchups) {
    if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
    groups[m.matchup_id].push(m.roster_id);
  }
  let html = '<div class="sec-head">Regular Matchups</div><div class="matchups-grid">';
  for (const rids of Object.values(groups)) {
    if (rids.length >= 2) html += matchupCard(rids[0], rids[1], cs, pcs);
  }
  html += '</div>';
  if (dhPairs && dhPairs.length) {
    html += `<div class="sec-spacer"></div>
           <div class="sec-head">Double Headers <span class="dh-badge">DH</span></div>
           <div class="matchups-grid">`;
    for (const { r1, r2 } of dhPairs) html += matchupCard(r1, r2, cs, pcs);
    html += '</div>';
  }
  return html;
}

async function renderMatchups() {
  if (!S.seasonStarted) return preDraftNotice();
  setLoading('Loading week data…');
  try {
    const { matchups, stats } = await loadWeek(S.selectedWeek);
    if (!matchups.length) {
      setPage('<div class="empty-box">No matchup data available for this week.</div>');
      return;
    }
    const cs = calcCatStats(matchups, stats);
    // Double header matchups — computed from the full-season schedule
    const dhPairs = DH_WEEKS.includes(S.selectedWeek)
      ? ((await getDHMatchups())[S.selectedWeek] || []) : [];

    setPage(matchupsHTML(matchups, cs, null, dhPairs));

    // Projections arrive later and re-render in place. Guarded on league + week + tab, because
    // by the time a 230KB response lands the user may well have moved on.
    if (projectionsApply()) {
      const league = lid(), week = S.selectedWeek;
      loadProjectedCats(matchups).then(pcs => {
        if (!pcs) return;
        if (lid() !== league || S.selectedWeek !== week || S.activeTab !== 'matchups') return;
        setPage(matchupsHTML(matchups, cs, pcs, dhPairs));
      }).catch(() => { /* the live view is already correct without them */ });
    }
  } catch (e) {
    setError('Failed to load week: ' + e.message);
  }
}
