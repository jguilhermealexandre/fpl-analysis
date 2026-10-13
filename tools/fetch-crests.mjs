/* The twenty club badges, fetched once and served from our own origin.
 *
 * They used to be hot-linked from resources.premierleague.com on every render,
 * in sixteen places that each spelled the URL out. That is one request per
 * badge per page against somebody else's CDN, with no cache we control, no
 * say over whether the path keeps working, and a 404-and-remove dance in the
 * markup for the clubs it has never had. Twenty files is 60KB. We hold them.
 *
 * FETCHED AS SVG, SERVED AS PNG. The league's badges are Illustrator exports
 * of the real crest: 35KB on average, 169KB for Coventry's, for something the
 * site draws at 14px in a table and at most 52px on a hero. Rasterised to
 * 160px — which covers 52 CSS pixels on a 3x display — the same twenty come to
 * 95KB in total, 4.8KB each, and are indistinguishable at every size this site
 * draws them.
 *
 * So the vector is kept under assets/crests/src/ as the source it is, and the
 * PNG beside it is what v2CrestSrc() points the browser at. Changing the
 * served size later is a re-run of this, not a re-fetch of anything.
 *
 * A club with no SVG is not written at all and is reported — the runtime
 * already falls back to the club's short name, which is a correct picture
 * rather than a broken one.
 *
 * WHAT IS STRIPPED. Everything that is not drawing: the XML declaration and
 * any doctype, comments, <metadata>, <title> and <desc>, plus <script> and any
 * on* handlers. Structural attributes are left exactly as they are — an `id`
 * here is a gradient or a clip the badge needs, and each badge is its own
 * document behind an <img>, so none of them can collide with another.
 *
 * Run:  node tools/fetch-crests.mjs           fetch and write
 *       node tools/fetch-crests.mjs --check   every club has one, nothing written
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets', 'crests');
const SRC = path.join(OUT, 'src');
const CHECK = process.argv.includes('--check');

/* 160, not 128: the biggest a badge is drawn is the 52px disc on a hero, and
   a 3x display asks for 156 device pixels of it. Above that it is bytes
   nobody can see. */
const RASTER = 160;

const boot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bootstrap-static.json'), 'utf8'));
const clubs = (boot.teams || []).map(t => ({ code: t.code, name: t.short_name }));
if (!clubs.length) {
    console.error('::error::no teams in bootstrap-static.json');
    process.exit(1);
}

/* Newest path first. The league has moved these more than once and keeps the
   older ones serving, so the list is the history rather than a guess. */
const CANDIDATES = code => [
    `https://resources.premierleague.com/premierleague25/badges/t${code}.svg`,
    `https://resources.premierleague.com/premierleague/badges/t${code}.svg`,
    `https://resources.premierleague.com/premierleague25/badges/50/t${code}.svg`,
    `https://resources.premierleague.com/premierleague/badges/50/t${code}.svg`
];

/* Not a parser, and it does not need to be: these are machine-generated files
   from one publisher, and every rule below is anchored to a whole element or a
   whole attribute. Anything it cannot confidently remove it leaves, and the
   result is checked for a root <svg> before it is written. */
function sanitise(svg) {
    const removedNotes = [];
    let out = svg;
    const drop = (re, what) => {
        const before = out;
        out = out.replace(re, '');
        if (out !== before) removedNotes.push(what);
    };
    drop(/<\?xml[\s\S]*?\?>/gi, 'xml declaration');
    drop(/<!DOCTYPE[\s\S]*?>/gi, 'doctype');
    drop(/<!--[\s\S]*?-->/g, 'comments');
    drop(/<metadata[\s\S]*?<\/metadata>/gi, 'metadata');
    drop(/<title[\s\S]*?<\/title>/gi, 'title');
    drop(/<desc[\s\S]*?<\/desc>/gi, 'desc');
    drop(/<script[\s\S]*?<\/script>/gi, 'script');
    drop(/\son[a-z]+\s*=\s*"[^"]*"/gi, 'event handlers');
    drop(/\son[a-z]+\s*=\s*'[^']*'/gi, 'event handlers');
    out = out.replace(/>\s+</g, '><').trim();
    return { svg: out, removed: [...new Set(removedNotes)] };
}

