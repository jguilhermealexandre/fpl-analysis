/* Three lists that have to say the same thing.
 *
 *   _redirects              which URLs serve an app page
 *   dashboard-gate.js       which of those need a Team ID
 *   <meta name="robots">    which of those may be indexed
 *
 * They drifted, and the way they drifted is instructive: every app page moved
 * under /dashboard/ except one. /squad-analysis is served from
 * fpl-my-team-analysis.html at 200, and the gate tested
 * path.indexOf('/dashboard') !== 0 — so the deepest page in the product, the
 * whole squad with the wizards and the draft planner, opened for anyone who
 * typed that URL. Nothing was broken, nothing errored, and the page looked
 * exactly as it should. The only way to see it was to ask all three lists the
 * same question and notice one of them answering differently.
 *
 * The rule this fixes in place: a page served under an app URL is either open
 * on purpose and indexable, or gated and noindex. There is no third state,
 * and adding a page without choosing one fails here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const gate = read('scripts/dashboard-gate.js');

/* The gate's own lists, read out of the gate rather than restated here — a
   test carrying its own copy of the thing it checks tests nothing. */
function listInGate(name) {
    const open = gate.indexOf(`var ${name} = [`);
    assert.ok(open > -1, `${name} not found in dashboard-gate.js`);
    const start = gate.indexOf('[', open) + 1;
    const end = gate.indexOf(']', start);
    return gate.slice(start, end).split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
}

/* Every 200-rewrite in _redirects: the URL people actually visit, and the file
   that answers it. */
function appRoutes() {
    const out = [];
    for (const line of read('_redirects').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const [from, to, code] = t.split(/\s+/);
        if (code !== '200' || !to.endsWith('.html')) continue;
        out.push({ from, file: to.replace(/^\//, '') });
    }
    return out;
}

test('every app URL is either in the gate or behind it', () => {
    const APP = listInGate('APP');
    const uncovered = appRoutes()
        .map(r => r.from.replace(/\/\*$/, '').replace(/\/+$/, '') || '/')
        .filter(p => p !== '/index.html')
        .filter(p => !APP.some(a => p === a || p.startsWith(a + '/')));
    assert.deepEqual(uncovered, [],
        'these serve an app page at a URL the gate never looks at — it returns before it reads anything');
});

test('what is gated is not indexed, and what is submitted is not gated', () => {
    /* Three states, not two, and the ID page is why: it needs no Team ID — it
       is where the gate sends people — and it must never be indexed, because
       it is a sign-in form. So "open" does not imply "indexable".
     *
     * sitemap.xml is the site's own statement of what it wants in the index,
     * so it is the third list to hold the other two against:
     *
     *   gated            noindex, and absent from the sitemap
     *   open, submitted  indexable — the Scout's Desk and the News Hub are
     *                    free reads and the whole point is that they rank
     *   open, noindex    fine, as long as nothing submits it
     */
    const OPEN = listInGate('OPEN');
    const sitemap = new Set([...read('sitemap.xml')
        .matchAll(/<loc>https:\/\/easyfpl\.com(\/[^<]*)<\/loc>/g)]
        .map(m => m[1].replace(/\/+$/, '') || '/'));
    const wrong = [];
    for (const { from, file } of appRoutes()) {
        if (!fs.existsSync(path.join(ROOT, file))) continue;
        if (file === 'index.html') continue;   // the landing page, judged at /
        const url = from.replace(/\/\*$/, '').replace(/\/+$/, '') || '/';
        const noindex = /<meta name="robots" content="[^"]*noindex/.test(read(file));
        const submitted = sitemap.has(url);
        if (!OPEN.includes(url)) {
            if (!noindex) wrong.push(`${url} (${file}) needs a Team ID but may be indexed`);
            if (submitted) wrong.push(`${url} (${file}) needs a Team ID and is in the sitemap`);
        } else if (submitted && noindex) {
            wrong.push(`${url} (${file}) is submitted for indexing and refuses to be indexed`);
        }
    }
    assert.deepEqual(wrong, []);
});

test('the gate runs on every page it is responsible for', () => {
    /* In <head>, synchronously, or it decides after the dashboard has already
       been drawn — which is the flicker the whole file exists to avoid.
       The ID page is exempt: it is the place the gate sends people, and it is
       in OPEN, so loading the gate there would only ask it to return. */
    const OPEN = listInGate('OPEN');
    const missing = [];
    for (const { from, file } of appRoutes()) {
        if (!fs.existsSync(path.join(ROOT, file))) continue;
        const url = from.replace(/\/\*$/, '').replace(/\/+$/, '') || '/';
        if (OPEN.includes(url)) continue;
        const html = read(file);
        const head = html.slice(0, html.indexOf('</head>'));
        if (!/<script src="\/scripts\/dashboard-gate(\.min)?\.js/.test(head)) missing.push(file);
    }
    assert.deepEqual(missing, [], 'these answer an app URL without loading the gate in <head>');
});

test('signing in returns you to the page the gate took you from', () => {
    /* The gate writes ?next= for anything in APP; welcome.html reads it back
       and refuses anything outside the app, because a redirect parameter taken
       at its word turns our own domain into a redirector to anyone else's.
       Two lists again: the one that writes and the one that reads. */
    const guard = /return \/\^\\\/\(([^)]*)\)/.exec(read('welcome.html'));
    assert.ok(guard, 'the ?next= guard in welcome.html should be a path pattern');
    const accepted = guard[1].split('|');
    const written = listInGate('APP').map(a => a.replace(/^\//, ''));
    assert.deepEqual(accepted.sort(), written.sort(),
        'the gate sends a ?next= from here and the ID page would throw it away');
});

test('the gate knows exactly the routes _redirects serves', () => {
    /* _redirects answers everything under /dashboard/ with index.html at 200,
       so the list of what actually exists is in the gate, and the two have to
       agree in both directions: a route in the table and not in the gate is
       sent to the 404 page it can reach, and a route in the gate and not in
       the table is a name for nothing. */
    const OPEN = listInGate('OPEN');
    const KNOWN = listInGate('KNOWN');
    const claims = new Set([...OPEN, ...KNOWN]);
    const served = new Set(appRoutes()
        .map(r => r.from.replace(/\/\*$/, '').replace(/\/+$/, '') || '/')
        .filter(p => p === '/dashboard' || p.startsWith('/dashboard/')));

    const unlisted = [...served].filter(p => !claims.has(p));
    const invented = [...claims].filter(p => !served.has(p));
    assert.deepEqual(unlisted, [], 'served by _redirects, but the gate sends them to /404.html');
    assert.deepEqual(invented, [], 'the gate treats these as real and _redirects has no rule for them');
});
