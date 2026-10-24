/* The clubs' real outfield colours and pattern, read off the game's own art.
 *
 * CLUB_KITS was written by hand: twenty rows of "Arsenal is red with white
 * sleeves", which is right until a club changes kit, gets promoted, or was
 * never quite what I remembered — Ipswich play in blue with white sleeves and
 * were drawn plain blue for a month.
 *
 * FPL draws its own pitch with a per-club shirt sprite, the outfield twin of
 * the keeper sprite tools/fetch-gk-kits.mjs already reads:
 *
 *   /dist/img/shirts/standard/shirt_{team_code}-110.png
 *
 * So both the colours and the pattern are there to be measured. The colours
 * are the two the shirt is made of; the pattern is read off scanlines — a
 * chest line that alternates is stripes, a centre line that alternates is
 * hoops, a left half that differs from the right is halves, and sleeves that
 * differ from the body is contrast sleeves.
 *
 * Writes a GENERATED block into scripts/common.js. A club it cannot read
 * keeps its hand-written row, so this can only improve on what is there.
 *
 * Run:  node tools/fetch-kit-art.mjs
 *       node tools/fetch-kit-art.mjs --dry-run   report, write nothing
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');
const COMMON = path.join(ROOT, 'scripts', 'common.js');
const OPEN = '/* === GENERATED: outfield kits — node tools/fetch-kit-art.mjs === */';
const CLOSE = '/* === END GENERATED OUTFIELD KITS === */';

const boot = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'bootstrap-static.json'), 'utf8'));
const clubs = (boot.teams || []).map(t => ({ code: t.code, name: t.short_name }));

const SRC = code => [
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}-220.png`,
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}-110.png`,
    `https://fantasy.premierleague.com/dist/img/shirts/standard/shirt_${code}-66.png`
];

