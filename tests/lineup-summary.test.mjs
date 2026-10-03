/* The Lineup Wizard's intel panel — Overview and Captaincy.

   Both tabs were rebuilt to answer one gameweek's questions and nothing else.
   What came off them: a six-segment stacked bar splitting the eleven's points
   into appearance/attack/clean sheet/saves/bonus/defcon, a paragraph narrating
   the fixtures, four tiles (XI xP, nailed-on count, expected absentees, average
   FDR), every three-gameweek figure, and — on the captaincy cards — two
   unlabelled progress bars and a nailed-on percentage that read 96% on four
   cards out of five.

   Removals are the easy half and they are pinned here by absence, because a
   chart nobody can read comes back the moment someone has a reason to add one.
   The harder half is what the narrowing cost, and there is exactly one thing:
   the XI is still SELECTED on the three-gameweek run — who starts is not a
   one-week question — while every figure now SHOWN is one week. So the
   optimiser can bench a player who out-projects a starter this gameweek, and
   the closest-call block has to say why rather than print a bare negative gap
   that reads as a fault. That is the case worth most of this file.

   Note that isValidLWFormation cannot be stubbed: lineup-wizard.js declares it,
   and a declaration wins over anything the sandbox supplies. The illegal-swap
   case is therefore built out of real positions, which is the better test
   anyway. */
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
        POSITION_CONFIG: { 1: { class: 'gk', short: 'GK' }, 2: { class: 'def', short: 'DEF' },
            3: { class: 'mid', short: 'MID' }, 4: { class: 'fwd', short: 'FWD' } },
        v2IdentityHTML: () => '', buildOptimizeSummary: () => '', renderBOMatchdayPanel: () => 'ODDS',
        projectPlayerPointsDetailed: () => ({}), projectPlayerPointsForGW: () => 0,
        xpIsUnavailable: () => false, isPreseason: false, currentGW: 5, planningGW: 5,
        allFixtures: [], seasonStats: {}, positionAverages: { 1: {}, 2: {}, 3: {}, 4: {} },
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
        ordinal: n => String(n)
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

/* ===== WHAT CAME OFF ===== */

test('the Overview no longer draws the points-source chart, the fixture narrative or the four tiles', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(!html.includes('opt-bar'), 'the stacked points-source bar is gone');
    assert.ok(!html.includes('Where the points come from'));
    assert.ok(!html.includes('What the eleven face'), 'the fixture narrative is gone');
    assert.ok(!html.includes('opt-grid'), 'the four summary tiles are gone');
    assert.ok(!html.includes('Nailed on') && !html.includes('Expected absent') && !html.includes('Avg FDR'));
});

test('no figure on the Overview is summed over more than this gameweek', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(!/next \d+ GWs/.test(html), 'a multi-gameweek unit label survived');
    // lwScore is the three-week run the XI is picked on; gwScore is one week.
    // Every number printed here must be the latter. Fwd1 is the weakest starter
    // at lwScore 9, gwScore 1.8 — the run figure must not appear.
    assert.ok(html.includes('1.8'), 'the one-week figure is shown');
    assert.ok(!html.includes('>9.0<'), 'the three-week run figure is not');
});

test('the captaincy cards drop the breakdown, the unlabelled bars and the nailed percentage', () => {
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' })).renderLWCaptaincyMatrix();
    assert.ok(!html.includes('lw-cap-break'), 'the per-card points breakdown is gone');
    assert.ok(!html.includes('lw-cap-bar'), 'the Threat and Opponent bars are gone');
    assert.ok(!html.includes('>Threat<') && !html.includes('>Opponent<'));
    assert.ok(!html.includes('opt-risk'), 'the nailed-on percentage is off the cards');
    assert.ok(!html.includes('nailed'), 'and its wording with it');
});

/* ===== THE OPTIMISER SUMMARY ===== */

test('the summary is above the tabs, so all three tabs carry it', () => {
    for (const tab of ['overview', 'captaincy', 'odds']) {
        const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: tab })).renderLWIntel();
        assert.ok(html.includes('lw-ovs'), `missing on the ${tab} tab`);
        assert.ok(html.indexOf('lw-ovs') < html.indexOf('lw-intel-tabs'), 'above the tabs');
    }
    // Selecting a player swaps the Overview body for a comparison; the summary
    // must survive that too.
    assert.ok(wizard(state(XI_442, STRONG_BENCH, { selectedPlayers: [1] })).renderLWIntel().includes('lw-ovs'));
});

