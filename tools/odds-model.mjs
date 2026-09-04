/* Turning bookmakers' prices into the probabilities FPL actually cares about.

   No bookmaker prices "clean sheet %" for a Premier League match, and none of
   them price expected goals. What they do price, deeply and on every fixture,
   is the 1X2 market and over/under 2.5 goals — and those two together pin down
   a goal model exactly:

     - Over/under 2.5 fixes the TOTAL goal expectation. P(over 2.5) rises
       monotonically with the total, so one bisection inverts it.
     - The home-win price then fixes the SUPREMACY, the split of that total
       between the two sides. Also monotonic, so a second bisection inverts it.

   Two numbers out, and everything else follows from independent Poisson: clean
   sheets are P(the other side fails to score), both-teams-to-score is the
   complement of either failing, and correct scores are the outer product.

   Independent Poisson is known to under-price draws, because real matches
   correlate at low scores — the Dixon-Coles correction exists for exactly that.
   It is not applied here, and the reason is empirical rather than lazy: fitted
   against a full round of Premier League prices the reconstructed draw
   probability landed within three points of the market on every fixture, which
   is inside the vig. deriveMatch() returns the market's own numbers alongside
   the reconstruction so the caller can check that claim rather than trust it.

   Pure functions, no I/O, no globals: tools/fetch-odds.mjs does the fetching and
   tests/odds-model.test.mjs pins the maths down. */

/* Where the goal distribution is truncated.

   Eleven looks generous for a football score and is not: at a goal expectation
   of 2.9 it drops 2.2e-4 of the mass, and that missing tail lands entirely on
   the away win, which is computed as the residual. Twenty-five is past the
   point where the tail is measurable at the highest expectation this model
   accepts, and the loops are small enough that the cost is nothing. */
const MAX_GOALS = 25;
const FACTORIAL = [1];
for (let i = 1; i < MAX_GOALS; i++) FACTORIAL[i] = FACTORIAL[i - 1] * i;

// Goal expectations outside this are not football, they are a parsing error.
export const LAMBDA_MIN = 0.05;
export const LAMBDA_MAX = 6;

/* Strip the bookmaker's margin.

   Quoted odds imply probabilities summing to more than one — that excess is the
   overround, and it is the bookmaker's edge. Normalising by the sum is the
   standard proportional de-vig. It is not the only method (shin and
   power-margin models allocate the margin differently, and better for long
   shots), but it is the one whose assumptions are easy to state, and the
   overround is returned so the caller can judge how much was removed. */
export function devig(odds) {
    if (!Array.isArray(odds) || odds.length < 2) return null;
    if (odds.some(o => !Number.isFinite(o) || o <= 1)) return null;
    const inverse = odds.map(o => 1 / o);
    const sum = inverse.reduce((a, b) => a + b, 0);
    if (!Number.isFinite(sum) || sum <= 0) return null;
    return { probabilities: inverse.map(i => i / sum), overround: sum - 1 };
}

export function poissonPmf(lambda) {
    const e = Math.exp(-lambda);
    const out = new Array(MAX_GOALS);
    for (let i = 0; i < MAX_GOALS; i++) out[i] = (e * Math.pow(lambda, i)) / FACTORIAL[i];
    return out;
}

// P(more than 2.5 goals) for a Poisson total. Closed form: everything except
// nil, one and two.
function overFromTotal(total) {
    return 1 - Math.exp(-total) * (1 + total + (total * total) / 2);
}

/* The total goal expectation implied by the over-2.5 price.
   overFromTotal is strictly increasing, so bisection converges without needing
   a derivative and cannot overshoot the way Newton can near the tails. */
export function solveTotalGoals(pOver) {
    if (!Number.isFinite(pOver) || pOver <= 0 || pOver >= 1) return null;
    let lo = LAMBDA_MIN, hi = LAMBDA_MAX * 2;
    if (overFromTotal(lo) > pOver || overFromTotal(hi) < pOver) return null;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (overFromTotal(mid) < pOver) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
}

