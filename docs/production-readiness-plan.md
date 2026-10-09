# easyfpl.com — production readiness

*Lives in the repo rather than in a chat window, because four surfaces of
findings had accumulated somewhere that would not survive the session that made
them. Updated as each surface is finished; the per-surface findings themselves
are in the commit messages, which is where they belong — this is the plan and
the decisions, not the log.*

## Where it stands

| surface | state |
|---|---|
| Step 0 — instrumentation | done: page-weight budgets, axe audit, layout audit |
| G1 — contrast tokens | done |
| G2 — shared-component type scale | done |
| 1 — My Team · Squad Analysis | done (v443) |
| 2 — My Team · Transfers | done (v444) |
| availability mark (spans 1 + 3) | done (v445) |
| 3 — My Team · GW Draft | done (v446) |
| 4 — My Team · Transfer Wizard | part 2 done (v449): the selling-price defect. The 4146-line split still open |
| 5 — My Team · Lineup Wizard | done (v450) |
| 6 — My Team · News | done (v453) — and the tab itself is unreachable, see below |
| 7-13 — Players x7 | |
| 14-18 — Teams x5 | |
| 19-24 — Rivals x6 | |
| 25-27 — Dashboard, Scout's Desk, News Hub | |
| 28-35 — the eight feature pages | |
| 36-47 — static and auth | |

## Open decisions

- **The My Team News tab is unreachable and 307 lines ship for it.** The button
  is `class="tab hidden"` in fpl-my-team-analysis.html and nothing anywhere
  removes `hidden`; nothing links to `#news`. The only way in is typing the hash
  by hand. Git says this was deliberate — hidden in "Simplify navigation",
  briefly un-hidden during a Squad Analysis rework, hidden again when v2 shipped
  — and a standalone News Hub page now exists at /fpl-news. So renderNewsTab()
  and its helpers, 307 lines in panels-and-tabs.js, are on the critical path of
  every My Team load for a tab no one can click. Two honest options: un-hide the
  tab, or delete it and let the News Hub own news. Not taken unilaterally
  because parking a feature is not the same as abandoning it.

- **Un-gate and index Players and Teams.** A product call, not an engineering
  one: it changes who can see the app without a Team ID. The SEO case is in
  Phase 3 below and it is the single biggest lever available. Still open.
- Nothing else is blocked on a decision.

## Carried forward, with measurements

- ~~transfer-funnel.min.js on the Transfers tab~~ — DONE in v448. 37.8 KB off
  that tab. The invariant check:deferred cannot express is pinned instead by
  tests/tab-group-closure.test.mjs, which also records that the saving depends
  on the tmSellBeforeDrop ordering fix from Surface 2.
- **nested-interactive on the Transfer Wizard's plan cart.** transfer-wizard.js
  ~1479: the × is a role="button" span INSIDE a real <button>. Pre-existing, and
  the fix is a layout change — the × has to become a sibling of the card rather
  than a child — so it is not an attribute edit. The equivalent on the two pitch
  cards was fixed in v450 by moving the keyboard path onto the player's name.
- **61 click handlers on non-interactive elements, site-wide.** Three were on
  the GW Draft and are fixed; the delegated handler that makes the fix a
  two-attribute change is in common.js (initKeyActivation). The rest are
  per-surface. Worth a baselined gate like page-budgets.json so the number can
  only fall.
- **Three formation-naming functions** — getFormation, getFormationString,
  describeFormation. The legality RULE is unified (v2LegalXI); these three only
  build a "4-4-2" string and take three different player shapes, so they are
  left alone deliberately.
- **gen-tracking.mjs cannot be run on the development machine.** node is not
  available, and a port of it disagrees with the real tool on one selector's
  band, so its output must not be committed. Consequence: no change here may
  introduce a font-size under 16px without a workflow to regenerate the block.
  Adding one would look like rebuild-minified.yml.

---

*Measured 2026-10-08 against `5cb30ff9`. Every number below came from the repo, not from an estimate.*

---

## The baseline, measured

### Transfer weight per page

