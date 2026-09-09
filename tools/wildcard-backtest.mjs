#!/usr/bin/env node
/* Does the wildcard builder actually pick good squads?

   Everything in tests/wildcard-builder.test.mjs proves the model is internally
   consistent — legal squads, honest arithmetic, a converged search. None of it
   proves the squads score points. This does, or fails to, by rebuilding a
   wildcard at a past gameweek from only the data that existed before it and
   totalling what the fifteen actually went on to return.

   WHERE THE DATA COMES FROM

   Not from `data/`, which holds the season in progress and is three gameweeks
   long. A finished season is sitting in this repo's own git history, because
   the data workflows have been committing `data/players-data.json` since
   January and that file carries per-gameweek history for every player:

       mkdir -p /tmp/season2526
       for f in players-data.json fixtures.json bootstrap-static.json; do
         git show e893f5c:data/$f > /tmp/season2526/$f
       done
       node tools/wildcard-backtest.mjs --data /tmp/season2526

   e893f5c is 2026-05-28, the last snapshot of 2025/26 — 38 gameweeks, 537
   players. Any commit from the end of a season works the same way.

   HOW A PAST GAMEWEEK IS REBUILT

   Fixtures from the build gameweek onward are masked back to unplayed, so
   computeTeamScores() sees only results that had happened. Every player's
   season totals are re-summed from the history rows before that round, and his
   price is the `value` the game recorded for it. The engine is then handed that
   state and asked the same question a manager would have asked on the Tuesday.

   WHAT CANNOT BE REBUILT, and it matters:

     - INJURIES. `status` and `chance_of_playing_next_round` are only ever
       stored as of now, so everyone is presented as fit. The minutes model
       still discounts players who were not playing, but a man who missed six
       weeks with a hamstring is offered as though available. This flatters
       every squad here equally — the model and all four baselines — so the
       comparison stands even though the absolute totals are optimistic.
     - SURVIVORSHIP. players-data.json holds the players in the game at season
       end, so anyone who left in January is missing from the pool.
     - CLUB. A player who moved mid-season is shown at the club he finished at.
     - `form` is FPL's own last-30-days figure and is not stored per round;
       the mean of the last four appearances stands in for it.
     - `ep_next` and penalty order are left empty rather than taken from the
       end-of-season snapshot, which would be reading the future. Both only
       feed priors that have faded to nothing by the minutes these gameweeks
       carry.

   WHAT IT MEASURES

     --mode squads      (default) builds a wildcard at each gameweek in the
                        range and totals the actual points its fifteen returned
                        over the window, against four baselines. Real FPL
                        scoring: best legal eleven picked from projections made
                        BEFORE each gameweek, auto-subs, captain, vice.
     --mode projection  the layer underneath. Every player, every gameweek:
                        projected against actual. Far more observations than the
                        squad test has, so it is where a calibration error shows
                        up first.
     --mode sweep       re-runs --mode squads across values of one constant, to
                        set it from evidence rather than from taste.

   The exported functions take plain data and no globals, so the same code can
   be driven from a runner that is not node.
*/

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

/* ===== point-in-time reconstruction ===== */

export const SQUAD_QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
export const MAX_PER_CLUB = 3;
export const FORMATIONS = [[3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1], [5, 2, 3]];

/* Fixtures as they stood before `gw` kicked off. Everything from that round on
   goes back to unplayed with its scoreline removed, which is what makes
   computeTeamScores() and xpPlanGWs() describe the past rather than the end of
   the season. */
export function maskFixtures(fixtures, gw) {
    return fixtures.map(f => (f.event != null && f.event < gw)
        ? f
        : { ...f, finished: false, finished_provisional: false, started: false,
            team_h_score: null, team_a_score: null });
}

