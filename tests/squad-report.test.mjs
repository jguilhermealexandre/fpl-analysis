/* The squad report, which is the easiest place on the site to lie by accident.

   Every other surface prints a number next to its own label. This one writes
   sentences about a manager's players, which means a missing value does not
   render as a blank cell — it renders as a confident claim with a hole in it,
   or worse, as a default that reads exactly like a measurement. So what is
   tested here is mostly what the report REFUSES to say:

     - no chance-of-playing figure invented when FPL published none
     - no median quoted for a position that has none configured
     - no second clean-sheet-style restatement of a figure already on the line
     - no section at all when its category is empty
     - no differential counted on the bench, where it cannot gain anyone rank

   The arithmetic behind it is computeSquadHealth's and is tested through that.
   What is new here is the writing, and the writing is where the trust goes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/team-analysis-core.js';
const OWN = 10;                     // SQR_DIFFERENTIAL_OWNERSHIP

const POSITION_CONFIG = {
    1: { name: 'Goalkeeper', short: 'GK', class: 'gk', formMedian: 3.0 },
    2: { name: 'Defender', short: 'DEF', class: 'def', formMedian: 3.5 },
    3: { name: 'Midfielder', short: 'MID', class: 'mid', formMedian: 4.0 },
    4: { name: 'Forward', short: 'FWD', class: 'fwd', formMedian: 4.5 }
};
const escHTML = s => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const v2Icon = name => `<svg data-icon="${name}"></svg>`;

const sqrJoin = loadFunction(SRC, 'sqrJoin');
const sqrPos = loadFunction(SRC, 'sqrPos', { POSITION_CONFIG });
const sqrWho = loadFunction(SRC, 'sqrWho', { escHTML, sqrPos });
const sqrItem = loadFunction(SRC, 'sqrItem');
const sqrSection = loadFunction(SRC, 'sqrSection', { escHTML, v2Icon });
const computeSquadHealth = loadFunction(SRC, 'computeSquadHealth');

/* The two visuals. Both are loaded for real rather than stubbed out, because
   each is markup built from a value and getting the value wrong is exactly the
   failure this file exists to catch. sqrSpark reads the page's
   playersDetailData, so it is rebuilt per case by sparkWith() below; the shared
   one here has no history for anybody, which is the common case in these
   fixtures and must render as nothing rather than as a flat line at zero. */
const sqrHistoryRows = loadFunction(SRC, 'sqrHistoryRows', { playersDetailData: null });
const sqrSpark = loadFunction(SRC, 'sqrSpark', { sqrHistoryRows, SQR_SPARK_WEEKS: 6 });
const sqrFdrStrip = loadFunction(SRC, 'sqrFdrStrip', { escHTML });
/* squadFixtureLoad is stubbed per case by withLoad() below rather than loaded —
   what it computes is tested in tests/blank-double-gw.test.mjs, and what matters
   here is only how the report writes up each of its three answers. */

/* price-watch.js, which the squad page loads beside this file. Stubbed at its
   real boundary — pwClassify's contract is "null unless the player is worth
   mentioning" — so the report is tested against that contract rather than
   against a reimplementation of the meter. */
const PW_CLOSE = 80, PW_DUE = 100;
const pwClassify = (p, floor) => {
    const mag = Math.abs(p.priceProgress || 0);
    if (!mag || mag < floor) return null;
    return { id: p.id, player: p, dir: p.priceProgress > 0 ? 'rise' : 'fall',
        tier: mag >= PW_DUE ? 'due' : 'close', progress: p.priceProgress, projected: p.priceProgress };
};
const pwLabel = c => (c.tier === 'due'
    ? (c.dir === 'rise' ? 'Rise due' : 'Drop due')
    : `${Math.round(Math.abs(c.progress))}% there`);
const pwDetail = c => (c.tier === 'due'
    ? `The meter is full, so this ${c.dir === 'rise' ? 'rise' : 'drop'} happens at the next daily price update.`
    : `${Math.round(Math.abs(c.progress))}% of the way, and not projected to cross yet.`);