| page | HTML | of which inline JS | external JS | CSS | **total** |
|---|---|---|---|---|---|
| `fpl-my-team-analysis` | 44KB | 1KB | 563KB | 458KB | **1064KB** |
| `fpl-players-analysis` | 300KB | **277KB** | 327KB | 213KB | **841KB** |
| `fpl-teams-analysis` | 270KB | **260KB** | 113KB | 152KB | **534KB** |
| `fpl-league-rivals` | 168KB | **94KB** | 110KB | 85KB | 362KB |
| `index` (dashboard) | 54KB | 6KB | 115KB | 188KB | 357KB |
| `fpl-news` | 130KB | **66KB** | 111KB | 85KB | 327KB |
| `fpl-scouts-desk` | 13KB | 6KB | 205KB | 99KB | 317KB |

Biggest single assets: `my-team.min.css` **330KB**, `transfer-wizard.min.js` 122KB,
`players.min.css` 104KB, `draft-planner.min.js` 99KB, `scouts-desk.min.js` 90KB.

### The two cross-cutting faults

**1. ~700KB of inline JavaScript on four pages.** My Team carries 1KB inline and
563KB external — it is the correctly-structured page. Players, Teams, Rivals and
News between them carry ~700KB *inline*, which means: never minified (the build
only touches `scripts/`), never cached separately (re-downloaded on every visit),
never covered by `check:min`, and only shallowly linted.

**2. That inline code is what keeps `'unsafe-inline'` in the CSP.** `_headers`
says so itself. Measured now: **147** inline `on*=` attributes in HTML and **287**
emitted from scripts — 434 handlers. With 360 `escHTML` interpolation sites and
FPL-supplied strings (manager names, player news) flowing through them, dropping
`'unsafe-inline'` is the single largest security win available, and it is blocked
on exactly this work.

### Accessibility baseline

| | count |
|---|---|
| click handlers on `div`/`span`/`td`/`tr`/`li` (keyboard-unreachable) | **61** |
| icon-only buttons with no accessible name | **21** |
| `<img>` without `alt` | 13 |
| `<th>` without `scope` | **112 of 148** |
| `data-tooltip` (not an accessible name, invisible on touch) | **360** |
| `outline: none` / `outline: 0` | 20 |
| `role="dialog"` | **3** (the report modal has none) |
| `aria-live` regions | 7 |
| `prefers-contrast` support | **0** |
| `prefers-reduced-motion` | 26 ✓ |

Worst files for unreachable handlers: `fpl-players-analysis.html` (22),
`fpl-my-team-analysis.html` (8), `fpl-teams-analysis.html` (6).

### SEO baseline

- **The four app pages are `noindex`** (my-team, players, teams, rivals). Deliberate —
  they need a Team ID — so the eight `feature-*.html` pages are the only indexable
  surface for the product. Those are thin (12KB each).
- **Structured data on 2 of 36 pages** (`index`, `fpl-faq`).
- 4 pages with more than one `<h1>`: premium, register, reset-password, welcome.
- 7 pages missing `canonical`; app pages missing `og:image`.
- `sitemap.xml` 46 URLs with `lastmod` ✓, `robots.txt` ✓.

### What is already good (do not re-do)

- `_headers` — CSP, HSTS, X-Frame-Options, immutable asset caching, 300s on `/data`.
  Thoroughly reasoned and self-documenting.
- **15 CI gates**: lint, globals, gen-globals, min, versions, bump, tracking, shell,
  inline-syntax, inline-css, preload, app-css, og, social, tests.
- `tools/audit-mobile.mjs` — opens every page at phone widths, **walks every tab**,
  and reports six fault classes (page-scroll, escapes, clipped, tiny-target, overlap,
  tiny-text). This is the responsiveness instrument; the plan uses it rather than
  replacing it.
- Only one third-party `<script>` tag site-wide (chartjs-plugin-annotation, on Teams)
  and it carries SRI. Fonts are self-hosted; a signed-out visitor makes no
  third-party request.
- **The projection model is unified.** Verified: `predictedGWPoints`,
  `projectPlayerPointsForGW`, `xpOver`/`twXPOver`, `projectLineupForGW` all bottom out
  in `projectPlayerPointsDetailed`. The two "next gameweek" wrappers were measured
  against each other: **0 of 667 players differ**.

---

## Phase 0 — Make it measurable (half a day)

Nothing else in this plan is trustworthy without a before/after.

