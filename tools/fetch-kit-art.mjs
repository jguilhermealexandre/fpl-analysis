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
 *       node tools/fetch-kit-art.mjs --map       and print the sprite itself
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DRY = process.argv.includes('--dry-run');
const DEBUG = process.argv.includes('--debug');
const MAP = process.argv.includes('--map');
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

const EDGE = 0.03;       // the keyline, as a fraction of the shirt's width
const SPLIT = 70;        // far enough apart in RGB to be the shirt's two colours

/* The sprite, cropped to the shirt, at the resolution it was drawn at.
 *
 * AN EARLIER VERSION SQUASHED IT TO 64x64 FIRST, which is where Brighton
 * came back as a plain blue shirt. Nearest-neighbour sampling of a 220px
 * sprite onto a 64px grid takes every third or fourth pixel, and a stripe
 * that happens to be three or four pixels wide is then sampled at a constant
 * phase: a striped shirt aliases into a flat one. Averaging instead would
 * have blended the stripes into a grey mush, which is no better. So nothing
 * is resampled — everything below is measured in fractions of the shirt's
 * own bounding box, at whatever size the sprite was drawn.
 */
async function sprite(sharp, buf) {
    const { data, info } = await sharp(buf).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
    const { width: W, height: H, channels: C } = info;
    const alpha = (x, y) => data[(y * W + x) * C + 3];

    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
            if (alpha(x, y) < 200) continue;
            if (x < x0) x0 = x; if (x > x1) x1 = x;
            if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
    }
    if (x1 < x0 || y1 < y0) throw new Error('nothing opaque in the sprite');
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    const edge = Math.max(2, Math.round(w * EDGE));

    /* Eroded: a pixel within `edge` of a transparent one is the sprite's dark
       keyline or the antialiasing under it, and is neither of the shirt's
       colours. Dropping dark pixels by luminance instead — which is what this
       did first — also drops Newcastle's and Bournemouth's black. */
    const at = (x, y) => {
        for (let dy = -edge; dy <= edge; dy++) {
            for (let dx = -edge; dx <= edge; dx++) {
                const yy = y + dy, xx = x + dx;
                if (yy < 0 || xx < 0 || yy >= H || xx >= W || alpha(xx, yy) < 200) return null;
            }
        }
        const i = (y * W + x) * C;
        return [data[i], data[i + 1], data[i + 2]];
    };

    /* Everything is asked for in fractions of the shirt, so no measurement
       below has to know how big the sprite is. */
    const px = (fx, fy) => at(x0 + Math.round(fx * (w - 1)), y0 + Math.round(fy * (h - 1)));
    const region = (fx0, fx1, fy0, fy1, step = 1 / 48) => {
        const out = [];
        for (let fy = fy0; fy <= fy1; fy += step) {
            for (let fx = fx0; fx <= fx1; fx += step) out.push(px(fx, fy));
        }
        return out;
    };
    const across = (fy, fx0, fx1) => {
        const out = [];
        for (let x = Math.round(fx0 * (w - 1)); x <= Math.round(fx1 * (w - 1)); x++) {
            out.push(at(x0 + x, y0 + Math.round(fy * (h - 1))));
        }
        return out;
    };
    const down = (fx, fy0, fy1) => {
        const out = [];
        for (let y = Math.round(fy0 * (h - 1)); y <= Math.round(fy1 * (h - 1)); y++) {
            out.push(at(x0 + Math.round(fx * (w - 1)), y0 + y));
        }
        return out;
    };
    return { w, h, px, region, across, down, run: Math.max(2, Math.round(w * 0.035)) };
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
    return { main, second: other && rest.length / (total || 1) > 0.08 ? other.rgb : null,
        share: rest.length / (total || 1) };
}

/* How many times a line crosses between the two colours. A run has to last
   `run` pixels to count, so a sponsor's lettering and the antialiasing either
   side of a seam are not six stripes. */