export function reconstructPlayers(bootData, playersData, gw, teamsById) {
    const meta = new Map(bootData.elements.map(e => [e.id, e]));
    const out = [];
    for (const p of playersData.players || []) {
        const m = meta.get(p.id);
        if (!m) continue;

        const before = [], during = [];
        for (const h of p.history || []) {
            if (h.round < gw) before.push(h);
            else if (h.round === gw) during.push(h);
        }
        const sum = k => before.reduce((s, h) => s + (parseFloat(h[k]) || 0), 0);
        const minutes = sum('minutes');
        // Appearances, not gameweeks: FPL's points-per-game divides by matches
        // played, and a player who has not played has no per-game rate at all.
        const apps = before.filter(h => (h.minutes || 0) > 0).length;
        const points = sum('total_points');

        /* The price going into this gameweek. `value` is what the game recorded
           for the round, which is known before kickoff — reading it is not
           reading the future, and it is the only honest source for what a
           wildcard would actually have cost. */
        const priceRow = during[0] || before[before.length - 1];
        const price = priceRow ? priceRow.value / 10 : (m.now_cost || 40) / 10;

        const last4 = before.slice(-4);
        const form = last4.length ? last4.reduce((s, h) => s + (h.total_points || 0), 0) / last4.length : 0;
        const ownRow = before[before.length - 1];

        const player = {
            id: p.id,
            name: m.web_name,
            team: (teamsById[m.team] || {}).short_name || String(m.team),
            teamId: m.team,
            position: m.element_type, pos: m.element_type,
            price,
            form, ppg: apps ? points / apps : 0, points,
            ownership: 0, selected: ownRow ? (ownRow.selected || 0) : 0,
            // Not reconstructable — see the header. Everyone is offered as fit.
            status: 'a', chanceNextRound: null, news: '',
            minutes, starts: sum('starts'),
            goals: sum('goals_scored'), assists: sum('assists'),
            cleanSheets: sum('clean_sheets'), goalsConceded: sum('goals_conceded'),
            xG: sum('expected_goals'), xA: sum('expected_assists'),
            xGI: sum('expected_goal_involvements'), xGC: sum('expected_goals_conceded'),
            bonus: sum('bonus'), bps: sum('bps'),
            yellowCards: sum('yellow_cards'), redCards: sum('red_cards'),
            saves: sum('saves'),
            defCon: sum('defensive_contribution'),
            // Reading either from the end-of-season snapshot would be reading
            // the future. Both only feed priors that have faded by now.
            penaltiesOrder: null, epNext: 0,
            fixtures: []
        };
        out.push(player);
    }
    return out;
}

/* players-data.json as it stood before a gameweek kicked off.

   reconstructPlayers above already truncates history for the pool it builds, but
   the raw file was being handed to the engine whole, and the engine reads it:
   buildTeamXgData walks playersDetailData.players[].history to build per-gameweek
   team xG. Left untruncated, a backtest at GW10 would build team strength partly
   out of gameweeks 10 to 38.

   That leaked nothing while it went unread — the projection has never touched
   teamXgData, which is why the call site could pass an empty array and say so.
   The moment team strength starts reading xG, the leak becomes a backtest that
   flatters itself and cannot be caught by looking at the number it prints. So
   the truncation goes in first, before anything depends on it. */
export function truncatePlayersData(playersData, gw) {
    return {
        ...playersData,
        players: (playersData.players || []).map(p => ({
            ...p,
            history: (p.history || []).filter(h => h.round < gw)
        }))
    };
}

// Actual returns for one gameweek. A double gameweek is two rows for the same
// round and both count, which is exactly the case a season total would hide.
export function actualsFor(playersData, gw) {
    const map = new Map();
    for (const p of playersData.players || []) {
        let points = 0, minutes = 0, played = false;
        for (const h of p.history || []) {
            if (h.round !== gw) continue;
            points += h.total_points || 0;
            minutes += h.minutes || 0;
            played = true;
        }
        if (played) map.set(p.id, { points, minutes });
    }
    return map;
}

/* ===== FPL scoring ===== */

export function pickXI(squad, scoreOf) {
    const by = { 1: [], 2: [], 3: [], 4: [] };
    for (const p of squad) by[p.position].push(p);
    for (const k of [1, 2, 3, 4]) by[k].sort((a, b) => scoreOf(b) - scoreOf(a));

    let best = null;
    for (const [nD, nM, nF] of FORMATIONS) {
        if (by[1].length < 1 || by[2].length < nD || by[3].length < nM || by[4].length < nF) continue;
        const xi = [by[1][0]].concat(by[2].slice(0, nD), by[3].slice(0, nM), by[4].slice(0, nF));
        const total = xi.reduce((s, p) => s + scoreOf(p), 0);
        if (!best || total > best.total) best = { xi, total, shape: [nD, nM, nF] };
    }
    if (!best) return null;
    const ids = new Set(best.xi.map(p => p.id));
    // FPL's default bench order, and the order auto-subs consume: outfield
    // first by how much you rate them, reserve keeper last.
    const bench = squad.filter(p => !ids.has(p.id))
        .sort((a, b) => (a.position === 1 ? 1 : 0) - (b.position === 1 ? 1 : 0) || scoreOf(b) - scoreOf(a));
    return { xi: best.xi, bench, shape: best.shape };
}