/* What the file still says about where it came from, after the strip. Reported
   rather than rewritten: a class or an id may be load-bearing, and the point
   of printing them is that somebody decides. */
function leftoverNames(svg) {
    const hits = new Set();
    for (const m of svg.matchAll(/premier\s*league|premierleague|\bPL\b|barclays|©|copyright/gi)) {
        hits.add(m[0]);
    }
    return [...hits];
}

async function get(url) {
    const res = await fetch(url, {
        headers: { 'User-Agent': 'easyfpl-asset-bot (+https://easyfpl.com)', Accept: 'image/svg+xml,*/*' }
    });
    if (!res.ok) return null;
    const body = await res.text();
    return /<svg[\s>]/i.test(body) ? body : null;
}

if (CHECK) {
    const missing = clubs.filter(c => !fs.existsSync(path.join(OUT, `t${c.code}.png`)));
    if (missing.length) {
        for (const c of missing) console.error(`::error::no crest for ${c.name} (t${c.code}.png)`);
        console.error(`✗ ${missing.length} club(s) have no badge; they fall back to the short name`);
        process.exit(1);
    }
    console.log(`✓ all ${clubs.length} clubs have a badge in assets/crests/`);
    process.exit(0);
}

const { default: sharp } = await import('sharp');
fs.mkdirSync(SRC, { recursive: true });
const failed = [];
let written = 0, unchanged = 0;

for (const club of clubs) {
    let got = null, from = null;
    for (const url of CANDIDATES(club.code)) {
        try {
            const body = await get(url);
            if (body) { got = body; from = url; break; }
        } catch (e) {
            console.log(`  ${club.name}: ${url} — ${e.message}`);
        }
    }
    if (!got) { failed.push(club); console.log(`  ${club.name} (t${club.code}) — no SVG at any known path`); continue; }

    const { svg, removed } = sanitise(got);
    if (!/^<svg[\s>]/i.test(svg)) {
        failed.push(club);
        console.log(`  ${club.name} — what came back is not a root <svg> after stripping; not written`);
        continue;
    }
    const leftovers = leftoverNames(svg);
    const srcFile = path.join(SRC, `t${club.code}.svg`);
    const pngFile = path.join(OUT, `t${club.code}.png`);
    const existing = fs.existsSync(srcFile) ? fs.readFileSync(srcFile, 'utf8') : null;
    const same = existing === svg && fs.existsSync(pngFile);
    if (!same) {
        fs.writeFileSync(srcFile, svg + '\n');
        /* density, because librsvg rasterises from the document's own units: a
           200-unit crest scaled up from 96dpi is a blurry 160px. */
        const png = await sharp(Buffer.from(svg), { density: 400 })
            .resize(RASTER, RASTER, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
            .png({ compressionLevel: 9, palette: true, quality: 90 })
            .toBuffer();
        fs.writeFileSync(pngFile, png);
        written++;
    } else { unchanged++; }
    const pngSize = fs.existsSync(pngFile) ? fs.statSync(pngFile).size : 0;
    console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(3)}`
        + ` svg ${String((svg.length / 1024).toFixed(1)).padStart(6)}KB`
        + ` -> png ${String((pngSize / 1024).toFixed(1)).padStart(5)}KB`
        + ` ${same ? 'unchanged' : 'written  '}`
        + (removed.length ? `  stripped: ${removed.join(', ')}` : '')
        + (leftovers.length ? `  ⚠ still mentions: ${leftovers.join(', ')}` : '')
        + `  <- ${from.replace('https://resources.premierleague.com', '')}`);
}

console.log(`\n${written} written, ${unchanged} unchanged, ${failed.length} missing`);
if (failed.length) {
    console.error(`::warning::no badge for ${failed.map(c => c.name).join(', ')} — they will show the club's short name`);
}
