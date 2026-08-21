// ─── Auto-refresh ─────────────────────────────────────────────────────────
// Active only when: current season, current week, matchups tab, page visible.
function shouldAutoRefresh() {
  return S.arEnabled
      && isCurrentSeason()
      && S.selectedWeek === S.currentWeek
      && S.activeTab === 'matchups'
      && !document.hidden;
}

function scheduleAutoRefresh() {
  stopAutoRefresh();
  if (!shouldAutoRefresh()) { updateARUI(); return; }
  S.arNextAt     = Date.now() + AR_INTERVAL_MS;
  S.arTimer      = setTimeout(async () => {
    if (!shouldAutoRefresh()) { scheduleAutoRefresh(); return; }
    delete S.weekCache[`${lid()}:${S.selectedWeek}`];
    await renderMatchups();
    document.getElementById('updatedTag').textContent = `Updated ${new Date().toLocaleTimeString()}`;
    scheduleAutoRefresh();
  }, AR_INTERVAL_MS);
  S.arCountTimer = setInterval(updateARCountdown, 1000);
  updateARUI();
}

function stopAutoRefresh() {
  if (S.arTimer)      { clearTimeout(S.arTimer);      S.arTimer      = null; }
  if (S.arCountTimer) { clearInterval(S.arCountTimer); S.arCountTimer = null; }
  S.arNextAt = null;
  updateARUI();
}

function toggleAutoRefresh() {
  S.arEnabled = !S.arEnabled;
  S.arEnabled ? scheduleAutoRefresh() : stopAutoRefresh();
}

function updateARCountdown() {
  if (!S.arNextAt) return;
  const rem = Math.max(0, Math.round((S.arNextAt - Date.now()) / 1000));
  const m = Math.floor(rem / 60), s = rem % 60;
  document.getElementById('arCountdown').textContent = `${m}:${String(s).padStart(2,'0')}`;
}

function updateARUI() {
  const btn   = document.getElementById('btnAR');
  const cntEl = document.getElementById('arCountdown');
  const active = S.arEnabled && !!S.arTimer;
  if (btn) btn.classList.toggle('ar-on', active);
  if (!active && cntEl) cntEl.textContent = '';
}

// Pause auto-refresh when tab is hidden, resume when visible
document.addEventListener('visibilitychange', () => {
  document.hidden ? stopAutoRefresh() : scheduleAutoRefresh();
});