/* A starter who did not play is replaced by the first man on the bench who did
   and who leaves a legal shape behind: one keeper, three at the back, two in
   midfield, one up front. A keeper only ever replaces a keeper.

   Worth having rather than assuming eleven players always turn out, because
   auto-subs are most of what a bench is FOR — and the bench weight the model
   optimises is only testable if the bench can actually score. */
export function applyAutoSubs(xi, bench, minutesOf) {
    const onPitch = xi.slice();
    const spare = bench.slice();
    const count = pos => onPitch.reduce((n, p) => n + (p.position === pos ? 1 : 0), 0);
    const legal = () => count(1) === 1 && count(2) >= 3 && count(3) >= 2 && count(4) >= 1;

    for (let i = 0; i < onPitch.length; i++) {
        if (minutesOf(onPitch[i]) > 0) continue;
        for (let b = 0; b < spare.length; b++) {
            const sub = spare[b];
            if (minutesOf(sub) <= 0) continue;
            if ((onPitch[i].position === 1) !== (sub.position === 1)) continue;
            const out = onPitch[i];
            onPitch[i] = sub;
            if (legal()) { spare.splice(b, 1); break; }
            onPitch[i] = out;
        }
    }
    return onPitch;
}

/* One gameweek of one squad, scored the way the game scores it.

   scoreOf must be a projection made BEFORE this gameweek. Picking the eleven
   with hindsight would measure clairvoyance rather than the squad, and every
   squad here would look far better than any manager's ever does. */
export function scoreGameweek(squad, scoreOf, actual) {
    const picked = pickXI(squad, scoreOf);
    if (!picked) return null;
    const minutesOf = p => (actual.get(p.id) || { minutes: 0 }).minutes;
    const pointsOf = p => (actual.get(p.id) || { points: 0 }).points;

    const ranked = picked.xi.slice().sort((a, b) => scoreOf(b) - scoreOf(a));
    const captain = ranked[0], vice = ranked[1];
    const final = applyAutoSubs(picked.xi, picked.bench, minutesOf);

    let points = final.reduce((s, p) => s + pointsOf(p), 0);
    // The armband falls to the vice when the captain does not play, and doubles
    // nothing at all when neither does.
    const armband = minutesOf(captain) > 0 ? captain : (vice && minutesOf(vice) > 0 ? vice : null);
    if (armband && final.some(p => p.id === armband.id)) points += pointsOf(armband);

    return {
        points,
        shape: picked.shape,
        captainId: armband ? armband.id : null,
        subsUsed: final.filter(p => !picked.xi.some(x => x.id === p.id)).length,
        benchPoints: picked.bench.reduce((s, p) => s + pointsOf(p), 0)
    };
}

/* ===== baselines ===== */

/* Fill a legal fifteen by walking `order` and taking whoever fits.

   The reserve is what stops a greedy list spending the budget on eleven good
   players and finding it cannot afford a goalkeeper: before each pick, the
   cheapest bodies for every slot still empty have to remain affordable. The
   second pass exists because that reserve is a lower bound rather than an exact
   one, so the walk can still come up short. */
export function greedyFill(pool, order, budget) {
    const need = { ...SQUAD_QUOTA };
    // Ascending price per position, so the reserve below can be the sum of the
    // k cheapest players still available rather than k times the single
    // cheapest. That distinction is not cosmetic: the loose bound lets the walk
    // commit money it does not have, and the squad comes back unfillable — it
    // is why the points-chasing baseline returned nothing at five gameweeks.
    const ladder = {};
    for (const pos of [1, 2, 3, 4]) {
        ladder[pos] = pool.filter(p => p.position === pos).sort((a, b) => a.price - b.price);
    }
    const squad = [], clubs = {}, taken = new Set();
    let spent = 0;

    const reserve = () => {
        let total = 0;
        for (const pos of [1, 2, 3, 4]) {
            let want = need[pos];
            for (const c of ladder[pos]) {
                if (want <= 0) break;
                if (taken.has(c.id)) continue;
                total += c.price; want--;
            }
            if (want > 0) return Infinity;   // not enough bodies left to be legal
        }
        return total;
    };

    const tryTake = p => {
        if (need[p.position] <= 0 || taken.has(p.id)) return false;
        if ((clubs[p.teamId] || 0) >= MAX_PER_CLUB) return false;
        need[p.position]--; taken.add(p.id);
        if (spent + p.price + reserve() > budget + 1e-9) {
            need[p.position]++; taken.delete(p.id);
            return false;
        }
        squad.push(p); spent += p.price;
        clubs[p.teamId] = (clubs[p.teamId] || 0) + 1;
        return true;
    };

    for (const p of order) { if (squad.length === 15) break; tryTake(p); }
    if (squad.length < 15) {
        for (const p of pool.slice().sort((a, b) => a.price - b.price)) {
            if (squad.length === 15) break;
            tryTake(p);
        }
    }
    return squad.length === 15 ? squad : null;
}

