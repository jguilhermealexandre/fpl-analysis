/* Tabs whose script arrives on the click, and the two ways that breaks quietly.
 *
 * My Team opens on Squad Analysis and ships six tabs. draft-planner.js is 100 KB
 * minified, read by GW Draft and by the Transfer Wizard and by nothing else, so
 * it is named in a JSON manifest on the page and fetched when one of those tabs
 * is first opened — see v2RunWithScripts() in common.js.
 *
 * Both failures this file guards are silent in the way that matters: the page
 * loads, the default tab draws, and the fault only shows when someone clicks.
 *
 *   1. Naming the renderer as an argument — v2RunWithScripts(k, g,
 *      renderSquadPlanner, host) — reads the global while its file is still in
 *      flight. That is a ReferenceError thrown before the loader is even
 *      entered, so the tab stays blank and nothing is ever fetched. It happened
 *      on the first cut of this change.
 *   2. A manifest that does not name the file the loader asks for resolves an
 *      empty list immediately and calls the renderer anyway — the same
 *      ReferenceError, from the other side.
 *
 * These are text assertions on purpose. The behaviour they pin is which moment
 * an identifier is read in, and no amount of running the function in a harness
 * reproduces a page's script-loading order.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const tabs = read('scripts/panels-and-tabs.js');
const page = read('fpl-my-team-analysis.html');

/* Every v2RunWithScripts(...) call in the file, with its arguments. Brace
   matching rather than a lazy regex: the renderer is wrapped in a function
   whose body contains its own parentheses, and `up to the first );` stops
   inside it. */
function calls(src) {
    const out = [];
    const name = 'v2RunWithScripts(';
    for (let at = src.indexOf(name); at > -1; at = src.indexOf(name, at + 1)) {
        let depth = 0, i = at + name.length - 1;
        for (; i < src.length; i++) {
            if (src[i] === '(') depth++;
            else if (src[i] === ')' && --depth === 0) break;
        }
        out.push(src.slice(at + name.length, i));
    }
    return out;
}

test('every deferred tab passes its renderer wrapped, never named', () => {
    const found = calls(tabs);
    assert.ok(found.length >= 2, 'expected My Team to defer at least two tabs');
    for (const args of found) {
        assert.match(args, /function \(\) \{/,
            `v2RunWithScripts(${args.replace(/\s+/g, ' ').trim()}) names its renderer directly. `
            + 'That reads the global before its file has run — wrap it in function () { ... }');
    }
});

test('the manifest names every group the page asks the loader for', () => {
    const manifest = /<script type="application\/json" id="v2TabScripts">([\s\S]*?)<\/script>/.exec(page);
    assert.ok(manifest, 'fpl-my-team-analysis.html has no #v2TabScripts manifest');
    const groups = JSON.parse(manifest[1]);

    for (const args of calls(tabs)) {
        const group = /,\s*'([^']+)'/.exec(args);
        assert.ok(group, `cannot read the group name out of v2RunWithScripts(${args})`);
        const list = groups[group[1]];
        assert.ok(Array.isArray(list) && list.length,
            `the manifest has no files under "${group[1]}", so that tab would call its `
            + 'renderer before anything had loaded it');
        for (const src of list) {
            const file = src.split('?')[0].replace(/^\//, '').replace(/\.min\.js$/, '.js');
            assert.ok(fs.existsSync(path.join(ROOT, file)), `${src} is named in the manifest but ${file} does not exist`);
        }
    }
});

test('a deferred file is not also loaded eagerly by a <script src>', () => {
    const manifest = /<script type="application\/json" id="v2TabScripts">([\s\S]*?)<\/script>/.exec(page);
    const named = Object.values(JSON.parse(manifest[1])).flat()
        .map(s => s.split('?')[0]);
    const eager = [...page.matchAll(/<script src="(\/scripts\/[\w.-]+\.js)/g)].map(m => m[1]);
    for (const src of named) {
        assert.ok(!eager.includes(src),
            `${src} is in the manifest and also in a <script src> — the tag wins and the deferral buys nothing`);
    }
});

test('the loader asks the manifest rather than building URLs itself', () => {
    const common = read('scripts/common.js');
    assert.match(common, /getElementById\('v2TabScripts'\)/,
        'v2TabManifest() no longer reads the page manifest');
    assert.doesNotMatch(common, /v2ScriptCache\[[^\]]*\]\s*=\s*[^;]*'\/scripts\/'/,
        'the loader is composing /scripts/ URLs again — npm run stamp cannot reach a literal in a .js file');
    assert.match(common, /s\.async = false/,
        'async = false is what keeps these files executing in manifest order');
});
