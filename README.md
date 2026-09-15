# 🏈 BAFL — Bad Ass Football League

A single-file, zero-dependency viewer for a Sleeper **category** league. Drop `index.html` on
any static host and it works — no build step for users, no server, no API keys.

BAFL isn't scored on fantasy points. Each matchup is decided across five categories:

| Category | How it's scored |
|---|---|
| Passing | passing yards − 20 per interception |
| Rushing | rushing yards |
| Receiving | receiving yards |
| Touchdowns | passing + rushing + receiving TDs |
| Kicking | XPM + 3×FGM + 2×two-point conversions |

Ties on categories are broken by **total yards**. That scoring lives in exactly one place —
`baflPlayerCats()` in [src/js/50-stats.js](src/js/50-stats.js) — and every view in the app
(matchups, standings, leaders, projections, player cards) calls it, so they can't disagree.

## What it does

- **Matchups** — every category, week by week, with the live category score and BAFL's
  double-header weeks (2, 3, 13, 14) computed from the season schedule.
- **Live projections** — during the current week, each card shows the projected finish beside
  the live number, a projected category score, and which categories are still close enough to
  flip. A projection is what has happened plus what is still to come: each starter's live line
  plus the unplayed share of his full-game projection, so it starts as Sleeper's forecast on
  Thursday and *is* the box score by Monday night. Game state comes from Sleeper's schedule
  (per game) and ESPN's scoreboard (period and clock). Live results always render first;
  projections patch in when they arrive.
- **Path to win** — while a week is live, the side that's behind gets a line under the projected
  score saying exactly what it needs: the categories it has to take (the cheapest ones that get it
  to three), the amount that takes the *lead* in each (a level category wins nothing), who it has
  left to do it with, and how that compares with what those players are still projected for —
  green within projection, amber a stretch, red a long shot. It also names the categories it
  leads that the other side can still take back. When the remaining starters can't reach enough
  categories — a lone kicker down two — it says so instead. The logic lives in
  [src/js/57-comeback.js](src/js/57-comeback.js).
- **Win probability** — a bar under the team names, filled left-to-right by the first team's
  chance of taking the matchup. Each category is a normal draw around its blended projection
  whose spread shrinks as games finish; the five are combined exactly (with a level count falling
  to the total-yards tiebreaker). A category already locked has no spread left, so three locked
  wins read as 100% whatever the remaining games do — and by the end of the week the bar is
  one colour end to end. The model lives in [src/js/59-winprob.js](src/js/59-winprob.js).
- **Standings** — records including double headers, plus each team's season category totals
  heat-mapped by league rank. That grid is the quickest read on who is a passing juggernaut and
  who is one category away from a trade. Click any column header to sort by it (again to flip);
  the rank column always shows the team's standings position, whatever the order.
- **Leaders** — league-wide category races, per **team** or per **player**. Player totals count
  only the weeks a BAFL team actually started them; bench production never won a category.
- **Playoffs** — championship bracket and toilet bowl, seeded from the regular season.
- **Player cards** — click any player anywhere. Who he is, where he was drafted, who rosters
  him in BAFL, and his game log season by season — with his BAFL category contribution graded
  green/yellow/red per game, plus the raw box score and a consistency grade. A College tab
  pulls his college game logs from ESPN. The current season shows the **whole slate**, games to
  come included, with every opponent coloured Sleeper-style by how generous that defense has been
  to his position — see [Defense vs position](#defense-vs-position).
- **TripleCrown** — the crown in the bottom-right corner opens BAFL's sibling projections app.
- **Week rollover** — Sleeper moves a league to the next week on Tuesday, hours after Monday
  Night Football. BAFL doesn't: the finished week stays in view until **Wednesday at 6am
  Eastern**, and the week Sleeper has already opened is one tap away on `›`, tagged *next*.
  The rule is in [src/js/12-week-clock.js](src/js/12-week-clock.js): NFL week *N* begins
  7·(N−1) days after the season's start date (which Sleeper publishes, and which is always the
  Wednesday before the opener) at `WEEK_ROLLOVER_HOUR_ET`.
- **Player search** — search any NFL player and see who rosters him, or "FA".
- **Past seasons** — the season picker walks Sleeper's `previous_league_id` chain, so every
  prior BAFL season is browsable with the same views.

## How consistency is graded

