/* BAFL service worker.
 *
 * The app is one self-contained HTML file. Without a worker every visit re-downloads it, which
 * on a phone at a bar with two bars of signal is several seconds of white screen for bytes the
 * device already has.
 *
 * Strategy:
 *   • index.html / ./  — network-first with a cache fallback. A new deploy must win, but a
 *                        flaky connection should still open the app you already have.
 *   • double_headers.json — cache-first, revalidated in the background. It changes at most
 *                        once a season.
 *   • everything else  — LEFT ALONE. Every Sleeper and ESPN request is live league data and
 *                        must never be served stale; the player database has its own
 *                        day-stamped cache in src/js/32-players.js, which this must not
 *                        second-guess.
 */
const CACHE = 'bafl-shell-v1';
const CORE = ['./', './index.html', './double_headers.json'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(CORE).catch(() => {}))   // a missing optional asset must not fail install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k.startsWith('bafl-shell-')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return fetch(req)
    .then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    })
    .catch(() => caches.match(req).then(hit => hit || Response.error()));
}

function cacheFirst(req) {
  return caches.match(req).then(hit => {
    if (hit) {
      // Refresh in the background; this request is already answered.
      fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      }).catch(() => {});
      return hit;
    }
    return fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    });
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Sleeper, ESPN, fonts — never touched
  if (url.pathname.endsWith('/double_headers.json')) { e.respondWith(cacheFirst(req)); return; }
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')) {
    e.respondWith(networkFirst(req));
  }
});