1. `npm run audit:widths` → commit the JSON as the responsive baseline.
2. Add `tools/audit-a11y.mjs` — same Playwright harness as audit-mobile, running
   axe-core per page **per tab**. Output the same shape so both can gate.
3. Add `tools/page-weight.mjs --check` — fails if a page's total transfer size
   regresses past a per-page budget. Seed the budgets at today's numbers so they
   can only improve.
4. Lighthouse CI on five representative URLs, scores recorded not gated (yet).

**Exit:** three committed baselines and a CI job that can fail on regression.

---

## The shape of the work (restructured 2026-10-08 at the owner's direction)

**One deep pass per surface, every surface, before production.** The earlier draft
put the cross-cutting work in its own phase ahead of the per-page passes. That was
wrong for this goal: extraction, weight, a11y and bug-bash are all *per surface*, so
batching them by type means visiting every page four times and finishing none of them.

Folded in instead. Each surface is done once, properly, and does not get reopened.
Only the items that are genuinely global — they cannot be true until every surface is
clean — are left to the closing phase.

### The surfaces: 27 app + 20 static

| # | group | surfaces |
|---|---|---|
| 1-6 | **My Team** | Squad Analysis · Transfers · GW Draft · Transfer Wizard · Lineup Wizard · News |
| 7-13 | **Players** | Recommendations · Rising Form · Purple Patch · Charts (Season Trend / Last 5) · Routes to Points · All Players |
| 14-18 | **Teams** | Teams Rankings · Fixture Swings · Soft Targets · Full Calendar · Stats Table |
| 19-24 | **Rivals** | Insights · Captain Race · League Race · Squad Strength · Matrix · Head-to-Head |
| 25 | **Dashboard** | `index` signed-in |
| 26 | **Scout's Desk** | hub + the article template (26 generated pages) |
| 27 | **News Hub** | `fpl-news` |
| 28-35 | **Feature pages** | the eight `feature-*` |
| 36-47 | **Static / auth** | landing, methodology, faq, how-it-works, pricing, accuracy, changelog, contact, privacy, terms, 404, welcome, login, register, reset-password, premium, season-vault, admin ×2 |

### Definition of done, per surface

A surface is not finished until all seven are green, and each gets a line in the
commit saying what was found:

1. **Code** — inline JS extracted to `scripts/`; duplication removed; dead code
   deleted; globals registered; oversized files split. Covered by `check:min`.
2. **Bug bash** — every control clicked; every empty, loading, error and
   data-absent path exercised; every number traced to its source and confirmed
   against the real feed.
3. **Responsive** — `audit:widths` clean at 390 / 768 / 1024 / 1180 / 1440.
4. **Accessibility** — axe clean; full keyboard path; every control named; focus
   visible, trapped in dialogs and returned on close.
5. **Performance** — inside its weight budget; heavy scripts deferred; no
   avoidable work on first paint.
6. **Product & design** — does it answer the question the user arrived with;
   hierarchy, copy, and no number on screen that another surface contradicts.
7. **SEO** — title, description, canonical, single `h1`, schema where it applies.
   (Skipped on the four gated app pages unless they are un-gated.)
8. **Security** — no user-written string reaching a markup sink unescaped; no
   client-side-only gate on anything paid or private; every fetch target on an
   allowlist; nothing secret in the bundle. Added 2026-10-08 after the Rivals
   finding below, because "is security being checked" deserved to be a line in
   the checklist rather than a phase at the end.

### Closing phase — only what cannot be done per surface

- **Drop `'unsafe-inline'` from `script-src`.** Possible only once all 434 inline
  handlers are gone. This is the payoff for the extraction work.
- **Cross-file CSS dedupe.** `my-team.min.css` 330KB, and the shared
  `v2-app.css` / `common.css` overlap. Easier once per-surface passes have shown
  which rules are actually live.
- **Self-host the two CDN dependencies** (jsdelivr chart plugin, unpkg lucide).
- **Full-site re-audit**: weights, axe, `audit:widths`, Lighthouse, link check.

---

## Phase 3 — SEO

