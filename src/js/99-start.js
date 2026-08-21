// ─── Service worker ───────────────────────────────────────────────────────
// Registered last and entirely optional: it caches the app shell so a reload (or a flaky
// connection at the stadium) opens instantly. Live league data is never cached by it — see
// sw.js, which deliberately leaves every api.sleeper.* request alone.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* file:// or unsupported */ });
  });
}

// ─── Start ────────────────────────────────────────────────────────────────
init();
