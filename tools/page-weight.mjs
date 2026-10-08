#!/usr/bin/env node
/* What each page actually costs a browser, with a budget it cannot quietly exceed.
   ============================================

   THE PROBLEM THIS EXISTS FOR. fpl-my-team-analysis.html loads 26 scripts and 11
   stylesheets and comes to just over a megabyte. Nobody decided that; it
   accumulated, one reasonable addition at a time, because nothing was counting.
   The same way, fpl-players-analysis.html carries 277KB of JavaScript inline in
   the HTML — never minified, because the build only touches scripts/, and
   re-downloaded in full on every visit, because inline code cannot be cached
   separately from the page.

   A budget turns that from a thing somebody notices one day into a thing the
   build refuses. Budgets are seeded at today's measured numbers, so they can
   only ever be ratcheted DOWN: any change that makes a page heavier fails, and
   `--update` is the deliberate act of recording an improvement.

   WHY RAW BYTES AND NOT GZIP. gzip is what crosses the wire, and it is the
   number that matters for a cold load — but zlib's output moves between
   versions, so a budget on it would fail on a runner upgrade rather than on a
   regression. Raw bytes are deterministic and are what the parser actually has
   to chew through, which is the cost that survives a warm cache. Gzip is
   reported beside it, ungated, because it is still the honest transfer figure.

   WHAT IS COUNTED. The HTML, its inline <script> blocks, and every local file it
   references with <script src> or <link rel=stylesheet>. That is the critical
   path: what a browser must have before the page is usable.

   WHAT IS NOT. Runtime fetches — data/*.json, the nav partials pulled in by
   loadSidebarNav(), lazily-loaded tab scripts. They are real weight but they are
   not attributable to one page from the markup alone, and guessing would make
   the number softer than it looks. The partials are measured and printed
   separately so they are not simply forgotten.

   Usage:
     node tools/page-weight.mjs            report every page
     node tools/page-weight.mjs --check    exit 1 if any page is over budget
     node tools/page-weight.mjs --update   rewrite the budgets to today's numbers
*/
import fs from 'node:fs';
import zlib from 'node:zlib';

const BUDGETS = 'tools/page-budgets.json';

/* Fetch-injected fragments, not navigable pages. They have no <title> and no
   <html lang>, they are pulled in at runtime by loadSidebarNav() and
   loadFooter(), and attributing their bytes to a page would double-count them
   across the thirteen that share one copy. Measured separately below. */
const PARTIALS = ['sidebar-nav.html', 'landing-nav.html', 'footer.html'];

const bytes = (p) => fs.statSync(p).size;
const gz = (buf) => zlib.gzipSync(buf, { level: 9 }).length;

/* Local assets a page pulls in before it is usable. The ?v= is the asset
   version and is not part of the path; a reference that does not resolve is a
   broken page and is reported rather than counted as nothing. */
