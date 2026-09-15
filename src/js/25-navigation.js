// ─── Week navigation ──────────────────────────────────────────────────────
function updateWeekDisplay() {
  const isDH = DH_WEEKS.includes(S.selectedWeek);
  const dhDot = isDH ? '<span class="dh-dot" title="Double Header week"></span>' : '';
  // A week Sleeper has opened but the app hasn't turned over to yet (12-week-clock.js).
  const upcoming = S.selectedWeek > S.currentWeek;
  const tag = upcoming
    ? `<span class="wk-tag" title="Sleeper has opened this week; BAFL turns over to it Wednesday at ${WEEK_ROLLOVER_HOUR_ET}am ET">next</span>`
    : '';
  document.getElementById('weekLabel').innerHTML = `Week ${S.selectedWeek}${dhDot}${tag}`;
  document.getElementById('btnPrev').disabled = S.selectedWeek <= 1;
  document.getElementById('btnNext').disabled = S.selectedWeek >= S.maxWeek;
  document.getElementById('updatedTag').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function changeWeek(d) {
  const nw = S.selectedWeek + d;
  if (nw < 1 || nw > S.maxWeek) return;
  S.selectedWeek = nw;
  updateWeekDisplay();
  stopAutoRefresh();
  if (S.activeTab === 'matchups') await renderMatchups();
  scheduleAutoRefresh();
}

async function refresh() {
  stopAutoRefresh();
  delete S.weekCache[`${lid()}:${S.selectedWeek}`];
  if (S.allLoadedFor === lid()) S.allLoadedFor = '';
  await renderTab();
  scheduleAutoRefresh();
}

// ─── Tab switching ────────────────────────────────────────────────────────
function setTab(btn) {
  S.activeTab = btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
  stopAutoRefresh();
  renderTab();
  scheduleAutoRefresh();
}

async function renderTab() {
  if (S.activeTab === 'matchups') await renderMatchups();
  else if (S.activeTab === 'standings') await renderStandings();
  else if (S.activeTab === 'leaders') await renderLeaders();
  else if (S.activeTab === 'playoffs') await renderPlayoffs();
}