const hex = (r, g, b) => '#' + [r, g, b].map(v =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const lum = (r, g, b) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
const gap = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/* A grid of opaque pixels, so every measurement below reads the same picture
   rather than re-decoding it. Outline and shadow are dropped: the sprites are
   drawn with a dark keyline that would otherwise count as one of the shirt's
   two colours on every club. */
async function grid(sharp, buf) {
    const N = 64;
    const { data, info } = await sharp(buf).resize(N, N, { fit: 'fill' })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = [];
    for (let y = 0; y < N; y++) {
        const row = [];
        for (let x = 0; x < N; x++) {
            const i = (y * N + x) * info.channels;
            const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
            const l = lum(r, g, b);
            row.push(a < 200 || l < 0.07 || l > 0.97 ? null : [r, g, b]);
        }
        px.push(row);
    }
    return px;
}

function dominant(pixels) {
    const counts = new Map();
    for (const p of pixels) {
        if (!p) continue;
        const key = p.map(v => Math.round(v / 16) * 16).join(',');
        const row = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        row.n++; row.r += p[0]; row.g += p[1]; row.b += p[2];
        counts.set(key, row);
    }
    return [...counts.values()].sort((a, b) => b.n - a.n)
        .map(c => ({ n: c.n, rgb: [c.r / c.n, c.g / c.n, c.b / c.n] }));
}

/* How many times a line crosses between the two colours. A striped shirt
   alternates several times across the chest; a plain one never does. */
function crossings(line, a, b) {
    let last = null, n = 0;
    for (const p of line) {
        if (!p) continue;
        const near = gap(p, a) < gap(p, b) ? 'a' : 'b';
        if (gap(p, near === 'a' ? a : b) > 110) continue;
        if (last && near !== last) n++;
        last = near;
    }
    return n;
}

const { default: sharp } = await import('sharp');
const rows = [];
const skipped = [];

for (const club of clubs) {
    let buf = null;
    for (const url of SRC(club.code)) {
        try {
            const res = await fetch(url, { headers: { 'User-Agent': 'easyfpl-asset-bot (+https://easyfpl.com)' } });
            if (res.ok) { buf = Buffer.from(await res.arrayBuffer()); break; }
        } catch { /* try the next size */ }
    }
    if (!buf) { skipped.push(club.name); console.log(`  ${club.name} — no sprite`); continue; }

    let px;
    try { px = await grid(sharp, buf); } catch (e) { skipped.push(club.name); console.log(`  ${club.name} — ${e.message}`); continue; }

    const all = px.flat();
    const ranked = dominant(all);
    if (!ranked.length || ranked.reduce((s, c) => s + c.n, 0) < 400) {
        skipped.push(club.name); console.log(`  ${club.name} — too little shirt in the sprite`); continue;
    }
    const main = ranked[0].rgb;
    const secondEntry = ranked.find(c => gap(c.rgb, main) > 90 && c.n > ranked[0].n * 0.08);
    const second = secondEntry ? secondEntry.rgb : main;
    const twoTone = !!secondEntry;

    /* The regions. The sprite is a front-on shirt filling the frame, so the
       body is the middle half and the sleeves are the outer sixths. */
    const chest = px[36];
    const centre = px.map(r => r[32]);
    const bodyX = (x) => x >= 22 && x <= 42;
    const leftHalf = px.flatMap(r => r.filter((p, x) => bodyX(x) && x < 32));
    const rightHalf = px.flatMap(r => r.filter((p, x) => bodyX(x) && x >= 32));
    const sleeves = px.slice(18, 34).flatMap(r => r.filter((p, x) => x < 14 || x > 50));
    const body = px.slice(30, 50).flatMap(r => r.filter((p, x) => bodyX(x)));

    const chestX = twoTone ? crossings(chest.filter((p, x) => bodyX(x)), main, second) : 0;
    const chestXWide = twoTone ? crossings(chest, main, second) : 0;
    const centreX = twoTone ? crossings(centre.slice(28, 54), main, second) : 0;
    const dL = dominant(leftHalf)[0], dR = dominant(rightHalf)[0];
    const dS = dominant(sleeves)[0], dB = dominant(body)[0];

    let pattern = 'plain';
    if (twoTone && chestX >= 3) pattern = chestXWide >= 8 ? 'pinstripes' : 'stripes';
    else if (twoTone && centreX >= 3) pattern = 'hoops';
    else if (twoTone && dL && dR && gap(dL.rgb, dR.rgb) > 90) pattern = 'halves';
    else if (twoTone && dS && dB && gap(dS.rgb, dB.rgb) > 90) pattern = 'sleeves';

    const mainHex = hex(...(dB ? dB.rgb : main));
    const secondHex = pattern === 'sleeves' && dS ? hex(...dS.rgb) : hex(...second);
    const ink = lum(...(dB ? dB.rgb : main)) > 0.55 ? '#1B1B1B' : '#FFFFFF';
    const trim = pattern === 'plain' ? ink : secondHex;

    rows.push({ code: club.code, name: club.name, pattern, main: mainHex, second: secondHex, ink, trim });
    console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(3)} ${pattern.padEnd(10)}`
        + ` ${mainHex} / ${secondHex}  ink ${ink}`
        + `   [chest ${chestX}/${chestXWide} centre ${centreX}`
        + ` sleeveΔ ${dS && dB ? Math.round(gap(dS.rgb, dB.rgb)) : '-'}`
        + ` halfΔ ${dL && dR ? Math.round(gap(dL.rgb, dR.rgb)) : '-'}]`);
    await new Promise(r => setTimeout(r, 200));
}

const MIN = Math.ceil(clubs.length * 0.75);
if (rows.length < MIN) {
    console.error(`::error::only ${rows.length} of ${clubs.length} kits could be read; nothing written`);
    process.exit(1);
}

const body = rows.sort((a, b) => a.code - b.code).map(r =>
    `    ${String(r.code + ':').padEnd(4)} ['${r.pattern}',${' '.repeat(Math.max(0, 11 - r.pattern.length))}`
        + `'${r.main}', '${r.second}', '${r.ink}', '${r.trim}'],  // ${r.name}`).join('\n');

const block = `${OPEN}
/* Measured off FPL's own outfield shirt sprites — see tools/fetch-kit-art.mjs.
   Do not hand-edit: the next run overwrites it. A club missing from here
   keeps its hand-written row in CLUB_KITS below. */
const CLUB_KIT_ART = {
${body}
};
${CLOSE}`;

console.log(`\n${rows.length} read, ${skipped.length} left on the hand-written row`
    + (skipped.length ? `: ${skipped.join(', ')}` : ''));
if (DRY) { console.log('--dry-run: nothing written'); process.exit(0); }

let src = fs.readFileSync(COMMON, 'utf8');
if (src.includes(OPEN)) {
    src = src.slice(0, src.indexOf(OPEN)) + block + src.slice(src.indexOf(CLOSE) + CLOSE.length);
} else {
    const anchor = 'const CLUB_KITS = {';
    const at = src.indexOf(anchor);
    if (at < 0) { console.error('::error::could not find where to write the block'); process.exit(1); }
    src = src.slice(0, at) + block + '\n\n' + src.slice(at);
}
fs.writeFileSync(COMMON, src);
console.log('Wrote scripts/common.js');
