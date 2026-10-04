/* The Lineup Wizard, rebuilt around the two things that decide a lineup.

   The page used to open on a full-width pitch with Matchday and Captaincy
   folded into a tab strip beside it. They are sections of the page now, in the
   order the decision is made — what the eleven is worth, the matches, the
   armband, the squad — and the pitch is a small picture at the bottom.

   The test that matters most is the one about where Matchday gets its
   fixtures. It used to be built from data/odds.json, which prices whatever the
   bookmaker feed had published when the job last ran: for GW5 that is five of
   the ten scheduled matches, a fact the feed states about itself. Ten clubs
   therefore did not exist as far as the screen was concerned, and any player
   at one of them silently disappeared out of a fifteen-man squad. Nothing was
   mis-mapped; the spine was the wrong list. Fixtures are the spine now and the
   odds are a left join, so an unpriced match still shows its players.

   Note that isValidLWFormation cannot be stubbed: lineup-wizard.js declares it,
   and a declaration wins over anything the sandbox supplies. The illegal-swap
   case is therefore built out of real positions, which is the better test
   anyway. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load.mjs';
import fs from 'node:fs';
import path from 'node:path';
const read = f => fs.readFileSync(path.resolve(import.meta.dirname, '..', f), 'utf8');

/* GW5: two fixtures. Only the first is priced, which is the shape of the real
   feed — football-data.co.uk publishes a round in instalments. */
const FIXTURES = [
    { id: 101, event: 5, team_h: 1, team_a: 2, kickoff_time: '2026-09-19T14:00:00Z' },
    { id: 102, event: 5, team_h: 3, team_a: 4, kickoff_time: '2026-09-19T16:30:00Z' },
    // A club nobody in the squad plays for, and a fixture in another round.
    { id: 103, event: 5, team_h: 5, team_a: 6, kickoff_time: '2026-09-20T14:00:00Z' },
    { id: 999, event: 6, team_h: 1, team_a: 3, kickoff_time: '2026-09-27T14:00:00Z' }
];
const PRICED = [
    { fixtureId: 101, event: 5, homeId: 1, awayId: 2, home: 'ARS', away: 'CHE',
      lambdaHome: 1.8, lambdaAway: 0.9, csHome: 0.42, csAway: 0.18,
      over25: 0.54, under25: 0.46, bttsYes: 0.51,
      scorelines: [{ h: 2, a: 0, p: 0.12 }, { h: 1, a: 0, p: 0.11 }],
      market: { home: 0.6, draw: 0.23, away: 0.17 } }
];

function el() {
    return { innerHTML: '', textContent: '', style: {}, classList: { add() {}, remove() {} } };
}

/* lineup-wizard.js is page code: it reads a lot of globals that live on the My
   Team page. Everything it touches on the way to rendering the Overview is
   stubbed to the shape the real page supplies. */
