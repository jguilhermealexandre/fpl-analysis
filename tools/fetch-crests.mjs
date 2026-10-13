/* The twenty club badges, fetched once and served from our own origin.
 *
 * They used to be hot-linked from resources.premierleague.com on every render,
 * in sixteen places that each spelled the URL out. That is one request per
 * badge per page against somebody else's CDN, with no cache we control, no
 * say over whether the path keeps working, and a 404-and-remove dance in the
 * markup for the clubs it has never had. Twenty files is 60KB. We hold them.
 *
 * SVG only, deliberately. A badge is line art and it is drawn at 14px in a
 * table and at 26px on a hero; a 100px PNG is soft at one end and wasteful at
 * the other. A club with no SVG is not written at all and is reported — the
 * runtime already falls back to the club's short name, which is a correct
 * picture rather than a broken one.
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
const CHECK = process.argv.includes('--check');

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
    const missing = clubs.filter(c => !fs.existsSync(path.join(OUT, `t${c.code}.svg`)));
    if (missing.length) {
        for (const c of missing) console.error(`::error::no crest for ${c.name} (t${c.code}.svg)`);
        console.error(`✗ ${missing.length} club(s) have no badge; they fall back to the short name`);
        process.exit(1);
    }
    console.log(`✓ all ${clubs.length} clubs have a badge in assets/crests/`);
    process.exit(0);
}

fs.mkdirSync(OUT, { recursive: true });
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
    const file = path.join(OUT, `t${club.code}.svg`);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    if (existing === svg) { unchanged++; } else { fs.writeFileSync(file, svg + '\n'); written++; }
    console.log(`  ${club.name.padEnd(4)} t${String(club.code).padEnd(3)} ${String(svg.length).padStart(6)}b`
        + ` ${existing === svg ? 'unchanged' : 'written  '}`
        + (removed.length ? `  stripped: ${removed.join(', ')}` : '')
        + (leftovers.length ? `  ⚠ still mentions: ${leftovers.join(', ')}` : '')
        + `  <- ${from.replace('https://resources.premierleague.com', '')}`);
}

console.log(`\n${written} written, ${unchanged} unchanged, ${failed.length} missing`);
if (failed.length) {
    console.error(`::warning::no badge for ${failed.map(c => c.name).join(', ')} — they will show the club's short name`);
}
