/* Strings other people wrote, and the places they reach the parser.
 *
 * THE BUG THIS EXISTS FOR. showStatus() on the League Rivals page assigned its
 * message into innerHTML, and two of its callers passed
 * `leagueData.league.name` — a string typed by whoever created the league. A
 * league named `<img src=x onerror=...>` ran its own markup in the browser of
 * every member who opened that page, and script-src carries 'unsafe-inline', so
 * an injected handler executes rather than being inert. `err.message` reached it
 * too, from a proxy response nobody here controls.
 *
 * WHAT MAKES THIS CLASS DIFFERENT from ordinary escaping bugs. Almost every
 * string on this site comes from FPL's own curated data — player names, club
 * names, fixture details — and FPL is not an attacker. Three fields are not like
 * that. A league name, a manager's own name and their team name are free text
 * entered by other users, and the Rivals page renders all three. The comment on
 * escHTML in scripts/common.js names this page for exactly that reason.
 *
 * So these are text assertions on the source, deliberately, in the same spirit
 * as tests/tab-scripts.test.mjs: the property being held is "this function
 * cannot put its argument through the HTML parser", and no amount of calling it
 * in a harness demonstrates that for the caller somebody adds next week.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* The body of a top-level function, by brace matching. The same walk
   tests/helpers/load.mjs uses, and good enough for the question here: does this
   function mention innerHTML at all. */
function body(src, name) {
    const start = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
    assert.ok(start >= 0, `${name} not found`);
    let i = src.indexOf('{', start), depth = 0, end = i;
    for (; end < src.length; end++) {
        if (src[end] === '{') depth++;
        else if (src[end] === '}' && --depth === 0) break;
    }
    return src.slice(start, end + 1);
}

test('showStatus puts its message through textContent, never innerHTML', () => {
    const fn = body(read('fpl-league-rivals.html'), 'showStatus');
    assert.ok(!/innerHTML/.test(fn),
        'the status bar message is text written by other users — innerHTML parses it');
    assert.match(fn, /textContent/, 'and textContent is how it stays text');
});

test('every showStatus caller passes text, not markup', () => {
    /* The fix holds because no caller wants markup. If one ever does, it has to
       build its own nodes rather than quietly turning the sink back into a
       parser. */
    const html = read('fpl-league-rivals.html');
    const callers = [...html.matchAll(/showStatus\(([\s\S]{0,200}?),\s*'(?:error|success|loading)'\)/g)];
    assert.ok(callers.length >= 8, `expected the real call sites, found ${callers.length}`);
    for (const [, arg] of callers) {
        assert.ok(!/<\w/.test(arg), `a caller passes markup: ${arg.slice(0, 80)}`);
    }
});

test('the three user-written fields never reach a markup sink unescaped', () => {
    /* player_name and entry_name are set by each manager in their own FPL
       account; league.name by whoever opened the league.

       Scoped to the SINKS — innerHTML and insertAdjacentHTML — rather than to
       every `${...}` that mentions one of the fields. A first cut did the
       latter and reported four faults that were not faults: the two showStatus
       callers and an `opt.textContent = ...` line all interpolate a league or
       manager name into a string that never meets the parser. Flagging those
       teaches the next reader to ignore this test, which is worse than not
       having it. Markup assignment is explicit in the source, so the sink is
       the thing worth watching. */
    const html = read('fpl-league-rivals.html');
    const TAINTED = /player_name|entry_name|league\.name/;
    const bad = [];
    for (const line of html.split('\n')) {
        const code = line.replace(/\/\/.*$/, '');
        if (!/innerHTML\s*=|insertAdjacentHTML\s*\(/.test(code)) continue;
        if (!TAINTED.test(code)) continue;
        if (/escHTML/.test(code)) continue;
        bad.push(code.trim().slice(0, 100));
    }
    assert.deepEqual(bad, [], 'a user-written name is written into markup unescaped');
});

test('the markdown the article generator emits is escaped before it becomes HTML', () => {
    /* scouts-desk.js builds articles as markdown and interpolates player names
       into them in a hundred places. That is only safe because the renderer
       escapes on the way out — if it ever stops, every one of those becomes a
       sink at once. */
    const sd = read('scripts/scouts-desk.js');
    const fn = body(sd, 'sdMarkdown');
    assert.match(fn, /replace\(\/&\/g/, 'sdMarkdown must escape ampersands');
    assert.match(fn, /replace\(\/</, 'and angle brackets');
});