function wizard(state) {
    const nodes = {};
    const ctx = {
        console,
        lineupState: state,
        document: {
            getElementById: id => (nodes[id] ||= el()),
            addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
            createElement: el, body: el()
        },
        localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        lucide: { createIcons() {} },
        setTimeout() {}, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
        escHTML: x => String(x == null ? '' : x),
        v2Icon: n => `<svg data-icon="${n}"></svg>`,
        planningGameweek: () => 5,
        xpPlanGWs: () => [5, 6, 7, 8, 9],
        XP_PLAN_HORIZON: 5,
        expectedMinutesModel: p => ({ pStart: p.pStart == null ? 1 : p.pStart }),
        optFdrFor: () => 3,
        optXpBreakdown: () => ({ parts: [{ key: 'Mins', v: 2 }, { key: 'Attack', v: 1.5 }] }),
        teams: { 1: { short_name: 'ARS', code: 3 }, 2: { short_name: 'CHE', code: 8 },
            3: { short_name: 'LIV', code: 14 }, 4: { short_name: 'EVE', code: 11 } },
        teamFixtures: {}, teamFixtures6: {}, teamAnalysis: {},
        POSITION_CONFIG: { 1: { class: 'gk', short: 'GK' }, 2: { class: 'def', short: 'DEF' },
            3: { class: 'mid', short: 'MID' }, 4: { class: 'fwd', short: 'FWD' } },
        v2IdentityHTML: () => '', buildOptimizeSummary: () => '', renderBOMatchdayPanel: () => 'ODDS',
        projectPlayerPointsDetailed: () => ({}), projectPlayerPointsForGW: () => 0,
        xpIsUnavailable: () => false, isPreseason: false, currentGW: 5, planningGW: 5,
        seasonStats: {}, positionAverages: { 1: {}, 2: {}, 3: {}, 4: {} },
        playersDetailData: {}, allPlayers: [], myTeamPlayers: [], bootstrapData: { elements: [] },
        formatPrice: v => String(v), POSITIONS: {}, chipState: {},
        renderPlayerProfileCard: () => '', pfFormWindow: () => null,
        compareReportHTML: () => '', optFixtureLabel: () => '-',
        fplTeamId: null, getStore: () => null, setStore() {}, showToast() {},
        openLineupOptimizeReport() {}, boMarketXGA: null,
        /* The Captaincy tab's inputs. opponentContext() is the only one whose
           shape matters to a test: ctx.matches gates the "concede X.X/game"
           row, which is the one fixture number the cards kept. */
        getDefensiveRanks: () => ({ rank: {}, total: 20 }),
        opponentContext: () => ({ matches: 5, conceded: 1.4, rank: 7, total: 20, ranked: true }),
        regressedPer90: () => ({ xg90: 0.4, xa90: 0.2 }),
        optMinutesRisk: () => ({ pct: 95, word: 'nailed', cls: 'ok' }),
        ordinal: n => String(n),
        /* Matchday's inputs. allFixtures is the round's real schedule; boOdds
           is the bookmaker feed, deliberately covering only SOME of it, which
           is the condition the old panel could not survive. */
        allFixtures: FIXTURES,
        boOdds: { matches: PRICED, metadata: { lastUpdated: new Date().toISOString(), source: 'football-data.co.uk' } },
        boBlendInfo: () => ({ active: true, event: 5, weight: 0.4, matchesPlayed: 5, priced: 1 }),
        boKickoff: () => 'Sat 15:00',
        boLoadOdds: () => Promise.resolve(null),
        getCleanSheetProb: () => 0.3,
        /* Lives in scripts/transfer-engine.js since the wizard split; the
           compare panel is the one thing here that reaches for it. */
        computeQuickLineupScoreDetailed: () => ({ total: 30, ep: 3, form: 4, fixture: 2,
            home: 1, xgi: 2, minutes: 3, ppg: 2, doubtful: 0, matchup: 1 })
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    ctx.__nodes = nodes;
    return loadScript('scripts/lineup-wizard.js', ctx);
}

const player = (id, name, score, pos) => ({
    id, web_name: name, lwScore: score, gwScore: score / 5, pos, teamId: 1, team: 'ARS',
    status: 'a', news: '', chanceNextRound: null, code: 1, price: 7.0, minutes: 900, starts: 10,
    xG: 1, xA: 1, xGI: 2, xGC: 0, bonus: 2, saves: 0, yellowCards: 0, redCards: 0,
    defCon: 0, defCon90: 0, penaltiesOrder: null, epNext: 0, form: '5.0', ownership: 10, ictIndex: 50,
    fixtures: [{ opponent: 'CHE', opponentId: 2, isHome: true, difficulty: 3 }]
});

function state(xi, bench, extra = {}) {
    return {
        xi, bench, squad: xi.concat(bench),
        captain: xi[0] ? xi[0].id : null, viceCaptain: null, formation: '3-4-3',
        selectedPlayers: [], excluded: new Set(), intelTab: 'overview',
        originalXIIds: new Set(xi.map(p => p.id)),
        originalCaptain: xi[0] ? xi[0].id : null, originalVC: null,
        swapSource: null, optimizeReport: null, undo: null, ...extra
    };
}

// 1-4-4-2. The weakest is a forward, so a bench midfielder can replace him and
// leave 1-4-5-1 — a legal shape, and therefore a real upgrade.
const XI_442 = [
    player(1, 'Keeper', 19, 1),
    ...[18, 17, 16, 15].map((v, n) => player(10 + n, `Def${n}`, v, 2)),
    ...[14, 13, 12, 11].map((v, n) => player(20 + n, `Mid${n}`, v, 3)),
    ...[10, 9].map((v, n) => player(30 + n, `Fwd${n}`, v, 4))
];


const STRONG_BENCH = [player(90, 'Szoboszlai', 30, 3), player(91, 'SubGK', 1, 1)];

/* ===== THE BUG: WHERE MATCHDAY GETS ITS FIXTURES ===== */

test('every squad player appears, including those whose match is not priced', () => {
    /* Two of the three GW5 fixtures carry squad players and only one of them is
       in the odds feed. Under the old odds-spined panel the unpriced one did
       not exist and its players vanished. */
    const xi = [player(1, 'Keeper', 19, 1),
        ...[18, 17, 16, 15].map((v, n) => ({ ...player(10 + n, `Def${n}`, v, 2), teamId: 2 })),
        ...[14, 13, 12, 11].map((v, n) => ({ ...player(20 + n, `Mid${n}`, v, 3), teamId: 3 })),
        ...[10, 9].map((v, n) => ({ ...player(30 + n, `Fwd${n}`, v, 4), teamId: 4 }))];
    // Eleven and four: a real squad, because the count is the point of the test.
    const bench = [{ ...player(90, 'Sub1', 8, 3), teamId: 3 }, { ...player(91, 'SubGK', 1, 1), teamId: 1 },
        { ...player(92, 'Sub2', 7, 2), teamId: 2 }, { ...player(93, 'Sub3', 6, 4), teamId: 4 }];
    const ctx = wizard(state(xi, bench));
    const rows = ctx.lwMatchdayRows();

    const seen = rows.flatMap(r => r.mine.map(m => m.p.id));
    assert.equal(seen.length, new Set(seen).size, 'nobody is counted twice');
    assert.equal(seen.length, 15, `all 15 should appear, got ${seen.length}`);

    const unpriced = rows.filter(r => !r.odds);
    assert.ok(unpriced.length, 'at least one fixture has no market price');
    assert.ok(unpriced.some(r => r.mine.length), 'and it still carries its players');
});

test('a fixture with none of my players is left out', () => {
    const xi = [player(1, 'Keeper', 19, 1),
        ...[18, 17, 16, 15].map((v, n) => ({ ...player(10 + n, `Def${n}`, v, 2), teamId: 1 })),
        ...[14, 13, 12, 11].map((v, n) => ({ ...player(20 + n, `Mid${n}`, v, 3), teamId: 1 })),
        ...[10, 9].map((v, n) => ({ ...player(30 + n, `Fwd${n}`, v, 4), teamId: 1 }))];
    const rows = wizard(state(xi, [])).lwMatchdayRows();
    // Everyone is at team 1, which plays only fixture 101 this round — so the
    // other two GW5 fixtures are dropped even though they exist.
    assert.equal(rows.length, 1);
    assert.equal(rows[0].f.id, 101);
});

test('only this gameweek, and in kickoff order', () => {
    const xi = [player(1, 'K', 19, 1), ...[18, 17, 16, 15].map((v, n) => ({ ...player(10 + n, `D${n}`, v, 2), teamId: 2 })),
        ...[14, 13, 12, 11].map((v, n) => ({ ...player(20 + n, `M${n}`, v, 3), teamId: 3 })),
        ...[10, 9].map((v, n) => ({ ...player(30 + n, `F${n}`, v, 4), teamId: 4 }))];
    const rows = wizard(state(xi, [])).lwMatchdayRows();
    assert.ok(rows.every(r => r.f.event === 5), 'no fixture from another round');
    const kos = rows.map(r => r.f.kickoff_time);
    assert.deepEqual(kos, [...kos].sort(), 'earliest first');
});

test('the odds are joined on fixtureId, not assumed', () => {
    const xi = [player(1, 'K', 19, 1), ...[18, 17, 16, 15].map((v, n) => ({ ...player(10 + n, `D${n}`, v, 2), teamId: 1 })),
        ...[14, 13, 12, 11].map((v, n) => ({ ...player(20 + n, `M${n}`, v, 3), teamId: 2 })),
        ...[10, 9].map((v, n) => ({ ...player(30 + n, `F${n}`, v, 4), teamId: 3 }))];
    const rows = wizard(state(xi, [])).lwMatchdayRows();
    const priced = rows.find(r => r.f.id === 101);
    assert.ok(priced && priced.odds, 'fixture 101 is in the feed');
    assert.equal(priced.odds.csHome, 0.42);
    const other = rows.find(r => r.f.id === 102);
    assert.ok(other && !other.odds, 'fixture 102 is not, and says so with null rather than guessing');
});

test('starters and bench are both present and told apart', () => {
    const xi = [player(1, 'K', 19, 1), ...[18, 17, 16, 15].map((v, n) => ({ ...player(10 + n, `D${n}`, v, 2), teamId: 1 })),
        ...[14, 13, 12, 11].map((v, n) => ({ ...player(20 + n, `M${n}`, v, 3), teamId: 1 })),
        ...[10, 9].map((v, n) => ({ ...player(30 + n, `F${n}`, v, 4), teamId: 1 }))];
    const bench = [{ ...player(90, 'Benchy', 8, 3), teamId: 1 }];
    const rows = wizard(state(xi, bench)).lwMatchdayRows();
    const mine = rows[0].mine;
    assert.ok(mine.some(m => m.starting), 'starters');
    assert.ok(mine.some(m => !m.starting), 'and substitutes');
    assert.ok(mine.findIndex(m => !m.starting) > mine.findIndex(m => m.starting), 'starters listed first');
});

/* ===== THE TWO CLEAN SHEET NUMBERS ===== */

test('both clean sheet numbers are labelled, not left as "x vs y"', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const cell = ctx.lwCsCell(1, 2, true, 0.42);
    assert.match(cell, /<em>Mkt<\/em>/, 'the market half is named');
    assert.match(cell, /<em>Ours<\/em>/, "and so is EasyFPL's");
    assert.match(cell, /42%/);
});

