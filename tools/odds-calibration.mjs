/* What the site's own model said, next to what the market said.

   Every odds run hands us twenty free labelled samples: for each team in each
   priced fixture, the model's expected goals against and the market's estimate
   of the same quantity. Nothing else on this site produces an external reference
   for a number the model invents, so this is the only place its bias can be
   measured rather than argued about.

   The first round measured found the model's overall level almost exactly right
   — 30.9 goals against the market's 29.5 across a full gameweek — and its
   home/away split badly out: home sides projected to concede 9.99 against the
   market's 13.48, away sides 20.94 against 16.01. A venue effect roughly 1.8
   times what is priced. One round is not enough to act on beyond the
   evidence-weighted blend already in place; a season of rounds is, which is what
   this accumulates.

   The model side is computed by loading the SHIPPED engine into a vm, not by
   reimplementing it here. A second copy of expectedGoalsAgainst would drift from
   the first and then measure itself, which is worse than not measuring at all —
   and the codebase has already paid for one accidental duplicate of a shared
   function. tests/helpers/load.mjs does the same thing for the same reason.

   Nothing here is allowed to fail the odds job. A calibration sample is a
   convenience; the feed is the deliverable. */
import fs from 'node:fs';
import vm from 'node:vm';

// Enough of a browser for scripts that touch the DOM incidentally. Nothing
// called here renders anything — these are pure scoring functions that happen to
// live in files which also draw things.
function sandbox() {
    const ctx = {
        console: { log() {}, warn() {}, error() {} },
        document: {
            getElementById: () => null, querySelector: () => null,
            createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, setAttribute() {} }),
            body: { appendChild() {}, insertAdjacentHTML() {} },
            addEventListener() {}, activeElement: null
        },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        location: { hash: '', search: '', href: 'http://local/' },
        navigator: { userAgent: 'node' },
        setTimeout, clearTimeout, fetch: () => Promise.reject(new Error('offline')),
        escHTML: (s) => String(s == null ? '' : s),
        computeIsPreseason: () => false,
        Chart: undefined, lucide: undefined
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    return vm.createContext(ctx);
}

/* The scripts the projection needs, in the order the page loads them.

   panels-and-tabs.js is here only because computeTeamScores() reads the team xG
   aggregates it builds; without it every team's xG trend is missing and the
   ratings the model is being measured on are not the ones it ships with. */
const SCRIPTS = [
    'scripts/xp-engine.js',
    'scripts/team-analysis-core.js',
    'scripts/squad-table-chart.js',
    'scripts/panels-and-tabs.js'
];

/* Model expected-goals-against for every team in every priced fixture, paired
   with the market's. Returns null rather than throwing: this runs inside the
   odds job, and a broken sandbox must not cost the feed. */
export function calibrationSample(odds, boot, fixtures) {
    try {
        const ctx = sandbox();
        for (const rel of SCRIPTS) {
            new vm.Script(fs.readFileSync(rel, 'utf8'), { filename: rel }).runInContext(ctx);
        }

        // Reproduce the page's data phase, minus anything needing a manager.
        vm.runInContext(`
            teams = {};
            __boot.teams.forEach(function (t) { teams[t.id] = t; });
            var __cur = __boot.events.find(function (e) { return e.is_current; });
            currentGW = __cur ? __cur.id : 1;
            isPreseason = false;
            allFixtures = __fixtures;
            processFixtures(__fixtures);
            processFixtures6(__fixtures);
            buildTeamXgData(__boot.elements);
            computeTeamScores(__boot.teams, __fixtures);
        `, Object.assign(ctx, { __boot: boot, __fixtures: fixtures }));

        const rows = [];
        for (const m of odds.matches) {
            for (const [teamId, oppId, isHome, marketXga] of [
                [m.homeId, m.awayId, true, m.lambdaAway],
                [m.awayId, m.homeId, false, m.lambdaHome]
            ]) {
                ctx.__q = { teamId, fixture: { isHome, opponentId: oppId, difficulty: 3, event: m.event } };
                const modelXga = vm.runInContext('expectedGoalsAgainst(__q.teamId, __q.fixture)', ctx);
                const played = vm.runInContext(`(teamAnalysis[${teamId}] || {}).matchesPlayed`, ctx);
                if (!Number.isFinite(modelXga)) continue;
                rows.push({
                    event: m.event, fixtureId: m.fixtureId, teamId, isHome,
                    matchesPlayed: played ?? null,
                    modelXga: Math.round(modelXga * 1000) / 1000,
                    marketXga
                });
            }
        }
        return rows.length ? rows : null;
    } catch (err) {
        console.log(`calibration skipped: ${err.message}`);
        return null;
    }
}

/* Summary statistics over the accumulated history.

   The ratio is reported split by venue because that is where the first round's
   disagreement lived, and a single pooled average would hide it — the home and
   away errors point in opposite directions and very nearly cancel. */
export function summarise(rows) {
    if (!rows || !rows.length) return null;
    const ratio = r => r.marketXga / r.modelXga;
    const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
    const usable = rows.filter(r => r.modelXga > 0 && r.marketXga > 0);
    if (!usable.length) return null;
    const home = usable.filter(r => r.isHome).map(ratio);
    const away = usable.filter(r => !r.isHome).map(ratio);

    // log(market) = a + b * log(model). b of 1 with a of 0 is an unbiased model;
    // a b well under 1 means the model separates fixtures more than the market
    // does, which at this sample size is mostly prior noise rather than insight.
    const xs = usable.map(r => Math.log(r.modelXga));
    const ys = usable.map(r => Math.log(r.marketXga));
    const n = xs.length;
    const sx = xs.reduce((a, b) => a + b, 0), sy = ys.reduce((a, b) => a + b, 0);
    const sxx = xs.reduce((a, x) => a + x * x, 0), sxy = xs.reduce((a, x, i) => a + x * ys[i], 0);
    const denom = n * sxx - sx * sx;
    const b = Math.abs(denom) > 1e-9 ? (n * sxy - sx * sy) / denom : null;
    const a = b != null ? (sy - b * sx) / n : null;

    const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000);
    return {
        samples: n,
        meanRatio: r3(mean(usable.map(ratio))),
        meanRatioHome: home.length ? r3(mean(home)) : null,
        meanRatioAway: away.length ? r3(mean(away)) : null,
        // Above 1 means the model applies more venue effect than the market.
        venueEffectVsMarket: (home.length && away.length) ? r3(mean(home) / mean(away)) : null,
        logFitIntercept: r3(a),
        logFitSlope: r3(b)
    };
}

export const CALIBRATION_MAX_ROUNDS = 40;   // a season is 38

/* Append this run to the rolling history, one entry per run rather than per
   sample, so the file stays small and a round can be dropped whole. */
export function appendRound(existing, stamp, rows) {
    const history = (existing && Array.isArray(existing.rounds)) ? existing.rounds.slice() : [];
    const event = rows[0].event;
    // Replace rather than accumulate within a gameweek: four runs a day would
    // otherwise weight the most-priced round forty times over.
    const at = history.findIndex(r => r.event === event);
    const entry = { event, recordedAt: stamp, samples: rows };
    if (at >= 0) history[at] = entry; else history.push(entry);
    history.sort((x, y) => x.event - y.event);
    const kept = history.slice(-CALIBRATION_MAX_ROUNDS);
    return {
        metadata: {
            lastUpdated: stamp,
            rounds: kept.length,
            note: 'Model expected-goals-against against the market\'s, per team per priced fixture. Written by tools/fetch-odds.mjs.',
            overall: summarise(kept.flatMap(r => r.samples))
        },
        rounds: kept
    };
}
