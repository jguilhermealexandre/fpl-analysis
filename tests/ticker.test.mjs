/* The strip across the top of the dashboard.

   It used to be price movers and nothing else, which is the right thing to read
   on a Tuesday and the wrong thing at 3pm on a Saturday. Now it asks what part
   of the week it is and says something different in each — so what is worth
   testing is the switch between them, and the arithmetic behind the one number
   anybody actually checks. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript, loadFunction, browserStubs } from './helpers/load.mjs';

const md = loadScript('scripts/matchday.js', browserStubs({
    escHTML: s => String(s ?? ''),
    v2Icon: name => `<svg data-icon="${name}"></svg>`
}));

const tickerNum = loadFunction('index.html', 'tickerNum');
const tickerLiveSquad = loadFunction('index.html', 'tickerLiveSquad');
const tickerPhase = loadFunction('index.html', 'tickerPhase', {
    mdGameweekState: md.mdGameweekState
});
const tickerItems = loadFunction('index.html', 'tickerItems', {
    tickerNum, tickerLiveSquad
});

const T0 = Date.parse('2026-09-12T18:00:00Z');   // an hour after GW4 locked

const EVENTS = [
    { id: 3, deadline_time: '2026-09-04T17:30:00Z', finished: true, data_checked: true },
    { id: 4, deadline_time: '2026-09-12T17:00:00Z', finished: false, data_checked: false },
    { id: 5, deadline_time: '2026-09-19T17:00:00Z', finished: false, data_checked: false }
];
const boot = extra => ({ events: EVENTS.map(e => ({ ...e, ...(extra?.[e.id] || {}) })) });

const UNPLAYED = { started: false, finished: false, finished_provisional: false };
const PLAYING = { started: true, finished: false, finished_provisional: false };
const DONE = { started: true, finished: true, finished_provisional: true };

// Two matches a round: Spurs (1) v Arsenal (2), and City (3) v Everton (4).
const round = (event, a, b) => ([
    { id: event * 10 + 1, event, team_h: 1, team_a: 2, kickoff_time: '2026-09-13T14:00:00Z', ...a },
    { id: event * 10 + 2, event, team_h: 3, team_a: 4, kickoff_time: '2026-09-13T16:30:00Z', ...b }
]);

test('a round with a match in play is live', () => {
    assert.equal(tickerPhase(round(4, PLAYING, UNPLAYED), boot(), 4, T0), 'live');
});

test('between kickoffs is still live — the round is not over', () => {
    // matchday calls this 'locked': started, nothing actually on the pitch.
    assert.equal(tickerPhase(round(4, DONE, UNPLAYED), boot(), 4, T0), 'live');
});

test('every match done but the points not signed off is results', () => {
    const b = boot({ 4: { finished: true, data_checked: false } });
    assert.equal(tickerPhase(round(4, DONE, DONE), b, 4, T0), 'results');
});

test('once FPL has checked the data the week ahead matters more', () => {
    const b = boot({ 4: { finished: true, data_checked: true } });
    assert.equal(tickerPhase(round(4, DONE, DONE), b, 4, T0), 'prep');
});

test('before the season starts there is nothing to be live about', () => {
    assert.equal(tickerPhase([], boot(), 4, Date.parse('2026-08-01T00:00:00Z')), 'prep');
});

/* ---- the score ---- */

const player = (id, teamId, pickPosition, extra = {}) => ({
    id, teamId, pickPosition, name: `P${id}`, position: 3, multiplier: 1, ...extra
});

test('the captain is counted twice and the bench not at all', () => {
    const squad = [
        player(1, 1, 1, { multiplier: 2, isCaptain: true }),
        player(2, 3, 2),
        player(3, 1, 12)                       // bench
    ];
    const live = { 1: { pts: 9, min: 90 }, 2: { pts: 5, min: 90 }, 3: { pts: 14, min: 90 } };
    const l = tickerLiveSquad(squad, live, round(4, DONE, DONE), 4);
    assert.equal(l.pts, 9 * 2 + 5);
    assert.equal(l.total, 2);
});

test('a player whose match is over is not "still to play", even with no minutes', () => {
    /* The bug this guards. An unused substitute never appears in the live feed,
       and counting every absent row as football still to come promised points
       that were never arriving. Spurs are done; City have not kicked off. */
    const squad = [
        player(1, 1, 1),      // played, finished match
        player(2, 2, 2),      // benched at his club, finished match
        player(3, 3, 3)       // City, not started
    ];
    const live = { 1: { pts: 6, min: 90 } };
    const l = tickerLiveSquad(squad, live, round(4, DONE, UNPLAYED), 4);
    assert.equal(l.pending, 1);
    assert.equal(l.pts, 6);
});