test('an unpriced fixture still shows our own number', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const cell = ctx.lwCsCell(1, 2, true, null);
    assert.match(cell, /is-none/, 'the market half is marked absent');
    assert.match(cell, /<em>Ours<\/em>/, 'ours is shown regardless');
});

test('a wide disagreement between market and model is marked', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    // getCleanSheetProb is stubbed at 0.30, so a market price of 0.55 is 25 points apart.
    assert.match(ctx.lwCsCell(1, 2, true, 0.55), /lwm-cs is-wide/);
    assert.doesNotMatch(ctx.lwCsCell(1, 2, true, 0.32), /is-wide/);
});

test('the section carries a legend, so the two numbers need no hover', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderMatchday();
    assert.match(html, /betting market/);
    assert.match(html, /EasyFPL model/);
    assert.match(html, /Starting/);
    assert.match(html, /Bench/);
});

/* ===== EVERY MARKET NUMBER THE OLD PANEL CARRIED =====

   The redesign kept the clean-sheet pair and the result bar and dropped the
   rest. They are back: a defender's owner is asking about the shape of the
   match, and "Over 2.5 54%, BTTS 51%, likeliest 2-0" is that question
   answered. */

test('a priced fixture shows each side its own expected goals', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderMatchday();
    assert.match(html, /lwm-sides/, 'a column per club');
    assert.match(html, /1\.80/, "the home side's goal expectation");
    assert.match(html, /0\.90/, "and the away side's");
    assert.match(html, /lwm-m-l">xG/, 'labelled, not left as a bare number');
});

