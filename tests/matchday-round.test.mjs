/* Matchday draws the round, not the part of it you happen to own.
 *
 * Reported from a live gameweek: "in the lineup wizard we dont have all the
 * games there". It was true and it was deliberate — lwMatchdayRows() ended in
 * `.filter(r => r.mine.length)`, on the reasoning that a fixture with none of
 * your players is noise on a screen about which of your players to start.
 *
 * The reasoning does not survive the arithmetic. A fifteen-man squad spans nine
 * or ten clubs, so for GW8 the filter removed four of the ten matches while the
 * section's own heading said "Matchday GW8". And the matches it removed are the
 * ones holding the players you are about to buy and the ones your rivals
 * captained — on a page that also runs the transfer wizard.
 *
 * So: every fixture in the planning gameweek, in kick-off order, with the
 * player-less ones marked so they can be drawn quieter rather than dropped.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SRC = 'scripts/lineup-wizard.js';

/* GW8 as it actually is: ten fixtures across three days. Team ids are the real
   ones, and the squad below is the real nine-club spread that exposed this. */
const GW8 = [
    { id: 71, event: 8, team_h: 11, team_a: 15, kickoff_time: '2026-10-23T19:00:00Z' }, // IPS v NFO
    { id: 72, event: 8, team_h: 2, team_a: 13, kickoff_time: '2026-10-24T11:30:00Z' },  // AVL v MCI
    { id: 73, event: 8, team_h: 1, team_a: 8, kickoff_time: '2026-10-24T14:00:00Z' },   // ARS v EVE
    { id: 74, event: 8, team_h: 7, team_a: 9, kickoff_time: '2026-10-24T14:00:00Z' },   // COV v FUL
    { id: 75, event: 8, team_h: 6, team_a: 18, kickoff_time: '2026-10-24T16:30:00Z' },  // CHE v TOT
    { id: 76, event: 8, team_h: 16, team_a: 14, kickoff_time: '2026-10-25T14:00:00Z' }, // CRY v NEW
    { id: 77, event: 8, team_h: 10, team_a: 4, kickoff_time: '2026-10-25T14:00:00Z' },  // HUL v BRE
    { id: 78, event: 8, team_h: 12, team_a: 5, kickoff_time: '2026-10-25T14:00:00Z' },  // LIV v BHA
    { id: 79, event: 8, team_h: 17, team_a: 3, kickoff_time: '2026-10-25T14:00:00Z' },  // MUN v BOU
    { id: 80, event: 8, team_h: 19, team_a: 20, kickoff_time: '2026-10-25T16:30:00Z' }  // SUN v LEE
];
// GW7 is in the list too, because the filter under test is on the event.
const GW7 = [{ id: 61, event: 7, team_h: 8, team_a: 6, kickoff_time: '2026-10-17T11:30:00Z' }];

// Nine clubs: ARS BHA CHE EVE HUL LIV MCI NEW TOT.
const SQUAD = [
    { id: 1, teamId: 1, pickPos: 1 }, { id: 2, teamId: 5, pickPos: 2 },
    { id: 3, teamId: 6, pickPos: 3 }, { id: 4, teamId: 8, pickPos: 4 },
    { id: 5, teamId: 10, pickPos: 5 }, { id: 6, teamId: 12, pickPos: 6 },
    { id: 7, teamId: 13, pickPos: 7 }, { id: 8, teamId: 14, pickPos: 8 },
    { id: 9, teamId: 18, pickPos: 9 }, { id: 10, teamId: 1, pickPos: 10 },
    { id: 11, teamId: 6, pickPos: 11 }, { id: 12, teamId: 12, pickPos: 12 },
    { id: 13, teamId: 18, pickPos: 13 }, { id: 14, teamId: 5, pickPos: 14 },
    { id: 15, teamId: 13, pickPos: 15 }
];

function rows({ odds = null, squad = SQUAD, fixtures = [...GW8, ...GW7] } = {}) {
    const fn = loadFunction(SRC, 'lwMatchdayRows', {
        allFixtures: fixtures,
        planningGW: 8,
        boOdds: odds,
        lineupState: {
            squad,
            xi: squad.slice(0, 11),
            captain: squad.length ? squad[0].id : null,
            viceCaptain: squad.length > 1 ? squad[1].id : null
        }
    });
    return fn();
}