test('a double gameweek still counts while either match is outstanding', () => {
    const fx = [
        ...round(4, DONE, DONE),
        { id: 99, event: 4, team_h: 1, team_a: 3, ...UNPLAYED }
    ];
    const l = tickerLiveSquad([player(1, 1, 1)], { 1: { pts: 8, min: 90 } }, fx, 4);
    assert.equal(l.pending, 1);
});

test('a clean sheet is a return for a defender and not for a midfielder', () => {
    const live = { 1: { pts: 6, min: 90, cs: 1 }, 2: { pts: 2, min: 90, cs: 1 } };
    const squad = [
        player(1, 1, 1, { position: 2 }),      // defender
        player(2, 1, 2, { position: 3 })       // midfielder
    ];
    const l = tickerLiveSquad(squad, live, round(4, DONE, DONE), 4);
    /* Spread into a host array first. The script under test is evaluated in a
       vm, so anything it maps carries that sandbox's Array.prototype and
       deepEqual refuses it: "same structure but not reference-equal". */
    assert.deepEqual([...l.returns.map(r => r.name)], ['P1']);
});

/* ---- what each mode says ---- */

const text = items => items.map(h => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join(' | ');

const baseCtx = {
    currentGW: 4, deadlineGW: 5, deadlineTime: '2026-09-19T17:00:00Z',
    fixtures: round(4, DONE, UNPLAYED),
    squad: [player(1, 1, 1, { multiplier: 2, isCaptain: true }), player(2, 3, 2)],
    liveRows: { 1: { pts: 7, min: 90, g: 1 } },
    rank: 412553, rankDelta: 18422,
    leagueInfo: { name: 'Liga da Faaaantasy', rank: 2, lastRank: 3 },
    freeTransfers: 1, bank: 0.4,
    // Fixed so the countdown is not a different sentence every day the suite runs.
    now: Date.parse('2026-09-15T09:00:00Z')
};

test('live leads with the score and says how much is still to come', () => {
    const out = text(tickerItems({ ...baseCtx, phase: 'live' }));
    assert.match(out, /GW4 LIVE 14 pts/);
    assert.match(out, /P1 \(C\) 1 goal/);
    assert.match(out, /Still to play 1 of your XI/);
});

test('live says nothing about the market — that is a between-rounds question', () => {
    const out = text(tickerItems({ ...baseCtx, phase: 'live' }));
    assert.doesNotMatch(out, /deadline|Free transfers|bank/i);
});

test('results calls the score final and flags that bonus is not in yet', () => {
    const out = text(tickerItems({ ...baseCtx, phase: 'results', fixtures: round(4, DONE, DONE) }));
    assert.match(out, /GW4 FINAL 14 pts/);
    assert.match(out, /Bonus not yet final/);
    assert.match(out, /Overall rank .* 18,422/);
});

test('prep is the week ahead: deadline, ranks, transfers, money', () => {
    const out = text(tickerItems({ ...baseCtx, phase: 'prep' }));
    assert.match(out, /GW5 deadline in/);
    assert.match(out, /Overall rank 412,553/);
    assert.match(out, /Liga da Faaaantasy 2/);
    assert.match(out, /Free transfers 1/);
    assert.match(out, /In the bank £0.4m/);
});

test('prep warns about a doubt in the eleven and ignores one on the bench', () => {
    const ctx = {
        ...baseCtx, phase: 'prep',
        squad: [
            player(1, 1, 1, { status: 'd', chanceNextRound: 25 }),
            player(9, 1, 14, { status: 'i', chanceNextRound: 0, name: 'Benched' })
        ]
    };
    const out = text(tickerItems(ctx));
    assert.match(out, /P1 25% to play/);
    assert.doesNotMatch(out, /Benched/);
});

test('a missing mini-league or rank is left out rather than guessed at', () => {
    const out = text(tickerItems({
        ...baseCtx, phase: 'prep', leagueInfo: null, rank: null, rankDelta: null
    }));
    assert.doesNotMatch(out, /Overall rank/);
    assert.match(out, /Free transfers 1/);
});
