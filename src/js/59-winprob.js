// ─── Win probability ──────────────────────────────────────────────────────
// Each category's finish is modelled as normal: mean = the gap between the two teams' blended
// projections, variance = the unplayed variance on both sides (58-projections.js). That gives
// every category a win / lose / tie probability — tie being the mass within half a unit of
// level, which matters for touchdowns and kicking (integers, and level TD counts are common)
// and is negligible for yardage. A category whose starters have all finished has no variance
// left, so its probabilities are 0 or 1: three such wins and the matchup is 100% whatever the
// remaining games do, which is the property the bar promises.
//
// The five categories are then combined as independent draws — the exact distribution over
// (won, lost) is a 21-state table, so there is no simulation and the number is reproducible —
// and a level category count falls to the total-yards tiebreaker, itself a normal over the
// three yardage categories.
//
// Independence across categories is the approximation: a quarterback's big day lifts passing
// yards and touchdowns together, so real probabilities sit a little further from 50 than these.

// Standard normal CDF — Abramowitz & Stegun 26.2.17, |error| < 7.5e-8, plenty for a percent.
function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804014327 * Math.exp(-z * z / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z >= 0 ? 1 - p : p;
}

// One category: P(team1 wins it), P(team2 wins it), P(level) for a gap ~ N(mu, variance).
function catOutcome(mu, variance) {
  if (!(variance > 0)) {
    return mu > 0 ? { w1: 1, w2: 0, tie: 0 } : mu < 0 ? { w1: 0, w2: 1, tie: 0 } : { w1: 0, w2: 0, tie: 1 };
  }
  const sd = Math.sqrt(variance);
  const w1 = 1 - normCdf((0.5 - mu) / sd);
  const w2 = normCdf((-0.5 - mu) / sd);
  return { w1, w2, tie: Math.max(0, 1 - w1 - w2) };
}

const YARD_CATS = ['passing', 'rushing', 'receiving'];

// {p1, p2}: each team's chance of taking the matchup, from blended projections `pcs`.
function winProbability(pcs, rid1, rid2) {
  const v = pcs.var || {};
  const gap  = k => (pcs[k][rid1] || 0) - (pcs[k][rid2] || 0);
  const vsum = k => ((v[k] || {})[rid1] || 0) + ((v[k] || {})[rid2] || 0);
  // dist: "won,lost" → probability, for team1.
  let dist = new Map([['0,0', 1]]);
  for (const c of BAFL_CATS) {
    const o = catOutcome(gap(c.key), vsum(c.key));
    const next = new Map();
    const add = (k, p) => { if (p > 0) next.set(k, (next.get(k) || 0) + p); };
    for (const [k, p] of dist) {
      const [a, b] = k.split(',').map(Number);
      add(`${a + 1},${b}`, p * o.w1);
      add(`${a},${b + 1}`, p * o.w2);
      add(`${a},${b}`,     p * o.tie);
    }
    dist = next;
  }
  const ty = catOutcome(
    YARD_CATS.reduce((s, k) => s + gap(k), 0),
    YARD_CATS.reduce((s, k) => s + vsum(k), 0));
  let p1 = 0, p2 = 0;
  for (const [k, p] of dist) {
    const [a, b] = k.split(',').map(Number);
    if (a > b) p1 += p;
    else if (b > a) p2 += p;
    else { p1 += p * (ty.w1 + ty.tie / 2); p2 += p * (ty.w2 + ty.tie / 2); }
  }
  return { p1, p2 };
}

// A finished matchup needs no model — the result is the probability. A dead heat (level
// categories AND level yards) is the one case that stays at 50/50.
function decidedWinProb(r) {
  return r.s1dec > r.s2dec ? { p1: 1, p2: 0 } : r.s2dec > r.s1dec ? { p1: 0, p2: 1 } : { p1: .5, p2: .5 };
}

// The bar under the team names: one track, team1's share filled from the left, the rest is
// team2's. At 100/0 it is a single colour end to end — the matchup is decided. A live 99.6%
// rounds to 99, not 100: "100%" is reserved for a final.
function winBarHTML(wp, decided) {
  let a = Math.round(wp.p1 * 100);
  if (!decided) a = Math.min(99, Math.max(1, a));
  const b = 100 - a;
  const tip = decided ? 'Final'
    : 'Chance to win — live totals plus the unplayed share of every starter\'s projection';
  return `<div class="mc-wp${decided ? ' decided' : ''}" title="${escAttr(tip)}" role="img" aria-label="${escAttr(`Win chance ${a}% to ${b}%`)}">
    <span class="mc-wp-pct${a >= b ? ' lead' : ''}">${a}%</span>
    <div class="mc-wp-track"><div class="mc-wp-fill" style="width:${a}%"></div></div>
    <span class="mc-wp-pct mc-wp-pct-r${b >= a ? ' lead' : ''}">${b}%</span>
  </div>`;
}