A season total says what a player did; in a category league what matters more is how *often* he
showed up, because a team wins categories week by week. Six quiet games and two monsters is a
worse asset than eight steady ones.

The grade is the share of **games he actually played** in which he beat replacement level at his
position, that season:

1. Pull season totals for every player at the position (one request per position per season,
   cached).
2. Reduce each to a per-game figure in the metric BAFL cares about — total yards net of the
   interception penalty, or kicking points for kickers. This is the same number the card's
   `yd/g` badge shows, so the badge and the grade always describe the same thing.
3. Find the **last startable player**: rank *N*, where *N* is how many of that position this
   league starts league-wide — read from the league's own `roster_positions` (BAFL: 2 QB, 2 RB,
   2 WR, 1 TE, 2 K × 10 teams).
4. The bar is **85% of that player's per-game figure** — roughly replacement level.

Only games played count. Weeks the player missed come back from Sleeper without a `gp` value and
are shown as DNP rows; they never enter the denominator. Nor does a week where he was active but
took zero offensive snaps.

**Why a fraction of the last starter, rather than a deeper rank.** A rank offset doesn't mean the
same thing in a 65-deep quarterback pool as in a 217-deep receiver pool, which made receivers
grade systematically worse than quarterbacks for no reason but positional depth. Scaling by
production is depth-independent: checked against 2025, it holds the median starter's hit rate
within 58–76% across all five positions, versus a 21-point spread for rank-based definitions.

The curve (in [src/js/48-benchmarks.js](src/js/48-benchmarks.js)) puts a typical starter in the
C/B band at every position and reserves A for clearing the bar in roughly five games out of six.
Adjust `CONSISTENCY_CURVE` to move it; nothing else reads those numbers.

> Earlier versions used fixed per-position thresholds, which aged badly and ran hot — "good" for a
> tight end was 60 receiving yards in a season where the league's best tight end averaged 72.9, so
> no tight end could grade well however good he was. The per-game **cell** colours were re-derived
> from the same anchors; they stay fixed constants (in `PC_CATS_BY_POS`) so the table colours in
> immediately rather than shifting once a benchmark loads.

## Defense vs position

The player card's opponent colours answer "is this a matchup to attack?" for *this* player's
position. Green is a defense that gives up a lot to the position, red one that shuts it down,
amber the middle; hover a code for the rank and the per-game figure.

1. For every completed week, pull Sleeper's stat rows for the five rostered positions. Each row
   carries the **opponent**, so no schedule-joining or team-of-record guessing is needed. A week
   still in progress only contributes games that are over.
2. Reduce each line to the production BAFL cares about — category yards plus 20 per touchdown
   (a score is worth roughly that against the yardage categories), or kicking points for kickers —
   and sum it per defense, per position.
3. Divide by the games that defense has actually played (from the schedule, so a positional
   shutout counts as a game, not a missing week), and rank: rank 1 allows the most. The top ~30%
   are green, the bottom ~30% red.

"The season as a whole" is thin in September, so until a defense has played six games last
season's per-game figure stands in for the games it hasn't yet — a defense two games in is judged
on those two plus four games' worth of last year's average. The blend fades out by October, and
the legend under the table says when it's in effect.

Cost: one ~90KB request per completed week, once. Each week's aggregate is a few hundred bytes
and never changes, so it's persisted in Cache Storage — a device downloads the season once, not
once per card. The table renders immediately; the colours patch in when the ranks land. Code in
[src/js/49-dvp.js](src/js/49-dvp.js).

## No seed file

Everything is fetched live from public, CORS-open, read-only APIs. There is no pre-baked data
file to build or keep fresh.

| Source | Used for |
|---|---|
| `api.sleeper.app/v1` | league, users, rosters, matchups, player database |
| `api.sleeper.app/schedule` | game status per game (pre-game / in progress / complete) |
| `api.sleeper.com` | per-player weekly stats, weekly projections, league-wide weekly stat rows (defense vs position) |
| `site.api.espn.com` | college + fallback NFL game logs; the week's scoreboard (period + clock) |
| `sports.core.api.espn.com` | draft position |
| `site.web.api.espn.com` | athlete-id lookup |

Player cards fetch **one season at a time**, only when that season's tab is clicked. The
candidate season list is derived from Sleeper's `years_exp`, so the tabs render instantly; a
season that turns out to have no games greys itself out, which quietly corrects the frequent
cases where `years_exp` is wrong.

