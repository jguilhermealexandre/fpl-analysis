#!/usr/bin/env node
/* The site's typefaces, fetched once and served from our own origin.
 *
 * Every page linked fonts.googleapis.com, which costs a DNS lookup, a TCP
 * connection and a TLS handshake to a third party before a single glyph can
 * be asked for — and then a second set of all three to fonts.gstatic.com,
 * because the stylesheet that arrives from the first host names files on the
 * second. Two cross-origin connections on the critical path of a page whose
 * own CSS and HTML arrive on one.
 *
 * Served from /assets/fonts they are same-origin, they arrive on the
 * connection that is already open, and they inherit the immutable year that
 * _headers already gives everything under /assets. It also takes Google off
 * the load path of a site whose privacy policy is one of its selling points:
 * a visitor who has not signed in now makes no third-party request at all.
 *
 * Only the latin and latin-ext subsets are kept. The stylesheet Google serves
 * carries cyrillic, greek and vietnamese as well — thirty-seven @font-face
 * rules for nine faces — and a browser downloads only the subsets it needs,
 * so those cost nothing at runtime; they are dropped because they are 500KB
 * in the repository for a site written in English.
 *
 * Inter and Space Grotesk are both SIL OFL 1.1, which permits this and asks
 * that the licence travel with the files. It does: assets/fonts/OFL.txt.
 *
 * Usage:  node tools/fetch-fonts.mjs
 *         Re-run when a weight is added to the set below. Needs Python with
 *         fonttools and brotli (pip install fonttools brotli) for the slicing
 *         step described above WEIGHTS; run manually, never in CI, and the
 *         result is committed.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const OUT = 'assets/fonts';
const CSS = 'styles/fonts.css';
/* Inter, and only Inter.
 *
 * The three <link>s across the site asked for three families between them and
 * the site renders none but this one: --font-display, --font-body and
 * --font-mono in common.css are all Inter, and v2-design.css then sets
 * font-family on `body *` with !important, so even the fallback chains that
 * still name Space Grotesk never reach it. Space Grotesk and JetBrains Mono
 * were 113KB of woff2 fetched from a third party on every page for glyphs
 * that were never drawn. Re-add a family here the day something renders in
 * it. */
const URL = 'https://fonts.googleapis.com/css2'
    + '?family=Inter:wght@400;500;600;700'
    + '&display=swap';
/* Asking as a browser is what gets woff2 rather than the ttf Google serves to
   clients it does not recognise. */
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/* The weights the site actually sets, and why the file shrinks by a quarter.
 *
 * Inter ships as one variable font with a weight axis running 100 to 900, and
 * that whole axis is in the file whether or not anything asks for Thin or
 * Black. Nothing here does: the stylesheets set 400, 500, 600 and 700 and
 * that is all. Slicing the axis to 400-700 takes the latin subset from 48KB
 * to 36KB with no visible difference, and that file is on the critical path
 * of every page — measured as the last thing to arrive before the largest
 * paint, which is a paragraph of text waiting for it.
 *
 * The axis is sliced, not pinned: a range keeps the variable font, so the
 * four weights stay four real weights rather than one synthesised from
 * another. */
const WEIGHTS = [400, 700];

/* fontTools does the slicing; there is no JavaScript equivalent worth
   depending on, and this file is run by hand when a font changes rather than
   on every build, so a Python tool here costs nothing at deploy time. It
   fails rather than quietly shipping the unsliced font, because a silent
   fallback here is 12KB back on the critical path that nobody would notice. */
function sliceAxis(buf) {
    const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'inter-'));
    const from = path.join(tmp, 'in.woff2');
    const to = path.join(tmp, 'out.woff2');
    fs.writeFileSync(from, buf);
    try {
        execFileSync('python3', ['-c', `
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
f = TTFont(sys.argv[1])
if 'fvar' not in f:
    f.save(sys.argv[2]); raise SystemExit(0)
out = instancer.instantiateVariableFont(f, {'wght': (${WEIGHTS[0]}, ${WEIGHTS[1]})}, inplace=False, updateFontNames=False)
out.flavor = 'woff2'
out.save(sys.argv[2])
`, from, to], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
        throw new Error('slicing the weight axis failed — install it with:  pip install fonttools brotli\n' + String(e.stderr || e));
    }
    const out = fs.readFileSync(to);
    fs.rmSync(tmp, { recursive: true, force: true });
    if (out.length >= buf.length) return buf;   // nothing gained; keep the original
    return out;
}

const css = await (await fetch(URL, { headers: { 'User-Agent': UA } })).text();
fs.mkdirSync(OUT, { recursive: true });

const blocks = [...css.matchAll(/\/\*\s*([a-z-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g)];
if (!blocks.length) throw new Error('no @font-face blocks in the stylesheet Google returned');

/* Named by the hash of their contents, because several of these @font-face
   rules point at the same bytes. Inter ships as a variable font: Google
   serves one file for every weight and varies only the font-weight in the
   rule, so naming by family-and-weight would have written four identical
   48KB copies of the latin subset and, worse, given them four URLs — four
   downloads at runtime where Google's own CSS causes one. */
const kept = [];
const byUrl = new Map();
let downloaded = 0;
for (const [, subset, block] of blocks) {
    if (subset !== 'latin' && subset !== 'latin-ext') continue;
    const family = /font-family:\s*'([^']+)'/.exec(block)[1];
    const src = /url\((https:\/\/[^)]+)\)/.exec(block)[1];
    let name = byUrl.get(src);
    if (!name) {
        let buf = Buffer.from(await (await fetch(src, { headers: { 'User-Agent': UA } })).arrayBuffer());
        if (buf.length < 1000) throw new Error(`${src} came back at ${buf.length} bytes`);
        buf = sliceAxis(buf);
        const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
        name = `${family.toLowerCase().replace(/\s+/g, '-')}-${subset}-${hash}.woff2`;
        byUrl.set(src, name);
        const file = path.join(OUT, name);
        if (!fs.existsSync(file)) { fs.writeFileSync(file, buf); downloaded++; }
    }
    kept.push(block.replace(/url\(https:\/\/[^)]+\)/, `url(/assets/fonts/${name})`));
}

/* Files no rule names any more — a weight dropped, or a version bump that
   changed the bytes and so the hash. */
const live = new Set(byUrl.values());
for (const f of fs.readdirSync(OUT)) {
    if (f.endsWith('.woff2') && !live.has(f)) { fs.unlinkSync(path.join(OUT, f)); console.log('  removed stale ' + f); }
}

const header = `/* The site's typefaces, served from our own origin.
 *
 * Generated by tools/fetch-fonts.mjs — do not edit by hand; re-run it. See
 * the note at the top of that file for why these are not loaded from
 * fonts.googleapis.com, and assets/fonts/OFL.txt for the licence both
 * families are published under.
 *
 * Latin and latin-ext only. font-display: swap is Google's own setting and is
 * kept: text paints in the fallback immediately and reflows once, which is
 * the right trade for a page whose largest paint is a heading.
 */

`;
fs.writeFileSync(CSS, header + kept.join('\n\n') + '\n');
console.log(`✓ ${kept.length} face(s) in ${CSS} (${downloaded} newly downloaded), ${fs.readdirSync(OUT).filter(f => f.endsWith('.woff2')).length} file(s) in ${OUT}/`);
