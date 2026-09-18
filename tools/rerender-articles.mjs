#!/usr/bin/env node
/* Re-renders the prose of every published article page from the markdown
   that produced it.

   The reader modal renders data/articles/<slug>.json at runtime, so it picks
   up any change to sdMarkdown immediately. The permalink pages bake the
   rendered HTML in at build time, and the builder deliberately never
   rewrites a file it has already written — which is right for the words and
   wrong for the markup around them. Without this, a change to how an
   article is laid out reaches the modal and never reaches the page you get
   when you share the link.

   Only the <div class="sd-prose">…</div> body is replaced. Title, dek,
   dates, meta and every other tag in the file are left exactly as they
   were: the words are not being rewritten, only re-marked-up. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sdMarkdown } = require('../scripts/scouts-desk.js');
const { sdArtwork } = require('../scripts/scouts-art.js');

const PROSE = /(<div class="sd-prose">)([\s\S]*?)(<\/div>\s*<div class="sd-reader-foot">)/;
/* The generated hero. Matched whether or not the page already has one, so a
   re-run replaces it rather than stacking a second copy above the first. */
const HERO = /(<article class="sd-reader-body">\s*)(?:<!--[\s\S]*?-->\s*)?(?:<div class="sd-standalone-art">[\s\S]*?<\/div>\s*)?(<div class="sd-tags">)/;

let changed = 0, skipped = 0;
for (const file of fs.readdirSync('articles').filter(f => f.endsWith('.html'))) {
    const slug = path.basename(file, '.html');
    const jsonPath = `data/articles/${slug}.json`;
    if (!fs.existsSync(jsonPath)) { skipped++; continue; }

    const article = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const body = article.body;
    if (!body) { skipped++; continue; }

    const htmlPath = `articles/${file}`;
    const html = fs.readFileSync(htmlPath, 'utf8');
    if (!PROSE.test(html)) { skipped++; continue; }

    let next = html.replace(PROSE, (_, open, _old, close) => open + sdMarkdown(body) + close);
    if (HERO.test(next)) {
        next = next.replace(HERO, (_, open, tags) =>
            `${open}<div class="sd-standalone-art">${sdArtwork(article, 'lead')}</div>\n        ${tags}`);
    }
    if (next !== html) { fs.writeFileSync(htmlPath, next); changed++; }
}
console.log(`✓ re-rendered ${changed} article page(s)${skipped ? `, skipped ${skipped}` : ''}`);
