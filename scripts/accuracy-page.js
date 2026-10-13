/* fpl-accuracy.html: the public scoreboard, and the page's own bootstrap.
 *
 * Extracted from the foot of the page, dedented two levels and otherwise
 * unchanged. It went out for the ordinary reasons — inline JavaScript is
 * unminified, uncacheable and parsed before the browser can paint — and for
 * one specific to this page: the inline-JS ceiling in tools/page-budgets.json
 * is a ratchet, and the sample-size caveat below did not fit under it. Code
 * that earns its bytes should not have to be argued down to fit in markup.
 *
 * Loaded in exactly the position the inline block occupied, after
 * sidebar-nav.js, as a classic script: the four calls at the top run at parse
 * time and every function they reach for is defined by a file above them.
 *
 * It declares nothing at top level — four calls and an IIFE — so it adds no
 * name to this page's shared global scope and nothing to check:globals.
 */
loadSidebarNav();
initIcons();
initScrollReveal();
loadFooter();

/* The figures come from data/model-summary.json, which the grading job derives
   from the graded archive after every round. The page renders whatever is in
   it, including nothing: a season with no graded rounds gets a sentence saying
   so rather than four zeroes pretending to be results.

   NOT data/model-accuracy.json, and that is the whole reason there are two
   files. The archive is admin-gated, so a public page fetching it gets the
   login shell with a 200 on it — which parses as JSON, carries none of these
   fields, and renders as four dashes for every visitor while looking perfectly
   fine to whoever is signed in. summarise() in tools/grade-predictions.mjs
   writes the public file and argues there for why these figures and not the
   flattering ones. */
(function renderAccuracy() {
    const grid = document.getElementById('acGrid');
    const pending = document.getElementById('acPending');
    const pendingText = document.getElementById('acPendingText');

    const cell = (n, k, sub, empty) =>
        `<div class="ac-cell">
            <div class="ac-n${empty ? ' is-empty' : ''}">${escHTML(n)}</div>
            <div class="ac-k">${escHTML(k)}</div>
            <div class="ac-sub">${escHTML(sub)}</div>
        </div>`;

    fetch('/data/model-summary.json?v=' + (typeof CACHE_BUSTER !== 'undefined' ? CACHE_BUSTER : Date.now()))
        .then(r => r.ok ? r.json() : Promise.reject(new Error('unavailable')))
        .then(d => {
            const graded = d.gameweeksGraded || 0;
            const fixtures = d.playerFixturesGraded || 0;
            const starters = d.startersGraded || 0;

            if (!graded) {
                grid.innerHTML =
                    cell('—', 'Gameweeks graded', 'Grading starts once a round has been played and scored', true) +
                    cell('—', 'Player fixtures', 'Every player with a fixture is scored, not a sample', true) +
                    cell('—', 'vs FPL’s own forecast', 'Measured against ep_next at the deadline', true) +
                    cell('—', 'vs points per game', 'The other baseline worth beating', true);
                pendingText.innerHTML =
                    '<b>No rounds graded yet this season.</b> The job runs after every gameweek is ' +
                    'final and writes its results here. Until then there is nothing to report, and ' +
                    'we would rather say that than show you a zero.';
                pending.hidden = false;
                return;
            }

            const pct = v => (v == null ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%');

            /* The two baselines are measured over the players the model
               projected to START, not over every player with a fixture — so
               the cells name that smaller number rather than letting the
               fixture total beside them stand in for it. Pooled over everyone
               the margin is roughly double, and most of that is correctly
               predicting that a reserve full back scores nothing. */
            grid.innerHTML =
                cell(String(graded), 'Gameweeks graded', 'Written down before kick-off, scored once the round was final') +
                cell(fixtures.toLocaleString(), 'Player fixtures scored', 'Every player with a fixture, not a sample') +
                cell(pct(d.vsEp), 'Better than FPL’s forecast', `Less squared error than ep_next, over ${starters} projected starters`) +
                cell(pct(d.vsPpg), 'Better than points per game', 'The simplest baseline there is, on the same players');

            /* The sample-size caveat, driven by the file rather than written
               into the page: one round of advantage is not distinguishable
               from one round of luck, and a page titled "we mark our own
               homework" loses its argument the moment it pretends otherwise.
               summarise() decides when it comes off — ten rounds. */
            if (d.provisional) {
                pendingText.innerHTML =
                    `<b>${graded === 1 ? 'One round' : graded + ' rounds'} graded so far.</b> ` +
                    'Read these as early signals rather than a verdict — telling a real edge ' +
                    'from a good week takes ten to fifteen rounds, and we would rather say so ' +
                    'than let one afternoon speak for the season.';
                pending.hidden = false;
            }
        })
        .catch(() => {
            grid.innerHTML = cell('—', 'Scoreboard unavailable', 'The results file could not be loaded just now', true);
        });
})();
