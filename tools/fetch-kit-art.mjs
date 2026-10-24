#!/usr/bin/env node
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
 * So both the colours and the pattern are there to be measured.
 *
 * THE FIRST VERSION OF THIS MEASURED THE WRONG THINGS, and the dry run said
 * so: Brentford came back white on white, Palace came back white, Newcastle
 * came back hooped. Three mistakes, all of them mine:
 *
 *   - It read fixed coordinates out of a 64x64 box, assuming the shirt filled
 *     the frame. The sprites are padded, and by different amounts, so "the
 *     sleeves are the outer sixths" was sampling the body on some clubs and
 *     empty space on others. Everything is measured off the shirt's own
 *     bounding box now.
 *   - It took the second colour off a ranked list of every colour in the
 *     picture, so on a red-and-white striped shirt the runner-up was a second
 *     shade of white rather than the red. The second colour is now the
 *     dominant colour of the pixels that are *not* the first one.
 *   - It dropped dark pixels wholesale to get rid of the sprite's keyline,
 *     which also dropped Newcastle's and Bournemouth's black. The keyline is
 *     eroded off the alpha edge instead, which is what it actually is.
 *
 * Writes a GENERATED block into scripts/common.js. A club it cannot read, or
 * reads badly enough to fail its own sanity checks, keeps its hand-written
 * row, so this can only improve on what is there.
 *
 * Run:  node tools/fetch-kit-art.mjs
 *       node tools/fetch-kit-art.mjs --dry-run   report, write nothing
 *       node tools/fetch-kit-art.mjs --debug     and show the working
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');
const DEBUG = process.argv.includes('--debug');
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

const N = 64;            // the normalised grid every measurement is taken on
const EDGE = 2;          // how far in from the alpha edge the keyline reaches
const SPLIT = 70;        // far enough apart in RGB to be the shirt's two colours

/* The sprite, cropped to the shirt and squared off to NxN, with the keyline
   eroded away. Returns a grid of [r,g,b] or null, so every measurement below
   reads the same picture rather than re-deciding what counts as a pixel. */
async function grid(sharp, buf) {
    const first = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = first.info;
    const alphaAt = (x, y) => first.data[(y * W + x) * C + 3];

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (alphaAt(x, y) < 200) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < x0 || y1 < y0) throw new Error('nothing opaque in the sprite');

    const { data, info } = await sharp(buf)
        .extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 })
        .resize(N, N, { fit: 'fill', kernel: 'nearest' })
        .ensureAlpha().raw().toBuffer({ resolveWithObject: true });

    const solid = [];
    for (let y = 0; y < N; y++) {
        const row = [];
        for (let x = 0; x < N; x++) row.push(data[(y * N + x) * info.channels + 3] >= 200);
        solid.push(row);
    }
    /* Erode: a pixel within EDGE of a transparent one is keyline or the
       antialiasing under it, and is neither of the shirt's colours. */
    const px = [];
    for (let y = 0; y < N; y++) {
        const row = [];
        for (let x = 0; x < N; x++) {
            let ok = solid[y][x];
            for (let dy = -EDGE; ok && dy <= EDGE; dy++) {
                for (let dx = -EDGE; ok && dx <= EDGE; dx++) {
                    const yy = y + dy, xx = x + dx;
                    if (yy < 0 || xx < 0 || yy >= N || xx >= N || !solid[yy][xx]) ok = false;
                }
            }
            const i = (y * N + x) * info.channels;
            row.push(ok ? [data[i], data[i + 1], data[i + 2]] : null);
        }
        px.push(row);
    }
    return px;
}

/* Buckets to /24 so antialiasing lands with its own colour, then averages
   each bucket back to the colour it actually was. */
function dominant(pixels) {
    const counts = new Map();
    let total = 0;
    for (const p of pixels) {
        if (!p) continue;
        total++;
        const key = p.map(v => Math.round(v / 24) * 24).join(',');
        const row = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        row.n++; row.r += p[0]; row.g += p[1]; row.b += p[2];
        counts.set(key, row);
    }
    return {
        total,
        ranked: [...counts.values()].sort((a, b) => b.n - a.n)
            .map(c => ({ share: c.n / (total || 1), rgb: [c.r / c.n, c.g / c.n, c.b / c.n] }))
    };
}

/* The two colours the shirt is made of. The second is the dominant colour of
   what is left once the first is taken out — not the runner-up in a ranked
   list, which on a striped shirt is another shade of the first. */