test('the shape of the match is shown, not only the result', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderMatchday();
    assert.match(html, /Over 2\.5<\/em><b>54%/);
    assert.match(html, /BTTS<\/em><b>51%/);
    assert.match(html, /Likeliest<\/em><b>2\u20130/, 'and the single likeliest scoreline');
    assert.match(html, /Goals<\/em><b>2\.70/, 'with the total the two lambdas make');
});

test('an unpriced fixture says so rather than showing a blank row', () => {
    // One starter moved to a club whose GW5 fixture the feed has not priced.
    const xi = XI_442.map((p, i) => i === 5 ? { ...p, teamId: 3, team: 'LIV' } : p);
    const html = wizard(state(xi, STRONG_BENCH)).lwRenderMatchday();
    assert.match(html, /Not priced yet/);
    assert.match(html, /lwm-players/, 'and his name is still on the card');
});

test('the section says where its numbers come from and whether they are blended', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderMatchday();
    assert.match(html, /market weight 40%/, 'the blend is stated, not silent');
    assert.match(html, /Odds updated/);
    assert.match(html, /football-data\.co\.uk/, 'and the source is named');
});

/* ===== THE OVERVIEW ROW ===== */

test('the overview leads with the Squad Analysis KPI row', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderOverviewRow();
    assert.equal((html.match(/class="sq-kpi"/g) || []).length, 4, 'four tiles, same object as Squad Analysis');
    assert.match(html, /sq-kpi-icon tone-/);
});

