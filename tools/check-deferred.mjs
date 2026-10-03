#!/usr/bin/env node
/* Fails when something loaded WITH a page calls a name that only arrives when a
   tab is clicked.

   My Team names four of its scripts in a #v2TabScripts manifest instead of
   loading them: GW Draft, the Transfer Wizard, its market funnel and the
   Lineup Wizard, 286 KB that the tab the page opens on has no use for. The
   arrangement has one failure mode and it is silent. Everything still shares
   one global scope, so a name declared in a deferred file reads as a perfectly
   ordinary global — right up to the moment it is touched before its file has
   run. Then it is a ReferenceError in a click handler, or, worse, a `typeof x
   === 'function'` that is simply false and does nothing at all.

   Four of these were real: the transfer scoring engine behind the Replace
   panel, the clean-sheet model the compare report reads, the price thresholds
   under the squad table and the settings drawer on the KPI strip were all
   declared inside transfer-wizard.js, and Squad Analysis uses every one. They
   were moved; this stops them coming back.

   A reference is allowed three ways:

     1. guarded — `typeof x === 'function' && x()`, where a missing x is a
        correct no-op rather than a late one. Judgement, so it is listed below
        by name and has to be argued for once.
     2. wrapped — handed to v2RunWithScripts() as `function () { x(); }`, which
        is the loader itself and runs only after the file is there.
     3. deliberately late — a line marked `deferred-ok`, for code that runs on
        the other side of the loader's promise. One marker, within a dozen lines
        above the call, and the comment has to say why.
     4. inert markup — an inline onclick inside a region the page marks
        data-tab-script="<group>", meaning nothing in it can be clicked until
        that group has loaded. The group must be the one declaring the name.

   Anything else fails. */
import fs from 'node:fs';
import { topLevelNames } from './scan-globals.mjs';
import { PARTIALS } from './page-scripts.mjs';

/* Names an always-loaded file may reference behind a typeof guard, because the
   deferred half is genuinely optional there. One line of why, each. */
const GUARD_OK = {
    renderTWSquadPane: 'repaints the wizard\'s squad pane after a live-data refresh; with no wizard open there is no pane',
    twApplyDeepLink: 'only reached on the other side of switchTab\'s promise, which resolves once the wizard is loaded',
    updateLWContextPanel: 'refreshes the Lineup Wizard\'s intel panel when odds land; nothing to refresh if it was never opened',
    getTWBank: 'twBuildRecommendation() falls back to it only when a caller omits bank, and the only such caller is the wizard itself',
    twSquad: 'the wizard\'s view of the squad including planned moves; without it the real squad is the right answer',
    applySquadDeepLink: 'the squad-tab branch of the same deep link, declared on the page',
};

/* Comments blanked rather than deleted, newlines kept. Deleting them collapsed
   lines, so every line number this tool reported was wrong, and it also ate the
   `deferred-ok` markers it has to be able to see. */
function mask(src) {
    let out = '', i = 0;
    while (i < src.length) {
        if (src[i] === '/' && src[i + 1] === '*') {
            const end = src.indexOf('*/', i + 2);
            const stop = end < 0 ? src.length : end + 2;
            for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' ';
        } else if (src[i] === '/' && src[i + 1] === '/' && src[i - 1] !== ':') {
            while (i < src.length && src[i] !== '\n') { out += ' '; i++; }
        } else {
            out += src[i++];
        }
    }
    return out;
}

/* Every region a page marks as unclickable until a group has loaded, as
   [group, html]. Depth-counted on the tag that carries the attribute, so a
   handler anywhere inside it counts as inside. */
function markedRegions(html) {
    const out = [];
    const rx = /<(\w+)([^>]*\bdata-tab-script="([\w-]+)"[^>]*)>/g;
    let m;
    while ((m = rx.exec(html))) {
        const [tag, , , group] = [m[1], m[2], m[3], m[3]];
        const open = new RegExp(`<${tag}\\b`, 'g');
        const close = new RegExp(`</${tag}>`, 'g');
        let depth = 0, i = m.index, end = html.length;
        open.lastIndex = close.lastIndex = m.index;
        while (i < html.length) {
            open.lastIndex = close.lastIndex = i;
            const o = open.exec(html), c = close.exec(html);
            const oAt = o ? o.index : Infinity, cAt = c ? c.index : Infinity;
            if (oAt === Infinity && cAt === Infinity) break;
            if (oAt < cAt) { depth++; i = oAt + 1; }
            else { depth--; i = cAt + 1; if (depth === 0) { end = i; break; } }
        }
        out.push([group, html.slice(m.index, end)]);
    }
    return out;
}

let failures = 0;
let pagesChecked = 0;

