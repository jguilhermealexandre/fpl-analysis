/* Rising form, and the difference between "flat" and "cannot tell yet".

   Every reading here compares a short window against a longer one, so none of
   them says anything until the longer one exists. The bug this file exists to
   prevent is not a wrong number — it is a confident one: a score of 0 for a
   player nobody has enough season to measure, and the word "stable" printed
   about a club whose trend was never computed. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const F = 'scripts/form-trend.js';

const ftShortfall = loadFunction(F, 'ftShortfall');
const ftTeamTrend = loadFunction(F, 'ftTeamTrend', { FT_MIN_TREND: 10 });
const risingFormFor = loadFunction(F, 'risingFormFor', {
    FT_MIN_RECENT: 3, FT_MIN_SEASON: 6, FT_SCORE_FLOOR: 6,
    ftShortfall, ftTeamTrend: () => ({ usable: false }),
    teamAnalysis: {}, fixtureSwingData: {}
});
const risingFormScores = loadFunction(F, 'risingFormScores', { risingFormFor });

// A midfielder whose recent returns run well ahead of his season.
const player = (over = {}) => ({
    id: 1, position: 3, teamId: 1, status: 'a',
    l5: { games: 4, minutes: 360, points: 24, xGI: 2.0 },
    season: { games: 10, minutes: 900, points: 40, xGI: 4.0 },
    history: Array.from({ length: 6 }, (_, i) => ({ minutes: 90, total_points: i < 2 ? 2 : 8 })),
    fixtures: { avgFDR3: 3 },
    ...over
});

test('a short season is not a score of zero', () => {
    /* The bug. Four gameweeks in, every player in the game failed the six-match
       gate, the function returned early, and the report rendered "0" — which
       reads as "measured, and flat". */
    const r = risingFormFor(player({ season: { games: 4, minutes: 360, points: 16, xGI: 2 } }));
    assert.equal(r.measurable, false);
    assert.equal(r.score, null, 'null, not 0');
    assert.match(r.note, /4 of the 6 matches/, 'the note says exactly what is missing');
});

test('too little recent football is its own answer', () => {
    const r = risingFormFor(player({ l5: { games: 2, minutes: 180, points: 12, xGI: 1 } }));
    assert.equal(r.measurable, false);
    assert.match(r.note, /recent matches/);
});

test('minutes matter as well as matches', () => {
    // Three cameo appearances are three matches and not a trend.
    const r = risingFormFor(player({ l5: { games: 4, minutes: 120, points: 12, xGI: 1 } }));
    assert.equal(r.measurable, false);
    assert.match(r.note, /180 minutes/);
});

test('measured and not rising is different from not measured', () => {
    // Same shape of empty result, completely different meaning — so the note
    // has to distinguish them, which is what the report renders.
    const flat = risingFormFor(player({
        l5: { games: 4, minutes: 360, points: 16, xGI: 2.0 },
        season: { games: 10, minutes: 900, points: 40, xGI: 4.0 }
    }));
    assert.equal(flat.measurable, true, 'we could measure him');
    assert.equal(flat.score, null, 'he is simply not rising');
    assert.match(flat.note, /not running ahead of his season/);
});

test('an attacker scoring without chances is not rising', () => {
    // Points up, xGI flat: a run of bonus and clean sheets, not a forward
    // getting into better positions.
    const r = risingFormFor(player({ l5: { games: 4, minutes: 360, points: 24, xGI: 0.1 } }));
    assert.equal(r.measurable, true);
    assert.equal(r.score, null);
    assert.match(r.note, /chances are not/);
});

test('an unavailable player gets no forward-looking reading', () => {
    const r = risingFormFor(player({ status: 'i' }));
    assert.equal(r.measurable, false);
    assert.match(r.note, /Not currently available/);
});

test('the team trend refuses to compare a window with itself', () => {
    /* A six-match window against a season of six matches is largely the same
       games on both sides. Ten is where the comparison starts carrying
       information, and below it this says so rather than defaulting to the
       string "stable" — which is what the report used to print, about clubs
       whose trend had never been computed. */
    const trendWith = (games) => loadFunction(F, 'ftTeamTrend', {
        FT_MIN_TREND: 10,
        getTeamSeasonXg: () => ({ games, xGpg: 1.5, xGCpg: 1.2 }),
        getTeamXgWindow: () => ({ games: Math.min(6, games), xGpg: 2.1, xGCpg: 0.9 })
    })(1);

    const thin = trendWith(6);
    assert.equal(thin.usable, false, 'six games cannot judge a six-game window');
    assert.equal(thin.played, 6);
    assert.equal(thin.need, 10);

    const ok = trendWith(12);
    assert.equal(ok.usable, true);
    assert.ok(Math.abs(ok.xgDelta - 0.6) < 1e-9, 'creating more than its season');
    // Signed so positive is always the good direction, whichever stat it is.
    assert.ok(Math.abs(ok.xgcDelta - 0.3) < 1e-9, 'conceding fewer than its season');
});

test('pillars fire and the score reflects them', () => {
    const rich = loadFunction(F, 'risingFormFor', {
        FT_MIN_RECENT: 3, FT_MIN_SEASON: 6, FT_SCORE_FLOOR: 6, ftShortfall,
        ftTeamTrend: () => ({ usable: true, xgDelta: 0.5, xgcDelta: 0.1,
            recent: { xGpg: 2.0, xGCpg: 0.9 }, season: { xGpg: 1.5, xGCpg: 1.0 } }),
        teamAnalysis: { 1: { wins: 6, draws: 2, losses: 2, matchesPlayed: 10 } },
        fixtureSwingData: { 1: { direction: 'improving', swing: 0.8, currentFdr: 3.6, futureFdr: 2.4 } }
    });
    const r = rich(player());
    assert.equal(r.measurable, true);
    assert.ok(r.score > 6, 'score clears the floor');
    assert.equal(r.note, null, 'nothing to explain when there is a reading');
    const labels = r.signals.map(s => s.label);
    assert.ok(labels.includes('Team winning'));
    assert.ok(labels.includes('Team creating more chances'));
    assert.ok(labels.includes('Fixtures improving'));
    // Every signal states the numbers behind it rather than a 0-100 rating.
    for (const s of r.signals) assert.match(s.detail, /\d/, `${s.label} shows its figures`);
});

test('the pool carries the reason it is empty', () => {
    // An empty section that cannot say why looks broken, and looked broken.
    const out = risingFormScores([player({ season: { games: 4, minutes: 360, points: 16, xGI: 2 } })]);
    assert.deepEqual({ ...out.scores }, {});
    assert.equal(out.measurable, 0);
    assert.match(out.note, /not enough season yet/);
});