// Deterministic, so a run is reproducible and a regression is a real change.
export function lcg(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/* Four squads nobody needs a model to build.

   The random pool is the one that matters. Beating a points-chasing greedy list
   by two points a gameweek means little without knowing the spread of legal
   squads — if any fifteen scores about the same, the model has demonstrated
   nothing, and only the null distribution can say. */
export function baselineSquads(pool, budget, randomCount = 25) {
    const byPoints = pool.slice().sort((a, b) => b.points - a.points);
    const byValue = pool.slice().sort((a, b) => (b.points / Math.max(b.price, 3.5)) - (a.points / Math.max(a.price, 3.5)));
    const byOwned = pool.slice().sort((a, b) => b.selected - a.selected);
    const byForm = pool.slice().sort((a, b) => b.form - a.form);

    const out = {
        points: greedyFill(pool, byPoints, budget),
        value: greedyFill(pool, byValue, budget),
        template: greedyFill(pool, byOwned, budget),
        form: greedyFill(pool, byForm, budget),
        random: []
    };
    const rnd = lcg(20260907);
    for (let i = 0; i < randomCount; i++) {
        const s = greedyFill(pool, shuffled(pool, rnd), budget);
        if (s) out.random.push(s);
    }
    return out;
}

/* ===== statistics ===== */

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

export function sd(xs) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export function pearson(xs, ys) {
    const n = Math.min(xs.length, ys.length);
    if (n < 2) return 0;
    const mx = mean(xs), my = mean(ys);
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
        const a = xs[i] - mx, b = ys[i] - my;
        num += a * b; dx += a * a; dy += b * b;
    }
    return (dx && dy) ? num / Math.sqrt(dx * dy) : 0;
}

export function spearman(xs, ys) {
    const rank = v => {
        const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
        const r = new Array(v.length);
        for (let i = 0; i < idx.length;) {
            let j = i;
            while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
            const avg = (i + j) / 2 + 1;
            for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
            i = j + 1;
        }
        return r;
    };
    return pearson(rank(xs), rank(ys));
}

/* ===== the engine bridge =====

   The site's scripts share one scope by design, so they have to be evaluated as
   ONE script: run per file, each file's top-level `let` is script-scoped and
   the others cannot see it. For the same reason the state cannot be poked in
   from outside — `allPlayers` is a `let` inside that scope, not a property of
   the global object. The epilogue below is appended to the same source so its
   closures can reach those bindings, and publishes the three entry points this
   tool needs on globalThis, which IS reachable. */
export const ENGINE_FILES = [
    'scripts/common.js',
    'scripts/team-analysis-core.js',
    'scripts/squad-table-chart.js',
    'scripts/panels-and-tabs.js',
    'scripts/xp-engine.js',
    'scripts/transfer-engine.js',
    'scripts/wildcard-builder.js'
];

export const ENGINE_EPILOGUE = `
globalThis.__engine = {
    setState(st) {
        teams = st.teams;
        currentGW = st.gw;
        isPreseason = false;
        allFixtures = st.fixtures;
        processFixtures(st.fixtures);
        processFixtures6(st.fixtures);
        playersDetailData = st.playersData;
        allPlayers = st.players;
        allPlayersById = {};
        allPlayers.forEach(p => { allPlayersById[p.id] = p; });
        allPlayers.forEach(p => { p.fixtures = teamFixtures[p.teamId] || []; });
        computePositionAverages();
        /* Team xG, built from the season as it stood before this gameweek.

           This used to pass an empty array, correctly: teamXgData fed only the
           xgTrend labels, the projection never read it, and the only season
           totals to hand were the end-of-season ones, which would have been the
           future. The cost was that the harness could not see the team model at
           all — computeTeamScores has three implementations across the site and
           the two that read xG were unmeasurable here.

           Both halves are period-correct now. The per-gameweek path reads
           st.playersData, which is truncated to rounds before this one. The
           season totals below are summed from st.players, which reconstructPlayers
           built from the same truncated history — so they are the real figures a
           manager had, not zeroes and not the end of the season. Shaped as
           bootstrap elements because that is what buildTeamXgData consumes. */
        buildTeamXgData(st.players.map(p => ({
            team: p.teamId, minutes: p.minutes,
            expected_goals: p.xG, expected_assists: p.xA,
            goals_scored: p.goals, assists: p.assists
        })));
        computeTeamScores(st.bootTeams, st.fixtures);
    },
    project(player, gw) { return projectPlayerPointsForGW(player, gw); },
    buildPlans(opts) { return wcBuildPlans(opts); }
};
`;