test('no squad, no summary', () => {
    assert.ok(!wizard(state([], [])).renderLWIntel().includes('lw-ovs'));
});

test('the Overview body does not draw the total a second time', () => {
    assert.ok(!wizard(state(XI_442, STRONG_BENCH)).renderLWSummary().includes('lw-ovs'));
});

test('the gain is measured against the live FPL eleven, scored the same way', () => {
    /* The optimiser has promoted Szoboszlai (gwScore 6.0) over Fwd1 (1.8) and
       moved the armband onto a defender. originalXIIds/originalCaptain still
       describe what is saved on the FPL site, so the difference is 6.0 - 1.8
       plus the change in who gets doubled. */
    const moved = XI_442.slice(0, 10).concat([player(90, 'Szoboszlai', 30, 3)]);
    const st = state(moved, [player(31, 'Fwd1', 9, 4), player(91, 'SubGK', 1, 1)]);
    st.originalXIIds = new Set(XI_442.map(p => p.id));
    st.originalCaptain = 1;          // Keeper, as saved
    st.captain = 10;                 // Def0, after optimising
    const ctx = wizard(st);
    const live = ctx.lwLiveXP();
    const now = ctx.lwTotalXP();
    assert.ok(live > 0, 'the live eleven has a projection of its own');
    assert.notEqual(live, now, 'and it differs from the optimised one');
    const html = ctx.renderLWIntel();
    assert.ok(html.includes('vs your live FPL team'));
    assert.ok(html.includes((now - live) > 0 ? 'is-up' : 'is-down'), 'the sign is coloured, not just printed');
});

test('an unchanged lineup reports level rather than +0.0', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWIntel();
    assert.ok(html.includes('>level<'), 'a zero gain is said in words');
    assert.ok(!html.includes('+0.0'));
});

test('the flag count in the summary is the length of the risk list', () => {
    const hurt = XI_442.slice(0, 10).concat([
        { ...player(40, 'Crock', 9, 4), status: 'd', news: 'Knock', chanceNextRound: 75 }]);
    const ctx = wizard(state(hurt, STRONG_BENCH));
    const n = ctx.lwRiskList().length;
    assert.equal(n, 1);
    const html = ctx.renderLWIntel();
    assert.ok(html.includes('1 flagged player') || html.includes('>1<'), 'the count is shown');
    assert.ok(html.includes('is-warn'), 'and marked as something to look at');
});

/* ===== RISKS ===== */

test('risks list the injured and the rotation-risked, starters first', () => {
    const risky = XI_442.slice(0, 10).concat([{ ...player(41, 'Rotato', 9, 4), pStart: 0.4 }]);
    const bench = [{ ...player(42, 'BenchCrock', 9, 3), status: 'i', news: 'Hamstring' },
                   player(91, 'SubGK', 1, 1)];
    const ctx = wizard(state(risky, bench));
    const list = ctx.lwRiskList();
    assert.equal(list.length, 2);
    assert.ok(list[0].inXI, 'the one you are starting comes first');
    assert.equal(list[0].p.web_name, 'Rotato');
    const html = ctx.renderLWSummary();
    assert.ok(html.includes('Risks &amp; flags'));
    assert.ok(html.includes('rotation risk'));
    assert.ok(html.includes('Hamstring'));
    assert.ok(html.includes('lw-ov-risk-where'), 'and each says whether he is starting');
});

test('a player who is both flagged and rotation-risked is listed once', () => {
    const both = XI_442.slice(0, 10).concat([
        { ...player(43, 'Doubtful', 9, 4), status: 'd', news: 'Illness', pStart: 0.3 }]);
    assert.equal(wizard(state(both, STRONG_BENCH)).lwRiskList().length, 1);
});

test('a clean squad says so in a line, not a card', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('No injuries, suspensions or rotation risks'));
    assert.ok(!html.includes('lw-ov-block is-warn'), 'and spends no panel on it');
});

/* ===== CHANGES ===== */

