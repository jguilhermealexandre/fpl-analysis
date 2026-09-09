# Architecture

The knowledge you would otherwise reconstruct by grepping. Written after a long
session of doing exactly that.

## Shape of the thing

A static site on Cloudflare Pages. No bundler, no framework, no build step for
the site itself — pages are hand-written HTML that load classic `<script src>`
files in a fixed order. **This is deliberate.** Every problem the codebase has
hit is addressable without changing it, and a migration would be months of risk
to fix things a linter catches in an afternoon.

Roughly 53k lines: ~20k in `scripts/`, ~17k CSS, and ~13.9k of JavaScript still
living inside `<script>` blocks in HTML pages. That last number is the main
outstanding debt (see *Known debt*).

## The one rule that explains everything

**Every script on a page shares one global scope.** There are no modules. A
function declared in `team-analysis-core.js` is callable from
`transfer-wizard.js` because both are `<script src>` tags on the same page.

Consequences you have to work with:

- **Load order matters for state, not for functions.** Function declarations
  hoist across files by the time anything runs, so a file may call a function
  defined in a file loaded after it. Top-level `const`/`let` do not — a file
  reading another file's `const` at parse time will fail.
- **Two files declaring the same top-level name silently collide.** The later
  one wins, with no error. `twRecencyWeightedAvg` exists only because
  `compare-report.js` already owns `recencyWeightedAvg` with different
  semantics. `npm run check:globals` fails the build on this.
- **Prefixes are the namespace.** `tw*` transfer wizard, `twf*` the transfer
  wizard's market funnel, `lw*` lineup wizard, `bo*` the matchday odds panel,
  `md*` the dashboard's live matchday panel and gameweek state, `mk*` the
  dashboard's price-movement panel, `dp*` draft planner, `sd*` scout's desk,
  `gwr*` gameweek review, `opt*` the shared optimisation report, `wc*` the
  wildcard builder, `pa*` the players-analysis page's own scoring helpers.
  Keep using them.

  `pa*` is the newest and worth reading as a worked example, because it exists
  for a reason a prefix is not always the answer to. `xp-engine.js` owns
  `priceQualityMultiplier`; the players page had one of its own by the same
  name. They compute the identical formula from identical constants and still
  disagree, because each takes its reference median from a different pool of
  players. A shared name would have been a silent behaviour change on whichever
  page lost the argument, so the page-local one became
  `paPriceQualityMultiplier`. Prefix when two functions genuinely differ; merge
  when they genuinely do not. Telling those apart is the work.

## Data

Three sources, different cadences, and it matters which one you read.

| File | Written by | Cadence | Holds |
|---|---|---|---|
| `data/bootstrap-static.json` | `refresh-live-data.yml` | 15 min in match windows, hourly otherwise | players, teams, events |
| `data/fixtures.json` | same | same | fixtures, `finished_provisional` |
| `data/event-live.json` | same | same | per-player stats for the round in progress |
| `data/players-data.json` | `update.player-data.yml` | every 4 h | per-gameweek history for all ~610 players |
| `data/articles/*.json` | `update.player-data.yml` | every 4 h | Scout's Desk archive |
| `data/odds.json` | `fetch-odds.yml` | 4x daily | bookmakers' prices for the next round, as probabilities |
| `data/odds-calibration.json` | same | same | the model's expected goals against, next to the market's |

The split exists because `players-data.json` needs 610 sequential
`element-summary` calls and takes minutes, while the first three are two or
three plain GETs. Before the split, a match that kicked off at 16:00 was still
being shown as an upcoming fixture at 22:00.

**Prefer `event-live.json` for anything about the current gameweek.** The
gameweek review does, falling back to `players-data.json` history when it is
absent or covers a different round. Opponent and scoreline always come from
`fixtures.json` so the two sources cannot disagree about who played whom.

Live manager data (picks, leagues, history) goes through the Cloudflare Worker
proxy in `WORKER_URL`, never direct to FPL — the API has no CORS headers.

`data/odds.json` is the one feed not sourced from FPL. It comes from
football-data.co.uk, which needs no API key — which is the reason it was
chosen, since a key could not live in the browser on a static site. Bookmakers
price one round at a time, so the feed only ever covers the next gameweek: the
Lineup Wizard's Matchday tab reads it, and the Transfer Wizard deliberately
does not. Nobody quotes clean-sheet percentages, so those are derived in
`tools/odds-model.mjs` from the 1X2 and over/under 2.5 markets and committed
already computed.

