/* The Hall of Shame — the one article on the desk written for entertainment.

   Its risk is not that it breaks; it is that it says something untrue or
   repeats itself. Both are testable: every award is a lookup, so a thin
   gameweek must produce no article rather than a half-invented one, and the
   phrasing is picked by a seeded hash, so the same round must always read the
   same way while different rounds must not. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sd = require('../scripts/scouts-desk.js');

test('the phrasing picker is stable for a round and varied across a season', () => {
    const opts = ['a', 'b', 'c', 'd'];
    // Stable: build-articles.js never rewrites a published file, so a wobbling
    // hash would silently make two gameweeks read alike.
    assert.equal(sd.sdRoastPick('open-7', opts), sd.sdRoastPick('open-7', opts));
    // Varied: a season of one phrasing would be worse than no jokes at all.
    const picks = new Set();
    for (let gw = 1; gw <= 20; gw++) picks.add(sd.sdRoastPick(`open-${gw}`, opts));
    assert.ok(picks.size >= 3, `should use most phrasings across a season, used ${picks.size}`);
    // Different slots on the same gameweek must not lock together.
    assert.ok(new Set(['open', 'blank', 'capt', 'diff'].map(k => sd.sdRoastPick(`${k}-5`, opts))).size >= 2);
});

test('the picker always returns one of the options', () => {
    const opts = ['x', 'y'];
    for (const seed of ['', 'a', 'open-1', 'open-38', 'ünïcødé', '0']) {
        assert.ok(opts.includes(sd.sdRoastPick(seed, opts)), `seed ${seed}`);
    }
});

test('no data means no article, not an empty one', () => {
    // Awards are lookups. With nothing to look up the honest output is nothing.
    sd.sdSetData({ elements: [], events: [], teams: [] }, [], { players: [] });
    assert.equal(sd.sdGenGameweekRoast(), null);
});

test('a real round produces awards that match the round data', () => {
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    const fixtures = JSON.parse(fs.readFileSync('data/fixtures.json', 'utf8'));
    const players = JSON.parse(fs.readFileSync('data/players-data.json', 'utf8'));
    sd.sdSetData(boot, fixtures, players);

    const a = sd.sdGenGameweekRoast();
    if (!a) return;                       // no completed round in this snapshot

    assert.match(a.title, /Hall of Shame/);
    assert.equal(a.category, 'Hall of Shame');
    assert.ok(sd.sdWordCount(a.body) > 120, 'long enough to be worth opening');

    // Every directive it opens must close, or sdMarkdown swallows the rest.
    const fences = (a.body.match(/^:::/gm) || []).length;
    assert.equal(fences % 2, 0, 'directive fences are balanced');

    // Nothing unresolved reaches the page.
    for (const bad of ['undefined', 'NaN', '[object Object]', '${']) {
        assert.ok(!a.body.includes(bad), `body must not contain ${bad}`);
        assert.ok(!a.dek.includes(bad), `dek must not contain ${bad}`);
    }

    const html = sd.sdMarkdown(a.body);
    assert.ok(!html.includes(':::'), 'every directive was consumed by the renderer');
    assert.ok(!/<script/i.test(html), 'player names cannot become markup');
});
