/* The shirt that replaced the photograph.
 *
 * Every face on the site used to be a club headshot from
 * resources.premierleague.com — the league's photographs, which we have no
 * licence to republish. A player is drawn now: the back of his club's shirt,
 * with his initials where the squad number goes.
 *
 * What these pin is the part that can quietly rot. The kit table is keyed by
 * the league's team code and has to cover whoever is actually in the division
 * this season; the number has to stay honest about the fact that FPL no longer
 * publishes squad numbers; and the ink has to be readable on the shirt it is
 * printed on, which is a thing you can measure rather than squint at.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const common = read('scripts/common.js');

/* The identity block, evaluated on its own. Everything from the position-class
   map down to the position edge is self-contained — no DOM, no fetch. */
function kitContext(teams) {
    const from = common.indexOf('const V2_POS_CLASS');
    const to = common.indexOf("/* The class that paints a position colour down a row's leading edge");
    assert.ok(from > -1 && to > from, 'the identity block is still one run of common.js');
    const ctx = {
        console,
        escHTML: t => String(t == null ? '' : t),
        teams: teams || {}
    };
    ctx.window = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    /* The tables are `const`, and a top-level const in a vm script does not
       become a property of the context the way a function declaration does.
       Handed over explicitly rather than rewritten as globals in the shipped
       file to suit the test. */
    new vm.Script(common.slice(from, to)
        + ';globalThis.__kit = { CLUB_KITS, CLUB_KIT_FALLBACK, V2_KIT_SHIRT };',
    { filename: 'scripts/common.js#identity' }).runInContext(ctx);
    return Object.assign(ctx, ctx.__kit);
}

const bootstrap = JSON.parse(read('data/bootstrap-static.json'));
const kit = kitContext();

/* ===== The table covers the division ===== */

test('every club in the division has a kit', () => {
    const missing = bootstrap.teams
        .filter(t => !kit.CLUB_KITS[t.code])
        .map(t => `${t.short_name} (code ${t.code})`);
    assert.deepEqual(missing, [],
        'a promoted club with no kit wears the league purple, which is wrong rather than merely plain');
});

test('every kit names a pattern the renderer draws', () => {
    const drawn = new Set(['plain', 'stripes', 'sleeves']);
    for (const [code, k] of Object.entries(kit.CLUB_KITS)) {
        assert.ok(drawn.has(k[0]), `club ${code} asks for "${k[0]}", which nothing draws`);
    }
});