/* The Overview was cut to four tiles once. These are the figures that went
   with them, and they are back: a tile reading "0 flagged" cannot tell you the
   eleven is three-deep on one club, or where half its points come from. */
test('the overview keeps every figure that described the eleven', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderOverviewRow();
    assert.match(html, /Nailed on/, 'how many starters are nailed on');
    assert.match(html, /Expected absent/);
    assert.match(html, /Avg FDR/);
    assert.match(html, /XI xP/);
    assert.match(html, /What the eleven face/, 'the fixture read');
    assert.match(html, /Key player decisions/, 'weakest starter against best substitute');
    assert.match(html, /Changes against your saved lineup/);
});

test('the swap offer only appears when the shape survives it', () => {
    // STRONG_BENCH holds a substitute who out-projects a starter in a legal shape.
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderOverviewRow();
    if (html.includes('lw-sum-apply')) assert.match(html, /lwApplySwap\(\d+, \d+\)/, 'the button names both players');
    else assert.match(html, /no legal formation|as good as the eleven gets|no swap to make/, 'or says why there is none');
});

test('the overview reports the gain against the live FPL eleven', () => {
    const moved = XI_442.slice(0, 10).concat([player(90, 'Szoboszlai', 30, 3)]);
    const st = state(moved, [player(31, 'Fwd1', 9, 4), player(91, 'SubGK', 1, 1)]);
    st.originalXIIds = new Set(XI_442.map(p => p.id));
    const ctx = wizard(st);
    assert.notEqual(ctx.lwLiveXP(), ctx.lwTotalXP());
    assert.match(ctx.lwRenderOverviewRow(), /vs your live team/);
});

test('no squad, no overview content', () => {
    // The mount point survives so refreshLWView() can find it; nothing else does.
    const html = wizard(state([], [])).lwRenderOverviewRow();
    assert.match(html, /id="lwKpis"/, 'the anchor the refresh replaces');
    assert.ok(!html.includes('sq-kpi'), 'and no tiles describing a squad that is not loaded');
});

/* ===== CAPTAINCY ===== */

test('captaincy is a ranked list with a reason tied to the fixture', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderCaptaincy();
    assert.equal((html.match(/lwc-row/g) || []).length, 5, 'five candidates');
    assert.match(html, /lwc-rank/);
    assert.match(html, /lwc-why/, 'each carries its reason');
    assert.match(html, /setLWCaptain/);
    assert.match(html, /setLWViceCaptain/);
});

test('the doubled figure is this gameweek doubled', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderCaptaincy();
    // Def0 leads on gwScore 3.6, so the card reads 7.2.
    assert.match(html, />7\.2</);
});

test('selecting players turns the captaincy column into the comparison', () => {
    const one = wizard(state(XI_442, STRONG_BENCH, { selectedPlayers: [1] })).lwRenderCaptaincy();
    assert.match(one, /is-compare/);
    assert.match(one, /Player detail/);
    assert.ok(!one.includes('lwc-row'), 'the ranked list stands aside');
    const two = wizard(state(XI_442, STRONG_BENCH, { selectedPlayers: [1, 10] })).lwRenderCaptaincy();
    assert.match(two, /Compare/);
});

