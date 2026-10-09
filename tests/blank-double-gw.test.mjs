/* Blanks and doubles, counted off the fixture list.

   A gameweek is a BLANK for a club with no fixture in it and a DOUBLE for one
   with two. Neither exists when a season is published — all 380 matches start out
   one per club per round — and they appear when a league fixture clashes with a
   cup tie: out of the round it clashed with, and back into a later one once the
   tie is settled. There is no published list of affected gameweeks; counting the
   fixtures is what produces one.

   Checked against the shipped data/fixtures.json before this was written: today
   every one of the 38 gameweeks holds exactly ten fixtures and every club plays
   exactly once in each, so the correct answer in October is "none scheduled yet".
   That is a finding, not an absence, and these tests pin both halves — that a
   clean list reads as clean, and that a real blank is found the week it lands.

   THE ONE THAT MATTERS. A club with no row in a gameweek is only blanking if that
   gameweek is in the list at all. A truncated or short file must report fewer
   gameweeks examined, never twenty clubs blanking for the rest of the season. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/team-analysis-core.js';

const load = (fixtures) => {
    const fixtureLoadByGW = loadFunction(SRC, 'fixtureLoadByGW', { allFixtures: fixtures });
    return {
        fixtureLoadByGW,
        squadFixtureLoad: loadFunction(SRC, 'squadFixtureLoad', { fixtureLoadByGW })
    };
};

const p = (id, teamId, name) => ({ id, teamId, name: name || `P${id}` });
/* One fixture per club per gameweek over a range, which is what a freshly
   published season looks like. Twenty clubs, so ten fixtures a round. */
function cleanSeason(from, to) {
    const out = [];
    for (let gw = from; gw <= to; gw++) {
        for (let h = 1; h <= 20; h += 2) out.push({ event: gw, team_h: h, team_a: h + 1 });
    }
    return out;
}

test('a clean list reads as clean, and says how far it looked', () => {
    const { squadFixtureLoad } = load(cleanSeason(6, 20));
    const r = squadFixtureLoad([p(1, 3), p(2, 7), p(3, 12)], 6, 13);
    assert.equal(r.clean, true);
    assert.equal(r.blanks.length, 0);
    assert.equal(r.doubles.length, 0);
    assert.equal(r.from, 6);
    assert.equal(r.to, 13);
    assert.equal(r.examined, 8);
    assert.equal(r.squadSize, 3);
});

test('a club pulled out of a gameweek blanks every player it has', () => {
    const fixtures = cleanSeason(6, 13).filter(f => !(f.event === 9 && (f.team_h === 3 || f.team_a === 3)));
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3, 'Mine'), p(2, 3, 'AlsoMine'), p(3, 7, 'Fine')], 6, 13);
    assert.equal(r.clean, false);
    assert.equal(r.blanks.length, 1);
    assert.equal(r.blanks[0].gw, 9);
    assert.deepEqual(r.blanks[0].players.map(x => x.name), ['Mine', 'AlsoMine']);
    assert.equal(r.doubles.length, 0);
});

test('a club with two fixtures in a week doubles every player it has', () => {
    const fixtures = cleanSeason(6, 13).concat([{ event: 11, team_h: 3, team_a: 19 }]);
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3, 'Mine'), p(2, 7, 'Fine')], 6, 13);
    assert.equal(r.doubles.length, 1);
    assert.equal(r.doubles[0].gw, 11);
    assert.deepEqual(r.doubles[0].players.map(x => x.name), ['Mine']);
    assert.equal(r.clean, false);
    // The opponent doubles too, and is not in this squad.
    assert.equal(r.doubles[0].players.length, 1);
});

test('the same club can blank one week and double another', () => {
    /* Which is the usual shape of it: the match that left GW9 is the match that
       arrives in GW11. */
    const fixtures = cleanSeason(6, 13)
        .filter(f => !(f.event === 9 && (f.team_h === 3 || f.team_a === 3)))
        .concat([{ event: 11, team_h: 3, team_a: 19 }]);
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3)], 6, 13);
    assert.equal(r.blanks[0].gw, 9);
    assert.equal(r.doubles[0].gw, 11);
});

test('results come back in gameweek order, soonest first', () => {
    const fixtures = cleanSeason(6, 20)
        .filter(f => !(f.event === 15 && (f.team_h === 3 || f.team_a === 3)))
        .filter(f => !(f.event === 8 && (f.team_h === 3 || f.team_a === 3)));
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3)], 6, 20);
    assert.deepEqual(r.blanks.map(x => x.gw), [8, 15]);
});

/* ---- the window ---- */

test('gameweeks before the window are not counted', () => {
    /* A round already played is not evidence about a round still to come, and the
       squad being scanned is today's squad. */
    const fixtures = cleanSeason(1, 13).filter(f => !(f.event === 3 && (f.team_h === 3 || f.team_a === 3)));
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3)], 6, 13);
    assert.equal(r.clean, true, 'GW3 is behind us');
    assert.equal(r.from, 6);
});

test('a short fixture list reports the window it actually had', () => {
    /* NOT twenty clubs blanking for the rest of the season. The gameweeks with no
       fixtures at all are simply absent from the count, so `to` and `examined`
       describe what was really looked at and the copy can say so. */
    const { squadFixtureLoad } = load(cleanSeason(6, 9));
    const r = squadFixtureLoad([p(1, 3), p(2, 7)], 6, 13);
    assert.equal(r.clean, true, 'a missing gameweek is not a blank');
    assert.equal(r.to, 9);
    assert.equal(r.examined, 4);
});

/* ---- refusals ---- */

test('it refuses when it has no squad or no fixtures to read', () => {
    assert.equal(load(cleanSeason(6, 13)).squadFixtureLoad([], 6, 13), null);
    assert.equal(load([]).squadFixtureLoad([p(1, 3)], 6, 13), null,
        'no data about the window is not the same as a clean window');
    assert.equal(load(cleanSeason(6, 13)).squadFixtureLoad([p(1, 3)], 90, 99), null);
});

test('a player with no club is skipped rather than reported as blanking for ever', () => {
    const { squadFixtureLoad } = load(cleanSeason(6, 13));
    const r = squadFixtureLoad([p(1, 3), { id: 2, name: 'Nowhere' }], 6, 13);
    assert.equal(r.squadSize, 1);
    assert.equal(r.clean, true);
});

test('a fixture with no gameweek is not counted against any week', () => {
    /* FPL sets event to null on a postponed match until it is rescheduled. It is
       not a fixture in any round yet, and counting it as one would hide the blank
       it created. */
    const fixtures = cleanSeason(6, 13)
        .filter(f => !(f.event === 9 && (f.team_h === 3 || f.team_a === 3)))
        .concat([{ event: null, team_h: 3, team_a: 4 }]);
    const { squadFixtureLoad } = load(fixtures);
    const r = squadFixtureLoad([p(1, 3)], 6, 13);
    assert.equal(r.blanks.length, 1, 'still a blank in GW9');
    assert.equal(r.blanks[0].gw, 9);
});