test('changes are grouped in, out and armband rather than one row per player', () => {
    const moved = XI_442.slice(0, 10).concat([player(90, 'Szoboszlai', 30, 3)]);
    const st = state(moved, [player(31, 'Fwd1', 9, 4), player(91, 'SubGK', 1, 1)]);
    st.originalXIIds = new Set(XI_442.map(p => p.id));
    const html = wizard(st).renderLWChanges();
    assert.ok(!html.includes('lw-change-row'), 'the per-player rows are gone');
    assert.ok(!html.includes('Promoted to XI'), 'and the labels that repeated their own badge');
    assert.equal(html.match(/lw-ovc-row/g).length, 3, 'in, out, armband');
    assert.ok(html.includes('Szoboszlai'), 'who came in');
    assert.ok(html.includes('Fwd1'), 'who went out');
    assert.ok(html.includes('lw-change-badge promoted') && html.includes('lw-change-badge benched'));
});

test('the armband row is shown even when it did not change, and says so', () => {
    const moved = XI_442.slice(0, 10).concat([player(90, 'Szoboszlai', 30, 3)]);
    const st = state(moved, [player(31, 'Fwd1', 9, 4), player(91, 'SubGK', 1, 1)]);
    st.originalXIIds = new Set(XI_442.map(p => p.id));
    const html = wizard(st).renderLWChanges();
    assert.ok(html.includes('lw-ovc-same'), 'an unchanged armband is worth confirming');
    assert.ok(!html.includes('is-new'));
});

test('a new captain is marked as new', () => {
    const st = state(XI_442, STRONG_BENCH, { captain: 20, originalCaptain: 1 });
    const html = wizard(st).renderLWChanges();
    assert.ok(html.includes('is-new'));
    assert.ok(!html.includes('lw-ovc-same'));
});

test('"nothing to change" is a line, not a card', () => {
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWChanges();
    assert.ok(!html.includes('lw-ov-block'), 'a card to say nothing happened');
    assert.ok(html.includes('lw-ov-quiet'));
});

/* ===== THE CLOSEST CALL ===== */

test('a starter who leads his nearest substitute is reported as the narrowest gap', () => {
    const html = wizard(state(XI_442, WEAK_BENCH)).renderLWSummary();
    assert.ok(html.includes('Closest bench call'));
    assert.ok(html.includes('narrowest gap in the eleven'));
    assert.ok(!html.includes('lw-ov-apply'), 'and offers no swap, because there is nothing to gain');
});

test('a benched player who out-projects a starter this week says why he is benched', () => {
    /* The case the whole narrowing turns on. Szoboszlai projects more this
       gameweek and is still on the bench, because the eleven is picked over
       three. Printing the gap alone would read as a bug. */
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('benched on the longer run the eleven is picked over'),
        'the one place the selection horizon shows through must name itself');
    assert.ok(html.includes('lw-ov-apply'), 'and the swap is offered, because it is legal');
    assert.ok(html.includes('Start Szoboszlai anyway'));
});

test('a swap the formation forbids says so instead of offering it', () => {
    const html = wizard(state(XI_352, STRONG_BENCH)).renderLWSummary();
    assert.ok(html.includes('No legal formation lets them swap'),
        'the bench player out-projects a starter but the shape is in the way');
    assert.ok(!html.includes('lw-ov-apply'), 'and the button must not be offered');
});

test('the gap chip is a gap, never a signed delta', () => {
    // Direction is carried by which side is lit and by the note underneath, so
    // a minus sign in the chip between them would say nothing and confuse.
    const html = wizard(state(XI_442, STRONG_BENCH)).renderLWSummary();
    const chip = /lw-ov-call-gap"[^>]*>([^<]*)</.exec(html);
    assert.ok(chip, 'the chip is drawn');
    assert.ok(!chip[1].includes('-') && !chip[1].includes('−'), `signed gap: ${chip[1]}`);
    assert.ok(html.includes('is-ahead'), 'the side projecting more is lit instead');
});

test('an all-goalkeeper bench has no bench call to make', () => {
    const ctx = wizard(state(XI_442, GK_ONLY_BENCH));
    assert.equal(ctx.lwClosestCall(), null);
    assert.ok(!ctx.renderLWSummary().includes('Closest bench call'));
});