const renderSquadReport = loadFunction(SRC, 'renderSquadReport', {
    escHTML, v2Icon, sqrJoin, sqrPos, sqrWho, sqrItem, sqrSection,
    sqrSpark, sqrFdrStrip, pwLabel, pwDetail,
    SQR_DIFFERENTIAL_OWNERSHIP: OWN
});

/* buildSquadReport reads the page's `analysisResults`, so it gets a fresh
   context per case rather than a mutable one shared between them. */
function buildWith(results, extra = {}) {
    const fn = loadFunction(SRC, 'buildSquadReport', {
        analysisResults: results, computeSquadHealth,
        SQR_DIFFERENTIAL_OWNERSHIP: OWN,
        SQR_FIXTURE_HORIZON: 8, planningGW: 6,
        pwClassify, PW_CLOSE,
        ...extra
    });
    return fn();
}

const player = (o = {}) => ({
    id: 1, name: 'X', position: 3, ownership: 50, status: 'a', news: '',
    chanceNextRound: null, onBench: false, isCaptain: false, avgFDR: 3, ...o
});
const analysis = (o = {}) => {
    const out = {
        verdict: 'hold', verdictReason: '', sellRating: 40,
        availPenalty: 0, formPenalty: 0, effectiveForm: 5, rawForm: 5,
        fixtures: [{ opponent: 'ARS', isHome: false, difficulty: 3, event: 6 }],
        ...o
    };
    // After the spread, or a caller passing a partial player would replace the
    // filled-in one rather than extend it.
    out.player = player(o.player || {});
    return out;
};
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const report = results => text(renderSquadReport(buildWith(results)));

/* ---- what it says when there is nothing to say ---- */

test('a squad with nothing flagged says so, and drops every empty section', () => {
    const clean = Array.from({ length: 11 }, (_, i) =>
        analysis({ player: { id: i, name: `Clean${i}` } }));
    const out = report(clean);
    assert.match(out, /Nothing is flagged against any of your 11 starters/);
    for (const section of ['Availability', 'Out of form', 'The hard run', 'Sell (']) {
        assert.ok(!out.includes(section), `${section} should not render for a clean squad`);
    }
    // Differentials is the one section that is always worth stating, because
    // "none" is itself the finding.
    assert.match(out, /Differentials/);
});

test('an empty squad says so instead of throwing', () => {
    assert.match(text(renderSquadReport(buildWith([]))), /No squad loaded/);
});

/* ---- availability, where the defaults would be lies ---- */

test('a doubt with no published chance does not get given one', () => {
    /* analyzePlayer falls back to "75% chance" when FPL has published nothing,
       which is fine next to a concern chip and not fine in a sentence that
       reads as a measurement. The number is FPL's or it is absent. */
    const out = report([analysis({ player: { status: 'd', name: 'Mystery', news: '', chanceNextRound: null } })]);
    assert.ok(!out.includes('75%'), 'no invented chance figure');
    assert.match(out, /no detail published/);
});

test('the chance is not printed twice when FPL already wrote it into the news', () => {
    /* The real string on Konsa, GW6: "Unspecified injury - 75% chance of
       playing". Printing our own "75% chance of playing." beside it said the
       same thing twice on one line. */
    const out = report([analysis({
        player: { status: 'd', name: 'Konsa', news: 'Unspecified injury - 75% chance of playing', chanceNextRound: 75 }
    })]);
    assert.equal(out.match(/75% chance of playing/g).length, 1);
});

test('the chance is printed when the news does not carry it', () => {
    const out = report([analysis({
        player: { status: 'i', name: 'Hurt', news: 'Hamstring injury', chanceNextRound: 0 }
    })]);
    assert.match(out, /Hurt \(MID\) — Injured\./);
    assert.match(out, /0% chance of playing/);
    assert.match(out, /Hamstring injury/);
});

