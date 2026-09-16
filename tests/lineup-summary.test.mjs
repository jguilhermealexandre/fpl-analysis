/* The Lineup Wizard's Overview panel.

   Two cards became one. The weakest starter and the strongest substitute were
   drawn as separate blocks, but they are a single question — is there a swap to
   make? — and the answer was already computed from both of them together. Asked
   twice, the two notes had to hedge around each other: one could say "nothing on
   the bench beats them in a legal formation" while the other said "out-projects
   a starter", which are both true and read as a contradiction.

   The merged note has four branches and only one of them is the happy path, so
   they are worth pinning down. Note that isValidLWFormation cannot be stubbed:
   lineup-wizard.js declares it, and a declaration wins over anything the sandbox
   supplies. The illegal-swap case is therefore built out of real positions,
   which is the better test anyway.

   The other change here is where the projected total lives. It was rendered
   twice from the same lwTotalXP() call — a chip in the command-centre header and
   a hero inside this panel — so one figure appeared in two places. The chip is
   gone and the hero moved above the tabs, because leaving it inside the Overview
   would have hidden the page's headline number behind the Captaincy tab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScript } from './helpers/load.mjs';

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
        teams: { 1: { short_name: 'ARS' } },
        teamFixtures: {}, teamFixtures6: {}, teamAnalysis: {},
        POSITION_CONFIG: { 1: { class: 'gk' }, 2: { class: 'def' }, 3: { class: 'mid' }, 4: { class: 'fwd' } },
        v2IdentityHTML: () => '', buildOptimizeSummary: () => '', renderBOMatchdayPanel: () => 'ODDS',
        projectPlayerPointsDetailed: () => ({}), projectPlayerPointsForGW: () => 0,
        xpIsUnavailable: () => false, isPreseason: false, currentGW: 5, planningGW: 5,
        allFixtures: [], seasonStats: {}, positionAverages: { 1: {}, 2: {}, 3: {}, 4: {} },
        playersDetailData: {}, allPlayers: [], myTeamPlayers: [], bootstrapData: { elements: [] },
        formatPrice: v => String(v), POSITIONS: {}, chipState: {},
        renderPlayerProfileCard: () => '', pfFormWindow: () => null,
        compareReportHTML: () => '', optFixtureLabel: () => '-',
        fplTeamId: null, getStore: () => null, setStore() {}, showToast() {},
        openLineupOptimizeReport() {}, boMarketXGA: null
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
    defCon: 0, defCon90: 0, penaltiesOrder: null, epNext: 0, form: '5.0', ownership: 10,
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

// 1-3-5-2 with the weakest a defender. Swapping him for the bench midfielder
// would leave two defenders and six midfielders — illegal on both counts.
const XI_352 = [
    player(1, 'Keeper', 15, 1),
    ...[5, 6, 7].map((v, n) => player(10 + n, `Def${n}`, v, 2)),
    ...[10, 11, 12, 13, 14].map((v, n) => player(20 + n, `Mid${n}`, v, 3)),
    ...[8, 9].map((v, n) => player(30 + n, `Fwd${n}`, v, 4))
];

const STRONG_BENCH = [player(90, 'Szoboszlai', 30, 3), player(91, 'SubGK', 1, 1)];
const WEAK_BENCH = [player(92, 'Weakling', 0.5, 3), player(91, 'SubGK', 1, 1)];
const GK_ONLY_BENCH = [player(91, 'SubGK', 1, 1)];

test('the weakest starter and the best substitute share one card', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('Key player decisions'));
    assert.ok(html.includes('lw-sum-duo'), 'the two sit side by side');
    assert.ok(!html.includes('Weakest link in the XI'), 'the old pair is gone');
    assert.ok(!html.includes('Strongest player on the bench'));
    // Three blocks where there were four: points-source, fixtures, decisions.
    assert.equal(html.match(/lw-sum-block/g).length, 3);
});

test('a legal upgrade offers the swap', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('Make the swap'));
    assert.ok(html.includes('Szoboszlai'));
});

test('a swap the formation forbids says so instead of offering it', () => {
    const html = wizard(state(XI_352, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('no legal formation lets them swap'),
        'the bench player out-projects a starter but the shape is in the way');
    assert.ok(!html.includes('Make the swap'), 'and the button must not be offered');
});

test('a bench that beats nobody says the order is right', () => {
    const html = wizard(state(XI_442, WEAK_BENCH)).renderLWSummary();
    assert.ok(html.includes('Nothing on the bench beats a starter'));
    assert.ok(!html.includes('Make the swap'));
});

test('an all-goalkeeper bench is its own case', () => {
    const html = wizard(state(XI_442, GK_ONLY_BENCH)).renderLWSummary();
    assert.ok(html.includes('No outfield players on the bench'));
    assert.ok(html.includes('lw-sum-duo-none'), 'the empty half is marked, not blank');
});

test('the projected total is visible from every tab', () => {
    // It used to be a header chip AND a hero inside Overview — the same
    // lwTotalXP() twice. Only the hero survives, so it has to sit above the
    // tabs rather than inside the one tab that used to draw it.
    for (const tab of ['overview', 'captaincy', 'odds']) {
        const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: tab })).renderLWIntel();
        assert.ok(html.includes('lw-sum-hero'), `missing on the ${tab} tab`);
        assert.ok(html.indexOf('lw-sum-hero') < html.indexOf('lw-intel-tabs'), 'above the tabs');
    }
    // Selecting a player swaps the Overview body for a comparison; the total
    // must survive that too.
    const compare = wizard(state(XI_442, STRONG_BENCH, { selectedPlayers: [1] })).renderLWIntel();
    assert.ok(compare.includes('lw-sum-hero'));
});

test('no squad, no total', () => {
    assert.ok(!wizard(state([], [])).renderLWIntel().includes('lw-sum-hero'));
});

test('the Overview body no longer draws its own total', () => {
    assert.ok(!wizard(state(XI_442, STRONG_BENCH)).renderLWSummary().includes('lw-sum-hero'));
});

test('"nothing to change" is a line, not a card', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    const html = ctx.renderLWChanges();
    assert.ok(!html.includes('lw-final-section'), 'a card to say nothing happened');
    assert.ok(html.includes('lw-sum-quiet'));
});

test('a real change still gets the card', () => {
    const moved = XI_442.slice(0, 10).concat([player(90, 'Szoboszlai', 30, 3)]);
    const st = state(moved, [player(31, 'Fwd1', 9, 4), player(91, 'SubGK', 1, 1)]);
    st.originalXIIds = new Set(XI_442.map(p => p.id));   // the XI from before the swap
    assert.ok(wizard(st).renderLWChanges().includes('lw-final-section'));
});

test('the header carries identity and actions, not a duplicate figure', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH));
    ctx.renderLineupCommandCenter();
    const html = ctx.__nodes.lineupDisplay.innerHTML;
    assert.ok(!html.includes('id="lwTotal"'), 'the duplicated total is gone');
    assert.ok(!html.includes('lw-cc-stat'), 'and the chips that looked like buttons with it');
    assert.ok(html.includes('rc-btn primary'), 'the one primary action is filled');
    assert.ok(html.includes('lw-cc-actions'), 'actions grouped away from the metadata');
    // refreshLWView writes the formation into this id on every in-place change.
    assert.ok(html.includes('id="lwFormation"'), 'the live-update hook must survive');
});