test('an excluded substitute is not offered as the call', () => {
    /* Two outfielders on the bench, so excluding the better one leaves a real
       answer rather than no answer — excluding the only outfielder is the
       all-goalkeeper case above, and it correctly returns null. */
    const bench = [player(90, 'Szoboszlai', 30, 3), player(93, 'Backup', 20, 3), player(91, 'SubGK', 1, 1)];
    assert.equal(wizard(state(XI_442, bench)).lwClosestCall().sub.id, 90, 'the best sub, normally');
    const st = state(XI_442, bench, { excluded: new Set([90]) });
    assert.equal(wizard(st).lwClosestCall().sub.id, 93, 'the next one, once he is ruled out');
});

/* ===== CAPTAINCY ===== */

test('the insight line is a panel of its own, not grey text above a grid', () => {
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' })).renderLWCaptaincyMatrix();
    assert.ok(html.includes('lw-cap-lead-h'), 'it has a heading');
    assert.ok(html.includes('What the model makes of it'));
    assert.ok(html.indexOf('lw-cap-lead') < html.indexOf('lw-cap-grid'), 'and sits above the cards');
});

test('a card keeps the rank, the doubled figure, the fixture, the defence, form and ownership', () => {
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' })).renderLWCaptaincyMatrix();
    assert.ok(html.includes('lw-cap-rank'));
    assert.ok(html.includes('lw-cap-xp'), 'the doubled projection leads the card');
    assert.ok(html.includes('concede <strong>1.4</strong>/game'), 'the one fixture number that bears on an armband');
    assert.ok(html.includes('Form <strong>'));
    assert.ok(html.includes('Owned <strong>'));
    assert.ok(html.includes('lw-cap-btn'), 'and the two actions');
});

test('the doubled figure is this gameweek doubled, not the run', () => {
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' })).renderLWCaptaincyMatrix();
    // Def0 leads on gwScore 3.6, so the card must read 7.2.
    assert.ok(html.includes('>7.2<'), 'gwScore doubled');
});

test('only the leader is badged top pick', () => {
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' })).renderLWCaptaincyMatrix();
    assert.equal(html.match(/Top pick/g).length, 1);
});

test('a differential badge needs both low ownership and a real chance', () => {
    const mk = (id, name, score, own) => ({ ...player(id, name, score, 3), ownership: own });
    // Close on projection, far apart on ownership — a genuine differential.
    const close = [player(1, 'Keeper', 19, 1), mk(20, 'Popular', 18, 70), mk(21, 'Hidden', 17.5, 8),
        ...[16, 15, 14].map((v, n) => player(30 + n, `Def${n}`, v, 2)),
        ...[13, 12, 11, 10, 9].map((v, n) => player(40 + n, `Mid${n}`, v, 3))];
    assert.ok(wizard(state(close, STRONG_BENCH, { intelTab: 'captaincy' }))
        .renderLWCaptaincyMatrix().includes('Differential'));

    // Same ownership gap, but far behind on projection — not an option, so not a badge.
    const far = [player(1, 'Keeper', 19, 1), mk(20, 'Popular', 40, 70), mk(21, 'Hopeless', 5, 8),
        ...[16, 15, 14].map((v, n) => player(30 + n, `Def${n}`, v, 2)),
        ...[13, 12, 11, 10, 9].map((v, n) => player(40 + n, `Mid${n}`, v, 3))];
    assert.ok(!wizard(state(far, STRONG_BENCH, { intelTab: 'captaincy' }))
        .renderLWCaptaincyMatrix().includes('Differential'));
});

test('a captained goalkeeper is described without a negative "behind"', () => {
    /* The candidate list filters out goalkeepers, so the gap to the leader can
       be negative — and the sentence used to read "-0.2 projected points
       behind", which is not a sentence. */
    const html = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy', captain: 1 }))
        .renderLWCaptaincyMatrix();
    assert.ok(html.includes('lw-cap-off'));
    assert.ok(!/-\d|−\d/.test(html.slice(html.indexOf('lw-cap-off'), html.indexOf('lw-cap-grid'))),
        'no negative number in the off-pick sentence');
    assert.ok(html.includes('ahead of'), 'it reads as ahead, because that is what it is');
});

test('a risky leader is flagged in the insight line, which is the one place it earns', () => {
    const ctx = wizard(state(XI_442, STRONG_BENCH, { intelTab: 'captaincy' }));
    ctx.optMinutesRisk = () => ({ pct: 55, word: 'doubtful', cls: 'warn' });
    const html = ctx.renderLWCaptaincyMatrix();
    assert.ok(html.includes('55% likely to start'));
    assert.ok(html.includes('costs you double'));
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