export function homeWinProbability(lambdaHome, lambdaAway) {
    const ph = poissonPmf(lambdaHome), pa = poissonPmf(lambdaAway);
    let p = 0;
    for (let h = 1; h < MAX_GOALS; h++) for (let a = 0; a < h; a++) p += ph[h] * pa[a];
    return p;
}

export function drawProbability(lambdaHome, lambdaAway) {
    const ph = poissonPmf(lambdaHome), pa = poissonPmf(lambdaAway);
    let p = 0;
    for (let g = 0; g < MAX_GOALS; g++) p += ph[g] * pa[g];
    return p;
}

/* How that total splits, given the home-win price.
   Holding the total fixed, the home side's win probability increases
   monotonically with supremacy, so the same bisection applies. */
export function solveSupremacy(total, pHomeWin) {
    if (!Number.isFinite(total) || total <= 0) return null;
    if (!Number.isFinite(pHomeWin) || pHomeWin <= 0 || pHomeWin >= 1) return null;
    let lo = -total + 1e-6, hi = total - 1e-6;
    for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (homeWinProbability((total + mid) / 2, (total - mid) / 2) < pHomeWin) lo = mid;
        else hi = mid;
    }
    return (lo + hi) / 2;
}

/* Everything FPL wants, from one fixture's prices.

   Takes decimal odds. Returns null rather than a half-answer when a market is
   missing or unusable — a fixture the model cannot price should disappear from
   the feed, not appear with invented numbers. */
export function deriveMatch({ homeOdds, drawOdds, awayOdds, over25Odds, under25Odds }) {
    const match = devig([homeOdds, drawOdds, awayOdds]);
    const totals = devig([over25Odds, under25Odds]);
    if (!match || !totals) return null;

    const [mktHome, mktDraw, mktAway] = match.probabilities;
    const pOver = totals.probabilities[0];

    const total = solveTotalGoals(pOver);
    if (total === null) return null;
    const supremacy = solveSupremacy(total, mktHome);
    if (supremacy === null) return null;

    const lambdaHome = (total + supremacy) / 2;
    const lambdaAway = (total - supremacy) / 2;
    if (![lambdaHome, lambdaAway].every(l => Number.isFinite(l) && l >= LAMBDA_MIN && l <= LAMBDA_MAX)) return null;

    // A clean sheet is the OTHER side failing to score, which is the whole
    // reason this is worth deriving: it is a property of the opponent's attack,
    // not of your own defence's reputation.
    const csHome = Math.exp(-lambdaAway);
    const csAway = Math.exp(-lambdaHome);

    const fitHome = homeWinProbability(lambdaHome, lambdaAway);
    const fitDraw = drawProbability(lambdaHome, lambdaAway);

    const ph = poissonPmf(lambdaHome), pa = poissonPmf(lambdaAway);
    const scorelines = [];
    for (let h = 0; h < 6; h++) for (let a = 0; a < 6; a++) scorelines.push({ h, a, p: ph[h] * pa[a] });
    scorelines.sort((x, y) => y.p - x.p);

    return {
        lambdaHome, lambdaAway,
        csHome, csAway,
        winHome: fitHome, draw: fitDraw, winAway: Math.max(0, 1 - fitHome - fitDraw),
        over25: pOver, under25: 1 - pOver,
        bttsYes: (1 - Math.exp(-lambdaHome)) * (1 - Math.exp(-lambdaAway)),
        totalGoals: total, supremacy,
        scorelines: scorelines.slice(0, 5).map(s => ({ h: s.h, a: s.a, p: s.p })),
        // The market's own numbers, kept so the panel can show that the
        // reconstruction agrees with the prices it came from.
        market: { home: mktHome, draw: mktDraw, away: mktAway },
        overround: { match: match.overround, totals: totals.overround },
        drawError: Math.abs(fitDraw - mktDraw)
    };
}
