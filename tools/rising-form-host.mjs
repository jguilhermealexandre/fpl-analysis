#!/usr/bin/env node
/* Rising Form, run outside a browser, from the files the site serves.

   Same contract as xp-engine-host.mjs and for the same reason: the archive is
   only worth keeping if it records what the SITE said, so this evaluates
   scripts/form-trend.js itself rather than restating the model in Node. A
   second implementation would drift, and the first time it did we would be
   grading a model nobody was ever shown.

   The engine reads four things off the page — getTeamSeasonXg, getTeamXgWindow,
   teamAnalysis and allFixtures. Three come from scripts the site loads
   (team-xg.js, xp-engine.js); the fourth is passed in. Nothing here computes a
   football number of its own.
*/
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, loadEngine } from './xp-engine-host.mjs';

/* What the host can see after evaluation. Anything not named here stays inside
   the engine — a caller cannot quietly start depending on an internal. */
const SURFACE = ['risingFormRanked', 'risingFormFor', 'rfEvaluate', 'rfSplit', 'ftTeamTrend'];

const read = (rel, root) => fs.readFileSync(path.join(root, rel), 'utf8');

/* team-xg.js and form-trend.js evaluated into one scope, the way a page loads
   them. `with` rather than plain globals so the two can see each other and the
   seeded page values without either file being edited for our benefit. */
export function loadRisingForm(ctxValues, root = REPO_ROOT) {
    const src = read('scripts/team-xg.js', root) + '\n;\n' + read('scripts/form-trend.js', root);
    const ctx = {
        // buildTeamXgData() calls it; common.js owns the definition and this is
        // the whole of what it needs.
        fixturePlayed: (f) => !!(f && f.finished_provisional && f.team_h_score !== null),
        console,
        ...ctxValues
    };
    const handback = ['buildTeamXgData', ...SURFACE]
        .map(n => `__ctx.${n} = typeof ${n} === 'function' ? ${n} : null;`)
        .join('\n');

    new Function('__ctx', `with (__ctx) {\n${src}\n${handback}\n}`)(ctx);

    const missing = ['buildTeamXgData', ...SURFACE].filter(n => typeof ctx[n] !== 'function');
    if (missing.length) {
        throw new Error(`form-trend.js evaluated but did not define: ${missing.join(', ')}`);
    }
    return ctx;
}

/* The player objects the engine expects, built from the committed files.

   Deliberately NOT buildStatWindows(): the model reads `history` directly and
   derives its own windows, so anything else here would be a second opinion
   about what "recent" means. */
export function buildRisingInputs(boot, fixtures, playersData, gw, root = REPO_ROOT) {
    const engine = loadEngine(gw, root);
    const teamsById = {};
    (boot.teams || []).forEach(t => { teamsById[t.id] = t; });

    const teamFixtures = engine.xpBuildTeamFixtures(fixtures, teamsById, 8);
    const teamAnalysis = engine.xpBuildTeamScores(boot.teams, fixtures);

    const historyById = new Map();
    ((playersData && playersData.players) || []).forEach(p => {
        historyById.set(p.id, p.history || []);
    });

    const rf = loadRisingForm({ teams: teamsById, allFixtures: fixtures, teamAnalysis }, root);
    rf.buildTeamXgData({ teams: boot.teams, players: (playersData || {}).players || [] }, fixtures);

    const players = (boot.elements || []).map(el => {
        const upcoming = teamFixtures[el.team] || [];
        const next3 = upcoming.slice(0, 3);
        return {
            id: el.id,
            name: el.web_name,
            position: el.element_type,
            teamId: el.team,
            price: el.now_cost / 10,
            status: el.status || 'a',
            chanceNextRound: el.chance_of_playing_next_round ?? null,
            selectedBy: parseFloat(el.selected_by_percent) || 0,
            history: historyById.get(el.id) || [],
            fixtures: next3.length ? { next3 } : null,
            teamScores: teamAnalysis[el.team] || null
        };
    });

    return { rf, players, teamAnalysis, teamFixtures };
}

/* The ranked board, as rows small enough to archive every week for a season.

   Each row carries what the ranking was MADE of, not just its result: a score
   with no fixture term and no ownership beside it cannot be argued with later,
   and arguing with it later is the entire point of writing it down. */
export function rankRisingForm(boot, fixtures, playersData, gw, root = REPO_ROOT) {
    const { rf, players } = buildRisingInputs(boot, fixtures, playersData, gw, root);
    const ranked = rf.risingFormRanked(players, { fixtures });
    const round = (v, dp) => (Number.isFinite(v) ? Math.round(v * 10 ** dp) / 10 ** dp : null);

    return ranked.map((p, i) => {
        const split = rf.rfSplit(p);
        return {
            id: p.id,
            rank: i + 1,
            score: round(p.risingScore, 2),
            pos: p.position,
            team: p.teamId,
            price: p.price,
            sel: p.selectedBy,
            fdrNear: round(p.fdrNear, 2),
            ppgRecent: split ? round(split.ppgRecent, 2) : null,
            ppgPrior: split ? round(split.ppgPrior, 2) : null,
            mpgRecent: split ? round(split.mpgRecent, 1) : null,
            signals: p.signals.map(s => s.label)
        };
    });
}