/* The model's constants are `const` in the shipped file, which is right there
   and wrong here: a sweep has to move them. Rewriting them to `var` in the copy
   this tool evaluates leaves the shipped file alone. */
export const TUNABLE = /const (WC_[A-Z_]+) =/g;

/* A sweep changes a constant by rewriting its declaration, and builds a fresh
   engine for each value.

   The obvious alternative — a tune() on the engine that assigns the constant —
   was tried and silently did nothing. Those constants live in the evaluated
   script's own scope, not on the global object, so an assignment from a helper
   reached a different binding and every value in the sweep returned an
   identical figure. An identical figure across a sweep reads exactly like "the
   model is not sensitive to this", which is the most expensive kind of wrong
   answer a tuning tool can give. Substitution cannot fail that way, and throws
   rather than shrugging when the name is not a constant it can find. */
export function engineSource(root, overrides) {
    let src = ENGINE_FILES
        .map(f => `\n/* ==== ${f} ==== */\n` + fs.readFileSync(path.join(root, f), 'utf8').replace(TUNABLE, 'var $1 ='))
        .join('\n;\n');
    for (const [k, v] of Object.entries(overrides || {})) {
        const re = new RegExp(`\\bvar ${k} = [^;]+;`);
        if (!re.test(src)) throw new Error(`${k} is not a constant this tool can set`);
        src = src.replace(re, `var ${k} = ${JSON.stringify(v)};`);
    }
    return src + '\n;\n' + ENGINE_EPILOGUE;
}

export function createEngine(root, overrides) {
    const sandbox = {
        console: { log() {}, warn() {}, error() {} },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        document: { documentElement: { setAttribute() {}, getAttribute: () => null },
                    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
                    addEventListener() {}, createElement: () => ({ style: {}, classList: { add() {}, remove() {} } }) },
        navigator: { userAgent: 'node' },
        location: { hash: '', search: '', pathname: '/', href: '' },
        MutationObserver: function () { return { observe() {}, disconnect() {} }; },
        IntersectionObserver: function () { return { observe() {}, disconnect() {} }; },
        requestAnimationFrame: () => 0, setTimeout: () => 0, clearTimeout: () => {},
        fetch: () => Promise.resolve({ ok: false }),
        Chart: function () {}, lucide: { createIcons() {} }
    };
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    new vm.Script(engineSource(root, overrides), { filename: 'engine.js' }).runInContext(sandbox);
    return sandbox.__engine;
}

/* ===== the runs ===== */

export function loadSeason(dir) {
    const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const bootData = read('bootstrap-static.json');
    const fixtures = read('fixtures.json');
    const playersData = read('players-data.json');
    const teamsById = {};
    bootData.teams.forEach(t => { teamsById[t.id] = t; });
    const rounds = new Set();
    for (const p of playersData.players || []) for (const h of p.history || []) rounds.add(h.round);
    return { bootData, fixtures, playersData, teamsById, lastRound: Math.max(0, ...rounds) };
}

/* State as of just before `gw`, cached: a six-gameweek window over a dozen
   build points asks for the same gameweek again and again, and rebuilding it
   each time is most of the run. */
export function stateCache(season) {
    const cache = new Map();
    return gw => {
        if (!cache.has(gw)) {
            cache.set(gw, {
                gw,
                teams: season.teamsById,
                bootTeams: season.bootData.teams,
                fixtures: maskFixtures(season.fixtures, gw),
                players: reconstructPlayers(season.bootData, season.playersData, gw, season.teamsById),
                playersData: truncatePlayersData(season.playersData, gw)
            });
        }
        return cache.get(gw);
    };
}

/* Every player, every gameweek: what was projected against what was returned.

   Thousands of observations rather than the dozen a squad backtest gets, so a
   bias in the projection shows up here long before it is visible in a total.
   Only players the builder would actually consider are counted — projecting a
   third-choice keeper who was never going to play measures nothing. */
export function runProjectionCheck(season, engine, opts) {
    const stateAt = stateCache(season);
    const rows = [];
    for (let gw = opts.from; gw <= opts.to; gw++) {
        const st = stateAt(gw);
        engine.setState(st);
        const actual = actualsFor(season.playersData, gw);
        for (const p of st.players) {
            if (p.minutes < 300) continue;      // no rate worth projecting yet
            const proj = engine.project(p, gw);
            const a = actual.get(p.id);
            if (!a) continue;                    // blank gameweek, nothing to compare
            rows.push({ gw, id: p.id, pos: p.position, price: p.price, proj, act: a.points, mins: a.minutes });
        }
    }
    return rows;
}

