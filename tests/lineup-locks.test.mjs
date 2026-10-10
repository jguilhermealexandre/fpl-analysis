/* A saved lineup stops being a plan at the deadline.
 *
 * The bug, reported from a live gameweek. An eleven was arranged on the site on
 * Friday night — with two players benched, on the site's own advice — and left
 * there. The real eleven was then entered on fantasy.premierleague.com, with
 * both of those players STARTING and one of them captained. On Saturday, mid
 * round, Squad Analysis and the dashboard both still showed Friday's draft:
 * two of the best performers in the squad sitting on a bench that did not
 * exist.
 *
 * lsLoad already refused an arrangement from another team or another gameweek.
 * What it had no concept of was the deadline. An arrangement saved for GW6 is
 * still "for GW6" while GW6 is being played, so every check passed and the
 * draft was laid back over the squad on every render.
 *
 * It is the deadline that matters, not the gameweek, because that is the moment
 * the picks endpoint stops describing a plan and starts describing a fact: it
 * returns the eleven that was actually submitted. After that there is nothing
 * for a local draft to add and everything for it to misrepresent.
 *
 * All four restore paths in the app — the squad pitch, the Lineup Wizard, the
 * squad table and the dashboard — go through lsLoad, so the rule lives there
 * rather than at the call sites. These tests cover the rule and the one caller
 * with a different shape.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/lineup-store.js';
const LS_STORE = 'easyfpl_lineup';
const LS_MAX_AGE_DAYS = 21;

/* A localStorage stand-in. The real one is a browser global; lsLoad only ever
   does getItem/removeItem, so this is the whole surface. */
function storage(initial) {
    const box = { value: initial == null ? null : JSON.stringify(initial) };
    return {
        box,
        api: {
            getItem: () => box.value,
            setItem: (_k, v) => { box.value = v; },
            removeItem: () => { box.value = null; }
        }
    };
}

const ARRANGEMENT = { xi: [1, 2, 3], bench: [4], captain: 1, vice: 2, excluded: [] };
const SAVED_AT = Date.parse('2026-10-09T21:00:00Z');   // Friday night
const DEADLINE = Date.parse('2026-10-10T10:00:00Z');   // Saturday morning

function loadWith(store) {
    const lsClear = () => store.api.removeItem(LS_STORE);
    return loadFunction(SRC, 'lsLoad', {
        localStorage: store.api, LS_STORE, LS_MAX_AGE_DAYS, lsClear
    });
}

const entry = (over = {}) => ({ teamId: '2951638', gw: 6, arrangement: ARRANGEMENT, savedAt: SAVED_AT, ...over });

test('before the deadline a saved plan is restored', () => {
    /* The case the store exists for: plan on Friday, come back Saturday
       morning before the lock, and the work is still there. */
    const store = storage(entry());
    const lsLoad = loadWith(store);
    const before = Date.parse('2026-10-10T09:30:00Z');
    assert.deepEqual(lsLoad('2951638', 6, before, DEADLINE), ARRANGEMENT);
});

test('after the deadline it is refused — the real eleven is the submitted one', () => {
    // The reported bug, at the exact times it happened.
    const store = storage(entry());
    const lsLoad = loadWith(store);
    const during = Date.parse('2026-10-10T16:00:00Z');
    assert.equal(lsLoad('2951638', 6, during, DEADLINE), null);
});

test('and it is cleared, not merely ignored', () => {
    /* A locked gameweek cannot unlock, so an entry left in storage is only an
       invitation to restore it again on the next render. */
    const store = storage(entry());
    const lsLoad = loadWith(store);
    lsLoad('2951638', 6, Date.parse('2026-10-10T16:00:00Z'), DEADLINE);
    assert.equal(store.box.value, null, 'the entry is gone');
});

test('the deadline instant itself counts as locked', () => {
    const store = storage(entry());
    const lsLoad = loadWith(store);
    assert.equal(lsLoad('2951638', 6, DEADLINE, DEADLINE), null, 'at the deadline, not after it');
});

test('a caller with no deadline to hand still gets the old behaviour', () => {
    /* Rather than throwing, or guessing a lock time. Every caller in the app
       passes one; this is what happens if a new one forgets. */
    const store = storage(entry());
    const lsLoad = loadWith(store);
    const during = Date.parse('2026-10-10T16:00:00Z');
    assert.deepEqual(lsLoad('2951638', 6, during, null), ARRANGEMENT);
    assert.deepEqual(lsLoad('2951638', 6, during, undefined), ARRANGEMENT);
});

test('the older guards still hold', () => {
    const store = storage(entry());
    const lsLoad = loadWith(store);
    const before = Date.parse('2026-10-10T09:30:00Z');
    assert.equal(lsLoad('9999999', 6, before, DEADLINE), null, 'another team');
    assert.equal(lsLoad('2951638', 7, before, DEADLINE), null, 'another gameweek');
});

test('an ancient entry is still refused on age', () => {
    const store = storage(entry({ savedAt: Date.parse('2026-08-01T12:00:00Z') }));
    const lsLoad = loadWith(store);
    // No deadline passed in, so age is the only thing that can refuse it.
    assert.equal(lsLoad('2951638', 6, Date.parse('2026-10-10T09:30:00Z'), null), null);
});

test('junk in storage is refused rather than thrown at', () => {
    for (const bad of [null, {}, { teamId: '2951638', gw: 6 }]) {
        const store = storage(bad);
        const lsLoad = loadWith(store);
        assert.equal(lsLoad('2951638', 6, Date.now(), DEADLINE), null);
    }
});

/* The dashboard reaches the store through a different door, because its squad
   is one flat list rather than the wizard's state object. It has to carry the
   deadline too, or the fix holds on two pages out of three. */
test('applySavedArrangement passes the lock through', () => {
    const store = storage(entry());
    const lsClear = () => store.api.removeItem(LS_STORE);
    const seen = [];
    const fn = loadFunction(SRC, 'applySavedArrangement', {
        localStorage: {
            getItem: (k) => (k === 'fpl_team_id' ? '2951638' : store.api.getItem(k)),
            removeItem: store.api.removeItem
        },
        lsLoad: (teamId, gw, now, lockedAt) => { seen.push({ teamId, gw, lockedAt }); return null; },
        lsApplyToSquad: () => true,
        LS_STORE, LS_MAX_AGE_DAYS, lsClear
    });
    fn([{ id: 1 }], 6, DEADLINE);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].lockedAt, DEADLINE, 'the deadline reaches lsLoad');
    assert.equal(seen[0].gw, 6);
});