The market does reach the projection, in exactly one place: `expectedGoalsAgainst()`
in `xp-engine.js` blends it into its own estimate, weighted by how much
evidence the model has of its own (heavy at two matches played, light by a
dozen). Everything defensive — clean sheets, goals-conceded deductions —
derives from that one number, so correcting it there corrects them together.
It only applies to a round where every fixture is priced: half a round would
mean comparing players across two different estimators. `data/odds-calibration.json`
accumulates model-versus-market pairs so the model's bias can be measured
rather than argued about — the first round found its overall level right and
its home/away split roughly 1.8x too strong.

## One projection

Every xP figure on the site comes from `projectPlayerPointsDetailed()` in
`scripts/xp-engine.js`. The pitch, the captain pick, the lineup optimiser, the
draft, the transfer deltas, the players page's recommendation cards and both
Compare reports all call the same function.

That is recent. There were four scoring systems: this one, `calculateMultiGWxPts`
(a second projection inside `fpl-players-analysis.html`), and the pair of
heuristic scores `calculatePositionScore` and `calculateTransferScore`, which are
copies of each other that drifted apart. The second projection is deleted.

Both scores are still here, and both still decide orderings, so this is one
projection everywhere and **not yet one model**. `calculatePositionScore` sorts
the players page's Budget, Premium and Differentials lists.
`calculateTransferScore` no longer chooses the transfer candidate list — that
ranks on `xpOver()` over `TW_HORIZON`, and the score survives there as a
tie-break and a second reading on the card — but it does still sort the wizard's
three package strategies, blended against price and ownership.

What is left is not a deduplication, which is why it did not come with the rest.
Both scores mix prediction with decision: `points / price` and a differential
bonus are opinions about your budget and your rank welded into a forecast, and
the tabs they order are named for exactly those opinions. Retiring them needs a
decision layer that takes the projection and applies price, ownership and risk on
top of it. Attempt that as a refactor and you lose the Premium and Differentials
tabs, because expected points alone cannot answer what either of them asks.

**Why the duplicate existed, and how not to recreate it.** The engine reads six
globals the host page must define — `positionAverages`, `teamAnalysis`,
`currentGW`, `isPreseason`, `computePlayerGamesPlayed`, `teamFixtures6`, listed
at the top of the file — plus a seventh dependency that went undocumented for
much longer: **the player object's own shape**. For a long time exactly one file
could build it, buried in `team-analysis-core.js`, so a page that wanted a
projection had to load the whole squad module or write its own model. The players
page wrote its own.

So the mapping is a builder now, and the engine ships the builders for its own
inputs: `xpBuildPlayers()`, `xpBuildTeamFixtures()`, `xpBuildPositionAverages()`.
Any page holding `bootstrap-static.json` and `fixtures.json` can satisfy the
contract in about ten lines — see the block after `computeIsPreseason` in
`fpl-players-analysis.html`. Build `teamFixtures6` *before* the players and pass
it in, or each player's `.fixtures` carries no `opponentId` and every projection
degrades silently to an FDR-only estimate.

`teamAnalysis` was the last divergence and is settled. It had three
implementations of `computeTeamScores` and they were not copies: the players
page blended 35% xG, 35% goals and 30% FPL strength, `team-analysis-core.js`
used goals and strength alone, and `index.html`'s emitted no home/away splits at
all, so the projection fell back to the unsplit figure on the dashboard and only
there. One model reading three sets of inputs still gives one player two answers
on two pages.

It was decided by measurement rather than by taste, and the answer was not the
one the sophistication suggested. Both models were run over the 2025/26 season
through `tools/wildcard-backtest.mjs`: the xG version moved every team's attack
rating, one of them by 31 points, and changed the projection not at all —
Spearman 0.356 against 0.356, Pearson 0.318 against 0.314, MAE 2.028 against
2.013, and 2.4% of same-gameweek player pairs ordered differently. Equivalent for
the only thing it feeds, so the cheaper one won: `xpBuildTeamScores()` in
`xp-engine.js` is the 2-component model, and dropping the xG dependency means a
page wanting team strength no longer needs `players-data.json` to get it.

Worth keeping in mind before the next one of these: making the backtest able to
see the team model took longer than unifying it, and was the only reason the
choice could be made on evidence. The harness had been passing
`buildTeamXgData([])` and, behind that, handing the engine an untruncated
`players-data.json` — a future leak that lied about nothing only because nothing
read it.

## Conventions

**Cache-busting.** One number in `asset-version.json`. Bump it, run `npm run
stamp`, and every `?v=` in every page plus the three nav/footer busters inside JS
are rewritten. CI fails if anything is unstamped. Do not hand-edit `?v=`.

**Escaping.** `escHTML()` in `common.js` is the global one. `index.html` also
declares a function-local `esc` in several places — that is a historical wart,
and calling it from a top-level function is what took the dashboard down once.