1. **Un-gate and index Players and Teams. This is the single biggest SEO lever and
   it is nearly free.** Measured: both pages hold **one** `teamId` reference each —
   their content is entirely public data (player stats, xG, fixture difficulty). They
   are `noindex` AND redirected away from by `dashboard-gate.js`, whose own comment
   says it is *"not a security boundary… about landing somebody in the right place."*
   The Scout's Desk and News Hub are already exempt as "the two free reads"; Players
   and Teams belong on that list. "FPL player stats", "FPL xG table", "FPL fixture
   difficulty" are high-volume evergreen queries and the site has better data than
   most pages ranking for them.
   - Keep **My Team** and **Rivals** gated — those genuinely need a squad or a league.
   - Do NOT over-invest in the eight `feature-*` pages. See the note below.
2. **Structured data.** CORRECTION to the first draft of this plan: I wrote that the
   Scout's Desk articles carry no `Article` schema. That was wrong — I had only scanned
   root `*.html`. **All 26 articles carry `Article` schema and all 26 are in the
   sitemap.** The content engine is already in good shape. What is genuinely missing:
   `BreadcrumbList` on the feature pages, `dateModified` on articles, and a per-series
   index so the series accumulate authority rather than each article standing alone.
3. Fix the four multi-`<h1>` pages and the seven missing canonicals.
4. `og:image` for the app pages (`make-og-cards.mjs` already exists).
5. Internal linking: the feature pages should link into each other and into the
   articles; the articles should link back to the features.
6. Re-check Core Web Vitals after Phase 1 — page weight is currently the main LCP risk.

### Why NOT to turn the feature pages into eight landing pages

- **Doorway-page risk.** Eight near-identical pages each pitching the product and
  funnelling to the same CTA is the pattern Google's doorway guidance names. The risk
  is a documented spam category, not a theory.
- **Cannibalisation with `/`.** The landing page already owns the head term. Eight more
  pages chasing the same intent means Google picks one, and not necessarily yours.
- **Maintenance against this codebase's own standard.** This repo refuses unverifiable
  claims; eight pages of marketing copy are eight more places to go stale.
- **The demand is not there.** Nobody searches "FPL squad analysis tool" at volume.
  They search "who should I captain gw7" and "best fpl defenders under 5m" — content
  and data queries, which the article engine and an indexable Players page serve.

Keep the feature pages as conversion surfaces for traffic arriving from `/`. Fix the
four multi-`<h1>` pages and seven missing canonicals, and stop there.

---

## Phase 4 — Production readiness (lead-engineer view)

**Must fix before calling it production**

1. **`old-website/` is live.** 4.4MB, 23 HTML pages, served from the domain, held out
   of the index only by an `X-Robots-Tag`. `_headers` calls it *"TEMPORARY… days, not
   months"*. Delete it, or move it behind a branch.
2. **Verify Supabase RLS.** The anon key is in the client, which is correct — but it
   is only safe if row-level security is right on every table. This has not been
   checked in anything I have seen. Treat as a blocker.
3. **Audit the FPL proxy worker for open-proxy abuse.** If it will fetch arbitrary
   URLs or has no rate limit, it is a free bandwidth amplifier attached to your name.
4. **Confirm `error-monitor.js` has a live sink and someone reads it.** Error
   reporting nobody watches is not monitoring.
5. **Reconcile the `immutable` caching sharp edge.** `_headers` warns that nothing
   catches a script edited without an `asset-version.json` bump, and under
   `immutable` a returning visitor keeps the stale file *forever*. `check:bump`
   appears to cover exactly this — confirm, and if so correct the comment; if not,
   add the gate. Today this is the highest-consequence silent failure on the site.

**Should fix**

6. **8 test suites cannot run outside a full node+vm environment** (`loadScript`-based:
   xp-engine, matchday, ticker, form-trend, error-monitor, service-worker,
   odds-calibration, lineup-summary). They run in CI, so coverage is real — but they
   cannot be run locally on this machine, which is how the `squadFixtureLoad` dead
   binding and the unused `catch` both reached CI instead of being caught locally.
7. **9 cross-file global collisions.** All currently benign (the files never share a
   page) but nothing enforces that, and `check-globals` tolerates them. Make the
   tolerance an explicit allowlist so a new collision fails.
8. **No per-page JS budget**, hence 1064KB. Phase 0.3 fixes this.
9. **`data/bootstrap-static.json` is committed every 15 minutes** (1.74MB). Git
   history growth is worth a look — `git count-objects -vH`.
