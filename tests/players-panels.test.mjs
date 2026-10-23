/* Three reported defects on the Players and Teams pages.
 *
 * 1. Recommendations opened on "Budget" — a price band — so the first thing the
 *    page said about a position was its cheapest players, and the best player in
 *    it was behind a filter nobody had asked for. There is an "All" tier now and
 *    it is the default.
 *
 * 2. Purple Patch cannot say anything before eight gameweeks are played, and it
 *    drew its five position pills and its colour legend anyway — controls for a
 *    list that did not exist.
 *
 * 3. Fixture Swings listed clubs by the size of the swing, so the pivots ran
 *    GW10, GW13, GW10. A swing is a date; the list has to climb.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { loadFunction } from './helpers/load.mjs';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const CORE = 'scripts/players-core.js';
const TEAMS = 'fpl-teams-analysis.html';

/* ---- 1. the All tier ----------------------------------------------------- */

/* A player as the Recommendations panel sees him. `price` is what the tier
   split reads; l5 is the minutes gate every tier applies. */
const pl = (id, name, position, price) => ({
    id, name, position, price, selectedBy: 20,
    l5: { minutes: 450, games: 5 }
});

function recs(players, { tier = null } = {}) {
    const win = { _activeRecCat: tier ? { ALL: tier } : undefined };
    const fn = loadFunction(CORE, 'generatePositionRecs', {
        POSITIONS: { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' },
        isPlayerEligible: () => true,
        calculatePositionScore: (p) => p.price,          // dearest = best, to make the split visible
        getDisplayMetrics: () => ({}),
        getBudgetCap: () => 7.5,
        recCardList: (list) => list.map(p => `[${p.name}]`).join(''),
        window: win,
        activeGlobalPosition: 'ALL'
    });
    return fn('ALL', players, { budgetCap: null, metrics: [] });
}

// A cheap midfielder, a mid-price one and a premium, all playing full games.
const THREE = [pl(1, 'Cheap', 3, 4.5), pl(2, 'Mid', 3, 7.0), pl(3, 'Haaland', 3, 15.0)];

function panelOf(html, tier) {
    const m = new RegExp(`id="recCat-ALL-${tier}">([\\s\\S]*?)</div>`).exec(html);
    return m ? m[1] : null;
}

test('there is an All panel, and it holds every price', () => {
    const html = recs(THREE);
    const all = panelOf(html, 'all');
    assert.ok(all, 'the panel must exist');
    for (const name of ['Cheap', 'Mid', 'Haaland']) {
        assert.ok(all.includes(`[${name}]`), `${name} belongs in All`);
    }
});

test('All is the panel that opens, and the only one that does', () => {
    const html = recs(THREE);
    assert.match(html, /class="rec-category-panel active" id="recCat-ALL-all"/,
        'the All panel carries .active');
    const active = [...html.matchAll(/class="rec-category-panel active" id="recCat-ALL-(\w+)"/g)].map(m => m[1]);
    assert.deepEqual(active, ['all'], 'exactly one panel is open and it is All');
});

test('the price bands still exist and still split at the cap', () => {
    /* All is not a replacement for Budget and Premium — it is those two
       unsplit, and both must still work. */
    const html = recs(THREE);
    assert.ok(panelOf(html, 'budget').includes('[Cheap]'));
    assert.equal(panelOf(html, 'budget').includes('[Haaland]'), false, 'a £15.0m player is not budget');
    assert.ok(panelOf(html, 'premium').includes('[Haaland]'));
    assert.equal(panelOf(html, 'premium').includes('[Cheap]'), false);
});

test('All keeps the minutes gate, because that is not a price filter', () => {
    /* "Regardless of price" takes the price band off. It does not take off the
       rule that a recommendation has to be somebody who plays. */
    const benchwarmer = { ...pl(4, 'Benchwarmer', 3, 9.0), l5: { minutes: 100, games: 5 } };
    const all = panelOf(recs([...THREE, benchwarmer]), 'all');
    assert.equal(all.includes('[Benchwarmer]'), false, '20 minutes a game is not a recommendation');
});

test('a chosen tier still wins over the default', () => {
    const html = recs(THREE, { tier: 'differential' });
    assert.match(html, /class="rec-category-panel active" id="recCat-ALL-differential"/);
    assert.equal(/class="rec-category-panel active" id="recCat-ALL-all"/.test(html), false);
});

test('both places that decide the default agree on All', () => {
    /* The trap: recActiveTier()'s `|| 'all'` never fires once window
       ._activeRecCat exists, so the seed object is what actually decides. One
       changed without the other is a silent no-op. */
    const src = read(CORE);
    assert.match(src, /window\._activeRecCat = \{ ALL: 'all', GK: 'all', DEF: 'all', MID: 'all', FWD: 'all' \};/);
    assert.match(src, /\|\| 'all';\n\s*\}/, 'and the fallback agrees');
    assert.match(src, /\{ value: 'all', label: 'All'/, 'the menu offers it');
    assert.match(src, /\{ all: 'All', budget: 'Budget'/, 'and the closed menu can name it');
});

/* ---- 2. Purple Patch before it can work ---------------------------------- */

function tooEarly(played, demo = false) {
    return loadFunction(CORE, 'ppTooEarly', {
        seasonGamesPlayed: played,
        demoPreview: () => demo,
        PP_MIN_SEASON_GAMES: 8
    })();
}

test('Purple Patch knows when it cannot answer', () => {
    assert.equal(tooEarly(0), true);
    assert.equal(tooEarly(7), true, 'seven is not enough');
    assert.equal(tooEarly(8), false, 'eight is, and the board fills in at GW9');
    assert.equal(tooEarly(20), false);
});

test('a demo is never too early, because its thresholds are already scaled', () => {
    assert.equal(tooEarly(2, true), false);
});

test('the early-season panel explains and offers nothing to click', () => {
    const html = loadFunction(CORE, 'ppEarlySeasonPanel', {
        seasonGamesPlayed: 5,
        PP_MIN_SEASON_GAMES: 8,
        paIcon: () => ''
    })();
    assert.match(html, /needs 8 gameweeks and the season has played 5/);
    assert.match(html, /GW9/, 'it says when it will work');
    assert.match(html, /Rising Form/, 'and what to read instead today');
    // The mess being removed: controls for a list that does not exist.
    for (const control of ['pa-filter-pills', 'legend-toggle', 'ppLegend', 'sub-tab-panel']) {
        assert.equal(html.includes(control), false, `${control} has nothing to act on yet`);
    }
});

test('the panel branches before it builds any of that', () => {
    const src = read(CORE);
    const i = src.indexOf('if (ppTooEarly()) return ppEarlySeasonPanel();');
    const pills = src.indexOf('${paPositionPills()}', i);
    assert.ok(i > 0, 'the guard exists');
    assert.ok(pills > i, 'and it comes before the controls it is avoiding');
});

/* ---- 3. Fixture swings in time order ------------------------------------- */

/* The comparator itself, lifted out of the page. The builder around it reads
   the whole fixture list and cannot be run here; the ordering is the change. */
function swingComparator() {
    const src = read(TEAMS);
    const m = /return swings\.sort\((\(a, b\) => [\s\S]*?)\);/.exec(src);
    assert.ok(m, 'the sort should still be one expression on the swings array');
    // eslint-disable-next-line no-new-func
    return new Function(`return (${m[1]});`)();
}

test('swings climb from the nearest pivot, not from the biggest swing', () => {
    /* The reported order, with the magnitudes that produced it: Villa swung
       hardest, so a magnitude sort put its GW13 pivot between two GW10s. */
    const rows = [
        { teamName: 'Spurs', swingGW: 10, swing: 0.7 },
        { teamName: 'Villa', swingGW: 13, swing: 1.4 },
        { teamName: 'Everton', swingGW: 10, swing: 1.1 }
    ];
    const got = rows.slice().sort(swingComparator()).map(r => `${r.teamName}@${r.swingGW}`);
    assert.deepEqual(got, ['Everton@10', 'Spurs@10', 'Villa@13']);
});

test('inside one gameweek the biggest swing leads', () => {
    const rows = [
        { teamName: 'A', swingGW: 12, swing: 0.4 },
        { teamName: 'B', swingGW: 12, swing: -1.9 },
        { teamName: 'C', swingGW: 12, swing: 1.2 }
    ];
    assert.deepEqual(rows.slice().sort(swingComparator()).map(r => r.teamName), ['B', 'C', 'A'],
        'magnitude, so a hardening run sorts beside an easing one of the same size');
});

test('the order is total, so cards do not reshuffle between renders', () => {
    const rows = [
        { teamName: 'Zulu', swingGW: 9, swing: 1.0 },
        { teamName: 'Alpha', swingGW: 9, swing: 1.0 }
    ];
    const cmp = swingComparator();
    assert.deepEqual(rows.slice().sort(cmp).map(r => r.teamName), ['Alpha', 'Zulu']);
    assert.deepEqual(rows.slice().reverse().sort(cmp).map(r => r.teamName), ['Alpha', 'Zulu'],
        'same answer whatever order it arrives in');
});

/* ---- the dashboard, and the odds feed's own staleness -------------------- */

test('the transfer row names who goes, not who to buy', () => {
    /* It read "Szoboszlai → Mbeumo, Gvardiol → De Cuyper, Groß → Tavernier" in
       a lane called "Needs a look". Groß was there on 22 October with 58
       points and 8.3 a game, traded for a same-price midfielder with better
       underlying numbers and an easier run — a defensible proposal, and an
       accusation when it sits under that heading with an arrow after it. */
    const src = read('scripts/readiness.js');
    const rd = src.slice(src.indexOf("const rec = c.transferRec;"), src.indexOf("--- sell:"));
    assert.match(rd, /name: outs\.map\(p => p\.name\)\.join\(', '\)/, 'the out players alone');
    assert.equal(/\$\{m\.out\.name\} → \$\{m\.in\.name\}/.test(rd), false,
        'no incoming player is named on this row any more');
    assert.match(rd, /sellIds/, 'and the ones actually rated Sell lead it');
    assert.match(rd, /\$\{moves\.length\} move/,
        'the move count is stated, so one package gain is not read as per-player');
});

test('the dashboard ticker is gone, and took its five renderers with it', () => {
    const dash = read('scripts/index-dashboard.js');
    const page = read('index.html');
    for (const fn of ['function tickerPhase', 'function tickerNum', 'function tickerLiveSquad',
        'function tickerItems', 'function renderPriceTicker']) {
        assert.equal(dash.includes(fn), false, `${fn} should be deleted`);
    }
    assert.equal(page.includes('priceTickerBar'), false, 'and the bar is out of the markup');
    assert.equal(page.includes('priceTickerTrack'), false);
    /* The one that stays, and the reason it is easy to delete by mistake: the
       name says ticker and it builds the whole dashboard's analysisResults. */
    assert.match(dash, /function analyzePlayerForTicker/);
    assert.match(dash, /squad\.map\(p => analyzePlayerForTicker\(/);
});

test('the odds feed records when ITS file was written, not just when we fetched', () => {
    const tool = read('tools/fetch-odds.mjs');
    assert.match(tool, /sourceUpdated = res\.headers\.get\('last-modified'\)/,
        'read off the response, because the file can be older than the fetch');
    assert.match(tool, /sourceUpdated: sourceUpdated \? new Date\(sourceUpdated\)\.toISOString\(\) : null/);
    assert.match(tool, /const FIXTURES_URL = 'https:\/\/football-data\.co\.uk\/fixtures\.csv';/,
        'and the apex, so the fetch does not depend on a redirect');
});

test('an unpriced round no longer claims a publishing schedule', () => {
    /* The old line asserted the odds "appear mid-week". On Thursday 22 October,
       with GW8 starting the next day, their file had not moved since Tuesday
       10:57 and held only matches already played. */
    /* Comments stripped: the sentence is quoted in the note that records why
       it went, and a check that cannot tell prose from output would forbid
       writing the reason down. */
    const src = stripComments(read('scripts/lineup-wizard.js'));
    assert.equal(src.includes("so these appear mid-week"), false);
    const fn = src.slice(src.indexOf('function lwNoPricesLine'));
    assert.match(fn, /meta\.sourceUpdated/, 'it reads the feed file date');
    assert.match(fn, /has not been updated since/, 'and can say the feed itself is stale');
    assert.match(fn, /nothing on this page depends on the market/,
        'while making clear the page still works');
});

/* ---- 4. Rising Form: a tile per signal ---------------------------------- */

/* Each signal was three rows — a label, a 60px bar under it, and the detail on
   a line of its own — so a six-signal card ran to eighteen rows. Reported as
   "each player signals are waaaay too long". Then it was one line each on a
   grey bar, and six of those stacked were reported as looking "like an excel
   sheet". It is a tile now: the signal's colour on a disc behind its icon, the
   figure that moved set large, and what it is under it. No bar of any kind. */

function risingCard(signals) {
    return loadFunction(CORE, 'renderRisingCard', {
        v2PlayerHeroHTML: () => '<!--hero-->',
        getStarHtml: () => '',
        p: undefined,
        escHTML: s => String(s)
    })({
        id: 7, pos: 'MID', signalCount: signals.length, signals,
        fdrNear: 2.4, avgFDR: 2.4
    }, 1);
}

const SIGNALS = [
    { label: 'Points trending up', detail: '1.0 → 5.7 pts/g', stat: '1.0 → 5.7', unit: 'pts a game',
        icon: 'flame', strength: 8, color: '#FB923C' },
    { label: 'Under the radar', detail: '4.1% owned', stat: '4.1%', unit: 'owned',
        icon: 'eye-off', strength: 9, color: '#F472B6' }
];

test('a signal is a tile: coloured icon, what moved, the figure large, its units', () => {
    const html = risingCard(SIGNALS);
    const tiles = [...html.matchAll(/<div class="rising-signal"([\s\S]*?)<\/div>/g)].map(m => m[1]);
    assert.equal(tiles.length, 2, 'one element per signal');
    for (const t of tiles) {
        assert.match(t, /rising-signal-icon[\s\S]*rising-signal-label[\s\S]*rising-signal-stat[\s\S]*rising-signal-unit/,
            'icon, what moved, the figure, then its units — in that order');
    }
    assert.match(tiles[0], /--sig:#FB923C/, 'the tile wears its signal\u2019s colour');
    assert.match(tiles[0], /1\.0 <i class="rising-signal-arrow">→<\/i> 5\.7/);
    assert.match(tiles[0], /data-tooltip="Points trending up: 1\.0 → 5\.7 pts\/g"/,
        'the full sentence is still there, on hover');
});

test('no bars, and nothing reads s.strength', () => {
    const html = risingCard(SIGNALS);
    for (const cls of ['rising-signal-bar', 'rising-signal-bar-fill', 'rising-signal-head', 'rising-signal-value']) {
        assert.equal(html.includes(cls), false, `${cls} should not be rendered`);
    }
    assert.equal(html.includes('strength'), false);
});

test('the stylesheet lays the tiles two to a row, with no bar behind them', () => {
    const css = read('styles/players.css');
    const grid = /\.rising-signals \{([^}]*)\}/.exec(css);
    assert.match(grid[1], /grid-template-columns: repeat\(2/);
    const tile = /\.rising-signal \{([^}]*)\}/.exec(css);
    assert.ok(tile, '.rising-signal must still have a rule');
    assert.equal(/background/.test(tile[1]), false, 'the grey bar behind each signal is gone');
    assert.equal(css.includes('.rising-signal-bar'), false);
});

test('every signal Rising Form can raise has a headline figure', () => {
    const src = read('scripts/form-trend.js');
    const pushes = src.split('signals.push(').length - 1;
    const stats = (src.match(/\bstat: /g) || []).length;
    assert.equal(stats, pushes, 'a signal without `stat` falls back to its whole sentence in large type');
});

/* ---- 1. the Teams ranked card loses its conversion rows ----------------- */

test('the ranked club card no longer restates xG against goals', () => {
    /* "2.20 xG → 2.71 scored +0.52" and the conceding row under it. Both
       columns directly above the row already carry xG/game and goals/game. */
    const page = read(TEAMS);
    assert.equal(page.includes('tsb-conversion'), false, 'the row is gone from the card');
    assert.equal(/const conversion = /.test(page), false, 'and the variable that built it');
    assert.equal(/\$\{conversion\}/.test(page), false, 'and the slot it was dropped into');
});

test('but the club modal keeps the same comparison over the last five', () => {
    /* renderXgVsActual() is shared. There the gap IS the point — it is not
       repeating two figures printed an inch above it. */
    const page = read(TEAMS);
    assert.match(page, /function renderXgVsActual\(/, 'the helper stays');
    const calls = (page.match(/\$\{renderXgVsActual\(/g) || []).length;
    assert.equal(calls, 2, 'called twice, both in the modal');
    assert.match(page, /renderXgVsActual\('Scored'/);
    assert.match(page, /renderXgVsActual\('Conceded'/);
});