**Player objects.** Each page maps FPL's `element` into its own shape, and they
disagreed on `position` vs `pos`. `normalisePlayerShape()` keeps both present
and equal. New mappings should call it.

**Linting.** `npm run lint` is a gate, not a report, and the run is clean. Two
things make that possible and are worth not undoing. `no-redeclare` runs with
`builtinGlobals: false`, because the generated globals block is built from the
same declarations the rule would otherwise object to — the genuine hazard, two
files declaring one name on a page, is `check:globals`'s job and it knows which
scripts a page loads. And `tools/scan-globals.mjs` has to find every declarator
in `let a = 1, b = 2;`, not just the first: missing them cost seventy no-undef
reports across six files and hid the real ones.

**Errors.** `scripts/error-monitor.js` loads first on every page and captures
window errors, unhandled rejections and `reportError(err, context)`. The log
lives in `localStorage`; `fplErrorLog()` in the console dumps it. Nothing is
forwarded anywhere unless `window.FPL_ERROR_ENDPOINT` is set.

## Working on it

```
npm install          # eslint and friends, dev-only
npm run dev          # http://localhost:8080, honours _redirects
npm test             # node:test, no browser needed
npm run check        # lint + globals + versions + inline syntax + css + preload
npm run stamp        # after bumping asset-version.json
```

Tests load classic scripts into a `node:vm` sandbox rather than importing them
(`tests/helpers/load.mjs`), because there is nothing to import. That adapts the
tests to the architecture rather than the reverse. Note that they must be
evaluated as **one** script: run per file, each file's top-level `let` is
script-scoped and the others cannot see it. For the same reason state cannot be
poked in from outside — `allPlayers` is a `let` in that scope, not a property of
the global object — so anything driving the engine appends its own epilogue to
the same source and reaches the bindings from a closure.

## Does the model work?

Separate question from "does the code work", and `npm test` only answers the
second. `npm run backtest` answers the first by rebuilding a wildcard at a past
gameweek from only the data that existed before it and totalling what the
fifteen actually returned.

The season it needs is in this repo's own git history: the data workflows have
been committing `data/players-data.json` since January and it carries per-gameweek
history, so an end-of-season snapshot is a whole season of ground truth.

```
mkdir -p /tmp/season2526
for f in players-data.json fixtures.json bootstrap-static.json; do
  git show e893f5c:data/$f > /tmp/season2526/$f      # 2026-05-28, GW38
done
node tools/extract-availability.mjs /tmp/season2526  # team news, from git history
npm run backtest -- --data /tmp/season2526
npm run backtest -- --data /tmp/season2526 --mode projection
```

`--mode projection` checks the layer underneath on every player-gameweek at
once, which is where a calibration error shows up long before a squad total
moves.

**Run the availability step.** It is optional only in the sense that the tool
still works without it, and skipping it does not weaken the measurement so much
as change what is being measured. The projection earns most of its accuracy
deciding who plays, and without team news the harness marks every player fit —
so it scores a model denied its most important input. On the 16 gameweeks of
2025/26 where a snapshot from before kickoff exists, supplying it moves MAE from
1.935 to 1.697 and rank correlation from 0.367 to 0.542. Nothing about the model
changed; the instrument stopped lying.

That is worth remembering before trusting any number this tool prints. A
calibration was fitted against the blind harness and shipped, and the news-aware
run showed the correction pointing the wrong way — the top decile under-projects
by 0.27 once injured players are excluded, where blind it appeared to over-project
by 0.39. It was reverted. Coverage begins at GW20 because the bootstrap feed has
only been committed since January; earlier gameweeks, and three with a stale
snapshot, are still measured with everyone fit.

## Deployment

Cloudflare Pages builds from `main`. `_headers` and `_redirects` are read from
the repo root — note the lack of extension on `_headers`; it spent a long time
named `_headers.txt`, which Pages ignores, so none of the security headers were
ever served.

`service-worker.js` precaches a static asset list using `cache.addAll`, which is
**atomic**: one 404 in that list fails the entire service worker install. If you
delete a file, remove it from there and bump `CACHE_NAME`.

## Known debt

- **~13.9k lines of JS inside HTML.** Not lintable until extracted, though
  `tests/page-smoke.test.mjs` now at least executes every line of it.
  `fpl-players-analysis.html` alone holds 5,182 lines. Extract page by page,
  smallest first; the CI guards are already in place to catch what moves.
- **`git log` is ~65% automated data commits.** `npm run log` filters them.
- **`.git` is ~220 MB**, growing a few MB a day from data commits. Fine for
  months; wants a decision eventually.
