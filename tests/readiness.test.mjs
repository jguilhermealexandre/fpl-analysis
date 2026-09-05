/* Deadline readiness.

   All of this logic used to live inline in index.html, where nothing could
   reach it — the CI parsed that block but never ran it. These are the first
   tests it has had, and they pin the two properties the old shape could not
   have: that every check reports even when it passes, so the panel can count
   them, and that a mistake which is an absence rather than a symptom still
   produces a row. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function load(over = {}) {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
        // Everyone is nailed unless a test says otherwise.
        expectedMinutesModel: (p) => ({ pStart: p.pStart ?? 0.92, expMins: p.expMins ?? 85 }),
        ...over
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    const f = 'scripts/readiness.js';
    new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    return ctx;
}
const evalIn = (ctx, expr) => vm.runInContext(expr, ctx);

// position: 1 GK, 2 DEF, 3 MID, 4 FWD.
const player = (id, extra = {}) => ({
    id, name: `P${id}`, position: 3, pickPosition: id, status: 'a', news: '', ...extra
});

// A legal, entirely healthy squad: 2 GK, 5 DEF, 5 MID, 3 FWD, four on the bench
// including a defender, so the bench checks pass.
function cleanSquad() {
    const squad = [];
    let pick = 1;
    [3, 3, 3, 4, 4].forEach(pos => squad.push(player(pick, { position: pos, pickPosition: pick++ })));
    [2, 2, 2, 2].forEach(pos => squad.push(player(pick, { position: pos, pickPosition: pick++ })));
    squad.push(player(pick, { position: 1, pickPosition: pick++ }));      // 10
    squad.push(player(pick, { position: 3, pickPosition: pick++ }));      // 11
    squad.push(player(pick, { position: 2, pickPosition: pick++ }));      // 12 bench DEF
    squad.push(player(pick, { position: 3, pickPosition: pick++ }));      // 13
    squad.push(player(pick, { position: 4, pickPosition: pick++ }));      // 14
    squad.push(player(pick, { position: 1, pickPosition: pick++ }));      // 15 bench GK
    squad[0].isCaptain = true;
    squad[1].isViceCaptain = true;
    return squad;
}

// A settled squad with a settled Hold: the state where a manager is done.
const settled = (over = {}) => ({
    squad: cleanSquad(),
    analysisResults: cleanSquad().map(() => ({ verdict: 'keep' })),
    transferRec: { best: { n: 0 }, gws: [4, 5, 6, 7, 8] },
    captainRec: null,
    freeTransfers: 1,
    maxFreeTransfers: 5,
    bank: 0.5,
    chips: [],
    now: Date.UTC(2026, 8, 5),      // September — nowhere near the chip deadline
    ...over
});

test('every check reports, whether or not it found anything', () => {
    /* The property the old panel could not have. It only appended rows when
       something was wrong, so a clean squad produced two empty columns — which
       reads as a page that failed to load, not as "you are ready". */
    const rd = load();
    const built = rd.rdBuild(settled());
    const ids = evalIn(rd, 'RD_CHECKS').map(c => c.id);

    assert.equal(built.checks.length, ids.length, 'one entry per declared check');
    assert.deepEqual([...built.checks.map(c => c.id)], [...ids], 'in declared order');
    for (const c of built.checks) {
        assert.ok(['clear', 'warn', 'urgent'].includes(c.state), `${c.id} has a state`);
    }
});

test('a settled squad reads as ready', () => {
    const rd = load();
    const { summary } = rd.rdBuild(settled());
    assert.equal(summary.outstanding, 0, 'nothing outstanding');
    assert.equal(summary.ready, true);
    assert.equal(summary.clear, summary.total);

    const html = rd.rdSummaryHTML(summary, null);
    assert.match(html, /Ready for the deadline/);
    assert.match(html, /rd-bar ready/);
});

test('an injured starter is urgent and a doubt is not', () => {
    const rd = load();
    const squad = cleanSquad();
    squad[0].status = 'i';
    squad[0].news = 'Hamstring injury';
    const built = rd.rdBuild(settled({ squad }));
    const fit = built.checks.find(c => c.id === 'xi-fit');
    assert.equal(fit.state, 'urgent');
    assert.equal(fit.rows[0].reason, 'Hamstring injury');

    const squad2 = cleanSquad();
    squad2[0].status = 'd';
    squad2[0].chanceNextRound = 50;
    const doubt = rd.rdBuild(settled({ squad: squad2 })).checks.find(c => c.id === 'xi-fit');
    assert.equal(doubt.state, 'warn', 'a doubt is worth watching, not urgent');
    assert.match(doubt.rows[0].reason, /50% chance/);
});

test('a fit starter who is unlikely to start is still caught', () => {
    // The status flags only fire for injuries and doubts. A fully fit player
    // who is a coin flip to start carries no flag at all.
    const rd = load();
    const squad = cleanSquad();
    squad[2].pStart = 0.35;
    const built = rd.rdBuild(settled({ squad }));
    const mins = built.checks.find(c => c.id === 'xi-minutes');
    assert.equal(mins.state, 'urgent', 'below 40% is urgent');
    assert.match(mins.rows[0].reason, /35% likely to start/);

    squad[2].pStart = 0.8;
    assert.equal(rd.rdBuild(settled({ squad })).checks.find(c => c.id === 'xi-minutes').state,
        'clear', 'a nailed starter clears it');
});