Every ESPN call is optional — if one fails the card still renders, it just shows less.

## Building

`index.html` is **generated**. The source is split under `src/`:

```
src/index.template.html   HTML shell, with @@CSS_PARTIALS@@ / @@JS_PARTIALS@@ tokens
src/css/*.css             stylesheet, split by feature (concatenated in filename order)
src/js/*.js               app JS, split by feature  (concatenated in filename order)
```

```bash
python3 build.py            # rebuild index.html from src/
python3 build.py --check    # verify src/ still rebuilds index.html; exit 1 if not
node tests/test_projections.js   # blended projections, win probability, path to win — run against the real partials
node tests/test_standings.js     # sortable standings: order, tie-breaks, header state
node tests/test_week_clock.js    # the Wednesday-morning week rollover
node tests/test_dvp.js           # defense vs position: aggregation, ranking, early-season blend
```

The numeric filename prefixes fix concatenation order. This is concatenation, not module
bundling — every function and global stays in the one shared scope the app relies on, and the
output is byte-for-byte what you'd get hand-editing `index.html`.

**Edit `src/`, never `index.html`.** The next build discards anything written directly to it.

## Performance notes

- The Sleeper player dictionary (~10MB) is slimmed to the dozen fields the app uses and cached
  in Cache Storage with a 1-day TTL, so it downloads roughly once a day instead of once a
  session. See [src/js/32-players.js](src/js/32-players.js).
- Weekly projections are filtered server-side to the five rostered positions, cutting the
  response from ~625KB to ~230KB gzipped.
- `sw.js` caches the app shell (network-first, so a deploy still wins) and deliberately leaves
  every Sleeper and ESPN request alone — league data must never be served stale.

## Mobile

The page itself never scrolls sideways. Anything genuinely wider than the viewport — the
standings category grid, a player-card game log, the playoff bracket — lives in its own
horizontal scroll container with its identity columns frozen, so it's reachable by scrolling
*that* element rather than being clipped by the page's overflow guard. Swipe left/right moves
between tabs.

The overlays (player card, roster, player search) share one sizing contract, ported from
TripleCrown, so they never run off screen at any window size:

- **They size from the visible viewport, not `100vh`.** `--vvh` (set in
  [src/css/00-base.css](src/css/00-base.css), kept current by
  [src/js/07-viewport-guard.js](src/js/07-viewport-guard.js) from `visualViewport`) tracks the
  collapsing mobile toolbar *and* the on-screen keyboard. Each overlay's padding is a set of
  custom properties and its card's `max-height` is derived from `--vvh` minus that padding,
  so the close button is always reachable. The padding honours the notch / home-indicator
  insets (`viewport-fit=cover` is what makes those non-zero on iOS).
- **The card is a flex column** — hero, tabs and season pills are fixed, the body is the one
  region that scrolls — and it centres in a scrolling overlay with `margin:auto`, so a short
  window shrinks the game log rather than pushing the header off the top.
- **Nothing behind an overlay scrolls.** `html.pc-locked` freezes the page declaratively, and a
  document-level touch/wheel guard cancels any gesture that doesn't land in a genuinely
  scrollable region of the open overlay (the case CSS can't express). With nothing open, the
  same guard kills iOS's rubber-band at the page and inner-scroller edges.
- **Swipe down on the card's hero to dismiss it.** The card follows the finger 1:1 and, past
  the threshold, slides off the bottom of the screen Sleeper-style. The hero is
  `touch-action:none` so the browser can't claim the gesture first.
- **Game-log column headers stay visible** while the body scrolls: each table's `<thead>` is
  translated down to the body's top edge, clamped to its own table, one write per frame.
- The player-card hero scales with `clamp()` (headshot, name, plate, meta) so one layout serves
  a 360px phone and a desktop window; text inputs are 16px on touch devices so iOS doesn't zoom
  the page on focus.

## Double headers

Weeks 2, 3, 13 and 14 each carry a second matchup. Exact pairings for past seasons are pinned
in [`double_headers.json`](double_headers.json); any season not listed there falls back to
deriving them from the schedule (see `getDHMatchups()` in
[src/js/30-data.js](src/js/30-data.js)). To lock in a season, add its pairings to that file.