export function summariseProjection(rows) {
    const block = (label, subset) => {
        if (!subset.length) return { label, n: 0 };
        const proj = subset.map(r => r.proj), act = subset.map(r => r.act);
        return {
            label, n: subset.length,
            meanProj: mean(proj), meanAct: mean(act),
            bias: mean(act) - mean(proj),
            mae: mean(subset.map(r => Math.abs(r.act - r.proj))),
            pearson: pearson(proj, act),
            spearman: spearman(proj, act)
        };
    };
    const POS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
    return [block('all', rows)]
        .concat([1, 2, 3, 4].map(p => block(POS[p], rows.filter(r => r.pos === p))))
        .concat([
            block('£4.0-5.5m', rows.filter(r => r.price <= 5.5)),
            block('£5.6-8.0m', rows.filter(r => r.price > 5.5 && r.price <= 8.0)),
            block('£8.1m+', rows.filter(r => r.price > 8.0))
        ]);
}

/* Build a wildcard at each gameweek in the range, then total what it really
   returned over the window that followed. */
export function runSquadBacktest(season, engine, opts) {
    const stateAt = stateCache(season);
    const results = [];

    for (let gw = opts.from; gw <= opts.to; gw += opts.step) {
        const window = [];
        for (let g = gw; g < gw + opts.horizon && g <= season.lastRound; g++) window.push(g);
        if (window.length < opts.horizon) break;

        const st = stateAt(gw);
        engine.setState(st);

        let built;
        try {
            built = engine.buildPlans({ budget: opts.budget, horizon: opts.horizon });
        } catch (e) {
            results.push({ gw, error: e.message });
            continue;
        }
        if (!built || !built.ok) { results.push({ gw, error: (built && built.reason) || 'not-ok' }); continue; }

        // The builder's own pool rules, so the baselines shop in the same shop.
        const pool = st.players.filter(p => p.minutes >= Math.min(100, Math.max(gw - 1, 1) * 45));
        const base = baselineSquads(pool, opts.budget, opts.randomCount);

        const squads = {};
        for (const plan of built.plans) squads[plan.id] = plan.squad;
        squads.best = (built.plans.slice().sort((a, b) => b.objective - a.objective)[0] || {}).squad;
        for (const k of ['points', 'value', 'template', 'form']) if (base[k]) squads[k] = base[k];

        const totals = {};
        for (const k of Object.keys(squads)) totals[k] = 0;
        const randomTotals = base.random.map(() => 0);

        for (const g of window) {
            const sg = stateAt(g);
            engine.setState(sg);
            const actual = actualsFor(season.playersData, g);
            // Project from the state that existed before THIS gameweek: a
            // manager re-picks his eleven every week with what he knows then,
            // and holding the build-week projection for six weeks would
            // handicap every squad equally but describe nobody.
            const projCache = new Map();
            const scoreOf = p => {
                if (!projCache.has(p.id)) {
                    const live = sg.players.find(x => x.id === p.id);
                    projCache.set(p.id, live ? engine.project(live, g) : 0);
                }
                return projCache.get(p.id);
            };
            for (const k of Object.keys(squads)) {
                if (!squads[k]) continue;
                const r = scoreGameweek(squads[k], scoreOf, actual);
                if (r) totals[k] += r.points;
            }
            base.random.forEach((sq, i) => {
                const r = scoreGameweek(sq, scoreOf, actual);
                if (r) randomTotals[i] += r.points;
            });
        }

        results.push({
            gw, window,
            ceiling: built.ceiling, ceilingPremiums: built.ceilingPremiums,
            premiumFloor: built.premiumFloor,
            projected: Object.fromEntries(built.plans.map(p => [p.id, p.objective])),
            actual: totals,
            random: { mean: mean(randomTotals), sd: sd(randomTotals), n: randomTotals.length,
                      min: Math.min(...randomTotals), max: Math.max(...randomTotals) }
        });
    }
    return results;
}

/* ===== reporting ===== */

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 7, d = 1) => (v == null || Number.isNaN(v) ? '—' : v.toFixed(d)).padStart(n);

