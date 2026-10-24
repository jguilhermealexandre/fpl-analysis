/* The shirt that replaced the photograph.
 *
 * Every face on the site used to be a club headshot from
 * resources.premierleague.com — the league's photographs, which we have no
 * licence to republish. A player is drawn now: the back of his club's shirt,
 * with his squad number on it.
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
        + ';globalThis.__kit = { CLUB_KITS, CLUB_KIT_FALLBACK,'
        + ' V2_KIT_SHIRT, V2_KIT_SLEEVE_L };',
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

/* A pattern the renderer does not know draws a plain shirt and says nothing
   about it, so the table is checked against what the renderer can draw. */
const everyKit = () => Object.entries(kit.CLUB_KITS).map(([c, k]) => [`club ${c}`, k]);

test('every kit names a pattern the renderer draws', () => {
    const drawn = new Set(['plain', 'stripes', 'pinstripes', 'hoops', 'halves', 'sash', 'sleeves']);
    for (const [where, k] of everyKit()) {
        assert.ok(drawn.has(k[0]), `club ${where} asks for "${k[0]}", which nothing draws`);
    }
});

test('every kit is five entries of the shape the renderer reads', () => {
    for (const [where, k] of everyKit()) {
        assert.equal(k.length, 5, `club ${where}`);
        for (const c of k.slice(1)) {
            assert.match(c, /^#[0-9A-F]{6}$/, `club ${where} has a colour that is not a six-digit hex`);
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
    for (const [where, [pattern, main, second, ink]] of everyKit()) {
        /* Every colour the number is actually printed over. Stripes, hoops,
           halves and a sash all run under it, so both colours count; contrast
           sleeves do not — they are nowhere near it. */
        const across = new Set(['stripes', 'pinstripes', 'hoops', 'halves', 'sash']);
        const grounds = across.has(pattern) ? [main, second] : [main];
        /* The glyph or its halo has to separate from the ground; a real
           outlined shirt number works the same way, which is why it is
           outlined. The halo is drawn at half to three-fifths alpha, so it is
           judged at full strength and the margin is the test's own. */
        const halo = /^rgba\(0,0,0/.test(kit.v2KitHalo(ink)) ? '#000000' : '#FFFFFF';
        for (const g of grounds) {
            const best = Math.max(contrast(ink, g), contrast(halo, g));
            if (best < 3) {
                bad.push(`club ${where}: neither ${ink} nor its halo separates from ${g}`);
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

test('a player the league has not numbered wears a plain shirt', () => {
    /* A new signing or a youth call-up has no number for days or weeks, and
       giving him one would be the invention this whole thing avoids. His
       initials were tried in that place and read as a mistake beside thirty
       real numbers, so the shirt is drawn without one. */
    const anon = bootstrap.elements.find(p => p.squad_number == null);
    assert.ok(anon, 'nobody is unnumbered, so this case is no longer reachable');
    assert.equal(kit.v2KitNumber({ name: anon.web_name, code: anon.code }), '');
    assert.doesNotMatch(kit.v2KitSVG({ name: anon.web_name, code: anon.code }), /v2-kit-n/);
});

test('the numbers survive a data refresh', () => {
    /* They lasted three hours a week: every live refresh copies a fresh
       bootstrap over the file, and FPL's has no numbers in it. The normaliser
       both data jobs run after the copy lays them back from their own file. */
    const numbers = JSON.parse(read('data/shirt-numbers.json'));
    assert.ok(Object.keys(numbers).length > bootstrap.elements.length * 0.6);
    for (const wf of ['refresh-live-data.yml', 'update.player-data.yml']) {
        const src = read(`.github/workflows/${wf}`);
        const copy = src.indexOf('cp /tmp/bootstrap.json data/bootstrap-static.json');
        const norm = src.indexOf('tools/normalise-bootstrap.mjs data/bootstrap-static.json');
        assert.ok(copy > -1 && norm > copy, `${wf} must normalise the bootstrap after replacing it`);
    }
    assert.match(read('tools/normalise-bootstrap.mjs'), /shirt-numbers\.json/);
});

test('a code alone is enough to dress him in his club and number', () => {
    /* A stored Scout's Desk subject carries a name and a code and nothing
       else, and drew Haaland in the fallback purple with an H on it. */
    const fresh = kitContext();
    const boot = { teams: [{ id: 13, code: 43 }], elements: [{ code: 223094, team: 13, element_type: 4, squad_number: 9 }] };
    fresh.v2LearnShirtNumbers(boot);
    const svg = fresh.v2KitSVG({ name: 'Haaland', code: 223094 });
    assert.match(svg, new RegExp(`fill="${fresh.CLUB_KITS[43][1]}"`));
    assert.match(svg, />9<\/text>/);
});

test('the number is learned from the bootstrap, not threaded through the callers', () => {
    const src = read('scripts/common.js');
    assert.match(src, /function v2LearnShirtNumbers\(boot\)/);
    assert.match(src, /key\.endsWith\('\/bootstrap-static\.json'\)/,
        'DataCache.fetchJSON is the one seam every page\u2019s bootstrap passes through');
});

test('a real number wins, and there is no fallback', () => {
    assert.equal(kit.v2KitNumber({ name: 'Bruno Fernandes' }), '', 'nothing known about him');
    assert.equal(kit.v2KitNumber({ name: 'Bruno Fernandes', shirt: 8 }), '8',
        'a real number wins the moment one exists');
    assert.equal(kit.v2KitNumber({ name: 'Saka', squadNumber: 7 }), '7');
});

/* ===== The drawing ===== */

test('the silhouette is written once and referenced wherever it is needed', () => {
    const svg = kit.v2KitSVG({ name: 'Isak', teamCode: 4, team: 'NEW' });
    assert.equal((svg.match(/48\.1 54\.4/g) || []).length, 1,
        'the body outline is declared once — the fill, the clip and the edge are <use>');
    assert.equal((svg.match(/<use href="#v2k-shirt"/g) || []).length, 3,
        'clipped, filled, outlined');
    assert.ok(svg.includes('<use href="#v2k-shade"/>'), 'and the shading is shared too');
    assert.ok(svg.includes('<use href="#v2k-trim"'), 'and the collar and cuffs');
});

/* The geometry is fixed — only the colours and the number change — so a page
   of eleven shirts should pay for the paths once. v2KitEnsureDefs() hoists them
   into one hidden <svg> on the document and every shirt then refers to that.
   Here there is no document, which is the other half of the contract: the
   drawing still has to stand on its own for a statically rendered article. */
test('with nowhere to hoist them, a shirt carries its own copy of the defs', () => {
    assert.equal(typeof kit.document, 'undefined', 'no DOM in this context');
    assert.equal(kit.v2KitEnsureDefs(), false);
    const svg = kit.v2KitSVG({ name: 'A', teamCode: 4 });
    assert.ok(svg.includes('<defs>'), 'so it writes them inline');
    assert.ok(svg.includes('id="v2k-shirt"'));
});

test('two shirts on a page share one copy of the geometry', () => {
    const a = kit.v2KitSVG({ name: 'A', teamCode: 4, shirt: 9 });
    const b = kit.v2KitSVG({ name: 'B', teamCode: 4, shirt: 9 });
    assert.equal(a, b, 'the same club and number is the same drawing, byte for byte');
    assert.ok(a.includes('clip-path="url(#v2k-clip)"'),
        'both clip to the one shared path rather than a per-shirt duplicate');
});

test('a striped club is drawn striped and a sleeved club sleeved', () => {
    const newcastle = kit.v2KitSVG({ name: 'Isak', teamCode: 4 });
    assert.equal((newcastle.match(/<rect x="\d+" y="0" width="8"/g) || []).length, 4, 'four stripes');
    const arsenal = kit.v2KitSVG({ name: 'Saka', teamCode: 3 });
    assert.ok(arsenal.includes(`<path d="${kit.V2_KIT_SLEEVE_L}" fill="`),
        'the left sleeve is filled in its own colour');
    assert.ok(!/width="8"/.test(arsenal), 'and nothing is striped');
});

/* Six patterns and a plain shirt. The table only reaches for a pattern when
   the art it was measured from has one, so a pattern the renderer silently
   ignored would show up as a plain shirt for one club and nothing else —
   which is exactly the kind of wrong that goes unnoticed for a season. */
test('every pattern the table can name draws something', () => {
    const cases = {
        plain:      null,
        stripes:    /<rect x="\d+" y="0" width="8"/,
        pinstripes: /<rect x="\d+" y="0" width="2"/,
        hoops:      /<rect x="0" y="\d+" width="64" height="6"/,
        halves:     /<rect x="32" y="0" width="32"/,
        sash:       /<path d="M8 64L40 6/,
        sleeves:    /<path d="M16\.6 15\.2C13/
    };
    for (const [pattern, shape] of Object.entries(cases)) {
        kit.CLUB_KITS[777] = [pattern, '#101010', '#F0F0F0', '#FFFFFF', '#F0F0F0'];
        const svg = kit.v2KitSVG({ name: 'Test', teamCode: 777 });
        if (shape) assert.match(svg, shape, `"${pattern}" draws nothing`);
        /* The shared shading rect is in every shirt, so a plain one is
           pinned by the absence of anything painted in the second colour. */
        else assert.ok(!svg.includes('fill="#F0F0F0"'), 'a plain shirt wears one colour');
    }
    delete kit.CLUB_KITS[777];
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
    assert.ok(kit.v2KitSVG({ name: 'Isak', teamCode: 4, shirt: 14 }).includes('v2-kit-n'));
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