test('a fifth free transfer is reported as waste, a first is not', () => {
    /* The check the old shape could not produce: nothing is flagged, no player
       is involved, so there was never a row to append. Free transfers roll over,
       so an unused one is normally banked — at the cap it stops rolling and the
       one you skip is simply gone. */
    const rd = load();
    const atCap = rd.rdBuild(settled({ freeTransfers: 5, maxFreeTransfers: 5 }));
    const check = atCap.checks.find(c => c.id === 'free-transfers');
    assert.equal(check.state, 'warn');
    assert.match(check.rows[0].reason, /at the maximum/);

    for (const ft of [1, 2, 4]) {
        assert.equal(rd.rdBuild(settled({ freeTransfers: ft })).checks
            .find(c => c.id === 'free-transfers').state, 'clear', `${ft} free transfers is banked value`);
    }
});

test('the cap is read from the game rather than assumed', () => {
    // max_extra_free_transfers is a game setting and has changed before.
    const rd = load();
    const built = rd.rdBuild(settled({ freeTransfers: 3, maxFreeTransfers: 3 }));
    assert.equal(built.checks.find(c => c.id === 'free-transfers').state, 'warn',
        'three of three is at the cap even though five is the usual ceiling');
});

test('chips are only chased as their deadline approaches', () => {
    /* Two sets run this season and the first expires 13:30 GMT on 2 January.
       A chip you were saving is worth nothing the day after, and the game gives
       no warning at all. */
    const rd = load();
    const far = rd.rdBuild(settled({ now: Date.UTC(2026, 8, 5), chips: [] }));
    assert.equal(far.checks.find(c => c.id === 'chips').state, 'clear',
        'September is not the time to be told about January');

    const near = rd.rdBuild(settled({ now: Date.UTC(2026, 11, 10), chips: [] }));
    const check = near.checks.find(c => c.id === 'chips');
    assert.equal(check.state, 'warn', 'three weeks out it matters');
    assert.match(check.rows[0].reason, /Wildcard, Free Hit, Triple Captain, Bench Boost/);
    assert.match(check.rows[0].reason, /do not carry into the second set/);

    const urgent = rd.rdBuild(settled({ now: Date.UTC(2026, 11, 28), chips: [] }));
    assert.equal(urgent.checks.find(c => c.id === 'chips').state, 'urgent', 'five days out is urgent');
});

test('chips already played are not chased', () => {
    const rd = load();
    const chips = [
        { name: 'wildcard', time: '2026-09-01T10:00:00Z' },
        { name: '3xc', time: '2026-10-01T10:00:00Z' }
    ];
    const built = rd.rdBuild(settled({ now: Date.UTC(2026, 11, 10), chips }));
    const check = built.checks.find(c => c.id === 'chips');
    assert.match(check.rows[0].name, /^2 chips/, 'only the two still unused');
    assert.match(check.rows[0].reason, /Free Hit, Bench Boost/);
    assert.doesNotMatch(check.rows[0].reason, /Wildcard/);
});

test('a second-half chip does not clear a first-half one', () => {
    // Chips played after the January deadline belong to the other set entirely.
    const rd = load();
    const chips = [{ name: 'wildcard', time: '2027-03-01T10:00:00Z' }];
    const built = rd.rdBuild(settled({ now: Date.UTC(2026, 11, 10), chips }));
    assert.match(built.checks.find(c => c.id === 'chips').rows[0].reason, /Wildcard/,
        'a March wildcard says nothing about the December one');
});

test('the recommended move is outstanding and a hold is not', () => {
    const rd = load();
    const rec = {
        gws: [4, 5, 6, 7, 8],
        best: { n: 1, net: 6.2, cost: 0, moves: [{ out: { id: 1, name: 'Old' }, in: { id: 2, name: 'New' } }] }
    };
    const built = rd.rdBuild(settled({ transferRec: rec }));
    const check = built.checks.find(c => c.id === 'transfer');
    assert.equal(check.state, 'warn', 'a move you have not made is outstanding');
    assert.equal(check.rows[0].name, 'Old → New');
    assert.match(check.rows[0].href, /out=1&in=2/);

    assert.equal(rd.rdBuild(settled()).checks.find(c => c.id === 'transfer').state, 'clear',
        'deciding to hold is a decision');
});

test('rows are split into the column that renders them', () => {
    const rd = load();
    const squad = cleanSquad();
    squad[0].status = 'i';
    const built = rd.rdBuild(settled({ squad, freeTransfers: 5 }));
    const xi = rd.rdRows(built.checks, 'xi');
    const tx = rd.rdRows(built.checks, 'tx');
    assert.equal(xi.length, 1, 'the injury goes to the XI column');
    assert.equal(tx.length, 1, 'the free transfer goes to Transfers');
    assert.equal(xi.length + tx.length, built.checks.reduce((n, c) => n + c.rows.length, 0),
        'every row lands in exactly one column');
});

