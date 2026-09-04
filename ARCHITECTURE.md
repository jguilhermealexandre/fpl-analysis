# Architecture

The knowledge you would otherwise reconstruct by grepping. Written after a long
session of doing exactly that.

## Shape of the thing

A static site on Cloudflare Pages. No bundler, no framework, no build step for
the site itself — pages are hand-written HTML that load classic `<script src>`
files in a fixed order. **This is deliberate.** Every problem the codebase has
hit is addressable without changing it, and a migration would be months of risk
to fix things a linter catches in an afternoon.

Roughly 53k lines: ~20k in `scripts/`, ~17k CSS, and ~14.6k of JavaScript still
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
  `md*` the dashboard's live matchday panel and gameweek state, `dp*` draft
  planner, `sd*` scout's desk, `gwr*` gameweek review, `opt*` the shared
  optimisation report. Keep using them.

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

**Errors.** `scripts/error-monitor.js` loads first on every page and captures
window errors, unhandled rejections and `reportError(err, context)`. The log
lives in `localStorage`; `fplErrorLog()` in the console dumps it. Nothing is
forwarded anywhere unless `window.FPL_ERROR_ENDPOINT` is set.

## Working on it

```
npm install          # eslint and friends, dev-only
npm run dev          # http://localhost:8080, honours _redirects
npm test             # node:test, no browser needed
npm run check        # lint + globals + versions + inline syntax
npm run stamp        # after bumping asset-version.json
```

Tests load classic scripts into a `node:vm` sandbox rather than importing them
(`tests/helpers/load.mjs`), because there is nothing to import. That adapts the
tests to the architecture rather than the reverse.

## Deployment

Cloudflare Pages builds from `main`. `_headers` and `_redirects` are read from
the repo root — note the lack of extension on `_headers`; it spent a long time
named `_headers.txt`, which Pages ignores, so none of the security headers were
ever served.

`service-worker.js` precaches a static asset list using `cache.addAll`, which is
**atomic**: one 404 in that list fails the entire service worker install. If you
delete a file, remove it from there and bump `CACHE_NAME`.

## Known debt

- **~14.6k lines of JS inside HTML.** Not lintable or testable until extracted.
  `fpl-players-analysis.html` alone holds 5,369 lines. Extract page by page,
  smallest first; the CI guards are already in place to catch what moves.
- **ESLint is reporting-only** in CI, because it could not be run locally when
  introduced. Flip `continue-on-error` off once a clean run is confirmed.
- **`git log` is ~65% automated data commits.** `npm run log` filters them.
- **`.git` is ~220 MB**, growing a few MB a day from data commits. Fine for
  months; wants a decision eventually.
