// ─── Core BAFL stat calculation ───────────────────────────────────────────
// BAFL is a five-category league, not a points league. Every view in the app — matchups,
// standings, leaders, and now the player card — has to agree on exactly what a stat line is
// worth, so the per-player conversion lives here once and everything else calls it.
//
//   Passing:   raw pass yards minus 20 per interception
//   Rushing:   rush yards
//   Receiving: receiving yards
//   Touchdowns: pass + rush + rec TDs
//   Kicking:   XPM + 3×FGM + 2×(2PT conversions)
const BAFL_CATS = [
  { key: 'passing',   label: 'Passing'    },
  { key: 'receiving', label: 'Receiving'  },
  { key: 'rushing',   label: 'Rushing'    },
  { key: 'tds',       label: 'Touchdowns' },
  { key: 'kicking',   label: 'Kicking'    },
];

// One player's stat line → his BAFL category contribution. `ps` is a Sleeper stats object,
// from either the weekly league feed or the per-player season feed — they share field names.
function baflPlayerCats(ps) {
  ps = ps || {};
  return {
    passing:   (ps.pass_yd || 0) - (ps.pass_int || 0) * 20,
    rushing:   (ps.rush_yd || 0),
    receiving: (ps.rec_yd  || 0),
    tds:       (ps.pass_td || 0) + (ps.rec_td || 0) + (ps.rush_td || 0),
    kicking:   (ps.xpm || 0)
             + (ps.fgm || 0) * 3
             + ((ps.pass_2pt || 0) + (ps.rec_2pt || 0) + (ps.rush_2pt || 0)) * 2,
  };
}
// Total yardage — the standings tiebreaker, and the player card's headline number.
function baflTotalYards(cats) {
  return (cats.passing || 0) + (cats.rushing || 0) + (cats.receiving || 0);
}

// Accumulates per-roster category totals from a week's matchups + stats dict.
function calcCatStats(matchups, statsDict) {
  const passing = {}, rushing = {}, receiving = {}, tds = {}, kicking = {};
  for (const m of matchups) {
    const rid = m.roster_id;
    passing[rid] = rushing[rid] = receiving[rid] = tds[rid] = kicking[rid] = 0;
  }
  for (const m of matchups) {
    const rid = m.roster_id;
    const starters = m.starters || [];
    const pp = m.players_points || {};
    for (const pid of starters) {
      if (!(pid in pp)) continue;   // player did not participate (same check as Python)
      const c = baflPlayerCats(statsDict[pid]);
      passing[rid]   += c.passing;
      rushing[rid]   += c.rushing;
      receiving[rid] += c.receiving;
      tds[rid]       += c.tds;
      kicking[rid]   += c.kicking;
    }
  }
  return { passing, rushing, receiving, tds, kicking };
}

// Category comparison: 0 = rid1 wins, 1 = rid2 wins, 2 = tie  (same logic as Python)
function cmp(a, b) { return a > b ? 0 : b > a ? 1 : 2; }

// Full matchup result between two roster IDs using pre-computed cat stats
function calcResult(cs, rid1, rid2) {
  const cats = {
    Passing:    cmp(cs.passing[rid1]  || 0, cs.passing[rid2]  || 0),
    Receiving:  cmp(cs.receiving[rid1]|| 0, cs.receiving[rid2]|| 0),
    Rushing:    cmp(cs.rushing[rid1]  || 0, cs.rushing[rid2]  || 0),
    Touchdowns: cmp(cs.tds[rid1]      || 0, cs.tds[rid2]      || 0),
    Kicking:    cmp(cs.kicking[rid1]  || 0, cs.kicking[rid2]  || 0),
  };
  let s1 = 0, s2 = 0;
  for (const v of Object.values(cats)) { if (v===0) s1++; else if (v===1) s2++; }
  const ty1 = (cs.passing[rid1]||0) + (cs.rushing[rid1]||0) + (cs.receiving[rid1]||0);
  const ty2 = (cs.passing[rid2]||0) + (cs.rushing[rid2]||0) + (cs.receiving[rid2]||0);
  const tie = s1 === s2;
  const tb1 = tie && ty1 > ty2;   // team1 wins tiebreaker (shown as *)
  const tb2 = tie && ty2 > ty1;
  return {
    cats, s1, s2,
    s1dec: s1 + (tb1 ? .5 : 0),
    s2dec: s2 + (tb2 ? .5 : 0),
    ty1, ty2, tb1, tb2,
  };
}

