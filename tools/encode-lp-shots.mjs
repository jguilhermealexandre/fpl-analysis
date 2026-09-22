#!/usr/bin/env node
/* The landing page's screenshots, re-encoded for people on a phone.
 *
 * capture-lp-shots.mjs takes them as PNG because that is what a screenshot of
 * flat UI wants: crisp type, large areas of one colour, no generation loss.
 * That is the right FORMAT to capture in and the wrong one to serve. The dark
 * set alone was 4.9MB, and Lighthouse on a throttled connection put the
 * landing page's largest paint at 7.7 seconds, most of it one image.
 *
 * So: PNG stays the master, WebP is what ships. Every capture gets encoded at
 * two widths, and the markup asks for whichever fits.
 *
 * Effort 6 rather than the default 4 — these are built once by a workflow
 * nobody is waiting on, and the extra second per file buys real bytes.
 *
 * Deliberately NOT lossless. A screenshot of a dashboard has gradients,
 * photography and antialiased text in it; lossless WebP on that is barely
 * smaller than the PNG. Quality 82 on 2x-density captures is invisible at the
 * size these are displayed.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = 'assets/lp';
/* The two the markup asks for. 1400 is the widest any of these is ever drawn
   (the full-measure .lp-wide frame on a 1400px column, at 1x); 700 covers
   every phone at 2x. Captures are 2400-3000px wide, which nothing displays. */
const WIDTHS = [1400, 700];
const QUALITY = 82;

const only = process.argv[2] || '';
/* Dark only. The marketing shell has been dark-only since the landing page was
   rebuilt — scripts/common.js forces it for anyone without a saved team — so
   nothing on the site references a -light- shot, and encoding them was about a
   megabyte of files no browser will ever ask for. The light PNGs stay: they
   are what the capture workflow produces, and they are what this would encode
   the day the shell can be light again. */
const sources = fs.readdirSync(DIR)
    .filter(f => /\.(png|jpg)$/i.test(f))
    .filter(f => !/-light\.(png|jpg)$/i.test(f))
    .filter(f => !only || f.startsWith(only));

let before = 0, after = 0;

for (const file of sources) {
    const src = path.join(DIR, file);
    const stem = file.replace(/\.(png|jpg)$/i, '');
    const meta = await sharp(src).metadata();
    before += fs.statSync(src).size;

    for (const w of WIDTHS) {
        /* Never upscale. A card crop is 1000px wide; asking for 1400 would
           invent pixels and cost bytes to store them. */
        const target = Math.min(w, meta.width);
        const out = path.join(DIR, `${stem}-${w}.webp`);
        await sharp(src)
            .resize({ width: target, withoutEnlargement: true })
            .webp({ quality: QUALITY, effort: 6 })
            .toFile(out);
        after += fs.statSync(out).size;
        console.log(`${out}  ${(fs.statSync(out).size / 1024).toFixed(0)}KB  (${target}px)`);
    }
}

const pct = before ? Math.round((1 - after / before) * 100) : 0;
console.log(`\n${sources.length} source(s): ${(before / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB across ${WIDTHS.length} widths (${pct}% smaller)`);
