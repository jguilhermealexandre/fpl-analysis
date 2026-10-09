/* xpFixtureDifficulty — the site's one definition of how hard a fixture is.

   Seven places derived this independently from the raw feed before this
   existed, and they did not agree on the one case the feed can produce and
   nobody had seen: a fixture with no rating on it. Four defaulted to 3, three
   returned undefined, and `undefined >= 4` is false — so a fixture of unknown
   difficulty read as "not hard" on three surfaces and as "average" on four.

   These tests pin the contract rather than the number. The number is FPL's and
   is returned unchanged on purpose (see the FDR decision): what is tested here
   is that one answer comes back for one fixture, from either side of it, and
   that the refusal case has exactly one behaviour. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFunction } from './helpers/load.mjs';

const SRC = 'scripts/xp-engine.js';
const fdr = loadFunction(SRC, 'xpFixtureDifficulty', { XP_FDR_DEFAULT: 3 });

// Arsenal (1) at home to Spurs (6): hard for Spurs, kinder for Arsenal.
const fixture = { team_h: 1, team_a: 6, team_h_difficulty: 2, team_a_difficulty: 4 };

test('each side of a fixture gets its own rating', () => {
    assert.equal(fdr(1, fixture), 2, 'the home side reads the home column');
    assert.equal(fdr(6, fixture), 4, 'the away side reads the away column');
});

test('a team that is not in the fixture reads it as away', () => {
    /* Not a case the callers produce — they iterate the fixture's own two
       teams — but the fallback has to be defined rather than accidental, and
       "not the home team" is the only thing the data supports. */
    assert.equal(fdr(99, fixture), 4);
});

test('a missing rating is the middle band, not undefined', () => {
    // The divergence this function exists to remove.
    assert.equal(fdr(1, { team_h: 1, team_a: 6 }), 3);
    assert.equal(fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: null }), 3);
    assert.equal(fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: undefined }), 3);
});

test('zero is treated as absent, because there is no band 0', () => {
    /* FPL's scale is 1-5. A 0 in that column is a feed defect, and scoring it
       as "easier than the easiest fixture in the game" would flow straight into
       toughFixtureStarters and the squad health score. */
    assert.equal(fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: 0 }), 3);
});

test('no fixture at all is the middle band rather than a throw', () => {
    /* Blanks are real: a team with no fixture in a gameweek is normal in the
       spring, and every caller maps over a list that can contain a hole. */
    assert.equal(fdr(1, null), 3);
    assert.equal(fdr(1, undefined), 3);
});

test('a numeric string is a number, not a string', () => {
    /* The comparisons downstream are numeric — `difficulty >= 4` decides
       whether a fixture counts as hard — and '4' >= 4 is true by coercion while
       '10' >= 4 is also true. Returning a Number means the band arithmetic
       cannot be accidentally lexical. */
    const out = fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: '2' });
    assert.equal(out, 2);
    assert.equal(typeof out, 'number');
});

test('a rating that is not a number at all falls back', () => {
    assert.equal(fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: 'hard' }), 3);
    assert.equal(fdr(1, { team_h: 1, team_a: 6, team_h_difficulty: NaN }), 3);
});

/* The measured read that goes beside the band is opponentContext(), which
   already existed in player-profile.js and is now in the engine beside this
   function. It is covered where it lives rather than duplicated here — the
   point of moving it was that there be one of it. */
