// ─── Week clock ───────────────────────────────────────────────────────────
// Sleeper advances a league's week (`leg`) on Tuesday, a few hours after Monday Night
// Football. Nobody wants the app to flip to next week's empty matchups while the one that just
// finished is still being savoured — or disputed — so the week the app opens on is held until
// Wednesday morning.
//
// The NFL week is counted from the season's start date, which Sleeper publishes in its state
// payload and which is always the Wednesday before the opening Thursday. Week N therefore
// begins 7·(N−1) days after it, at WEEK_ROLLOVER_HOUR_ET (Eastern, because that is the clock
// the NFL runs on — a West Coast reader gets the new week at 3am, not at 6). Until that
// moment the previous week stays in view, and the newly opened one is a tap away on ›, tagged
// "next" so it's clear the app hasn't turned over yet.

// The Eastern-time calendar date and hour of an instant.
function etClock(ms) {
  const d = new Date(ms);
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false });
    const o = {};
    for (const p of f.formatToParts(d)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: (+o.hour) % 24 };
  } catch {
    // No time-zone support (very old engines): assume EDT, which covers September–October.
    const e = new Date(ms - 4 * 3600e3);
    return { y: e.getUTCFullYear(), m: e.getUTCMonth() + 1, d: e.getUTCDate(), h: e.getUTCHours() };
  }
}

// Which NFL week the calendar says it is, given the season's start date ('YYYY-MM-DD').
// Week 1 before the season opens; null if the date can't be read. The start date is snapped
// back to a Wednesday in case Sleeper ever publishes the Thursday kickoff instead.
function calendarWeek(startDate, nowMs) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(startDate || ''));
  if (!m) return null;
  let start = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const dow = new Date(start).getUTCDay();          // 0 = Sunday … 3 = Wednesday
  start -= ((dow - 3 + 7) % 7) * 864e5;
  const now = etClock(nowMs == null ? Date.now() : nowMs);
  let days = Math.round((Date.UTC(now.y, now.m - 1, now.d) - start) / 864e5);
  if (now.h < WEEK_ROLLOVER_HOUR_ET) days -= 1;   // still "last night" until the rollover hour
  if (days < 0) return 1;
  return Math.floor(days / 7) + 1;
}

// The week the app should open on: Sleeper's week, capped by the calendar. The cap only
// applies when the state payload describes the same season as the league in view — in the
// offseason Sleeper's state is already on next year while the league is still last year's.
function heldWeek(leg, state, leagueSeason, nowMs) {
  const sleeperWeek = Math.max(1, Number(leg) || 1);
  if (!state || !state.season_start_date) return sleeperWeek;
  if (leagueSeason != null && state.season != null && String(state.season) !== String(leagueSeason)) return sleeperWeek;
  const cal = calendarWeek(state.season_start_date, nowMs);
  return cal == null ? sleeperWeek : Math.max(1, Math.min(sleeperWeek, cal));
}