export function reportProjection(rows) {
    const out = [`projection check — ${rows.length} player-gameweeks`, ''];
    out.push(`${pad('slice', 12)}${pad('n', 8)}${pad('proj', 8)}${pad('actual', 8)}${pad('bias', 8)}${pad('MAE', 8)}${pad('r', 8)}${pad('rho', 8)}`);
    for (const b of summariseProjection(rows)) {
        if (!b.n) continue;
        out.push(pad(b.label, 12) + pad(b.n, 8) + num(b.meanProj, 7, 2) + ' ' + num(b.meanAct, 7, 2) + ' '
            + num(b.bias, 7, 2) + ' ' + num(b.mae, 7, 2) + ' ' + num(b.pearson, 7, 3) + ' ' + num(b.spearman, 7, 3));
    }
    return out.join('\n');
}

export function reportSquads(results, opts) {
    const ok = results.filter(r => !r.error);
    const out = [];
    out.push(`squad backtest — wildcard built at each gameweek, actual points over the ${opts.horizon} that followed`);
    out.push('');
    const cols = ['spread', 'single', 'double', 'best', 'points', 'value', 'template', 'form'];
    out.push(pad('build', 7) + pad('window', 10) + cols.map(c => pad(c, 9)).join('') + pad('random', 16));
    for (const r of results) {
        if (r.error) { out.push(pad('GW' + r.gw, 7) + '  ' + r.error); continue; }
        out.push(pad('GW' + r.gw, 7)
            + pad(`${r.window[0]}-${r.window[r.window.length - 1]}`, 10)
            + cols.map(c => pad(r.actual[c] != null ? r.actual[c] : '—', 9)).join('')
            + pad(`${r.random.mean.toFixed(0)} ±${r.random.sd.toFixed(0)}`, 16));
    }
    out.push('');
    if (ok.length) {
        /* Means are taken only over the gameweeks where that column exists. A
           baseline that could not be built is missing, not nought, and counting
           it as nought is how a broken baseline turns into a flattering margin
           for everything it is compared against. */
        const have = c => ok.filter(r => r.actual[c] != null);
        out.push(pad('MEAN', 17) + cols.map(c => {
            const rows = have(c);
            return pad(rows.length ? mean(rows.map(r => r.actual[c])).toFixed(1) : '—', 9);
        }).join('') + pad(mean(ok.map(r => r.random.mean)).toFixed(1), 16));
        const missing = cols.filter(c => have(c).length < ok.length)
            .map(c => `${c} (${have(c).length}/${ok.length})`);
        if (missing.length) out.push(`  built at fewer than every gameweek: ${missing.join(', ')}`);

        out.push('');
        out.push('model (its highest-scoring plan) versus each baseline, over the gameweeks both exist:');
        for (const c of ['points', 'value', 'template', 'form']) {
            const rows = ok.filter(r => r.actual[c] != null && r.actual.best != null);
            if (!rows.length) { out.push(`  vs ${pad(c, 10)} — never built`); continue; }
            const wins = rows.filter(r => r.actual.best > r.actual[c]).length;
            out.push(`  vs ${pad(c, 10)} ${wins}-${rows.length - wins}   mean margin ${mean(rows.map(r => r.actual.best - r.actual[c])).toFixed(1)}   (n=${rows.length})`);
        }
        const vsRandom = ok.filter(r => (r.actual.best || 0) > r.random.mean).length;
        out.push(`  vs ${pad('random', 10)} ${vsRandom}-${ok.length - vsRandom}   mean margin ${(mean(ok.map(r => (r.actual.best || 0) - r.random.mean))).toFixed(1)}   (n=${ok.length})`);
        // In units of the spread of legal squads, which is the only scale on
        // which "twelve points better" means anything.
        const z = ok.map(r => r.random.sd > 0 ? ((r.actual.best || 0) - r.random.mean) / r.random.sd : 0);
        out.push(`  mean z against the random pool: ${mean(z).toFixed(2)}`);

        /* The question the three plans exist to answer. If the model says two
           premiums is worth thirty points and it is not, the cards are
           confidently wrong about the only thing they are for.

           Every statistic here is WITHIN a build gameweek. Pooling projections
           across build weeks and correlating them against actuals looks like
           the obvious test and is meaningless: both scales are dominated by how
           high-scoring that particular window was, so the number it produces is
           about the calendar, not about premiums. */
        out.push('');
        out.push('the premium ladder — did the ordering hold up?');
        const pair = (a, b) => {
            const rows = ok.filter(r => r.actual[a] != null && r.actual[b] != null);
            if (!rows.length) return null;
            const wins = rows.filter(r => r.actual[a] > r.actual[b]).length;
            const actGap = rows.map(r => r.actual[a] - r.actual[b]);
            const projGap = rows.map(r => (r.projected[a] || 0) - (r.projected[b] || 0));
            return { wins, n: rows.length, actGap, projGap };
        };
        for (const [a, b] of [['double', 'spread'], ['single', 'spread'], ['double', 'single']]) {
            const p = pair(a, b);
            if (!p) continue;
            out.push(`  ${pad(a + ' > ' + b, 18)} ${p.wins}/${p.n} builds   actual gap ${mean(p.actGap) >= 0 ? '+' : ''}${mean(p.actGap).toFixed(1)} (sd ${sd(p.actGap).toFixed(0)})   the model predicted ${mean(p.projGap) >= 0 ? '+' : ''}${mean(p.projGap).toFixed(1)}`);
        }
        // Does a BIGGER predicted gap mean a bigger actual one? This is the
        // claim the number printed on the card is making.
        const ds = pair('double', 'spread');
        if (ds && ds.n > 2) {
            out.push(`  does the size of the predicted gap track the actual one? r ${pearson(ds.projGap, ds.actGap).toFixed(3)} over ${ds.n} builds`);
        }
        const rightOrder = ok.filter(r => {
            const ks = ['spread', 'single', 'double'].filter(k => r.projected[k] != null && r.actual[k] != null);
            if (ks.length < 2) return false;
            const byProj = ks.slice().sort((a, b) => r.projected[b] - r.projected[a])[0];
            const byAct = ks.slice().sort((a, b) => r.actual[b] - r.actual[a])[0];
            return byProj === byAct;
        }).length;
        out.push(`  the plan the model rated best scored most in ${rightOrder}/${ok.length} builds (one in three is chance)`);
    }
    return out.join('\n');
}

