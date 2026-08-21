// ─── Matchup card HTML ────────────────────────────────────────────────────
// The team names used to be <th> cells in the same table as the category rows. That forced one
// table row to budget score + name + "Categories" + name + score across the viewport, and on a
// 360px phone that row alone overflowed — and because the page is overflow-x:hidden, it was
// CLIPPED rather than scrollable, so the right-hand score was simply unreachable.
//
// The names now live in their own flex header above the table. The table is left with the five
// narrow data columns, which fit any phone; it still gets a scroll wrapper with a frozen
// category column as a safety net for very long category labels at large text sizes.
function matchupCard(rid1, rid2, cs, pcs) {
  const r = calcResult(cs, rid1, rid2);
  const name = rid => esc(S.rosterMap[rid] || `Team ${rid}`);
  const s1s = r.tb1 ? `${r.s1}*` : String(r.s1);
  const s2s = r.tb2 ? `${r.s2}*` : String(r.s2);
  const cls1 = r.s1dec > r.s2dec ? 'win' : r.s1dec < r.s2dec ? 'loss' : 'tie';
  const cls2 = r.s2dec > r.s1dec ? 'win' : r.s2dec < r.s1dec ? 'loss' : 'tie';
  const tbTip = 'Category tie broken on total yards';

  const rows = BAFL_CATS.map(c => {
    const cr = r.cats[c.label];
    const v1 = cs[c.key][rid1] || 0;
    const v2 = cs[c.key][rid2] || 0;
    // Projected finish, when we have it: a second line under each value plus a hollow check
    // on the side projected to win, so a category you're losing but projected to take reads
    // differently from one you're losing outright.
    let p1 = '', p2 = '', pchk1 = '', pchk2 = '';
    if (pcs) {
      const pv1 = pcs[c.key][rid1] || 0, pv2 = pcs[c.key][rid2] || 0;
      p1 = `<span class="mc-proj">→${Math.round(pv1)}</span>`;
      p2 = `<span class="mc-proj">→${Math.round(pv2)}</span>`;
      const pwin = pv1 > pv2 ? 0 : pv2 > pv1 ? 1 : 2;
      if (pwin === 0 && cr !== 0) pchk1 = '<span class="mc-pchk" title="Projected to win this category">○</span>';
      if (pwin === 1 && cr !== 1) pchk2 = '<span class="mc-pchk" title="Projected to win this category">○</span>';
    }
    const chk = '<span class="mc-tick">✔</span>';
    return `<tr>
      <td class="mc-chk">${cr === 0 ? chk : pchk1}</td>
      <td class="mc-val">${Math.round(v1)}${p1}</td>
      <td class="mc-cat">${c.label}</td>
      <td class="mc-val mc-val-r">${Math.round(v2)}${p2}</td>
      <td class="mc-chk mc-chk-r">${cr === 1 ? chk : pchk2}</td>
    </tr>`;
  }).join('');

  // Total yards is the tiebreaker when the category score is level, so it gets a projection
  // too — otherwise a projected 2–2 gives you no read on who actually takes it.
  let pt1 = '', pt2 = '';
  if (pcs) {
    const pr = calcResult(pcs, rid1, rid2);
    pt1 = `<span class="mc-proj">→${Math.round(pr.ty1)}</span>`;
    pt2 = `<span class="mc-proj">→${Math.round(pr.ty2)}</span>`;
  }

  return `
  <div class="mc">
    <div class="mc-head">
      <div class="mc-side">
        <span class="mc-score ${cls1}"${r.tb1 ? ` title="${escAttr(tbTip)}"` : ''}>${s1s}</span>
        <span class="mc-team team-link" onclick="openRosterModal(${rid1})">${name(rid1)}</span>
      </div>
      <span class="mc-vs">vs</span>
      <div class="mc-side mc-side-r">
        <span class="mc-team team-link" onclick="openRosterModal(${rid2})">${name(rid2)}</span>
        <span class="mc-score ${cls2}"${r.tb2 ? ` title="${escAttr(tbTip)}"` : ''}>${s2s}</span>
      </div>
    </div>
    ${pcs ? projScoreHTML(pcs, rid1, rid2) : ''}
    <div class="mc-table-scroll">
      <table class="mc-tbl">
        <tbody>
          ${rows}
          <tr class="mc-total">
            <td></td>
            <td class="mc-val">${Math.round(r.ty1)}${pt1}</td>
            <td class="mc-cat">Total Yards</td>
            <td class="mc-val mc-val-r">${Math.round(r.ty2)}${pt2}</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`;
}
