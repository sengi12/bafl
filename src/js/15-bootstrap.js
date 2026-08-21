// ─── Bootstrap ────────────────────────────────────────────────────────────
async function init() {
  try {
    setLoading('Loading league data…');
    const [seasons, dhHistory] = await Promise.all([
      walkSeasonChain(),
      fetchJ('./double_headers.json').catch(() => ({})),
    ]);
    S.seasons   = seasons;
    S.dhHistory = dhHistory || {};
    buildSeasonPicker(seasons);
    // Warm the NFL player database in the background. It's needed by the player card, search
    // and player leaders, and after the first visit it comes straight out of Cache Storage —
    // starting it here means those views are usually instant instead of waiting on a download.
    loadPlayers().catch(() => { /* surfaced when a view that needs it is opened */ });
    currentNflSeason();
    await loadSeason(0);
  } catch(e) {
    setError('Failed to load league: ' + e.message);
  }
}

// Load a season by index, wiring up all state
async function loadSeason(idx) {
  S.seasonIdx    = idx;
  S.allLoadedFor = '';
  S.dhMatchups   = null;  // recompute for each season
  S.schedCache   = {};    // clear schedule cache for new season
  S.projCache    = {};    // projections are week+season specific
  const { id, league } = S.seasons[idx];
  S.league = league;

  const [users, rosters] = await Promise.all([
    fetchJ(`${API}/league/${id}/users`),
    fetchJ(`${API}/league/${id}/rosters`),
  ]);
  S.users = users;  S.rosters = rosters;
  S.userMap = {};   S.rosterMap = {};
  for (const u of users)   S.userMap[u.user_id]     = u.display_name;
  for (const r of rosters) S.rosterMap[r.roster_id] = S.userMap[r.owner_id] || `Team ${r.roster_id}`;
  buildOwnerIndex();   // pid → roster_id, so a card or search hit can name its BAFL owner

  const leg = parseInt(league.settings?.leg || 0);
  // Detect whether the season has started: status 'in_season', 'post_season',
  // or 'complete' all mean the schedule exists. Pre-draft / drafting = not started.
  const status = (league.status || '').toLowerCase();
  S.seasonStarted = !['pre_draft', 'drafting', ''].includes(status) && leg > 0;
  S.currentWeek   = S.seasonStarted ? Math.max(1, leg) : 1;
  S.selectedWeek  = S.currentWeek;

  document.getElementById('seasonSel').value    = String(idx);
  document.getElementById('seasonSel').disabled = false;
  document.getElementById('btnRefresh').disabled = false;
  updateWeekDisplay();
  stopAutoRefresh();
  await renderTab();
  scheduleAutoRefresh();
}

// ─── Season switching ─────────────────────────────────────────────────────
async function switchSeason(idxStr) {
  const idx = parseInt(idxStr);
  if (idx === S.seasonIdx) return;
  stopAutoRefresh();
  setLoading(`Loading ${S.seasons[idx].season} season…`);
  await loadSeason(idx);
}