/* ---- form, and not contradicting the player's own card ---- */

test('both form figures appear when the regression moved the number', () => {
    /* The card prints the raw form and the verdict is reached on the regressed
       one. Printing only the second puts a figure in the report that disagrees
       with the figure on the player's card, for no reason the reader can see. */
    const out = report([analysis({ player: { name: 'Reg' }, rawForm: 0.5, effectiveForm: 2.0 })]);
    assert.match(out, /form 0\.5, judged at 2\.0 once regressed/);
    assert.match(out, /against a MID median of 4/);
});

test('one figure appears when the two agree', () => {
    const out = report([analysis({ player: { name: 'Same' }, rawForm: 2.0, effectiveForm: 2.0 })]);
    assert.match(out, /form 2\.0, against a MID median/);
    assert.ok(!out.includes('judged at'));
});

/* ---- differentials ---- */

test('a differential on the bench is not counted', () => {
    /* It cannot gain anyone rank from there, so counting it would overstate how
       different the team actually is. Measured against the real squad on
       2026-10-07: Egan at 7.0% was the only sub-10% player and was benched, so
       the honest answer for that team is none. */
    const out = report([
        analysis({ player: { id: 1, name: 'Pop', ownership: 40 } }),
        analysis({ player: { id: 2, name: 'BenchDiff', ownership: 2, onBench: true } })
    ]);
    assert.match(out, /None of your 1 starters is owned by under 10%/);
});

test('a starting differential is counted, with the threshold in the sentence', () => {
    /* The threshold is stated because there are five of them in this codebase
       (8, 10, 12 on effective ownership, 15) and a count with an unstated
       cut-off is not something a reader can check. */
    const out = report([analysis({ player: { name: 'Spicy', ownership: 4.2 } })]);
    assert.match(out, /1 of your 1 starters is owned by under 10%: Spicy \(4\.2%\)/);
});

/* ---- who it is talking about ---- */

test('a bench player carrying a verdict is marked as bench', () => {
    const out = report([analysis({
        player: { name: 'Benchy', onBench: true }, verdict: 'sell', verdictReason: 'Not playing'
    })]);
    assert.match(out, /Benchy \(MID · bench\)/);
});

test('the captain is named as the captain', () => {
    const out = report([analysis({
        player: { name: 'Haaland', position: 4, isCaptain: true }, verdict: 'star', verdictReason: 'Elite form'
    })]);
    assert.match(out, /Haaland \(FWD · captain\)/);
});

test('the verdict reason is the engine\'s own, not a second one written here', () => {
    const out = report([analysis({
        player: { name: 'Wissa', position: 4 }, verdict: 'sell',
        verdictReason: 'Form 1.0 is well below the FWD median'
    })]);
    assert.match(out, /Form 1\.0 is well below the FWD median/);
});

/* ---- the list joiner ---- */

test('lists read as English', () => {
    assert.equal(sqrJoin([]), '');
    assert.equal(sqrJoin(['a']), 'a');
    assert.equal(sqrJoin(['a', 'b']), 'a and b');
    assert.equal(sqrJoin(['a', 'b', 'c']), 'a, b and c');
});

/* ---- escaping ---- */

test('a name or a news string is escaped, not interpolated', () => {
    /* player.name and player.news both come from the FPL API, which is not
       ours. This report interpolates both into markup. */
    const html = renderSquadReport(buildWith([analysis({
        player: { name: '<img src=x onerror=alert(1)>', status: 'd', news: '<script>bad()</script>', chanceNextRound: 50 }
    })]));
    assert.ok(!html.includes('<img src=x'), 'name must not survive as markup');
    assert.ok(!html.includes('<script>bad()'), 'news must not survive as markup');
    assert.match(html, /&lt;img/);
});

/* ---- an unconfigured position degrades rather than breaks ---- */

/* ---- price watch, where the two tiers must never blur ---- */