function refs(html, page) {
    const out = { js: [], css: [], missing: [] };
    const add = (list, raw) => {
        if (/^(https?:)?\/\//.test(raw) || raw.startsWith('data:')) return;   // third party
        const rel = raw.split('?')[0].replace(/^\//, '');
        if (!rel) return;
        if (fs.existsSync(rel)) list.push(rel);
        else out.missing.push(`${page} -> ${raw}`);
    };
    for (const m of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) add(out.js, m[1]);
    for (const m of html.matchAll(/<link[^>]*\srel="stylesheet"[^>]*\shref="([^"]+)"/g)) add(out.css, m[1]);
    /* The signed-in stylesheet is appended by four lines of inline script rather
       than linked, because whether a visitor needs it is a question about
       localStorage — see tools/app-css-snippet.txt. It is on the critical path
       for every signed-in reader, so it counts. */
    for (const m of html.matchAll(/['"]\/?(styles\/[\w.-]+\.css)\?v=/g)) add(out.css, m[1]);
    return out;
}

/* Comments first, and this is not tidiness.
 *
 * fpl-my-team-analysis.html carries a comment that says "...identical to the
 * <script src> below...". Matching `<script` against the raw file found that
 * text, failed to see a real src attribute on it, and then let `.*?</script>`
 * run to the next real closing tag — scoring 34KB of inline JavaScript on a page
 * that has 1KB of it. Players scored 181KB the same way. Measuring markup means
 * ignoring the parts of the file that are not markup. */
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');

/* Inline JavaScript means inline JavaScript. A <script type="application/json">
 * manifest and a <script type="application/ld+json"> block are data the parser
 * hands to something else, not code it runs — and counting them would mean that
 * adding structured data, which Phase 3 wants more of, could fail the inline-JS
 * ratchet. Only an absent type, or an explicitly JavaScript one, is code. */
function inlineJsBytes(html) {
    let n = 0;
    for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
        const attrs = m[1];
        if (/\ssrc\s*=/.test(attrs)) continue;
        const type = /\stype\s*=\s*"([^"]*)"/.exec(attrs);
        if (type && !/^(text|application)\/(java|ecma)script$/i.test(type[1].trim())) continue;
        n += Buffer.byteLength(m[2], 'utf8');
    }
    return n;
}

function measure(page) {
    const raw = fs.readFileSync(page, 'utf8');
    const html = stripComments(raw);
    const inlineJs = inlineJsBytes(html);
    const r = refs(html, page);
    const uniq = (a) => [...new Set(a)];
    const jsFiles = uniq(r.js), cssFiles = uniq(r.css);
    const js = jsFiles.reduce((n, f) => n + bytes(f), 0);
    const css = cssFiles.reduce((n, f) => n + bytes(f), 0);
    /* The page's own bytes as SHIPPED, comments and all — a comment is still
       downloaded. Only the scanning above works on the stripped copy. */
    const htmlB = Buffer.byteLength(raw, 'utf8');
    const gzTotal = gz(Buffer.concat([
        Buffer.from(raw, 'utf8'),
        ...jsFiles.map(f => fs.readFileSync(f)),
        ...cssFiles.map(f => fs.readFileSync(f))
    ]));
    return { page, html: htmlB, inlineJs, js, css, total: htmlB + js + css,
        gzTotal, jsCount: jsFiles.length, cssCount: cssFiles.length, missing: r.missing };
}

const argv = process.argv.slice(2);
const mode = argv.includes('--check') ? 'check' : argv.includes('--update') ? 'update' : 'report';

const pages = fs.readdirSync('.')
    .filter(f => f.endsWith('.html') && !PARTIALS.includes(f))
    .sort();
const rows = pages.map(measure);
const budgets = fs.existsSync(BUDGETS) ? JSON.parse(fs.readFileSync(BUDGETS, 'utf8')) : { pages: {} };

const kb = (n) => (n / 1024).toFixed(0).padStart(6);
const problems = [];

if (mode === 'update') {
    const next = {
        _comment: 'Measured ceilings, not targets. Seeded from the real files by '
            + '`node tools/page-weight.mjs --update`; `--check` fails if a page grows past '
            + 'one. Ratchet DOWN as pages get lighter — never up to make a build pass.',
        pages: {}
    };
    for (const r of rows) next.pages[r.page] = { total: r.total, inlineJs: r.inlineJs };
    fs.writeFileSync(BUDGETS, JSON.stringify(next, null, 2) + '\n');
    console.log(`Wrote ${BUDGETS} for ${rows.length} pages.`);
} else {
    console.log('page                             html  inlineJS      js     css     TOTAL    gzip  files');
    for (const r of rows) {
        const b = budgets.pages[r.page];
        let flag = '';
        if (b) {
            if (r.total > b.total) {
                flag = ' OVER';
                problems.push(`${r.page}: total ${(r.total / 1024).toFixed(0)}KB over budget ${(b.total / 1024).toFixed(0)}KB`);
            }
            /* Inline JavaScript gets its own ceiling because it is the one number
               with a direction: every page is being emptied of it, and a page
               that gains some back has gone the wrong way even if the total
               happens to have fallen. */
            if (r.inlineJs > b.inlineJs) {
                flag = ' OVER';
                problems.push(`${r.page}: inline JS ${(r.inlineJs / 1024).toFixed(1)}KB over budget ${(b.inlineJs / 1024).toFixed(1)}KB`);
            }
        }
        console.log(`${r.page.padEnd(32)}${kb(r.html)}${kb(r.inlineJs)}${kb(r.js)}${kb(r.css)}${kb(r.total)}${kb(r.gzTotal)}  ${r.jsCount}js/${r.cssCount}css${flag}`);
    }
    const heaviest = [...rows].sort((a, b) => b.total - a.total)[0];
    const inline = rows.reduce((n, r) => n + r.inlineJs, 0);
    console.log(`\n${rows.length} pages. Heaviest: ${heaviest.page} at ${(heaviest.total / 1024).toFixed(0)}KB.`);
    console.log(`Inline JavaScript still in markup, all pages: ${(inline / 1024).toFixed(0)}KB.`);

    const missing = rows.flatMap(r => r.missing);
    if (missing.length) {
        problems.push(...missing.map(m => `unresolved reference: ${m}`));
    }
    for (const f of PARTIALS.filter(fs.existsSync)) {
        console.log(`  partial (fetched at runtime, not in any page's budget): ${f} ${(bytes(f) / 1024).toFixed(0)}KB`);
    }
}

if (mode === 'check') {
    if (problems.length) {
        for (const p of problems) console.error(`::error::${p}`);
        console.error(`\n✗ ${problems.length} page-weight problem(s). Either make the page lighter, `
            + `or record a deliberate increase with \`node tools/page-weight.mjs --update\`.`);
        process.exit(1);
    }
    console.log('\n✓ every page is inside its weight budget');
}
