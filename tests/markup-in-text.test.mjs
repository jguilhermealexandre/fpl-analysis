/* textContent is not for markup, and the panel heading kept forgetting.
 *
 * v2Icon() returns a string of SVG. Assigned with textContent it is not an
 * icon, it is the characters "<svg class=..." printed across the top of the
 * slide-in panel — which is what the Auto-optimise report, the GW Draft
 * report, the Lineup Wizard report and the auto-suggest summary all did. It
 * was found once, in the gameweek review, and fixed there with a comment
 * describing exactly this bug; the other four went on doing it, because the
 * fix went to the call site instead of to the thing being called.
 *
 * They all go through v2SetPanelTitle() now, which takes the icon and the
 * words as separate arguments so the two cannot be confused. This keeps the
 * next one honest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function sources() {
    const out = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'scripts'))) {
        if (!f.endsWith('.js') || f.endsWith('.min.js')) continue;
        out.push(['scripts/' + f, fs.readFileSync(path.join(ROOT, 'scripts', f), 'utf8')]);
    }
    for (const f of fs.readdirSync(ROOT)) {
        if (f.endsWith('.html')) out.push([f, fs.readFileSync(path.join(ROOT, f), 'utf8')]);
    }
    return out;
}

test('nothing assigns markup to textContent', () => {
    const bad = [];
    for (const [name, src] of sources()) {
        /* The assigned expression, up to the end of the line. Enough to see a
           tag or an icon call in it; a multi-line template is not a thing any
           of these are. */
        for (const m of src.matchAll(/\.textContent\s*=\s*([^\n;]+)/g)) {
            const value = m[1];
            if (!/<\/?[a-zA-Z]|v2Icon\s*\(/.test(value)) continue;
            const line = src.slice(0, m.index).split('\n').length;
            bad.push(`${name}:${line}  ${value.trim().slice(0, 78)}`);
        }
    }
    assert.deepEqual(bad, [],
        'these print their own markup as text — use innerHTML with escaped words, or v2SetPanelTitle()');
});

test('the shared panel title escapes the words and not the icon', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/common.js'), 'utf8');
    const fn = /function v2SetPanelTitle\([\s\S]*?\n}/.exec(src);
    assert.ok(fn, 'v2SetPanelTitle should exist in common.js');
    assert.match(fn[0], /escHTML\(String\(text\)\)/, 'the words have to be escaped');
    assert.match(fn[0], /innerHTML/, 'the icon has to go in as markup or it is text again');
});