test('the bar states the time left without a second ticking clock', () => {
    const rd = load();
    const now = Date.UTC(2026, 8, 5, 9, 0);
    const summary = rd.rdBuild(settled()).summary;

    const soon = rd.rdSummaryHTML(summary, new Date(Date.UTC(2026, 8, 5, 11, 30)).toISOString(), now);
    assert.match(soon, /2h 30m to deadline/);
    assert.match(soon, /rd-clock soon/, 'under three hours reads as urgent');

    const far = rd.rdSummaryHTML(summary, new Date(Date.UTC(2026, 8, 9, 9, 0)).toISOString(), now);
    assert.match(far, /4 days to deadline/);
    assert.doesNotMatch(far, /rd-clock soon/);

    const past = rd.rdSummaryHTML(summary, new Date(Date.UTC(2026, 8, 5, 8, 0)).toISOString(), now);
    assert.match(past, /Deadline passed/);
});

test('an empty squad does not throw', () => {
    // The dashboard renders before the squad resolves on a slow connection.
    const rd = load();
    const built = rd.rdBuild({});
    assert.equal(built.summary.total, evalIn(rd, 'RD_CHECKS').length);
    assert.ok(rd.rdSummaryHTML(built.summary, null).includes('rd-bar'));
});

test('the model runs without the minutes engine', () => {
    // readiness.js loads alongside xp-engine.js, not after it.
    const rd = load({ expectedMinutesModel: undefined });
    const built = rd.rdBuild(settled());
    assert.equal(built.checks.find(c => c.id === 'xi-minutes').state, 'clear',
        'no model means no claim, rather than a guess');
    assert.ok(built.summary.total > 0);
});

test('every check is on screen, split into what needs you and what is clear', () => {
    /* The defect this fixes: the bar reported "7 of 9 clear" over a panel that
       showed neither the nine nor which two failed. The columns render rows,
       and rows are not checks — one check can produce several, and the seven
       that pass produce none at all, so the count referred to something that
       was nowhere on the page.

       The checks are no longer behind a toggle, and they are no longer one
       interleaved list: the two the headline is about are in their own lane. */
    const rd = load();
    const squad = cleanSquad();
    squad[0].status = 'i';
    squad[0].news = 'Hamstring';
    const built = rd.rdBuild(settled({ squad }));
    const html = rd.rdSummaryHTML(built.summary, null, Date.now(), built.checks);

    assert.doesNotMatch(html, /<details/, 'nothing to open — the checks are simply there');
    assert.match(html, /rd-lane needs urgent/, 'the outstanding ones have their own lane');
    assert.match(html, /rd-lane done/, 'and so do the ones that passed');

    // Every declared check appears by name, whatever its state.
    for (const c of evalIn(rd, 'RD_CHECKS')) {
        assert.ok(html.includes(c.label), `"${c.label}" is on screen`);
    }
    const clear = (html.match(/rd-check clear/g) || []).length;
    assert.equal(clear, built.summary.clear, 'the passing checks are shown, not just counted');
    assert.match(html, /rd-check urgent/, 'and the failing one is marked apart');

    // The lane counts are the summary's own numbers, not a second tally.
    assert.match(html, new RegExp(`rd-lane-n">${built.summary.outstanding}<`));
    assert.match(html, new RegExp(`rd-lane-n">${built.summary.clear}<`));
});

test('a failing check carries its own detail and link', () => {
    // Otherwise the name has to be matched by eye against a column further down.
    const rd = load();
    const squad = cleanSquad();
    squad[0].status = 'i';
    squad[0].news = 'Hamstring';
    const built = rd.rdBuild(settled({ squad }));
    const html = rd.rdSummaryHTML(built.summary, null, Date.now(), built.checks);
    assert.match(html, /Hamstring/, 'the reason travels with the check');
    assert.match(html, /href="fpl-my-team-analysis\.html#squad\?player=1"/, 'and so does the way to fix it');
});

test('a ready squad still lists what was checked', () => {
    /* "Ready" is only worth anything if you can see what was actually looked
       at. Nine green lines is the evidence for the claim in the headline. */
    const rd = load();
    const built = rd.rdBuild(settled());
    const html = rd.rdSummaryHTML(built.summary, null, Date.now(), built.checks);
    assert.match(html, /Ready for the deadline/);
    assert.equal((html.match(/rd-check clear/g) || []).length, built.checks.length);
    assert.doesNotMatch(html, /rd-item/, 'with no detail rows, because nothing failed');
    assert.doesNotMatch(html, /rd-lane needs/, 'and no empty lane for the problems there are none of');
});

test('the bar renders without checks for callers that pass none', () => {
    // The signature grew; anything still calling it the old way must not break.
    const rd = load();
    const built = rd.rdBuild(settled());
    const html = rd.rdSummaryHTML(built.summary, null);
    assert.match(html, /rd-bar/);
    assert.match(html, /data-empty/, 'flagged as carrying no lanes');
    assert.doesNotMatch(html, /rd-lanes/, 'so the header keeps its own rounded corners');
});
