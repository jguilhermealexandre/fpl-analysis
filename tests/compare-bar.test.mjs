/* The compare bar is hidden by state, never by offset.
   ============================================

   The bar is a fixed panel at the bottom of the viewport that appears once
   you tick a player to compare. There are two copies of its stylesheet:
   styles/compare-report.css, loaded on My Team, and a near-complete duplicate
   inside styles/players.css, loaded on the Players page — 43 of the same 47
   compare-* rules between them.

   They disagreed about the one thing that matters. compare-report.css hides
   it with visibility/opacity/pointer-events; players.css parked it at
   bottom:-100px, which is a guess at the element's own height. The bar is
   115px tall, so fifteen pixels of it stood above the bottom of every Players
   page with nothing selected — visible, and clickable, because an element
   pushed past the viewport edge is still both as far as the browser is
   concerned.

   These should be one file. Until they are, this holds them to hiding it the
   same way, and to a way that cannot be wrong about a height.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** The `.compare-bar { ... }` block — the closed state — from one stylesheet. */
function closedState(file) {
    const css = fs.readFileSync(path.join(ROOT, 'styles', file), 'utf8');
    const at = css.search(/^\.compare-bar\s*\{/m);
    assert.notEqual(at, -1, `${file} should define .compare-bar`);
    const body = css.slice(at, css.indexOf('}', at));
    return { file, body };
}

const SHEETS = ['compare-report.css', 'players.css'];

test('the compare bar is hidden without depending on how tall it is', () => {
    for (const sheet of SHEETS) {
        const { body } = closedState(sheet);

        assert.match(body, /visibility:\s*hidden/, `${sheet}: should hide it outright`);
        assert.match(body, /opacity:\s*0\b/, `${sheet}: and fade it out`);
        assert.match(body, /pointer-events:\s*none/, `${sheet}: and stop it taking clicks`);

        /* The specific bug. A negative offset only hides an element while it
           stays shorter than the number somebody guessed, and nothing fails
           when it grows past it. */
        const offset = body.match(/bottom:\s*(-[\d.]+)px/);
        assert.equal(offset, null,
            `${sheet}: hides the bar by pushing it ${offset && offset[1]}px off-screen; `
            + 'it is 115px tall, so that leaves part of it visible and clickable');
    }
});

test('both copies of the bar agree on how it opens', () => {
    /* Two pages, one component. If the open state drifts the bar animates in
       differently depending on which screen you ticked a player on. */
    const open = SHEETS.map(file => {
        const css = fs.readFileSync(path.join(ROOT, 'styles', file), 'utf8');
        const at = css.search(/^\.compare-bar\.show\s*\{/m);
        assert.notEqual(at, -1, `${file} should define .compare-bar.show`);
        return css.slice(at, css.indexOf('}', at))
            .split('\n').slice(1)
            .map(l => l.trim()).filter(Boolean).sort().join('\n');
    });
    assert.equal(open[0], open[1],
        'compare-report.css and players.css should open the bar identically');
});

test('the bar is only shown when something is selected', () => {
    /* The CSS was the whole fault, but this is the half that has to stay
       true for the CSS fix to mean anything. */
    const js = fs.readFileSync(path.join(ROOT, 'scripts/compare-report.js'), 'utf8');
    const fn = js.slice(js.indexOf('function updateCompareBar'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    assert.match(body, /compareList\.length > 0/, 'it should test the selection');
    assert.match(body, /classList\.add\('show'\)/);
    assert.match(body, /classList\.remove\('show'\)/, 'and take it away again when empty');
});