/* The captaincy matrix was five cards wide and was cut to a bare list. The
   width was the problem, not the numbers — all of them are back, read down a
   column instead of across a grid. */
test('each candidate carries the numbers the armband is decided on', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).lwRenderCaptaincy();
    assert.match(html, /Threat/, 'how dangerous he is');
    assert.match(html, /Opponent/, 'and how leaky the defence he faces is');
    assert.match(html, /Form<\/em>/);
    assert.match(html, /Owned<\/em>/);
    assert.match(html, /Starts<\/em><b>95%/, 'minutes risk, as a number');
    assert.match(html, /concede 1\.4 a game/, 'the opponent in goals');
    assert.match(html, /lw-cap-fdr/, 'and the fixture, coloured by difficulty');
});

/* A pick the dataset does not know used to vanish without trace: map()
   returned null, filter(Boolean) swept it up, and a fifteen-man squad quietly
   became fourteen with no way to tell which man was gone. */
test('a pick missing from the dataset is reported, not swallowed', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH, { missingPicks: [31] }));
    const html = ctx.lwRenderOverviewRow();
    assert.match(html, /missing from the player dataset/);
    assert.match(html, /element 31/, 'and names which pick it was');
});

/* ===== SWAPPING, BY CLICK OR BY DRAG ===== */

test('a swap never loses a player', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const before = ctx.lineupState.squad.length;
    // Every pair, both directions.
    const all = [...XI_442, ...STRONG_BENCH].map(p => p.id);
    for (const a of all) for (const b of all) {
        ctx.lwSwapPlayers(a, b);
        const ids = new Set([...ctx.lineupState.xi, ...ctx.lineupState.bench].map(p => p.id));
        assert.equal(ctx.lineupState.xi.length, 11, `eleven starters after ${a}/${b}`);
        assert.equal(ids.size, before, `all ${before} still placed after ${a}/${b}`);
    }
});

test('an illegal shape is refused rather than half-applied', () => {
    // Swapping the only keeper out for an outfield substitute leaves no keeper.
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const gk = XI_442[0].id, sub = STRONG_BENCH.find(p => p.pos !== 1).id;
    assert.equal(ctx.lwSwapPlayers(gk, sub), 'illegal');
    assert.equal(ctx.lineupState.xi[0].id, gk, 'the keeper is still in the eleven');
});

/* The drag is pointer-based, not HTML5 drag-and-drop: that API never fires
   from a touchscreen, which would have put the feature out of reach of half
   the people using the page. */
test('the pitch offers drag as well as click, and says which drops are legal', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const card = ctx.lwCard(XI_442[5]);
    assert.match(card, /data-lw-id="\d+"/, 'so a drag can identify what it is over');
    assert.ok(!card.includes('draggable="true"'), 'not HTML5 drag-and-drop');
    assert.match(card, /onclick="handleLWSwapClick/, 'and clicking still swaps');
    // A midfielder for the bench midfielder keeps the shape; the keeper does not.
    const mid = XI_442.find(p => p.pos === 3).id;
    const benchMid = STRONG_BENCH.find(p => p.pos === 3);
    if (benchMid) assert.equal(ctx.lwSwapWouldWork(mid, benchMid.id), true);
    assert.equal(ctx.lwSwapWouldWork(XI_442[0].id, STRONG_BENCH.find(p => p.pos !== 1).id), false);
});

test('a drag that just ended does not also count as a click', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH, { dragJustEnded: true }));
    ctx.handleLWSwapClick(XI_442[3].id);
    assert.equal(ctx.lineupState.swapSource, null, 'the click is swallowed');
    assert.equal(ctx.lineupState.dragJustEnded, false, 'and the flag is spent');
    ctx.handleLWSwapClick(XI_442[3].id);
    assert.equal(ctx.lineupState.swapSource, XI_442[3].id, 'the next one is a real selection');
});

/* ===== THE PAGE ===== */