10. **The luck rating is still unexercised.** It ships refusing; GW6 is the first
    round `snapshot-predictions.mjs` can seal. Verify it renders once a snapshot
    lands rather than assuming it will.

**Worth considering**

11. Tabs-as-one-URL: five tabs behind one URL costs deep links and analytics
    resolution. Hash routing exists — consider making every tab linkable.
12. No visible-regression testing. With this much CSS, a screenshot diff on five
    pages × five widths would pay for itself.

---

## Suggested order

| | work | why first |
|---|---|---|
| 1 | Phase 0 | nothing is provable without it |
| 2 | Phase 4 items 1-5 | they are production blockers, and cheap |
| 3 | Phase 1a/1b for Players + Teams | 537KB of the problem, and unblocks the CSP |
| 4 | Phase 1c | the security payoff |
| 5 | Phase 2.1 → 2.7 in your stated order | per-page polish, now measurable |
| 6 | Phase 1d (CSS) | easier once dead rules are visible from Phase 2 |
| 7 | Phase 3 | after weight is fixed, so CWV measures the real thing |


---

## The FDR decision (investigated 2026-10-08)

### What is actually wrong

There is **no single definition of fixture difficulty.** Seven places derive it
independently from FPL's raw `team_h_difficulty` / `team_a_difficulty`:
`fpl-league-rivals.html` ×2, `fpl-players-analysis.html` ×2, `fpl-teams-analysis.html`
×3, `panels-and-tabs.js`, `team-analysis-core.js`, and `xp-engine.js` itself.

Meanwhile the projection's attack term uses something else entirely —
`xpTeamRate(opp,'avgConceded')`, clamped to [0.70, 1.40], regressed on the house
k=6 clock. And the Teams page shows a *third* number, `defensePower`, a 0-100 rating
blended 55/45 with FPL's published strength.

Three numbers for one concept. **That is the real defect, and it is worth fixing
regardless of which number wins.**

### A correction to what I told the owner

I said: *"Man City have conceded 1.00/game and Brentford 0.80, so the engine is right
and the FDR badge is wrong."* That was only the defensive half. Brentford are also
**scoring 2.00/game** against City's 2.60. A generic fixture rating has to account for
both, and on both counts Brentford away is a genuinely hard fixture. FPL rating it 3
is defensible; my claim that the badge was simply wrong was not.

The narrower, true statement: **the strip implies an ordering of fixtures that the
projection's attack term does not follow**, because the badge is generic and the
attack term is specifically about opponent leakiness.

### What I measured

A difficulty built only from quantities the projection already uses —
`sqrt((1/leakiness) × opponentAttack)` with a venue factor — over 660 remaining
team-fixtures:

| mapping | resulting 1-5 distribution |
|---|---|
| FPL's own FDR | 2:23% · 3:50% · 4:22% · 5:5% |
| fixed span 0.85-1.20 | **1:40% · 2:10% · 3:5% · 4:7% · 5:38%** ← unusable |
| quantile-matched, fixed cuts `[0.687, 0.879, 1.12, 1.294]` | 1:2% · 2:22% · 3:50% · 4:20% · 5:5% |

The naive mapping is bimodal and would paint the site red and green with nothing in
between — **worse than what ships today.** The quantile-matched version reproduces
FPL's familiar spread, **agrees with FPL exactly 48% of the time and is never more
than one band away.** Its extremes are sensible: hardest remaining fixture is away at
Brighton (scoring 3.20, conceding 1.00), easiest is home to Coventry (scoring 0.20,
conceding 2.00).

### The decision needed

**Option A — unify only.** One `xpFixtureDifficulty()` returning FPL's FDR unchanged;
all seven call sites repointed; the measured opponent read added to the badge tooltip
so the two are visible side by side instead of one silently contradicting the other.
Zero behaviour change, kills the three-numbers problem, makes option B a one-line
change later.

