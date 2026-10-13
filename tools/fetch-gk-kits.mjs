/* The clubs' real goalkeeper colours, taken from the game's own shirt art.
 *
 * The keeper was being drawn in a generic amber because there is no feed of
 * kit colours — which was true of every feed I had looked at, and wrong. FPL
 * draws its own pitch with per-club shirt sprites, and it has a separate one
 * for the goalkeeper:
 *
 *   /dist/img/shirts/standard/shirt_{team_code}-110.png      outfield
 *   /dist/img/shirts/standard/shirt_{team_code}_1-110.png    goalkeeper
 *
 * So the colours are there; they just have to be read off the picture rather
 * than out of a JSON field. This downsamples each keeper shirt, throws away
 * the transparent margin and the outline, buckets what is left, and takes the
 * two colours the shirt is actually made of.
 *
 * Writes a GENERATED block into scripts/common.js, the way gen-tracking.mjs
 * writes into the stylesheets — so the colours ship with the code and no page
 * fetches anything at runtime. A club whose sprite cannot be read keeps the
 * generic keeper kit and is reported.
 *
 * Run:  node tools/fetch-gk-kits.mjs
 *       node tools/fetch-gk-kits.mjs --dry-run   report, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');
const COMMON = path.join(ROOT, 'scripts', 'common.js');
const OPEN = '/* === GENERATED: goalkeeper kits — node tools/fetch-gk-kits.mjs === */';
const CLOSE = '/* === END GENERATED GOALKEEPER KITS === */';

const boot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bootstrap-static.json'), 'utf8'));
const clubs = (boot.teams || []).map(t => ({ code: t.code, name: t.short_name }));

const SRC = code => [
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}_1-110.png`,
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}_1-66.png`,
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}_1-220.png`
];

const hex = (r, g, b) => '#' + [r, g, b].map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* The two colours a shirt is made of.
 *
 * Buckets to the nearest 16 so a gradient or a JPEG-ish edge does not read as
 * fifty colours, drops anything the sprite uses as outline or shadow rather
 * than as fabric — fully transparent, nearly black, nearly white — and takes
 * the most common bucket, then the most common one that is clearly a
 * different colour from it rather than a shade of the same. */
async function shirtColours(sharp, buf) {
    const { data, info } = await sharp(buf).resize(48, 48, { fit: 'inside' })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const counts = new Map();
    for (let i = 0; i < data.length; i += info.channels) {
        const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
        if (a < 200) continue;
        const l = lum(r, g, b);
        if (l < 0.07 || l > 0.96) continue;
        const key = [r, g, b].map(v => Math.round(v / 16) * 16).join(',');
        const row = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        row.n++; row.r += r; row.g += g; row.b += b;
        counts.set(key, row);
    }
    const ranked = [...counts.values()]
        .map(c => ({ n: c.n, rgb: [c.r / c.n, c.g / c.n, c.b / c.n] }))
        .sort((a, b) => b.n - a.n);
    if (!ranked.length) return null;
    const main = ranked[0].rgb;
    const second = (ranked.find(c => gap(c.rgb, main) > 90) || ranked[0]).rgb;
    return { main, second, pixels: ranked.reduce((s, c) => s + c.n, 0) };
}

const { default: sharp } = await import('sharp');
const rows = [];
const missing = [];

for (const club of clubs) {
    let buf = null;
    for (const url of SRC(club.code)) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'easyfpl-asset-bot (+https://easyfpl.com)' } });
            if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
        } catch { /* try the next size */ }
    }
    if (!buf) { missing.push(club); console.log(`  ${club.name} — no keeper sprite`); continue; }

    let c = null;
    try { c = await shirtColours(sharp, buf); } catch (e) { console.log(`  ${club.name} — ${e.message}`); }
    /* Too few opaque pixels means the sprite is mostly outline, which means
       the read is noise rather than a colour. */
    if (!c || c.pixels < 150) { missing.push(club); console.log(`  ${club.name} — sprite unreadable`); continue; }

    const main = hex(...c.main);
    const second = hex(...c.second);
    const ink = lum(...c.main) > 0.55 ? '#1B1B1B' : '#FFFFFF';
    const trim = gap(c.second, c.main) > 90 ? second : ink;
    rows.push({ code: club.code, name: club.name, main, second, ink, trim, pixels: c.pixels });
    console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(3)} ${main} / ${second}  ink ${ink}  (${c.pixels}px)`);
    await new Promise(r => setTimeout(r, 200));
}

const MIN = Math.ceil(clubs.length * 0.75);
if (rows.length < MIN) {
    console.error(`::error::only ${rows.length} of ${clubs.length} keeper kits could be read; nothing written`);
    process.exit(1);
}

const body = rows.sort((a, b) => a.code - b.code).map(r =>
    `    ${String(r.code + ':').padEnd(4)} ['plain', '${r.main}', '${r.second}', '${r.ink}', '${r.trim}'],`
        + `  // ${r.name}`).join('\n');

const block = `${OPEN}
/* Read off FPL's own goalkeeper shirt sprites — see tools/fetch-gk-kits.mjs.
   Do not hand-edit: the next run overwrites it. A club missing from here
   wears the generic keeper kit, which is the correct answer for a club whose
   sprite the game has not drawn yet. */
const CLUB_GK_KITS = {
${body}
};
${CLOSE}`;

console.log(`\n${rows.length} read, ${missing.length} on the generic kit`
    + (missing.length ? `: ${missing.map(c => c.name).join(', ')}` : ''));
if (DRY) { console.log('--dry-run: nothing written'); process.exit(0); }

let src = fs.readFileSync(COMMON, 'utf8');
if (src.includes(OPEN)) {
    src = src.slice(0, src.indexOf(OPEN)) + block + src.slice(src.indexOf(CLOSE) + CLOSE.length);
} else {
    const anchor = 'const GK_KITS = [';
    const at = src.indexOf(anchor);
    if (at < 0) { console.error('::error::could not find where to write the block'); process.exit(1); }
    src = src.slice(0, at) + block + '\n\n' + src.slice(at);
}
fs.writeFileSync(COMMON, src);
console.log('Wrote scripts/common.js');