test('a full meter says the change happens at the next update', () => {
    const out = report([analysis({
        player: { name: 'Climber', price: 7.5, priceProgress: 100 }, verdict: 'hold'
    })]);
    assert.match(out, /Price watch/);
    assert.match(out, /Climber/);
    assert.match(out, /Rise due/);
    assert.match(out, /next daily price update/);
});

test('a player short of the line is never told he moves tonight', () => {
    /* Measured over a real overnight window, the game's own next-day projection
       flagged nineteen players to catch four actual changes. The second tier is a
       watch item and the copy may not promise a night. */
    const out = report([analysis({
        player: { name: 'Nearly', price: 5.0, priceProgress: -87 }, verdict: 'hold'
    })]);
    assert.match(out, /87% there/);
    assert.ok(!/tonight/i.test(out), 'no promise of tonight for a watch item');
    assert.ok(!/next daily price update/.test(out), 'that sentence belongs to the full meter only');
});

test('nobody near a change means no price section at all', () => {
    const out = report([analysis({ player: { name: 'Still', price: 5.0, priceProgress: 12 } })]);
    assert.ok(!out.includes('Price watch'));
});

test('a drop on a player already listed to sell is called a timing question', () => {
    /* The one clause that reads the sell list, and it adds no new judgement — the
       0.1 goes one way or the other purely on whether the move happens before the
       update. */
    const out = report([analysis({
        player: { name: 'Dumper', price: 6.0, priceProgress: -100 },
        verdict: 'sell', verdictReason: 'Out of form'
    })]);
    assert.match(out, /timing question/);
    assert.match(out, /keeps the 0\.1/);
});

test('a rising player you are holding gets no timing clause', () => {
    const out = report([analysis({
        player: { name: 'Riser', price: 6.0, priceProgress: 100 }, verdict: 'hold'
    })]);
    assert.match(out, /Rise due/);
    assert.ok(!out.includes('timing question'));
});

/* ---- blanks and doubles ---- */

const withLoad = (results, fixtureLoad) =>
    text(renderSquadReport(buildWith(results, {
        squadFixtureLoad: () => fixtureLoad, planningGW: 6, SQR_FIXTURE_HORIZON: 8
    })));

test('a clean fixture window says so, and says why it may not stay clean', () => {
    /* The one section here that speaks when it has found nothing. "No blanks are
       scheduled" is the answer to a question asked before spending a chip, and an
       absent section would be indistinguishable from a broken one. What it must
       not do is imply a clean list stays clean. */
    const out = withLoad([analysis({ player: { name: 'A' } })], {
        from: 6, to: 13, examined: 8, squadSize: 15, blanks: [], doubles: [], clean: true
    });
    assert.match(out, /Blanks and doubles/);
    assert.match(out, /GW6.GW13/);
    assert.match(out, /exactly one fixture every week/);
    assert.match(out, /cup tie/, 'the reason it is clean in October');
});

test('a blank names the players and the gameweek, and the heading carries the window', () => {
    const out = withLoad([analysis({ player: { name: 'A' } })], {
        from: 6, to: 13, examined: 8, squadSize: 15, clean: false, doubles: [],
        blanks: [{ gw: 9, players: [{ name: 'Saka' }, { name: 'Rice' }] }]
    });
    assert.match(out, /Blanks and doubles \(GW6.GW13\)/);
    assert.match(out, /GW9 is a blank for 2 of your 15: Saka and Rice/);
    assert.match(out, /No fixture at all/);
});

test('a long list of affected players is cut short rather than printed whole', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `P${i}` }));
    const out = withLoad([analysis({ player: { name: 'A' } })], {
        from: 6, to: 13, examined: 8, squadSize: 15, clean: false, blanks: [],
        doubles: [{ gw: 11, players: many }]
    });
    assert.match(out, /and 3 more/);
    assert.ok(!out.includes('P8'), 'the tail is summarised, not listed');
});

