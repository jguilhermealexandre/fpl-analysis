/* The site's own projection engine, hosted outside a browser.

   scripts/xp-engine.js is a classic script: no exports, every function a global,
   because a dozen pages load it with a script tag. Anything that wants to
   measure what it predicts has to give it somewhere to live that is not the real
   global object, and hand the pieces back.

   THIS IS A SECOND COPY OF A LOADER, AND DELIBERATELY NOT A SECOND COPY OF THE
   MODEL.

   scripts/scouts-desk.js does the same trick so the article generators rank
   captains on the same engine the app does — see sdLoadXpEngine() there, which
   is where the reasoning is written up. It cannot be shared with this file:
   scouts-desk.js is a dual-context classic script that the browser also loads,
   so it cannot import an ES module. What must never be duplicated is the maths,
   and none of it is here. Every number this hands back came out of the shipped
   engine; if the engine changes, this changes with it or throws.

   Why `with` rather than node:vm. Both work. tools/odds-calibration.mjs uses vm
   because it has to replay a whole page's data phase across four scripts. This
   needs one script and five lookups, and `with` keeps the engine's globals on a
   plain object the caller can read and write afterwards — which is exactly how
   the lookups get in.
*/
import fs from 'node:fs';
import path from 'node:path';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

/* What the host can see after evaluation. Anything not named here stays inside
   the engine, which is the point: this is the surface it gets measured through,
   and a caller cannot quietly start depending on an internal. */
const SURFACE = [
    'xpBuildTeamFixtures', 'xpBuildTeamScores', 'xpBuildSeasonStats',
    'xpBuildPlayers', 'xpBuildPositionAverages',
    'projectPlayerPointsForGW', 'projectPlayerPointsDetailed',
    'predictedGWPoints', 'expectedMinutesModel', 'xpEngineReady'
];

/* The two page-level values the engine reads but never declares.

   Seeded BEFORE evaluation, not after. This is the failure scouts-desk.js paid
   for once already: without them projectPlayerPointsForGW dies on "isPreseason
   is not defined", and a caller with a try/catch turns that into a silent zero.
   A snapshot full of silent zeros is worse than no snapshot, so this throws
   instead. */
export function loadEngine(gw, root = REPO_ROOT) {
    const src = fs.readFileSync(path.join(root, 'scripts/xp-engine.js'), 'utf8');
    const ctx = { isPreseason: false, currentGW: gw };
    const handback = SURFACE
        .map(n => `__ctx.${n} = typeof ${n} === 'function' ? ${n} : null;`)
        .join('\n');

    new Function('__ctx', `with (__ctx) {\n${src}\n${handback}\n}`)(ctx);

    const missing = SURFACE.filter(n => typeof ctx[n] !== 'function');
    if (missing.length) {
        throw new Error(`xp-engine.js evaluated but did not define: ${missing.join(', ')}`);
    }
    return ctx;
}

/* Every lookup projectPlayerPointsForGW reads, built in the order index.html's
   loadTicker() builds them. The order is load-bearing: players are built from
   the fixture lookup, and the position averages from the players.

   The span of 8 gameweeks matches what the dashboard and scouts-desk.js pass.
   It has to cover the gameweek being projected or teamFixtures6 has no match
   for it and every projection is a blank. */
export function buildProjector(boot, fixtures, gw, root = REPO_ROOT) {
    if (!boot || !boot.teams || !boot.elements) throw new Error('bootstrap data is missing teams or elements');

    const engine = loadEngine(gw, root);
    const teamsById = {};
    boot.teams.forEach(t => { teamsById[t.id] = t; });

    engine.teamFixtures6 = engine.xpBuildTeamFixtures(fixtures, teamsById, 8);
    engine.teamAnalysis = engine.xpBuildTeamScores(boot.teams, fixtures);
    engine.seasonStats = engine.xpBuildSeasonStats(boot.teams, fixtures);
    engine.allPlayers = engine.xpBuildPlayers(boot.elements, teamsById, engine.teamFixtures6);
    engine.positionAverages = engine.xpBuildPositionAverages(engine.allPlayers, gw);

    /* The engine's own readiness check exists precisely so a host can find out
       it is about to get zeros instead of getting them. Asking it is the whole
       reason it is on the surface list. */
    if (!engine.xpEngineReady()) {
        throw new Error('xp-engine.js is loaded but reports it is not ready — a lookup above did not build');
    }
    return { engine, teamsById, players: engine.allPlayers };
}

const PARTS = ['appearance', 'attack', 'cleanSheet', 'saves', 'bonus', 'conceded', 'defCon', 'cards'];

/* One player's projection for one gameweek, with the component breakdown.

   `total` is whatever the shipped projectPlayerPointsForGW returns — that is the
   number the site shows and therefore the number being graded. The parts are
   summed over the same fixtures with the same options, so they should add up to
   it; `partsTotal` is returned alongside rather than assumed equal, and the
   caller checks. A drift between the two means the two paths have diverged,
   which is worth finding out from a failing job rather than from a year of
   quietly mismatched archive rows.

   A blank gameweek is zero and that is the honest answer, not a missing value:
   a player with no fixture scores nothing. */
export function projectOne(engine, player, gw) {
    const all = engine.teamFixtures6[player.teamId] || [];
    const matches = all.filter(f => f.event === gw);

    // The ep_next floor is only meaningful for the very next fixture — same
    // condition projectPlayerPointsForGW applies, for the same reason.
    const isImmediate = all.length > 0 && all[0].event === gw;

    const parts = {};
    PARTS.forEach(k => { parts[k] = 0; });
    let partsTotal = 0;
    let pStart = null;

    for (const fixture of matches) {
        const d = engine.projectPlayerPointsDetailed(player, { fixture, applyEpFloor: isImmediate });
        PARTS.forEach(k => { parts[k] += d[k] || 0; });
        partsTotal += d.total || 0;
        if (pStart == null && Number.isFinite(d.pStart)) pStart = d.pStart;
    }

    const mins = engine.expectedMinutesModel(player);
    return {
        total: engine.projectPlayerPointsForGW(player, gw),
        partsTotal,
        parts,
        matches,
        pStart: pStart != null ? pStart : (mins ? mins.pStart : null),
        expMins: mins ? mins.expMins : null
    };
}

export { PARTS };