test('the page is the overview row and then the three panels', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    assert.ok(html.indexOf('lw-kpis') > -1 && html.indexOf('lw-main') > html.indexOf('lw-kpis'),
        'overview row leads');
    for (const slot of ['lw-slot-lineup', 'lw-slot-cap', 'lw-slot-md']) {
        assert.ok(html.includes(slot), `${slot} is present`);
    }
    /* Source order is fixed; which arrangement is in force is a class, so the
       mobile order is a property of the CSS areas rather than of the markup. */
    assert.ok(html.indexOf('lw-slot-lineup') < html.indexOf('lw-slot-cap'));
    assert.ok(html.indexOf('lw-slot-cap') < html.indexOf('lw-slot-md'));
    assert.match(html, /lw-main is-[ac]/, 'and a layout is chosen');
});

test('each of the three is a real panel, the one the rest of the site uses', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    // One .v2-section with a .section-header for lineup, captaincy and matchday.
    const panels = (html.match(/class="v2-section/g) || []).length;
    assert.ok(panels >= 3, `expected three panels, found ${panels}`);
    assert.ok((html.match(/class="section-header"/g) || []).length >= 3, 'each carries the shared header');
});

test('Auto-optimise belongs to the Lineup panel', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const panel = ctx.lwRenderLineupPanel();
    assert.match(panel, /resetLineupToOptimal/, 'the button is inside the panel it changes');
    assert.match(panel, /v2-section lw-pane-lineup/);
    assert.match(panel, /lwPitchField/, 'and the pitch is its content');
});

test('after optimising, the panel reports before, after and who moved', () => {
    const st = state(XI_442, STRONG_BENCH);
    st.optimizeReport = {
        beforeXP: 50.5, afterXP: 54.1, gain: 3.6,
        promoted: [player(90, 'Szoboszlai', 30, 3)],
        benchedOut: [{ player: player(31, 'Fwd1', 9, 4) }]
    };
    const strip = wizard(st).lwRenderOptimiseStrip();
    assert.match(strip, /50\.5/, 'the total before');
    assert.match(strip, /54\.1/, 'the total after');
    assert.match(strip, /\+3\.6/, 'and the gain');
    assert.match(strip, /Szoboszlai/, 'who came in');
    assert.match(strip, /Fwd1/, 'who went out');
});

test('a lineup that was already optimal says so instead of showing a zero', () => {
    const st = state(XI_442, STRONG_BENCH);
    st.optimizeReport = { beforeXP: 50, afterXP: 50, gain: 0, promoted: [], benchedOut: [] };
    assert.match(wizard(st).lwRenderOptimiseStrip(), /already the best available/);
});

test('the armband can be set from the pitch, on starters only', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const pitch = ctx.renderLWPitch();
    assert.match(pitch, /dp-arm-set/, 'the control is on the cards');
    assert.match(pitch, /setLWCaptain/);
    assert.match(pitch, /setLWViceCaptain/);
    // Ten outfield starters, two buttons each. The keeper and the bench cannot
    // hold an armband, so they get the read-only badge instead.
    assert.equal((pitch.match(/class="dp-arm[ "]/g) || []).length, 20);
});

test('the tab strip is gone', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    assert.ok(!html.includes('lw-intel-tab'), 'no tabs');
    assert.ok(!html.includes('setLWIntelTab'));
});

test('the comparison section is mounted and guarded', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    assert.ok(html.includes('lw-legacy'), 'the previous version has a home');
    assert.ok(html.includes('lwLegacyBody'), 'and a node of its own to paint into');
    // The mount is behind a window.lwLegacy check, so deleting the file cannot
    // break the live page.
    const src = read('scripts/lineup-wizard.js');
    assert.match(src, /if \(window\.lwLegacy\) window\.lwLegacy\.render\(\)/);
});

test('the header carries identity and actions, not a duplicate figure', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    assert.ok(!html.includes('id="lwTotal"'), 'the duplicated total is gone');
    assert.ok(html.includes('rc-btn primary'), 'the one primary action is filled');
    assert.ok(html.includes('id="lwFormation"'), 'the live-update hook must survive');
});