test('every kit is five entries of the shape the renderer reads', () => {
    for (const [code, k] of Object.entries(kit.CLUB_KITS)) {
        assert.equal(k.length, 5, `club ${code}`);
        for (const c of k.slice(1)) {
            assert.match(c, /^#[0-9A-F]{6}$/, `club ${code} has a colour that is not a six-digit hex`);
        }
    }
});

/* ===== The number is readable on the shirt =====
   Relative luminance per WCAG, so "is this legible" is a number and not an
   opinion. 3:1 is the large-text threshold, which is what a 21px glyph on a
   64-unit shirt is. */
function luminance(hex) {
    const ch = [1, 3, 5].map(i => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function contrast(a, b) {
    const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
}

test('the number reads on every colour it is printed over', () => {
    const bad = [];
    for (const [code, [pattern, main, second, ink]] of Object.entries(kit.CLUB_KITS)) {
        /* Both colours for a striped shirt, because the number sits across the
           stripes. Only the body for a sleeved one — the sleeves are nowhere
           near it. */
        const grounds = pattern === 'stripes' ? [main, second] : [main];
        /* The glyph or its halo has to separate from the ground; a real
           outlined shirt number works the same way, which is why it is
           outlined. The halo is drawn at half to three-fifths alpha, so it is
           judged at full strength and the margin is the test's own. */
        const halo = /^rgba\(0,0,0/.test(kit.v2KitHalo(ink)) ? '#000000' : '#FFFFFF';
        for (const g of grounds) {
            const best = Math.max(contrast(ink, g), contrast(halo, g));
            if (best < 3) {
                bad.push(`club ${code}: neither ${ink} nor its halo separates from ${g}`);
            }
        }
    }
    assert.deepEqual(bad, [], 'a kit whose number cannot be read on its own shirt');
});

test('the halo turns against the ink, so the number survives either stripe', () => {
    assert.match(kit.v2KitHalo('#FFFFFF'), /^rgba\(0,0,0/, 'a light number gets a dark halo');
    assert.match(kit.v2KitHalo('#132257'), /^rgba\(255,255,255/, 'and a dark one a light halo');
    assert.match(kit.v2KitHalo(undefined), /^rgba\(/, 'and nonsense still gets something');
});

/* ===== What goes where the number goes ===== */

/* This test used to assert the opposite — that squad_number was null for all
   667 players, which it was, and that the initials were therefore the honest
   thing to print. It was written to fail the day real numbers arrived. They
   have: tools/fetch-shirt-numbers.mjs reads the league's own squad pages and
   joins them to FPL's elements on the Opta id. */
test('the squad numbers are there, and enough of them to be the default', () => {
    const numbered = bootstrap.elements.filter(p => p.squad_number != null);
    assert.ok(numbered.length > bootstrap.elements.length * 0.6,
        `only ${numbered.length}/${bootstrap.elements.length} players carry a number — has the fetch stopped working?`);
    for (const p of numbered.slice(0, 50)) {
        assert.ok(Number.isInteger(p.squad_number) && p.squad_number > 0 && p.squad_number < 100,
            `${p.web_name} wears ${p.squad_number}, which is not a squad number`);
    }
});

test('a player the league has not numbered keeps his initials', () => {
    /* A new signing or a youth call-up has no number for days or weeks, and
       giving him one would be the invention this whole thing avoids. */
    const anon = bootstrap.elements.find(p => p.squad_number == null);
    assert.ok(anon, 'nobody is unnumbered, so this case is no longer reachable');
    assert.equal(kit.v2KitNumber({ name: anon.web_name, code: anon.code }),
        kit.v2Initials(anon.web_name));
});

test('the number is learned from the bootstrap, not threaded through the callers', () => {
    const src = read('scripts/common.js');
    assert.match(src, /function v2LearnShirtNumbers\(boot\)/);
    assert.match(src, /key\.endsWith\('\/bootstrap-static\.json'\)/,
        'DataCache.fetchJSON is the one seam every page\u2019s bootstrap passes through');
});

test('a real number wins, and the initials are the fallback', () => {
    assert.equal(kit.v2KitNumber({ name: 'Bruno Fernandes' }), 'BF', 'nothing known about him');
    assert.equal(kit.v2KitNumber({ name: 'Saka' }), 'S');
    assert.equal(kit.v2KitNumber({ name: 'Bruno Fernandes', shirt: 8 }), '8',
        'a real number wins the moment one exists');
    assert.equal(kit.v2KitNumber({ name: 'Saka', squadNumber: 7 }), '7');
});

/* ===== The drawing ===== */

test('the silhouette is written once and referenced three times', () => {
    const svg = kit.v2KitSVG({ name: 'Isak', teamCode: 4, team: 'NEW' });
    assert.equal((svg.match(/M23\.5 14L/g) || []).length, 1,
        'the path itself appears once — the fill, the clip and the outline are <use>');
    assert.equal((svg.match(/<use /g) || []).length, 3);
});

test('each shirt clips to its own copy, so two on a page cannot collide', () => {
    const a = kit.v2KitSVG({ name: 'A', teamCode: 4 });
    const b = kit.v2KitSVG({ name: 'B', teamCode: 4 });
    const idOf = s => /<path id="(vk\d+)"/.exec(s)[1];
    assert.notEqual(idOf(a), idOf(b));
    assert.ok(a.includes(`url(#${idOf(a)}c)`), 'and each clips to its own');
});

test('a striped club is drawn striped and a sleeved club sleeved', () => {
    const newcastle = kit.v2KitSVG({ name: 'Isak', teamCode: 4 });
    assert.equal((newcastle.match(/<rect x="\d+" y="0" width="8"/g) || []).length, 4, 'four stripes');
    const arsenal = kit.v2KitSVG({ name: 'Saka', teamCode: 3 });
    assert.ok(arsenal.includes('M17.2 15.4L6.4 21.6'), 'the left sleeve is filled in its own colour');
    assert.ok(!/width="8"/.test(arsenal), 'and nothing is striped');
});

test('a club we have never drawn gets the league purple, not an empty disc', () => {
    const svg = kit.v2KitSVG({ name: 'Nobody', teamCode: 999, team: 'XYZ' });
    assert.ok(svg.includes(kit.CLUB_KIT_FALLBACK[1]));
    assert.match(svg, /aria-label="XYZ shirt"/);
});

test('the shirt stays inside the circle the avatar crops it to', () => {
    /* Every coordinate in the silhouette, against the 32-unit radius, with
       room for the widest stroke laid over it. The first draft had the cuffs
       at 31.4 and every sleeve came back flattened. */
    const nums = kit.V2_KIT_SHIRT.match(/-?\d+(\.\d+)?/g).map(Number);
    let worst = 0;
    for (let i = 0; i + 1 < nums.length; i += 2) {
        worst = Math.max(worst, Math.hypot(nums[i] - 32, nums[i + 1] - 32));
    }
    assert.ok(worst < 30, `the furthest point is at r=${worst.toFixed(1)}, which the circle will clip`);
});

test('the number can be left off where the shirt is too small to carry one', () => {
    assert.ok(!kit.v2KitSVG({ name: 'Isak', teamCode: 4 }, { number: false }).includes('v2-kit-n'));
    assert.ok(kit.v2KitSVG({ name: 'Isak', teamCode: 4 }).includes('v2-kit-n'));
});

/* ===== And no photograph anywhere ===== */

function shippedSource() {
    return ['scripts', 'styles'].flatMap(d =>
        fs.readdirSync(path.join(ROOT, d))
            .filter(f => /\.(js|css)$/.test(f) && !f.includes('.min.'))
            .map(f => `${d}/${f}`))
        .concat(fs.readdirSync(ROOT).filter(f => /^(index|fpl-|welcome|premium|login|register)[\w-]*\.html$/.test(f)));
}

/* The badges are ours too now — assets/crests/, fetched by
   tools/fetch-crests.mjs and kept current by .github/workflows/update-crests.yml.
   The path is written once, in v2CrestSrc; it used to be spelled out in
   sixteen places across ten files, which is how one of them ends up on a
   stale URL and nobody notices for a season. */
test('the badge path is written once and points at our own origin', () => {
    const offenders = shippedSource().filter(f => /premierleague\.com\/premierleague[\w-]*\/badges/.test(read(f)));
    assert.deepEqual(offenders, [], 'a hot-linked club badge is back in the source');
    assert.match(read('scripts/common.js'), /function v2CrestSrc\(code\) \{\s*return `\/assets\/crests\/t\$\{Number\(code\)\}\.png`;/);

    /* Served as a raster, kept as a vector. The league's badges average 35KB
       of Illustrator export for something drawn at 14px; at 160px they are
       4.8KB each and identical at every size this site renders one. */
    const served = fs.readdirSync(path.join(ROOT, 'assets', 'crests')).filter(f => f.endsWith('.png'));
    assert.ok(served.length >= 20, `only ${served.length} badges are served`);
    const heaviest = Math.max(...served.map(f => fs.statSync(path.join(ROOT, 'assets', 'crests', f)).size));
    assert.ok(heaviest < 16 * 1024, `the heaviest badge is ${(heaviest / 1024).toFixed(1)}KB — raster them smaller`);
});

test('nothing in the shipped source asks for a player photograph', () => {
    const offenders = shippedSource().filter(f => /photos\/players/.test(read(f)));
    assert.deepEqual(offenders, [], 'a player photo URL is back in the source');
});
