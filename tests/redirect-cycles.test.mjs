/* A 200 rewrite whose target is also the source of a redirect is a loop.
 *
 * It was, for a day, and it broke signing in. /dashboard/login is served by
 * rewriting it to /welcome.html, and Cloudflare Pages serves an asset at its
 * clean URL — /welcome.html IS /welcome. So adding
 *
 *     /welcome   /dashboard/login   301
 *
 * put the rewrite's own target on the left of a rule pointing back to where
 * the request came from, and /dashboard/login bounced to /welcome bounced to
 * /dashboard/login until the browser gave up.
 *
 * The rule was added for a good reason and reviewed: the canonical tag on
 * those pages named a URL that served a duplicate instead of redirecting, and
 * a redirect is the tidier answer. What made it look safe is that the .html
 * spellings directly above it have the same shape on paper —
 * /fpl-my-team-analysis.html 301s to /dashboard/my-team while
 * /dashboard/my-team rewrites to /fpl-my-team-analysis.html — and have been
 * live for weeks without looping. The difference is that the rewrite target
 * is ALREADY the .html form, so nothing normalises it into a rule; the
 * extensionless form is what the target becomes.
 *
 * Hence the asymmetry below, which is not an oversight: the .html spelling of
 * a rewrite target may be a redirect source, and the bare spelling may not.
 *
 * Nothing in the dev server reproduces this — it has no clean-URL layer — so
 * a browser test would have passed too. The file has to be read as the rules
 * Pages will actually apply.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function rules() {
    const out = [];
    for (const line of fs.readFileSync(path.join(ROOT, '_redirects'), 'utf8').split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const [from, to, code] = t.split(/\s+/);
        if (from && to && code) out.push({ from, to, code });
    }
    return out;
}

test('no 200 rewrite points at a page that redirects back', () => {
    const all = rules();
    const sources = new Map(all.map(r => [r.from, r]));
    const loops = [];
    for (const r of all) {
        if (r.code !== '200' || !r.to.endsWith('.html')) continue;
        const clean = r.to.replace(/\.html$/, '');
        const back = sources.get(clean);
        if (!back) continue;
        loops.push(`${r.from} rewrites to ${r.to}, which Pages also serves at ${clean} — `
            + `and ${back.from} ${back.code}s to ${back.to}`);
    }
    assert.deepEqual(loops, [],
        'the clean URL of a rewrite target must not be a redirect source; that is a loop');
});

test('every 200 rewrite names a file that exists', () => {
    /* The other way this goes wrong quietly: a rewrite to a page that was
       renamed serves the 404 and nothing says which rule did it. */
    const missing = rules()
        .filter(r => r.code === '200' && r.to.endsWith('.html'))
        .filter(r => !fs.existsSync(path.join(ROOT, r.to.replace(/^\//, ''))))
        .map(r => `${r.from} -> ${r.to}`);
    assert.deepEqual(missing, []);
});

test('the named dashboard routes come before the catch-alls', () => {
    /* First match wins, so a /dashboard/* rule above /dashboard/players would
       serve the wrong page for every one of them. */
    const all = rules();
    const star = all.findIndex(r => r.from === '/dashboard/*');
    if (star === -1) return;                       // no catch-all, nothing to order
    const after = all.slice(star + 1).filter(r => r.from.startsWith('/dashboard/') && !r.from.includes('*'));
    assert.deepEqual(after.map(r => r.from), [],
        'these sit below /dashboard/* and can never be reached');
});
