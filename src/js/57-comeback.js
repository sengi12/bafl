// ─── Path to win ──────────────────────────────────────────────────────────
// A category matchup on Monday night is not "down by 11 points". It is "down two categories,
// with a receiver and a kicker still to play" — and the question worth answering is exactly
// what those two have to do. This module answers it, against the live totals:
//
//   1. Count the categories each side currently leads. Three wins takes the matchup, so the
//      trailing team needs (3 − wins) more.
//   2. For every category it isn't winning, work out the amount that takes the LEAD (the gap
//      plus one — a level category wins nothing) and which of its remaining starters can move
//      it: a QB moves passing, rushing and TDs; a RB/WR/TE rushing, receiving and TDs; a K
//      kicking. A category with nobody left who can score in it is out of reach.
//   3. Rank the reachable ones by how the amount compares with what those players are still
//      projected for, and name the cheapest (3 − wins). Fewer reachable than needed, or nobody
//      left at all, and the matchup is mathematically gone — the opponent's totals only rise.
//
// The callout also lists the categories the team leads that the opponent can still take back
// (it has a starter left who scores in them), because winning two more is no use if a third
// slips away. Everything reads from the live totals (calcCatStats) and the blended
// projections' `left` lists (58-projections.js); nothing here fetches.

const CATS_TO_WIN = 3;
// Which BAFL categories a position can move.
const POS_MOVES = {
  QB: ['passing', 'rushing', 'tds'],
  RB: ['rushing', 'receiving', 'tds'],
  WR: ['rushing', 'receiving', 'tds'],
  TE: ['rushing', 'receiving', 'tds'],
  K:  ['kicking'],
};
function posMoves(pos, key) { return (POS_MOVES[String(pos || '').toUpperCase()] || []).includes(key); }

// How the amount needed compares with what the remaining players are projected to add:
// 'likely' within projection, 'stretch' up to double it, 'long' beyond that.
function needTier(need, proj) {
  const ratio = need / Math.max(proj, 0.5);
  return ratio <= 1 ? 'likely' : ratio <= 2 ? 'stretch' : 'long';
}

// The plan for roster `rid` against `opp`, or null when there is nothing to say: no live
// blend, nothing played yet on either side (every category is level at zero, so "trailing"
// means nothing), or the team already holds three categories.
function comebackPlan(cs, pcs, rid, opp) {
  if (!pcs || !pcs.left || !pcs.tot) return null;
  const started = r => (pcs.tot[r] || 0) > (pcs.rem[r] || 0);
  if (!started(rid) && !started(opp)) return null;
  const mine = pcs.left[rid] || [], theirs = pcs.left[opp] || [];
  let wins = 0;
  const losing = [], hold = [];
  for (const c of BAFL_CATS) {
    const a = cs[c.key][rid] || 0, b = cs[c.key][opp] || 0;
    if (a > b) {
      wins++;
      const threats = theirs.filter(p => posMoves(p.pos, c.key));
      if (threats.length) {
        const oppProj = threats.reduce((s, p) => s + (p.cats[c.key] || 0), 0);
        hold.push({ key: c.key, label: c.label, margin: a - b, oppProj, threats, atRisk: oppProj >= a - b });
      }
    } else {
      const helpers = mine.filter(p => posMoves(p.pos, c.key));
      const proj = helpers.reduce((s, p) => s + (p.cats[c.key] || 0), 0);
      const need = (b - a) + 1;           // take the lead; level wins nothing
      losing.push({ key: c.key, label: c.label, deficit: b - a, need, proj, helpers,
        reachable: helpers.length > 0, tier: needTier(need, proj) });
    }
  }
  const need = CATS_TO_WIN - wins;
  if (need <= 0) return null;
  const reachable = losing.filter(x => x.reachable)
    .sort((x, y) => (x.need / Math.max(x.proj, 0.5)) - (y.need / Math.max(y.proj, 0.5)));
  const out = !mine.length || reachable.length < need;
  return { wins, need, out, left: mine, picks: out ? [] : reachable.slice(0, need), reachable, hold };
}

// Amount → "+38 yds" / "+2 TD" / "+4 pts", whole units (every category is integer-valued).
function needAmount(key, n) {
  const v = Math.ceil(n);
  return key === 'tds' ? `+${v} TD${v === 1 ? '' : 's'}` : key === 'kicking' ? `+${v} pts` : `+${v} yds`;
}
function projAmount(key, n) {
  const v = key === 'tds' ? (Math.round(n * 10) / 10) : Math.round(n);
  return key === 'tds' ? `${v} TD` : key === 'kicking' ? `${v} pts` : `${v} yds`;
}
// "WR T. Hill, K H. Butker" — the players still to play, positions first.
function leftList(players) {
  return players.map(p => `${p.pos ? p.pos + ' ' : ''}${p.name || p.pid}`).join(', ');
}

function comebackHTML(plan, teamName) {
  if (!plan) return '';
  const n = esc(teamName);
  const cats = k => `${k} ${k === 1 ? 'category' : 'categories'}`;
  if (plan.out) {
    const why = !plan.left.length
      ? 'lineup is finished'
      : plan.reachable.length
        ? `only ${esc(plan.reachable.map(x => x.label).join(' and '))} still reachable with ${esc(leftList(plan.left))} left`
        : `nobody left who can move the ${cats(plan.need)} it needs`;
    return `<div class="mc-need mc-need-out">
      <span class="mc-need-lbl">No path</span>
      <span class="mc-need-txt"><b>${n}</b> can't get to ${CATS_TO_WIN} — needs ${cats(plan.need)} more, ${why}.</span>
    </div>`;
  }
  const items = plan.picks.map(x => {
    const who = leftList(x.helpers);
    const tip = `${x.label}: trailing by ${Math.round(x.deficit)} — needs ${needAmount(x.key, x.need).slice(1)} to take it. `
      + `${who} ${x.helpers.length === 1 ? 'is' : 'are'} projected for ${projAmount(x.key, x.proj)} more`
      + `${x.tier === 'likely' ? ' — within projection' : x.tier === 'stretch' ? ' — a stretch' : ' — a long shot'}.`;
    return `<span class="mc-need-item mc-need-${x.tier}" title="${escAttr(tip)}">
      <span class="mc-need-cat">${esc(x.label)}</span><b>${needAmount(x.key, x.need)}</b>
      <span class="mc-need-proj">proj ${projAmount(x.key, x.proj)}</span></span>`;
  }).join('');
  const holdTxt = plan.hold.length
    ? `<div class="mc-need-hold">and hold ${plan.hold.map(h =>
        `<span class="mc-need-holdcat${h.atRisk ? ' risk' : ''}" title="${escAttr(
          `Leads ${h.label} by ${Math.round(h.margin)}; ${leftList(h.threats)} still to play for the other side, projected for ${projAmount(h.key, h.oppProj)} more.`)}">${esc(h.label)}</span>`).join(', ')}</div>`
    : '';
  const leftTip = `Still to play: ${leftList(plan.left)}`;
  return `<div class="mc-need">
    <div class="mc-need-head">
      <span class="mc-need-lbl">Path to win</span>
      <span class="mc-need-txt"><b>${n}</b> needs ${cats(plan.need)} more</span>
      <span class="mc-need-left" title="${escAttr(leftTip)}">${plan.left.length} left</span>
    </div>
    <div class="mc-need-list">${items}</div>
    ${holdTxt}
  </div>`;
}
