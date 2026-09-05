/* Trying a player before you buy him.

   The risk here is not arithmetic, it is confusion: a trial that leaks into the
   squad you own would let a manager believe he had made a transfer he had not,
   and the first correction would arrive as a score. So the tests are mostly
   about containment — the trialist is substituted for display and for scoring,
   and nowhere else. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

/* The health score is the real one, loaded from team-analysis-core, so a change
   to the scoring is reflected here rather than tested against a copy of it. */
function load(over = {}) {
    const ctx = {
        console,
        escHTML: (s) => String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
        // A player is worth his id in points, which makes every delta below
        // predictable by hand.
        predictedGWPoints: (p) => p.xp != null ? p.xp : 0,
        // Verdicts drive most of the health charges; keep them neutral unless a
        // test says otherwise, so a delta isolates the thing being changed.
        analyzePlayer: (p) => ({
            player: p, verdict: p.verdict || 'hold',
            sellRating: p.sellRating != null ? p.sellRating : 30,
            availPenalty: 0, formPenalty: 0,
            effectiveForm: p.effectiveForm != null ? p.effectiveForm : 5,
            fixtures: [{ difficulty: 3 }]
        }),
        // FPL stores the bank in tenths of a million, so this is £5.0m.
        picksData: { entry_history: { bank: 50 } },
        ...over
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    for (const f of ['scripts/squad-trial.js']) {
        new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }).runInContext(ctx);
    }
    // Only the health function is needed from the core, and loading the whole
    // file would drag in the page. Lift it out by name.
    const core = fs.readFileSync('scripts/team-analysis-core.js', 'utf8');
    const start = core.indexOf('        function computeSquadHealth(results) {');
    const end = core.indexOf('        function renderTeamAnalysis() {');
    if (start < 0 || end < 0) throw new Error('computeSquadHealth not found in team-analysis-core.js');
    new vm.Script(core.slice(start, end), { filename: 'computeSquadHealth' }).runInContext(ctx);
    return ctx;
}

// Eleven starters and four on the bench; ids double as projected points.
function squad() {
    return Array.from({ length: 15 }, (_, i) => ({
        id: i + 1, name: `P${i + 1}`, position: (i < 2 ? 1 : i < 7 ? 2 : i < 12 ? 3 : 4),
        price: 5.0, sellPrice: 5.0, status: 'a',
        pickPosition: i + 1, onBench: i >= 11,
        isCaptain: i === 0, xp: i + 1
    }));
}
const incoming = (over = {}) => ({ id: 99, name: 'Newcomer', position: 3, price: 7.0, status: 'a', xp: 20, ...over });

test('the trialist takes the outgoing player\'s place in the eleven', () => {
    /* Getting this wrong compares your XI against a twelve-man one and every
       number after it is meaningless. */
    const tl = load();
    const before = squad();
    const after = tl.tlSquadWith(before, incoming(), 8);   // id 8 is a starter
    assert.equal(after.length, before.length, 'still fifteen');
    const sub = after.find(p => p.id === 99);
    assert.equal(sub.pickPosition, 8, 'inherits the slot');
    assert.equal(sub.onBench, false);
    assert.equal(sub.isTrialist, true, 'and is marked as not yours');
    assert.ok(!after.some(p => p.id === 8), 'the outgoing player is gone');
});

test('swapping a bench player does not promote anyone into the XI', () => {
    const tl = load();
    const after = tl.tlSquadWith(squad(), incoming(), 13);  // a bench slot
    const sub = after.find(p => p.id === 99);
    assert.equal(sub.onBench, true);
    assert.equal(after.filter(p => !p.onBench).length, 11, 'the eleven is still eleven');
});

test('the original squad is never modified', () => {
    // The whole containment argument in one assertion.
    const tl = load();
    const before = squad();
    const snapshot = JSON.stringify(before);
    tl.tlSquadWith(before, incoming(), 8);
    tl.tlEvaluate(before, incoming(), 8);
    assert.equal(JSON.stringify(before), snapshot, 'untouched');
});

test('the XI delta counts only the eleven, and doubles the captain', () => {
    const tl = load();
    const r = tl.tlEvaluate(squad(), incoming(), 8);
    // Starters are ids 1-11, captain is id 1 counted twice: 66 + 1 = 67.
    assert.equal(r.xp.before, 67);
    // Swapping 8 out for a 20 adds twelve.
    assert.equal(r.xp.after, 79);
    assert.equal(r.xp.delta, 12);
});

test('a bench swap barely moves the XI but can still move health', () => {
    /* The reason both numbers are shown. A bench player scores nothing this
       week, so the XI total is blind to him — but a bench that cannot cover is
       a real weakness. */
    const tl = load();
    const r = tl.tlEvaluate(squad(), incoming({ id: 99, position: 4 }), 13);
    assert.equal(r.xp.delta, 0, 'the eleven did not change');
    assert.ok(typeof r.health.delta === 'number', 'health still has an opinion');
});

test('replacing an injured starter shows up as health, not just points', () => {
    // Eight points off the score per injured starter, per computeSquadHealth.
    const tl = load();
    const hurt = squad().map(p => p.id === 8 ? { ...p, status: 'i' } : p);
    const r = tl.tlEvaluate(hurt, incoming({ xp: 8 }), 8);
    assert.equal(r.xp.delta, 0, 'like for like on points');
    assert.ok(r.health.delta > 0, `health improves, got ${r.health.delta}`);
});