**Option B — unify and switch to the measured band**, with the cut points frozen as
constants (NOT recomputed per load: live quantiles would let one club's form re-band
another club's fixtures, which is a bad property for a planning tool). Honest caveat:
the cut points were calibrated on five gameweeks, and as the season matures the
hardness spread widens, so they will need one recalibration around the halfway mark.

### DECIDED: Option A. Not "A then B" — A, with B revisited only on evidence.

The measurement narrowed the problem rather than confirming it. **48% of fixtures agree
exactly, 100% agree within one band, and not one fixture differs by two or more.** The
Szoboszlai case that started this is a one-band disagreement, which is inside the noise
of any five-point scale. There is no material conflict between FPL's FDR and the
measured read — so the thing to fix is the seven derivations and the three displayed
numbers, not the number itself.

Four reasons B is the wrong trade today:

1. **Its blast radius is verdicts, not pixels.** `difficulty` is not just the badge:
   `toughFixtureStarters = difficulty >= 4` feeds the squad health score, the squad
   report's "hard run" section, fixture-swing detection and draft scoring. B changes
   what the site tells people to do.
2. **The calibration rests on five gameweeks.** Chelsea have conceded 2.40 a game and
   Everton 0.60 — a fourfold spread on five matches. Frozen cut points would need
   recalibrating by midseason, so B ships a number already known to need revisiting.
3. **FDR is shared vocabulary.** Every other FPL site, spreadsheet and video says
   "FDR 4". Differing on half of all fixtures asks the user to arbitrate between us and
   the rest of the FPL world — a trust cost for a one-band gain.
4. **A already kills the real defect** and makes B a one-line change if it is ever
   wanted.

**Revisit B around GW25**, when FPL's July-set ratings are genuinely stale and there are
twenty-plus matches per club to calibrate against.

### What A ships
- `xpFixtureDifficulty(teamId, fixture)` — one definition; all seven derivation sites
  repointed at it.
- The measured opponent read in the badge tooltip, so the badge explains itself:
  *"Leeds concede 0.60 a game, the meanest defence in the league on five matches."*
- `defensePower` on the Teams page either relabelled as what it is or dropped, so the
  site stops showing a third difficulty number.
- Lands with the Teams and Players surfaces, since four of the seven sites are inside
  their inline JavaScript.


---

## Measured baselines (2026-10-08, first real audit run)

The instruments shipped in Step 0 ran against main for the first time. Three
results, and two of them change how the work should be organised.

### Accessibility — 67 WCAG A/AA findings over 9 app pages, 38 advisory

| rule | nodes |
|---|---|
| `color-contrast` | **192** |
| `button-name` | 33 |
| `aria-tooltip-name` | 26 |
| `scrollable-region-focusable` | 22 |
| `label` | 15 |
| `label-content-name-mismatch` | 1 |
| `link-in-text-block` | 1 |

### Layout — no page is broken

**Zero CRITICAL and zero HIGH** across every app surface at 1440 / 768 / 390.
No page-scroll, no escaping elements, no overlapping controls. 8 MEDIUM
(clipped text) and 462 LOW (text under 10px).

That is a much better responsive baseline than the plan assumed, and it means
the responsive line in the per-surface checklist will mostly pass on arrival.

### THE STRUCTURAL LESSON, and it corrects this plan

Both baselines are dominated by a handful of SHARED tokens, not per-page faults:

- `color-contrast` at 192 nodes is a few colour pairs in the design system
  repeated everywhere — almost certainly `--text-muted` on `--surface-2` and its
  neighbours. Fixing the variables once clears most of 192.
- `.footer-col-title at 9.5px` appears in the tiny-text list on **every single
  page**, as do the crest fallbacks and the ticker separators. A large share of
  462 is a dozen shared components.

Doing either of those per surface means fixing the same CSS variable twenty-seven
times and arguing with yourself about it. So:

**Two global token passes go FIRST, before Surface 1:**

- **G1 — contrast tokens.** Find the failing pairs, fix them in
  `styles/common.css` / `v2-design.css`, re-run the audit, confirm the 192 drops.
  One pass, measurable, touches every surface at once.
- **G2 — the shared-component type scale.** Raise the sub-10px text in the
  footer, crest fallbacks, ticker and venue markers, or decide per component
  that 8px is deliberate and exempt it explicitly.

Everything else stays per surface. The distinction is simple: if the fix is in a
shared token or a shared component, it is global; if it is in one page's markup
or one page's script, it belongs to that surface.
