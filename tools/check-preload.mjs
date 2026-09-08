#!/usr/bin/env node
/* Preload hints must name exactly the scripts the page loads.

   Three pages carry <link rel="preload" as="script"> for their classic scripts.
   The tags themselves could not simply be moved into <head> or deferred, which
   is the usual fix: the inline block that follows them calls initIcons(),
   loadFooter() and friends at parse time, so hoisting or deferring the files
   that define those functions runs the caller before the callee and the block
   throws on its first line. Preloading leaves execution order untouched and
   only changes when the bytes start arriving.

   The price of that is a second copy of the file list, and a duplicated list
   rots. Both directions of drift are silent:

     preloaded, never loaded  the file is fetched, parsed and thrown away, and
                              the browser logs an unused-preload warning into a
                              console nobody has open
     loaded, never preloaded  a script added later quietly sits outside the
                              hint, and the slow path comes back for it

   Neither shows up as an error anywhere, which is the same shape as the bugs
   check:globals and check:versions exist to catch.

   A page with no preloads at all is skipped, so this is opt-in per page: adding
   the first <link rel="preload"> to a page is what turns the rule on for it. */
import fs from 'node:fs';

const problems = [];
let covered = 0;

for (const page of fs.readdirSync('.').filter(f => f.endsWith('.html')).sort()) {
    /* Comments are stripped first. The preload blocks explain themselves in
       prose that mentions <script src>, and that would otherwise be read as
       markup by the patterns below. */
    const html = fs.readFileSync(page, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

    const preloaded = (html.match(/<link\b[^>]*>/g) || [])
        .filter(tag => /\brel="preload"/.test(tag) && /\bas="script"/.test(tag))
        .map(tag => (tag.match(/\bhref="([^"]+)"/) || [])[1])
        .filter(Boolean);

    if (!preloaded.length) continue;
    covered++;

    /* Cross-origin scripts are left out on purpose: preloading one has to match
       its crossorigin and integrity attributes exactly or the browser fetches it
       a second time, so those are handled with preconnect instead. */
    const loaded = [...new Set((html.match(/<script\b[^>]*>/g) || [])
        .map(tag => (tag.match(/\bsrc="([^"]+)"/) || [])[1])
        .filter(url => url && !/^https?:/i.test(url)))];

    for (const url of new Set(preloaded.filter((u, i) => preloaded.indexOf(u) !== i))) {
        problems.push(`${page}: preloaded twice — ${url}`);
    }
    for (const url of preloaded.filter(u => !loaded.includes(u))) {
        problems.push(`${page}: preloaded but never loaded — ${url}`);
    }
    for (const url of loaded.filter(u => !preloaded.includes(u))) {
        problems.push(`${page}: loaded but never preloaded — ${url}`);
    }
}

if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    console.error(`\n${problems.length} preload mismatch(es). A page's <link rel="preload"> list must`);
    console.error('match its <script src> list exactly, ?v= included.');
    process.exit(1);
}

console.log(`✓ preload hints match the scripts loaded on all ${covered} page(s) using them`);
