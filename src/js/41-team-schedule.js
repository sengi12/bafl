// ─── Team schedule ───────────────────────────────────────────────────────
// The calendar in the roster modal expands one team into every regular-season game. Double
// headers are separate rows because each opponent produces a separate standings result.
function setRosterModalMode(view, rid) {
  const overlay = document.getElementById('rosterOverlay');
  const button = document.getElementById('rosterScheduleBtn');
  if (!overlay || !button) return;
  overlay.dataset.view = view;
  overlay.dataset.rid = String(rid);
  button.hidden = false;
  button.innerHTML = view === 'schedule'
    ? '<span class="schedule-back" aria-hidden="true">‹</span>'
    : '<span class="calendar-glyph" aria-hidden="true"></span>';
  button.title = view === 'schedule' ? 'Back to roster' : 'View full season schedule';
  button.setAttribute('aria-label', button.title);
  button.classList.toggle('is-back', view === 'schedule');
}

function toggleRosterSchedule() {
  const overlay = document.getElementById('rosterOverlay');
  const rid = Number(overlay.dataset.rid);
  if (!rid) return;
  if (overlay.dataset.view === 'schedule') openRosterModal(rid);
  else openTeamSchedule(rid);
}

function scheduleWeekIsFinal(week) {
  return !isCurrentSeason()
    || week < S.currentWeek
    || (week === S.currentWeek && S.maxWeek > S.currentWeek);
}

function scheduleOpponent(matchups, rid) {
  const mine = matchups.find(m => Number(m.roster_id) === Number(rid));
  if (!mine || mine.matchup_id == null) return null;
  const opponent = matchups.find(m => m.matchup_id === mine.matchup_id && Number(m.roster_id) !== Number(rid));
  return opponent ? Number(opponent.roster_id) : null;
}

function scheduleOutcome(cats, rid, opponent, projected) {
  if (!cats) return { state: 'pending', label: projected ? 'Projection unavailable' : 'Awaiting result', score: '' };
  const result = calcResult(cats, rid, opponent);
  const state = result.s1dec > result.s2dec ? 'win' : result.s1dec < result.s2dec ? 'loss' : 'tie';
  const score = `${result.s1}${result.tb1 ? '*' : ''}–${result.s2}${result.tb2 ? '*' : ''}`;
  return { state, label: `${projected ? 'Projected ' : ''}${state.toUpperCase()}`, score };
}

function scheduleGames(matchupsByWeek, dh, rid) {
  const games = [];
  for (let week = 1; week <= REGULAR_SEASON_WEEKS; week++) {
    const opponent = scheduleOpponent(matchupsByWeek[week] || [], rid);
    if (opponent) games.push({ week, opponent, dh: false });
    const extra = (dh[week] || []).find(pair => Number(pair.r1) === Number(rid) || Number(pair.r2) === Number(rid));
    if (extra) games.push({
      week,
      opponent: Number(extra.r1) === Number(rid) ? Number(extra.r2) : Number(extra.r1),
      dh: true,
    });
  }
  return games;
}

function teamScheduleHTML(rid, games, outcomes) {
  if (!games.length) return '<div class="empty-box">No regular-season schedule is available.</div>';
  let lastWeek = 0;
  return `<div class="team-schedule">${games.map((game, index) => {
    const result = outcomes[game.week];
    const outcome = result ? scheduleOutcome(result.cats, rid, game.opponent, result.projected) : null;
    const weekLabel = game.week === lastWeek ? '' : `<span class="ts-week-num">${game.week}</span>`;
    lastWeek = game.week;
    const status = outcome
      ? `<span class="ts-outcome ${outcome.state}"><b>${outcome.label}</b><small>${outcome.score}</small></span>`
      : `<span class="ts-outcome loading-result"><b>PROJECTING</b><small>…</small></span>`;
    return `<div class="ts-game${game.dh ? ' double-header' : ''}${game.week === S.currentWeek ? ' current' : ''}">
      <div class="ts-week"><small>${weekLabel ? 'WK' : ''}</small>${weekLabel}</div>
      <div class="ts-opponent"><span>${esc(S.rosterMap[game.opponent] || `Team ${game.opponent}`)}</span>
        ${game.dh ? '<small>DOUBLE HEADER</small>' : '<small>REGULAR MATCHUP</small>'}</div>
      ${status}
    </div>`;
  }).join('')}</div>`;
}

async function openTeamSchedule(rid) {
  const token = ++ROSTER_VIEW_TOKEN;
  const body = document.getElementById('rosterModalBody');
  document.getElementById('rosterModalTitle').textContent = `${S.rosterMap[rid] || `Team ${rid}`} Schedule`;
  setRosterModalMode('schedule', rid);
  body.innerHTML = '<div class="loading"><div class="spin"></div><div>Loading schedule…</div></div>';

  try {
    const weeks = Array.from({ length: REGULAR_SEASON_WEEKS }, (_, index) => index + 1);
    const schedules = await Promise.all(weeks.map(week => loadSchedule(week)));
    const matchupsByWeek = Object.fromEntries(weeks.map((week, index) => [week, schedules[index]]));
    const games = scheduleGames(matchupsByWeek, await getDHMatchups(), rid);
    const outcomes = {};

    await Promise.all(weeks.filter(scheduleWeekIsFinal).map(async week => {
      const data = await loadWeek(week);
      outcomes[week] = { cats: calcCatStats(data.matchups, data.stats), projected: false };
    }));
    if (token !== ROSTER_VIEW_TOKEN) return;
    body.innerHTML = teamScheduleHTML(rid, games, outcomes);

    const forecastWeeks = weeks.filter(week => !scheduleWeekIsFinal(week));
    for (let index = 0; index < forecastWeeks.length; index += 2) {
      const batch = forecastWeeks.slice(index, index + 2);
      await Promise.all(batch.map(async week => {
        const matchups = matchupsByWeek[week] || [];
        const actual = week === S.currentWeek ? await loadWeek(week) : { stats: {} };
        const projection = await loadWeekProjections(S.league.season, week);
        if (!projection || !Object.keys(projection.stats || {}).length) {
          outcomes[week] = { cats: null, projected: true };
          return;
        }
        const progress = week === S.currentWeek ? await loadGameProgress(S.league.season, week) : null;
        outcomes[week] = {
          cats: blendProjections(matchups, actual.stats || {}, projection, progress),
          projected: true,
        };
      }));
      if (token !== ROSTER_VIEW_TOKEN) return;
      body.innerHTML = teamScheduleHTML(rid, games, outcomes);
    }
  } catch (error) {
    if (token !== ROSTER_VIEW_TOKEN) return;
    body.innerHTML = `<div class="error-box">⚠ ${esc(error.message)}</div>`;
  }
}