test('no fixture data at all means no section, not a clean one', () => {
    const out = text(renderSquadReport(buildWith([analysis({ player: { name: 'A' } })])));
    assert.ok(!out.includes('Blanks and doubles'),
        'silence is right when the fixture list cannot answer');
});

/* ---- the two visuals ---- */

test('the sparkline draws one bar per gameweek and marks the weeks he did not play', () => {
    const spark = loadFunction(SRC, 'sqrSpark', {
        SQR_SPARK_WEEKS: 6,
        sqrHistoryRows: () => [
            { round: 1, total_points: 9, minutes: 90 },
            { round: 2, total_points: 2, minutes: 90 },
            { round: 3, total_points: 0, minutes: 0 }
        ]
    });
    const html = spark({ id: 1 });
    assert.equal((html.match(/<i /g) || []).length, 3);
    assert.match(html, /twf-sp haul/, 'nine points is a haul');
    assert.match(html, /twf-sp out/, 'no minutes is a week he did not play');
    assert.match(html, /GW3: did not play/);
});

test('the sparkline draws nothing rather than a flat line when there is no history', () => {
    /* A row of zero-height bars reads as a measured run of blanks. */
    const spark = loadFunction(SRC, 'sqrSpark', { SQR_SPARK_WEEKS: 6, sqrHistoryRows: () => [] });
    assert.equal(spark({ id: 1 }), '');
});

test('a quiet run is not stretched to look like a good one', () => {
    /* The scale has a floor, so two points out of a possible six draws short. */
    const spark = loadFunction(SRC, 'sqrSpark', {
        SQR_SPARK_WEEKS: 6,
        sqrHistoryRows: () => [{ round: 1, total_points: 2, minutes: 90 }]
    });
    const pct = Number(/height:([\d.]+)%/.exec(spark({ id: 1 }))[1]);
    assert.ok(pct < 50, `a two-point week drew at ${pct}%`);
});

test('the FDR strip carries one badge per fixture, coloured by difficulty', () => {
    const strip = loadFunction(SRC, 'sqrFdrStrip', { escHTML });
    const html = strip([
        { opponent: 'MCI', isHome: false, difficulty: 5, event: 6 },
        { opponent: 'BUR', isHome: true, difficulty: 2, event: 7 }
    ]);
    assert.match(html, /fdr-5/);
    assert.match(html, /fdr-2/);
    assert.match(html, /MCI \(A\)/, 'away is marked on the badge');
    assert.match(html, /BUR \(H\)/, 'and so is home — an unmarked badge asks the reader to infer');
    assert.match(html, /difficulty 5 of 5/);
    assert.equal(strip([]), '', 'no fixtures, no strip');
    assert.equal(strip(null), '');
});

test('a fixture with no difficulty still renders, in the middle band', () => {
    const strip = loadFunction(SRC, 'sqrFdrStrip', { escHTML });
    const html = strip([{ opponent: 'TBC', isHome: true }]);
    assert.match(html, /fdr-3/);
    assert.ok(!html.includes('undefined'));
    assert.ok(!html.includes('NaN'));
});

test('an opponent name is escaped on the badge as well as in the prose', () => {
    const strip = loadFunction(SRC, 'sqrFdrStrip', { escHTML });
    const html = strip([{ opponent: '"><img src=x>', isHome: true, difficulty: 3 }]);
    assert.ok(!html.includes('<img src=x'));
    assert.match(html, /&quot;&gt;&lt;img/);
});

test('a position with no config does not produce the word undefined', () => {
    /* Carries a verdict so that it actually appears: a hold with nothing
       flagged against it is in no section of the report at all, which is the
       point of the report but makes it a poor fixture for this check. */
    const out = report([analysis({
        player: { name: 'Odd', position: 99 }, verdict: 'sell', verdictReason: 'Reason'
    })]);
    assert.match(out, /Odd \(\?\)/);
    assert.ok(!out.includes('undefined'));
    assert.ok(!out.includes('NaN'));
});
