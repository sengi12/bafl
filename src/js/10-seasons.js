// ─── Season chain ────────────────────────────────────────────────────────
// Walk previous_league_id to discover all past BAFL seasons.
// Each fetch gets a hard 4-second timeout so a slow/hung API call
// never blocks the entire app from loading.
async function fetchWithTimeout(url, ms = 4000) {
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  } catch(e) {
    clearTimeout(t);
    throw e;
  }
}

async function walkSeasonChain() {
  const chain = [];
  let id = ROOT_LEAGUE_ID;
  while (id && chain.length < 10) {   // cap at 10 seasons as a safety net
    try {
      const lg = await fetchWithTimeout(`${API}/league/${id}`);
      chain.push({ id, season: lg.season, name: lg.name, league: lg });
      id = lg.previous_league_id || null;
    } catch { break; }
  }
  return chain; // newest first
}

function buildSeasonPicker(seasons) {
  const sel = document.getElementById('seasonSel');
  sel.innerHTML = seasons.map((s, i) =>
    `<option value="${i}">${s.season} Season${i === 0 ? ' ★' : ''}</option>`
  ).join('');
  sel.disabled = seasons.length <= 1;
}

