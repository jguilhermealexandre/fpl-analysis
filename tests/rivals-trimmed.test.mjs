/* Three blocks removed from the Rivals page, and the crash that removing them
 * nearly shipped.
 *
 * Insights lost Priority Transfers and the threat-and-damage-control matrix;
 * Captain Race lost the swing calculator; Squad Strength lost the Fixture
 * Difficulty Ranking.
 *
 * THE HAZARD, and the reason this file exists rather than a line in a commit
 * message. Deleting the markup is the easy half. renderInsights() went on
 * calling document.getElementById('actionBox').style.display on an element
 * that no longer existed — a TypeError thrown midway through the function that
 * fills Missing Templates and Your Differentials, so removing a box nobody
 * wanted would have emptied the two panels underneath it. The test below is
 * therefore not "is it gone" but "is anything still reaching for it".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const PAGE = 'fpl-league-rivals.html';
const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');

/* Everything the three blocks owned: element ids, renderers, and the one
   constant that only the threat matrix used. */
const GONE_IDS = ['actionBox', 'actionItems', 'threatMatrix', 'capSwing', 'strengthGrid'];
const GONE_FNS = ['renderThreatMatrix', 'updateCaptainSwing', 'renderFixtureDifficulty'];

test('the three blocks are out of the markup', () => {
    for (const id of GONE_IDS) {
        assert.equal(html.includes(`id="${id}"`), false, `#${id} should not be rendered`);
    }
    /* As MARKUP, not as a string. "Priority Transfers" is still written in the
       note recording why the box went, and an assertion that cannot tell a
       heading from a comment forbids writing the reason down — which is the
       third time that has caught me on this codebase. */
    assert.doesNotMatch(html, /Priority Transfers\s*<\/h3>/, 'the Priority Transfers heading');
    assert.doesNotMatch(html, /Captain swing calculator\s*<\/div>/, 'the swing calculator heading');
    assert.doesNotMatch(html, /Fixture Difficulty Ranking\s*<\/h2>/, 'the FDR ranking heading');
});

test('and nothing is still reaching for them', () => {
    /* The actual bug risk. A dangling getElementById returns null and the next
       property access throws, taking the rest of the function with it. */
    for (const id of GONE_IDS) {
        assert.equal(html.includes(`getElementById('${id}')`), false,
            `something still looks up #${id}, which now returns null`);
    }
    for (const fn of GONE_FNS) {
        assert.equal(new RegExp(`\\b${fn}\\s*\\(`).test(html), false,
            `${fn} is called or defined somewhere still`);
    }
    assert.equal(html.includes('THREAT_HAUL'), false, 'the threat matrix constant went with it');
});

test('renderInsights still fills the two panels that stayed', () => {
    /* The function the crash would have broken. Both of these are the reason
       anybody opens the tab. */
    const i = html.indexOf('function renderInsights(');
    assert.ok(i > 0, 'renderInsights must still exist');
    const body = html.slice(i, html.indexOf('\n        }', i));
    assert.match(body, /missingGrid/, 'Missing Templates is still filled');
    assert.match(body, /diffGrid/, 'and Your Differentials');
    assert.match(body, /missingCountLabel/);
    assert.match(body, /diffCountLabel/);
});

test('the sections around the deletions are untouched', () => {
    for (const heading of [
        'Missing Templates', 'Your Differentials', 'How This League Picks',
        'Captain Consensus', 'Captain Choices', 'Position Comparison',
        'Most Popular XI', 'Full Ownership Matrix'
    ]) {
        assert.ok(html.includes(heading), `${heading} should still be on the page`);
    }
});

test('the captain section still draws its distribution and its hero', () => {
    // What the swing calculator sat beside, and the part worth keeping.
    assert.match(html, /cap-dist-head/, 'the armband distribution stays');
    assert.match(html, /id="captainHero"/, 'and the hero card');
});

test('squad strength keeps the comparisons that are not the FDR table', () => {
    assert.match(html, /renderPositionComparison\(\)/);
    assert.match(html, /renderTemplateXI\(\)/);
});

test('the inline script is still balanced after four cuts', () => {
    /* Three functions and several markup blocks came out of one 86 KB inline
       script. check:inline parses it in CI; this is the cheap local version —
       brace and div counts, which is what a mis-sliced deletion breaks first. */
    const scripts = [...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)]
        .filter(m => !/\ssrc\s*=/.test(m[1])).map(m => m[2]).join('\n;\n');
    assert.equal(scripts.split('{').length, scripts.split('}').length,
        'braces balance in the inline script');
    assert.equal(html.split('<div').length, html.split('</div>').length,
        'and every div the deletions touched was closed');
});
