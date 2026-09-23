/* The GW Draft's horizon, and why a saved plan used to vanish on refresh.
 *
 * A plan is stored under the weeks it covers, and loadDraftSlot() checks that
 * list against the weeks that are plannable now — if they disagree the fixture
 * list has moved on and the saved plan is stale. Reasonable. The problem was
 * that the two sides of that comparison were worked out by two different
 * pieces of code:
 *
 *   initDraft()      skipped any gameweek with a match already under way,
 *                    because its deadline has gone and it cannot be planned.
 *   loadDraftSlot()  did not.
 *
 * So from the first kick of a gameweek until its last match was marked
 * finished — most of a weekend, every weekend — the list loadDraftSlot() built
 * began a week earlier than the one saved in the plan, the strings did not
 * match, and every plan was thrown away as stale. Nothing errored. The tab
 * simply came back empty, and the manager had lost their draft.
 *
 * The fix is one function, draftPlannableGWs(), used by both. These tests hold
 * that in place: the first pins what the function must do, the second pins
 * that loadDraftSlot() still asks it rather than working it out again.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'scripts/draft-planner.js'), 'utf8');

/* Lift a top-level function out of the file by matching its braces, so the
   test runs the shipped code rather than a paraphrase of it. */
function lift(name) {
    const open = src.indexOf(`function ${name}(`);
    assert.ok(open > -1, `${name} not found in draft-planner.js`);
    let depth = 0, i = src.indexOf('{', open);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(open, i + 1);
}

function constant(name) {
    const m = new RegExp(`const ${name} = (\\d+);`).exec(src);
    assert.ok(m, `${name} not found in draft-planner.js`);
    return Number(m[1]);
}

const DRAFT_GW_MAX = constant('DRAFT_GW_MAX');
const DRAFT_GW_STEP = constant('DRAFT_GW_STEP');

/* The globals draftPlannableGWs() closes over on the page. */
function run(allFixtures, currentGW = 5) {
    const factory = new Function('allFixtures', 'currentGW', 'DRAFT_GW_MAX',
        `${lift('draftPlannableGWs')}; return draftPlannableGWs();`);
    return factory(allFixtures, currentGW, DRAFT_GW_MAX);
}

const fixture = (event, extra = {}) => ({ event, started: false, finished_provisional: false, ...extra });

test('a gameweek already under way is not plannable', () => {
    /* GW5 kicked off on Saturday and is not finished. Its deadline has gone,
       so a plan cannot start there — and, crucially, neither caller may think
       it can, or they disagree and the saved plan is discarded. */
    const fixtures = [
        fixture(5, { started: true }),
        fixture(5),
        fixture(6), fixture(7), fixture(8)
    ];
    assert.deepEqual(run(fixtures), [6, 7, 8]);
});

test('a gameweek whose matches are all still to come is plannable', () => {
    assert.deepEqual(run([fixture(6), fixture(7), fixture(8)]), [6, 7, 8]);
});

test('the pool stops at the horizon the projection can actually see', () => {
    const fixtures = [];
    for (let gw = 6; gw <= 20; gw++) fixtures.push(fixture(gw));
    assert.equal(run(fixtures).length, DRAFT_GW_MAX);
});

test('with nothing unplayed on record it counts forward from the current week', () => {
    const played = [fixture(1, { finished_provisional: true })];
    assert.deepEqual(run(played, 5), [6, 7, 8, 9, 10, 11].slice(0, DRAFT_GW_MAX));
});

test('a plan opens on fewer weeks than the pool holds, so there is something to extend', () => {
    assert.ok(DRAFT_GW_STEP < DRAFT_GW_MAX,
        'DRAFT_GW_STEP must be smaller than DRAFT_GW_MAX or "more weeks" never appears');
    assert.equal(DRAFT_GW_MAX % DRAFT_GW_STEP, 0,
        'the pool should divide into whole steps, or the last batch is a stub');
});

test('loadDraftSlot asks draftPlannableGWs rather than working the list out again', () => {
    const body = lift('loadDraftSlot');
    assert.match(body, /draftPlannableGWs\(\)/,
        'loadDraftSlot must use the shared horizon');
    assert.doesNotMatch(body, /finished_provisional/,
        'loadDraftSlot is filtering fixtures itself again — that is the drift this file exists to stop');
});

test('initDraft asks the same function', () => {
    const body = lift('initDraft');
    assert.match(body, /draftPlannableGWs\(\)/);
    assert.doesNotMatch(body, /finished_provisional/);
});

test('the saved payload carries the pool, so opening a plan up is not read as a changed fixture list', () => {
    const body = lift('saveDraft');
    assert.match(body, /gwPool:/, 'saveDraft must store the pool the plan was built from');
    assert.match(body, /optimizeReports:/, 'auto-optimise reports must survive a refresh with the lineups they produced');
});