/* ===== cli ===== */

function parseArgs(argv) {
    const o = { mode: 'squads', data: 'data', from: 8, to: 33, step: 2, horizon: 6,
                budget: 100.0, randomCount: 25, tune: null, values: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const k = a.slice(2), v = argv[i + 1];
        if (k === 'mode' || k === 'data' || k === 'tune') { o[k] = v; i++; }
        else if (k === 'values') { o.values = v.split(',').map(Number); i++; }
        else if (k in o) { o[k] = Number(v); i++; }
    }
    return o;
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const root = process.cwd();
    const season = loadSeason(path.resolve(root, opts.data));

    if (season.lastRound < 5) {
        console.error(`✗ ${opts.data} covers only ${season.lastRound} gameweek(s) — nothing to score a squad against.`);
        console.error('  Point --data at a finished season. See the header of this file for the git incantation.');
        process.exit(1);
    }
    console.log(`season: ${season.lastRound} gameweeks, ${season.playersData.players.length} players, ${season.fixtures.length} fixtures\n`);

    const engine = createEngine(root);

    if (opts.mode === 'projection') {
        const to = Math.min(opts.to, season.lastRound);
        console.log(reportProjection(runProjectionCheck(season, engine, { from: opts.from, to })));
        return;
    }

    if (opts.mode === 'sweep') {
        if (!opts.tune || !opts.values) {
            console.error('✗ --mode sweep needs --tune WC_SOMETHING --values a,b,c');
            process.exit(1);
        }
        console.log(`sweeping ${opts.tune} over ${opts.values.join(', ')}\n`);
        const seen = new Set();
        for (const v of opts.values) {
            // A fresh engine per value, so nothing carries over from the last.
            const swept = createEngine(root, { [opts.tune]: v });
            const res = runSquadBacktest(season, swept, opts).filter(r => !r.error);
            const best = mean(res.map(r => r.actual.best || 0));
            const rnd = mean(res.map(r => r.random.mean));
            seen.add(best.toFixed(4));
            console.log(`  ${opts.tune} = ${String(v).padEnd(8)} mean actual ${best.toFixed(1)}   over random ${(best - rnd).toFixed(1)}   (${res.length} builds)`);
        }
        if (seen.size === 1 && opts.values.length > 1) {
            console.log('\n  every value gave an identical total, which is far more likely to mean the');
            console.log('  constant never reached the engine than that the model ignores it. Check that');
            console.log(`  ${opts.tune} is declared as a top-level const in scripts/wildcard-builder.js.`);
        }
        return;
    }

    console.log(reportSquads(runSquadBacktest(season, engine, opts), opts));
}

// Only when run directly, so the exports above stay importable by a runner
// that is not node.
if (process.argv[1] && process.argv[1].endsWith('wildcard-backtest.mjs')) {
    main().catch(e => { console.error(e); process.exit(1); });
}