function crossings(line, a, b, run) {
    let last = null, held = 0, n = 0;
    for (const p of line) {
        if (!p) continue;
        const da = gap(p, a), db = gap(p, b);
        if (Math.min(da, db) > SPLIT) continue;
        const near = da < db ? 'a' : 'b';
        if (near === last) { held++; continue; }
        if (last && held >= run) n++;
        last = near; held = 1;
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

    let art;
    try { art = await sprite(sharp, buf); } catch (e) { give(e.message); continue; }

    /* The regions, in fractions of the shirt's own bounding box. The torso is
       the middle two fifths; the sleeves are the outer fifths at shoulder
       height; both are read low enough to clear the collar and high enough to
       clear the hem. */
    const body = art.region(0.30, 0.70, 0.45, 0.92);
    const sleeve = [...art.region(0.00, 0.17, 0.25, 0.52), ...art.region(0.83, 1.00, 0.25, 0.52)];
    const leftBody = art.region(0.30, 0.48, 0.45, 0.92);
    const rightBody = art.region(0.52, 0.70, 0.45, 0.92);

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
    const other = second || main;
    const chest = [0.52, 0.66, 0.80]
        .map(fy => crossings(art.across(fy, 0.26, 0.74), main, other, art.run))
        .sort((a, b) => a - b)[1];
    const downC = crossings(art.down(0.50, 0.42, 0.92), main, other, art.run);
    const wide = crossings(art.across(0.66, 0.10, 0.90), main, other, Math.ceil(art.run / 2));

    if (second) {
        if (chest >= 3) pattern = wide >= 9 ? 'pinstripes' : 'stripes';
        else if (downC >= 3) pattern = 'hoops';
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

    if (MAP) {
        /* The sprite, printed. Two rounds of tuning against numbers I could
           not see was one round too many: every reading above is a claim
           about a picture, and this is the picture. One character per cell,
           the index into the club's own four commonest colours. */
        const all = art.region(0, 1, 0, 1, 1 / 64);
        const pal = dominant(all).ranked.slice(0, 4);
        const code = p => {
            if (!p) return '.';
            let best = 0, d = Infinity;
            pal.forEach((c, i) => { const g = gap(p, c.rgb); if (g < d) { d = g; best = i; } });
            return String(best);
        };
        console.log(`  ${club.name} — ` + pal.map((c, i) =>
            `${i}=${hex(...c.rgb)} ${(c.share * 100).toFixed(0)}%`).join('  '));
        for (let r = 0; r < 32; r++) {
            let line = '';
            for (let c = 0; c < 40; c++) line += code(art.px(c / 39, r / 31));
            console.log('    ' + line);
        }
    }
    if (DEBUG) {
        console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(4)} ${art.w}x${art.h}`
            + ` chest ${chest} down ${downC} wide ${wide}`
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

/* THE REPORT, which is the point of the exercise even when nothing is
   written. A disagreement is not automatically the table being wrong — the
   sprite carries shading, a sponsor and a fade at the hem, and the table
   carries the club's actual brand hex rather than the shaded average of it.
   What it is, is the only thing that will ever notice a club changing kit. */
const hand = new Map();
for (const line of fs.readFileSync(COMMON, 'utf8').split('\n')) {
    const m = /^\s{4}(\d+):\s+\['(\w+)',\s+'(#[0-9A-F]{6})', '(#[0-9A-F]{6})'/.exec(line);
    if (m && !hand.has(Number(m[1]))) hand.set(Number(m[1]), [m[2], m[3], m[4]]);
}
const far = (a, b) => gap([1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)),
    [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16))) > 90;

console.log('\n  club  measured                          hand-written');
let differ = 0;
for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
    const h = hand.get(r.code);
    const same = h && h[0] === r.pattern && !far(h[1], r.main);
    if (!same) differ++;
    console.log(`  ${r.name.padEnd(5)} ${r.pattern.padEnd(10)} ${r.main} / ${r.second}`
        + `   ${h ? `${h[0].padEnd(10)} ${h[1]} / ${h[2]}` : '(none)'.padEnd(27)}`
        + `   ${same ? '' : '<- differs'}`);
}
console.log(`\n  ${differ} of ${rows.length} read differently from the hand-written table.`);

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