test('every fixture in the round is there, not just the ones with your players', () => {
    const out = rows();
    assert.equal(out.length, 10, 'ten matches in a gameweek, ten cards');
    const withMine = out.filter(r => r.mine.length).length;
    assert.equal(withMine, 6, 'six of them hold a player of this squad');
    assert.equal(out.length - withMine, 4, 'and the other four are still drawn');
});

test('the four that were being dropped are the ones nobody owns', () => {
    /* Named explicitly, because this is the exact list the user could not see:
       IPS v NFO (71), COV v FUL (74), MUN v BOU (79), SUN v LEE (80). Checked
       against the real GW8 card and this squad's real nine clubs. */
    const spare = rows().filter(r => !r.mine.length).map(r => r.f.id).sort((a, b) => a - b);
    assert.deepEqual(spare, [71, 74, 79, 80]);
});

test('another gameweek never leaks in', () => {
    // The event filter is the one piece of the old behaviour that must survive.
    assert.equal(rows().every(r => r.f.event === 8), true);
});

test('kick-off order, so the day grouping underneath still means something', () => {
    const times = rows().map(r => r.f.kickoff_time);
    assert.deepEqual(times, [...times].sort());
    assert.equal(times[0], '2026-10-23T19:00:00Z', 'Friday night first');
    assert.equal(times[times.length - 1], '2026-10-25T16:30:00Z', 'Sunday teatime last');
});

test('a player-less fixture carries an empty list, not a missing one', () => {
    /* The renderer maps over row.mine and reads row.mine.length for its
       markers. Undefined there would be a TypeError on four cards. */
    for (const r of rows().filter(r => !r.mine.length)) {
        assert.ok(Array.isArray(r.mine));
        assert.equal(r.mine.length, 0);
    }
});

test('your players are still ordered starters first, then captain, then squad order', () => {
    const chelsea = rows().find(r => r.f.id === 75);        // CHE v TOT
    assert.equal(chelsea.mine.length, 4, 'two Chelsea, two Spurs');
    const flags = chelsea.mine.map(m => m.starting);
    assert.deepEqual(flags, [...flags].sort((a, b) => b - a), 'starters before bench');
    assert.equal(chelsea.mine[0].captain || chelsea.mine[0].starting, true);
});

test('with no squad loaded there is nothing to draw', () => {
    // Not ten empty cards: the section is about a squad it does not have yet.
    assert.deepEqual(rows({ squad: [] }), []);
});

test('the odds are a left join, so an unpriced round still yields every row', () => {
    const priced = rows({ odds: { matches: [{ fixtureId: 73, event: 8, market: {} }] } });
    assert.equal(priced.length, 10);
    assert.equal(priced.filter(r => r.odds).length, 1, 'one priced');
    assert.equal(priced.filter(r => !r.odds).length, 9, 'nine not, and all present');
    assert.equal(rows({ odds: { matches: [] } }).length, 10, 'an empty feed costs no rows');
});

/* ---- what the section says when the market has nothing ------------------- */

test('the section never blames the odds job for an empty upstream', () => {
    /* The message said "the odds job has not run since". On 20 October it had
       run twenty minutes earlier and succeeded; football-data.co.uk simply had
       no Premier League rows in fixtures.csv — 27 rows, all of them E1, E2, E3,
       SC1 and SP1. Sending someone to debug a green workflow is worse than
       saying nothing, so staleness is now claimed only of a feed that actually
       carries prices. */
    /* Comments stripped: the sentence still appears in the note explaining why
       it was removed, and a check that cannot tell prose from output would
       forbid recording the reason. */
    const src = stripComments(read(SRC));
    assert.equal(src.includes('the odds job has not run since'), false);
    const prov = src.slice(src.indexOf('function lwMatchdayProvenance'));
    assert.match(prov, /const priced = /, 'it counts what the feed holds');
    assert.match(prov, /stale = priced && updated/, 'and only an unempty feed can be stale');
    assert.match(prov, /Model only — no market prices yet/,
        'an unpriced round says so, rather than claiming a blend');
});

test('the legend and the provenance no longer vanish with the odds', () => {
    /* They were behind `if (!boOdds) return ''`, and boOdds is null whenever
       the feed prices nothing — so the one state that needed an explanation was
       the state with no explanation on screen. */
    const prov = read(SRC).slice(read(SRC).indexOf('function lwMatchdayProvenance'));
    const body = prov.slice(0, prov.indexOf('\n        }'));
    assert.doesNotMatch(body, /if \(typeof boOdds === 'undefined' \|\| !boOdds\) return ''/);
    assert.match(body, /boOddsMeta/, 'the metadata survives an empty feed and is read from it');
});
