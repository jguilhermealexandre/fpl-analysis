/* Is this player available? One classification, two renderings.
 *
 * The same fact was told three ways. Squad Analysis's pitch cards printed a
 * text badge — OUT, or the percentage. The GW Draft table printed an icon, and
 * before that printed nothing at all for several months. The squad TABLE
 * printed nothing: a doubtful player at 75% read as an ordinary row, because
 * his verdict dot said "Monitor" and so does a player with mild form worries.
 *
 * So the PRESENTATION is allowed to differ — a pitch card has room under the
 * face for a word and a dense table row does not — and the classification is
 * not. These tests are on the classification, plus the two renderers agreeing
 * about which players get marked at all.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadFunction } from './helpers/load.mjs';

const COMMON = 'scripts/common.js';
const V2_AVAILABILITY = {
    i: { state: 'out', word: 'Injured', icon: 'cross' },
    u: { state: 'out', word: 'Unavailable', icon: 'cross' },
    s: { state: 'out', word: 'Suspended', icon: 'card' },
    d: { state: 'doubt', word: 'Doubtful', icon: 'bandage' }
};
const avail = loadFunction(COMMON, 'v2Availability', { V2_AVAILABILITY });
const mark = loadFunction(COMMON, 'v2AvailMark', {
    v2Availability: avail,
    v2Icon: (n) => `<svg data-icon="${n}"></svg>`,
    escHTML: (s) => String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
});

test('an available player is not marked at all', () => {
    assert.equal(avail({ status: 'a', chanceNextRound: 100 }), null);
    assert.equal(mark({ status: 'a' }), '', 'and renders nothing, not an empty span');
});

test('the four flagged statuses each get their own word', () => {
    assert.equal(avail({ status: 'i' }).word, 'Injured');
    assert.equal(avail({ status: 'u' }).word, 'Unavailable');
    assert.equal(avail({ status: 's' }).word, 'Suspended');
    assert.equal(avail({ status: 'd', chanceNextRound: 75 }).word, 'Doubtful');
});

test('out and doubt are distinguished by shape, not only by colour', () => {
    /* Colour alone fails anyone who cannot see the difference between red and
       amber, and these two mean different things to plan around. */
    const out = avail({ status: 'i' });
    const doubt = avail({ status: 'd', chanceNextRound: 50 });
    assert.equal(out.state, 'out');
    assert.equal(doubt.state, 'doubt');
    assert.notEqual(out.icon, doubt.icon, 'a different glyph, not just a different colour');
    assert.equal(avail({ status: 's' }).icon, 'card',
        'and a ban is its own shape again — being suspended is not being hurt');
});

test('the chance figure is kept for a doubt and dropped for an absence', () => {
    /* FPL publishes 0 against every injured, suspended and unavailable player.
       "0% chance" next to the word Injured is a number that adds nothing, and
       measured against the live feed all 73 injured, 105 unavailable and 4
       suspended players carry exactly that 0. */
    assert.equal(avail({ status: 'd', chanceNextRound: 75 }).chance, 75);
    assert.equal(avail({ status: 'i', chanceNextRound: 0 }).chance, null);
    assert.equal(avail({ status: 'u', chanceNextRound: 0 }).chance, null);
    assert.equal(avail({ status: 's', chanceNextRound: 0 }).chance, null);
});

test('a doubt with no published figure is still a doubt', () => {
    /* The pitch badge used to require a figure and render nothing without one,
       so a flagged player with no percentage disappeared entirely. Unreachable
       on today's feed — every one of the 41 doubtful players carries a 50 or a
       75 — but the wrong way round to fail. */
    const a = avail({ status: 'd', chanceNextRound: null });
    assert.ok(a, 'marked');
    assert.equal(a.chance, null);
    assert.equal(a.label, 'Doubtful', 'and the label does not invent a number');
    assert.match(mark({ status: 'd' }), /aria-label="Doubtful"/);
});

test('100% is not a doubt worth marking', () => {
    // FPL reports 100 for a player it has flagged but expects to play anyway.
    assert.equal(avail({ status: 'd', chanceNextRound: 100 }).chance, null);
});

test('the label carries the chance so a screen reader gets it too', () => {
    assert.equal(avail({ status: 'd', chanceNextRound: 50 }).label,
        'Doubtful, 50% chance of playing');
    assert.match(mark({ status: 'd', chanceNextRound: 50 }),
        /aria-label="Doubtful, 50% chance of playing"/);
});

test("the detail is FPL's own words where it has any", () => {
    const a = avail({ status: 'i', news: 'Hamstring injury - expected back 25 Oct' });
    assert.equal(a.detail, 'Hamstring injury - expected back 25 Oct');
    assert.equal(avail({ status: 'i', news: '' }).detail, 'Injured', 'the status otherwise');
    assert.equal(avail({ status: 'i', news: '   ' }).detail, 'Injured', 'whitespace is not news');
});

test('news reaches the tooltip escaped', () => {
    /* FPL writes this field. It has carried an apostrophe for as long as the
       game has existed, and it lands in an attribute. */
    const html = mark({ status: 'i', news: `O'Brien <script>alert(1)</script>` });
    assert.ok(!html.includes('<script>'), 'no raw tag');
    assert.match(html, /&#39;Brien/);
    assert.match(html, /&lt;script&gt;/);
});

test('the mark is announced as one thing, not as a stray graphic', () => {
    const html = mark({ status: 'i' });
    assert.match(html, /role="img"/);
    assert.match(html, /class="v2-avail out"/);
    assert.match(html, /data-icon="cross"/);
});

test('every status the live feed actually uses is classified', () => {
    /* The guard against FPL adding a fifth. Anything other than 'a' that this
       returns null for is a flagged player the site would show as fine. */
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    const unclassified = new Set();
    for (const e of boot.elements) {
        if (e.status === 'a') continue;
        if (!avail({ status: e.status, chanceNextRound: e.chance_of_playing_next_round })) {
            unclassified.add(e.status);
        }
    }
    assert.deepEqual([...unclassified], [],
        `unclassified statuses in the live feed: ${[...unclassified].join(', ')}`);
});
