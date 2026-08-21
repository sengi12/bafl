// ─── Render: Playoffs tab ────────────────────────────────────────────────────────
async function renderPlayoffs() {
  setLoading('Loading playoffs…');
  try {
    // Need regular-season data to compute seedings
    await loadAllWeeks();
    const dhData = await getDHMatchups();

    // --- Build regular-season standings for seeding ---
    const st = {};
    for (const r of S.rosters)
      st[r.roster_id] = { rid: r.roster_id, name: S.rosterMap[r.roster_id], wins:0, losses:0, ties:0, pf:0, pa:0 };
    const rsWeek = Math.min(S.currentWeek, REGULAR_SEASON_WEEKS);
    for (let w = 1; w <= rsWeek; w++) {
      const wd = S.weekCache[`${lid()}:${w}`];
      if (!wd || !wd.matchups.length) continue;
      const cs = calcCatStats(wd.matchups, wd.stats);
      const groups = {};
      for (const m of wd.matchups) {
        if (!groups[m.matchup_id]) groups[m.matchup_id] = [];
        groups[m.matchup_id].push(m.roster_id);
      }
      for (const rids of Object.values(groups)) {
        if (rids.length < 2) continue;
        applyResult(st, cs, rids[0], rids[1]);
      }
      for (const {r1, r2} of (dhData[w] || [])) applyResult(st, cs, r1, r2);
    }
    const seeds = Object.values(st)
      .sort((a,b) => b.wins !== a.wins ? b.wins - a.wins : b.pf - a.pf)
      .map((s, i) => ({ ...s, seed: i + 1 }));
    const byRid = {};
    seeds.forEach(s => byRid[s.rid] = s);

    if (S.currentWeek < 15) {
      setPage(`<div class="empty-box">Playoffs haven’t started yet — regular season ends after Week ${REGULAR_SEASON_WEEKS}.</div>`);
      return;
    }

    // Load playoff week data (fire all in parallel, ignore errors for future weeks)
    const [w15, w16, w17] = await Promise.all([15, 16, 17].map(w => loadWeek(w).catch(() => null)));

    // Helper: get category result for two roster IDs in a given week
    function matchResult(weekData, ridA, ridB) {
      if (!weekData) return null;
      const {matchups, stats} = weekData;
      const mA = matchups.find(m => m.roster_id === ridA);
      const mB = matchups.find(m => m.roster_id === ridB);
      if (!mA || !mB) return null;
      const cs = calcCatStats(
        [{roster_id:ridA,starters:mA.starters,players_points:mA.players_points||{}},
         {roster_id:ridB,starters:mB.starters,players_points:mB.players_points||{}}],
        stats
      );
      return calcResult(cs, ridA, ridB);
    }

    // Helper: render one bracket slot
    function slot(sd, winner, result, isSide) {
      if (!sd) return `<div class="bkt-slot tbd"><span class="bkt-seed">—</span><span class="bkt-name">TBD</span></div>`;
      const cls = result ? (winner === sd.rid ? ' bw' : ' bl') : '';
      const score = result
        ? (isSide
            ? (result.s1dec > result.s2dec ? result.s1dec : result.s2dec) // winner side
            : (result.s1dec < result.s2dec ? result.s1dec : result.s2dec) // loser side
          ) : '';
      const scoreCls = score ? ` class="bkt-score ${winner===sd.rid?'sw':''}"` : '';
      const scoreEl  = score !== '' ? `<span${scoreCls}>${result.tb1||result.tb2?score+'*':score}</span>` : '';
      return `<div class="bkt-slot${cls}" onclick="openRosterModal(${sd.rid})">
        <span class="bkt-seed">#${sd.seed}</span>
        <span class="bkt-name">${esc(sd.name)}</span>
        ${scoreEl}
      </div>`;
    }

    // Determine winner of a matchup
    function winner(ridA, ridB, result) {
      if (!result) return null;
      return result.s1dec > result.s2dec ? ridA : result.s2dec > result.s1dec ? ridB : null;
    }

    // --- CHAMPIONSHIP BRACKET (seeds 1-4) ---
    const s1=seeds[0],s2=seeds[1],s3=seeds[2],s4=seeds[3];
    const r_14 = matchResult(w15, s1.rid, s4.rid); // seed 1 vs 4
    const r_23 = matchResult(w15, s2.rid, s3.rid); // seed 2 vs 3
    const w_14 = winner(s1.rid, s4.rid, r_14);
    const w_23 = winner(s2.rid, s3.rid, r_23);
    const cFinA = w_14 ? byRid[w_14] : null;
    const cFinB = w_23 ? byRid[w_23] : null;
    const r_fin = cFinA && cFinB ? matchResult(w16, cFinA.rid, cFinB.rid) : null;
    const w_fin = cFinA && cFinB ? winner(cFinA.rid, cFinB.rid, r_fin) : null;
    const champ = w_fin ? byRid[w_fin] : null;

    // slot helpers bound to results
    const cSlot14 = (sd) => slot(sd, w_14, r_14, sd?.rid===w_14);
    const cSlot23 = (sd) => slot(sd, w_23, r_23, sd?.rid===w_23);
    const cSlotFin= (sd) => slot(sd, w_fin, r_fin, sd?.rid===w_fin);

    const champHTML = `
    <div class="playoff-section">
      <div class="playoff-section-title">🏆 Championship Bracket</div>
      <div class="bkt-scroll"><div class="bkt-grid">
        <div class="bkt-col">
          <div class="bkt-col-lbl">Semifinals — Wk 15</div>
          <div class="bkt-pair">${cSlot14(s1)}${cSlot14(s4)}</div>
          <div class="bkt-pair">${cSlot23(s2)}${cSlot23(s3)}</div>
        </div>
        <div class="bkt-col">
          <div class="bkt-col-lbl">Final — Wk 16</div>
          <div style="display:flex;flex-direction:column;justify-content:center;height:100%;padding:6px 0">
            <div class="bkt-single">${cSlotFin(cFinA)}${cSlotFin(cFinB)}</div>
          </div>
        </div>
        <div class="bkt-champ-col">
          <div class="bkt-champ-card">
            <span class="bkt-champ-icon">🏆</span>
            <div class="bkt-champ-lbl">Champion</div>
            <div class="bkt-champ-name">${champ ? esc(champ.name) : '?'}</div>
            <div class="bkt-champ-seed">${champ ? `#${champ.seed} seed` : 'Season in progress'}</div>
          </div>
        </div>
      </div></div>
    </div>`;

    // --- TOILET BOWL (seeds 5-10) ---
    const s5=seeds[4],s6=seeds[5],s7=seeds[6],s8=seeds[7],s9=seeds[8],s10=seeds[9];
    // Week 15: 7v10, 8v9 (seeds 5,6 have byes)
    const r_710  = matchResult(w15, s7.rid, s10.rid);
    const r_89   = matchResult(w15, s8.rid, s9.rid);
    const w_710  = winner(s7.rid, s10.rid, r_710);
    const w_89   = winner(s8.rid, s9.rid, r_89);
    // Week 16: 5 vs winner(7v10), 6 vs winner(8v9)
    const tb16A  = w_710 ? byRid[w_710] : null;
    const tb16B  = w_89  ? byRid[w_89]  : null;
    const r_5tb  = tb16A ? matchResult(w16, s5.rid, tb16A.rid) : null;
    const r_6tb  = tb16B ? matchResult(w16, s6.rid, tb16B.rid) : null;
    const w_5tb  = tb16A ? winner(s5.rid, tb16A.rid, r_5tb) : null;
    const w_6tb  = tb16B ? winner(s6.rid, tb16B.rid, r_6tb) : null;
    // Week 17 final
    const tf17A  = w_5tb ? byRid[w_5tb] : null;
    const tf17B  = w_6tb ? byRid[w_6tb] : null;
    const r_tfin = tf17A && tf17B ? matchResult(w17, tf17A.rid, tf17B.rid) : null;
    const w_tfin = tf17A && tf17B ? winner(tf17A.rid, tf17B.rid, r_tfin) : null;
    const tbWinner = w_tfin ? byRid[w_tfin] : null;

    const ts710 = (sd) => slot(sd, w_710,  r_710,  sd?.rid===w_710);
    const ts89  = (sd) => slot(sd, w_89,   r_89,   sd?.rid===w_89);
    const ts5tb = (sd) => slot(sd, w_5tb,  r_5tb,  sd?.rid===w_5tb);
    const ts6tb = (sd) => slot(sd, w_6tb,  r_6tb,  sd?.rid===w_6tb);
    const tsFin = (sd) => slot(sd, w_tfin, r_tfin, sd?.rid===w_tfin);

    const toiletHTML = `
    <div class="playoff-section">
      <div class="playoff-section-title">🚽 Toilet Bowl</div>
      <div class="bkt-scroll"><div class="bkt-grid">
        <div class="bkt-col">
          <div class="bkt-col-lbl">First Round — Wk 15</div>
          <div class="bkt-bye-row">#5 ${esc(s5.name)} — bye</div>
          <div class="bkt-pair">${ts710(s7)}${ts710(s10)}</div>
          <div class="bkt-bye-row">#6 ${esc(s6.name)} — bye</div>
          <div class="bkt-pair">${ts89(s8)}${ts89(s9)}</div>
        </div>
        <div class="bkt-col">
          <div class="bkt-col-lbl">Semifinals — Wk 16</div>
          <div class="bkt-pair" style="margin-top:12px">${ts5tb(s5)}${ts5tb(tb16A)}</div>
          <div class="bkt-pair" style="margin-top:12px">${ts6tb(s6)}${ts6tb(tb16B)}</div>
        </div>
        <div class="bkt-col">
          <div class="bkt-col-lbl">Final — Wk 17</div>
          <div style="display:flex;flex-direction:column;justify-content:center;height:100%;padding:6px 0">
            <div class="bkt-single">${tsFin(tf17A)}${tsFin(tf17B)}</div>
          </div>
        </div>
        <div class="bkt-champ-col">
          <div class="bkt-champ-card" style="border-color:var(--danger);background:rgba(248,81,73,.07)">
            <span class="bkt-champ-icon">🚽</span>
            <div class="bkt-champ-lbl" style="color:var(--danger)">Toilet Bowl Champ</div>
            <div class="bkt-champ-name">${tbWinner ? esc(tbWinner.name) : '?'}</div>
            <div class="bkt-champ-seed">${tbWinner ? `#${tbWinner.seed} seed` : 'Season in progress'}</div>
          </div>
        </div>
      </div></div>
    </div>`;

    setPage(`<div class="playoff-wrap">${champHTML}${toiletHTML}</div>`);
  } catch(e) {
    setError('Failed to load playoffs: ' + e.message);
  }
}

// Apply a single matchup result to the standings object
function applyResult(st, cs, rid1, rid2) {
  if (!st[rid1] || !st[rid2]) return;
  const r = calcResult(cs, rid1, rid2);
  st[rid1].pf += r.s1dec; st[rid1].pa += r.s2dec;
  st[rid2].pf += r.s2dec; st[rid2].pa += r.s1dec;
  if (r.s1dec > r.s2dec)      { st[rid1].wins++;  st[rid2].losses++; }
  else if (r.s2dec > r.s1dec) { st[rid2].wins++;  st[rid1].losses++; }
  else                         { st[rid1].ties++;  st[rid2].ties++;   }
}

