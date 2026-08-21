// ─── Week navigation ──────────────────────────────────────────────────────
function updateWeekDisplay() {
  const isDH = DH_WEEKS.includes(S.selectedWeek);
  const dhDot = isDH ? '<span class="dh-dot" title="Double Header week"></span>' : '';
  document.getElementById('weekLabel').innerHTML = `Week ${S.selectedWeek}${dhDot}`;
  document.getElementById('btnPrev').disabled = S.selectedWeek <= 1;
  document.getElementById('btnNext').disabled = S.selectedWeek >= S.currentWeek;
  document.getElementById('updatedTag').textContent = `Updated ${new Date().toLocaleTimeString()}`;
}

async function changeWeek(d) {
  const nw = S.selectedWeek + d;
  if (nw < 1 || nw > S.currentWeek) return;
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