test('the same scoring judges both squads', () => {
    /* The reason computeSquadHealth had to be extracted. Trialling a player who
       changes nothing must produce a delta of exactly zero — any drift means
       the two sides are being scored differently. */
    const tl = load();
    const before = squad();
    const clone = { ...before.find(p => p.id === 8), id: 99, name: 'Clone' };
    const r = tl.tlEvaluate(before, clone, 8);
    assert.equal(r.health.delta, 0);
    assert.equal(r.xp.delta, 0);
});

test('affordability is answered separately from whether he is better', () => {
    const tl = load();
    const cheap = tl.tlEvaluate(squad(), incoming({ price: 9.0 }), 8);
    assert.equal(cheap.money.raised, 10, '5.0 sold plus 5.0 banked');
    assert.equal(cheap.money.affordable, true);

    const dear = tl.tlEvaluate(squad(), incoming({ price: 12.5 }), 8);
    assert.equal(dear.money.affordable, false);
    assert.ok(dear.xp.delta > 0, 'still reports that he is better, because he is');
    assert.match(tl.tlRenderBanner(dear), /could not afford/);
});

test('the banner leads on the deltas', () => {
    // Nobody opens this to find out their squad scores 67.
    const tl = load();
    const html = tl.tlRenderBanner(tl.tlEvaluate(squad(), incoming(), 8));
    assert.match(html, /\+12 xP/);
    assert.match(html, /Starting XI/);
    assert.match(html, /Squad health/);
    assert.match(html, /tl-delta-v up/);
    assert.match(html, /not in your squad/, 'and says plainly that nothing was transferred');
    assert.match(html, /tlClear\(\)/, 'with a way out');
});

test('only a trialist gets the badge', () => {
    const tl = load();
    assert.equal(tl.tlBadge({ id: 1, name: 'P1' }), '');
    assert.match(tl.tlBadge({ id: 99, isTrialist: true }), /TRIAL/);
    assert.match(tl.tlBadge({ id: 99, isTrialist: true }), /not in your squad/);
});

test('no trial means the table reads the real squad', () => {
    // tlDisplayResults returning null is what leaves getFilteredSquad exactly
    // as it always was.
    const tl = load();
    assert.equal(tl.tlActive(), false);
    assert.equal(tl.tlDisplayResults(), null);
    assert.equal(tl.tlRenderInto(), '');
});

test('a missing engine degrades to nothing rather than throwing', () => {
    // These are separate script tags on a page that can load them in any order.
    const tl = load({ analyzePlayer: undefined });
    assert.equal(tl.tlEvaluate(squad(), incoming(), 8), null);
    assert.equal(tl.tlRenderBanner(null), '');
});

test('an unknown outgoing player leaves the squad alone', () => {
    const tl = load();
    const before = squad();
    assert.deepEqual([...tl.tlSquadWith(before, incoming(), 12345).map(p => p.id)],
        [...before.map(p => p.id)]);
    assert.equal(tl.tlEvaluate(before, incoming(), 12345), null, 'and reports nothing rather than a fake delta');
});

test('the default outgoing player is the weakest starter, not the weakest player', () => {
    /* Sorting the whole position by projection puts bench fodder first, so
       trying a premium proposed swapping him for somebody who was never going
       to play — and every delta came back zero, because the eleven had not
       changed. Caught on real data, where three different targets all reported
       +0 xP. */
    const tl = load();
    const sq = squad();
    // id 12 is a bench midfielder and the lowest-projected in the position
    // once we make him so; id 8 is the weakest starting midfielder.
    sq.find(p => p.id === 12).position = 3;
    sq.find(p => p.id === 12).xp = 0;

    tl.allPlayers = [incoming()];
    tl.selectedPlayers = sq;
    tl.renderTeamAnalysis = () => {};
    tl.tlStart(99);

    assert.equal(tl.tlOutgoingId(), 8, 'the weakest man actually in the eleven');
    const r = tl.tlEvaluate(sq, tl.tlIncoming(), tl.tlOutgoingId());
    assert.ok(r.xp.delta > 0, 'so the trial actually moves the XI');
});

test('a player you already own is refused rather than trialled', () => {
    const tl = load();
    const sq = squad();
    tl.allPlayers = sq;
    tl.selectedPlayers = sq;
    tl.renderTeamAnalysis = () => {};
    let told = '';
    tl.updateStatus = (msg) => { told = msg; };
    tl.tlStart(8);
    assert.equal(tl.tlActive(), false);
    assert.match(told, /already in your squad/);
});

test('clearing a trial puts the table back on the real squad', () => {
    const tl = load();
    tl.allPlayers = [incoming()];
    tl.selectedPlayers = squad();
    tl.renderTeamAnalysis = () => {};
    tl.tlStart(99);
    assert.equal(tl.tlActive(), true);
    assert.ok(tl.tlDisplayResults(), 'the table reads the trial squad');

    tl.tlClear();
    assert.equal(tl.tlActive(), false);
    assert.equal(tl.tlDisplayResults(), null, 'and goes back to analysisResults');
    assert.equal(tl.tlRenderInto(), '');
});
