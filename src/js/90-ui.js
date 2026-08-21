// ─── Page-state helpers ───────────────────────────────────────────────────
function setPage(html) {
  document.getElementById('page').innerHTML = html;
}
function setLoading(msg, sub) {
  document.getElementById('page').innerHTML = `
    <div class="loading">
      <div class="spin"></div>
      <div class="loading-label">${esc(msg)}</div>
      ${sub ? `<div class="loading-sub">${esc(sub)}</div>` : ''}
    </div>`;
}
function setError(msg) {
  document.getElementById('page').innerHTML = `<div class="error-box">⚠ ${esc(msg)}</div>`;
}
// Every tab renders nothing useful before the schedule exists, so they all share this guard.
function preDraftNotice() {
  setPage('<div class="empty-box">This season hasn’t started yet. Check back after the draft!</div>');
}