function twoColours(pixels) {
    const { ranked, total } = dominant(pixels);
    if (!ranked.length) return null;
    const main = ranked[0].rgb;
    const rest = pixels.filter(p => p && gap(p, main) > SPLIT);
    const other = dominant(rest).ranked[0];
    const share = rest.length / (total || 1);
    return { main, second: other && share > 0.08 ? other.rgb : null, share };
}

/* How many times a line crosses between the two colours, ignoring the pixels
   that are neither. A striped shirt alternates several times across the
   chest; a plain one never does. */
function crossings(line, a, b) {
    let last = null, n = 0;
    for (const p of line) {
        if (!p) continue;
        const da = gap(p, a), db = gap(p, b);
        const near = da < db ? 'a' : 'b';
        if (Math.min(da, db) > SPLIT) continue;
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
    const give = why => { skipped.push(club.name); console.log(`  ${club.name.padEnd(4)} — ${why}`); };
    if (!buf) { give('no sprite'); continue; }

    let px;
    try { px = await grid(sharp, buf); } catch (e) { give(e.message); continue; }

    /* Regions, now that the shirt fills the frame: the body is the middle
       third, the sleeves are the outer fifths at shoulder height. */
    const col = (r, lo, hi) => r.filter((p, x) => x >= lo && x <= hi);
    const body = px.slice(34, 58).flatMap(r => col(r, 22, 42));
    const sleeve = px.slice(14, 34).flatMap(r => r.filter((p, x) => x < 13 || x > 51));
    const leftBody = px.slice(34, 58).flatMap(r => col(r, 22, 31));
    const rightBody = px.slice(34, 58).flatMap(r => col(r, 33, 42));

    const pair = twoColours(body);
    if (!pair || dominant(body).total < 150) { give('too little shirt in the sprite'); continue; }

    const main = pair.main;
    let second = pair.second;
    let pattern = 'plain';
    const dS = dominant(sleeve).ranked[0];
    const dL = dominant(leftBody).ranked[0];
    const dR = dominant(rightBody).ranked[0];

    /* Three chest lines rather than one, because a single scanline can land
       between hoops or on a sponsor. The pattern has to hold on the middle
       one of the three. */
    const chest = [38, 44, 50].map(y => crossings(col(px[y], 22, 42), main, second || main))
        .sort((a, b) => a - b)[1];
    const down = crossings(px.map(r => r[32]).slice(30, 58), main, second || main);
    const wide = crossings(px[44], main, second || main);

    if (second) {
        if (chest >= 3) pattern = wide >= 9 ? 'pinstripes' : 'stripes';
        else if (down >= 3) pattern = 'hoops';
        else if (dL && dR && gap(dL.rgb, dR.rgb) > SPLIT) pattern = 'halves';
    }
    /* Sleeves are read off the sleeves, so a plain body with contrast sleeves
       is found even when the body itself is one colour. */
    const dB = dominant(body).ranked[0].rgb;
    if (pattern === 'plain' && dS && gap(dS.rgb, dB) > SPLIT) { pattern = 'sleeves'; second = dS.rgb; }
    if (pattern === 'halves' && dR) second = dR.rgb;

    const mainHex = hex(...dB);
    const secondHex = hex(...(pattern === 'plain' ? dB : second || dB));
    const ink = lum(...dB) > 0.55 ? '#1B1B1B' : '#FFFFFF';
    const trim = pattern === 'plain' ? ink : secondHex;

    if (DEBUG) {
        console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(4)}`
            + ` chest ${chest} down ${down} wide ${wide}`
            + ` secondShare ${(pair.share * 100).toFixed(0)}%`
            + ` sleeveΔ ${dS ? Math.round(gap(dS.rgb, dB)) : '-'}`
            + ` halfΔ ${dL && dR ? Math.round(gap(dL.rgb, dR.rgb)) : '-'}`);
    }

    /* The guards. A patterned shirt whose two colours are the same colour is
       the Brentford failure, and it is better to keep a hand-written row than
       to ship a white shirt with white stripes. */
    if (pattern !== 'plain' && gap(dB, second || dB) < SPLIT) {
        give(`read ${pattern} in two colours that are the same colour`); continue;
    }
    rows.push({ code: club.code, name: club.name, pattern, main: mainHex, second: secondHex, ink, trim });
    console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(4)} ${pattern.padEnd(10)}`
        + ` ${mainHex} / ${secondHex}  ink ${ink}`);
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