for (const file of fs.readdirSync('.').sort()) {
    if (!file.endsWith('.html') || PARTIALS.has(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const manifest = /<script type="application\/json" id="v2TabScripts">([\s\S]*?)<\/script>/.exec(html);
    if (!manifest) continue;
    pagesChecked++;

    let groups;
    try { groups = JSON.parse(manifest[1]); }
    catch (e) { console.error(`✗ ${file}: #v2TabScripts is not valid JSON — ${e.message}`); failures++; continue; }

    /* name → the groups that can supply it */
    const owner = new Map();
    const deferredFiles = new Set();
    for (const [group, list] of Object.entries(groups)) {
        for (const src of list) {
            const f = 'scripts/' + src.split('?')[0].split('/').pop().replace(/\.min\.js$/, '.js');
            if (!fs.existsSync(f)) { console.error(`✗ ${file}: ${src} is in the manifest but ${f} does not exist`); failures++; continue; }
            deferredFiles.add(f);
            for (const n of topLevelNames(fs.readFileSync(f, 'utf8'))) {
                if (!owner.has(n)) owner.set(n, new Set());
                owner.get(n).add(group);
            }
        }
    }

    /* Everything the page DOES load, plus its own inline blocks. */
    const eager = [...html.matchAll(/<script src="\/?scripts\/([\w.-]+)\.min\.js/g)]
        .map(m => `scripts/${m[1]}.js`)
        .filter(f => fs.existsSync(f) && !deferredFiles.has(f));
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

    const regions = markedRegions(html);
    const markup = html.replace(/<!--[\s\S]*?-->/g, ' ');

    const units = eager.map(f => { const raw = fs.readFileSync(f, 'utf8'); return [f, mask(raw), raw]; });
    units.push([`${file} (inline)`, mask(inline), inline]);

    for (const [where, body, raw] of units) {
        /* Argument lists handed to the loader are exempt wholesale: that is
           where a wrapped renderer legitimately names its own file's function.
           Paren-balanced, because the wrapper's own body carries parentheses
           and "up to the first )" stops inside it. */
        const exempt = [];
        for (let at = body.indexOf('v2RunWithScripts('); at > -1; at = body.indexOf('v2RunWithScripts(', at + 1)) {
            let depth = 0, i = at + 'v2RunWithScripts'.length;
            for (; i < body.length; i++) {
                if (body[i] === '(') depth++;
                else if (body[i] === ')' && --depth === 0) break;
            }
            exempt.push(body.slice(at, i + 1));
        }
        const exemptText = exempt.join('\n');
        /* The markers live in the comments, so they are read off the real
           source at the same line numbers the masked copy reports. */
        const rawLines = raw.split('\n');
        /* One report per name per line: a guarded call mentions the name twice
           on the same line and does not need saying twice. */
        const said = new Set();
        for (const [name, canSupply] of owner) {
            const rx = new RegExp(`\\b${name}\\b`, 'g');
            let m;
            while ((m = rx.exec(body))) {
                const line = body.slice(0, m.index).split('\n').length;
                if (said.has(line + ':' + name)) continue;
                const text = rawLines[line - 1] || '';
                if (new RegExp(`typeof ${name} === 'function'`).test(text)) {
                    said.add(line + ':' + name);
                    if (GUARD_OK[name]) continue;
                    console.error(`✗ ${where}:${line}: "${name}" is guarded by typeof but lives in a deferred file `
                        + `(group ${[...canSupply].join('/')}). A guard on a name that is merely late is silently false. `
                        + `Move it to a file the page loads, or add it to GUARD_OK in tools/check-deferred.mjs with a reason.`);
                    failures++;
                    continue;
                }
                if (exemptText.includes(name)) continue;
                said.add(line + ':' + name);
                /* An explicit `deferred-ok` note within a dozen lines above. */
                if (rawLines.slice(Math.max(0, line - 13), line).some(l => l.includes('deferred-ok'))) continue;
                console.error(`✗ ${where}:${line}: "${name}" is called here but declared in a deferred file `
                    + `(group ${[...canSupply].join('/')}), so it does not exist until that tab is opened.`);
                console.error(`      ${text.trim().slice(0, 120)}`);
                failures++;
            }
        }
    }

    /* Inline handlers in the markup. */
    for (const m of markup.matchAll(/\son(?:click|change|input|submit)="([^"]*)"/g)) {
        const handler = m[1];
        for (const [name, canSupply] of owner) {
            if (!new RegExp(`\\b${name}\\s*\\(`).test(handler)) continue;
            const inside = regions.some(([g, h]) => canSupply.has(g) && h.includes(m[0]));
            if (inside) continue;
            console.error(`✗ ${file}: onclick="${handler.slice(0, 60)}" calls "${name}", declared in a deferred file `
                + `(group ${[...canSupply].join('/')}).`);
            console.error(`      Either move it to a file the page loads, or — if this markup cannot be clicked `
                + `before that group has loaded — mark its container data-tab-script="${[...canSupply][0]}".`);
            failures++;
        }
    }
}

if (failures) {
    console.error(`\n✗ ${failures} reference(s) into a deferred tab script`);
    process.exit(1);
}
console.log(`✓ nothing loaded with the page reaches into a deferred tab script (${pagesChecked} page(s) with a manifest)`);
