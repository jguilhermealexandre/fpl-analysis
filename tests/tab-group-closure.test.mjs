/* The Transfers tab does not load the market funnel, and must not need it.
 *
 * #v2TabScripts groups My Team's deferred scripts by tab. "transfers" used to
 * carry transfer-funnel.min.js — 37.8 KB — and renderTransferMarket() calls
 * none of its 43 functions: the funnel is the Transfer WIZARD's market pane,
 * and the Transfers tab is the price watch. It came off the group.
 *
 * What makes that safe is narrow enough to be worth pinning. Five places in
 * transfer-wizard.js call a twf* name, and transfer-wizard.js IS loaded on the
 * Transfers tab, so all five are reachable in principle. Four are wizard-
 * internal. The fifth is the one bridge between the two tabs —
 * tmSellBeforeDrop(), the "sell before drop" button on a price-watch row — and
 * it reaches them through twSetStrategy() and twSwapPlayer().
 *
 * It is safe because that button goes through switchTab('transfer') and waits
 * for the promise: switchTab loads the "wizard" group, which does carry the
 * funnel, and the staging runs in the .then(). Before the ordering fix in
 * tests/stage-after-tab-load.test.mjs those two calls ran synchronously — which
 * was harmless only because the funnel was in the group. Remove the funnel
 * without that fix and the first click on "Sell before drop" is a
 * ReferenceError on twfGWs.
 *
 * So the weight saving rests on the ordering fix, and this file says so. Two
 * assertions: the group does not carry the funnel, and nothing the Transfers
 * tab renders synchronously touches a funnel name.
 *
 * check:deferred does not cover this. It guards page-loaded code calling into a
 * deferred file; this is one deferred file calling into another, which it has
 * no opinion about.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stripComments } from '../tools/scan-globals.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const page = read('fpl-my-team-analysis.html');
const manifest = JSON.parse(
    /<script type="application\/json" id="v2TabScripts">([\s\S]*?)<\/script>/.exec(page)[1]
);
const basenames = (group) => (manifest[group] || []).map(s => s.split('/').pop().split('?')[0]);

const wizardSrc = stripComments(read('scripts/transfer-wizard.js'));
const funnelNames = new Set(
    [...stripComments(read('scripts/transfer-funnel.js'))
        .matchAll(/^\s{0,8}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1])
);

/* One top-level function's body, by brace depth. Comments are already gone, so
   a brace is a brace. */
function bodyOf(src, name) {
    const m = new RegExp(`^\\s{0,8}(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm').exec(src);
    if (!m) return null;
    let depth = 0;
    for (let k = src.indexOf('{', m.index); k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}' && --depth === 0) return src.slice(m.index, k + 1);
    }
    return null;
}

test('the funnel is not in the transfers group, and is still in the wizard group', () => {
    assert.ok(!basenames('transfers').includes('transfer-funnel.min.js'),
        'the price-watch tab does not need the wizard market pane');
    assert.ok(basenames('wizard').includes('transfer-funnel.min.js'),
        'but the wizard does, and is the only thing that fetches it now');
    assert.ok(basenames('transfers').includes('transfer-wizard.min.js'),
        'renderTransferMarket lives in transfer-wizard.js, so that stays');
});

test('the funnel is still named on the page, for check:globals', () => {
    /* tools/page-scripts.mjs treats every file named in the manifest as part of
       this page's one global scope. Dropping the last mention would take the
       funnel out of the collision check and the lint globals with it. */
    assert.equal((page.match(/transfer-funnel\.min\.js/g) || []).length, 1);
});

test('nothing the Transfers tab renders synchronously touches a funnel name', () => {
    /* The tab's own render tree. tmSellBeforeDrop is excluded deliberately and
       separately asserted below: it is the bridge into the wizard and it is
       allowed to reach funnel names on the far side of the loader. */
    const synchronous = [
        'renderTransferMarket', 'renderTmWatchRow', 'renderTmWatchLegend',
        'renderTmTransferBoard', 'renderTmTransferRow', 'tmFilterPos',
        'tmSetMarketTab', 'tmSetTransferScope',
        'tmSeasonPriceMove', 'startPriceLockCountdown'
    ];
    const offenders = [];
    for (const fn of synchronous) {
        const body = bodyOf(wizardSrc, fn);
        assert.ok(body, `${fn} should exist in transfer-wizard.js`);
        for (const m of body.matchAll(/\b(twf[A-Z]\w*)\s*\(/g)) {
            if (funnelNames.has(m[1])) offenders.push(`${fn} calls ${m[1]}`);
        }
    }
    assert.deepEqual(offenders, [],
        'a funnel call here would be a ReferenceError on the Transfers tab');
});

test('the one bridge into the wizard waits for the loader', () => {
    /* The whole safety argument in one assertion. If this reverts to a bare
       switchTab('transfer'), twSetStrategy and twSwapPlayer run before the
       wizard group has been fetched — and both call into the funnel. */
    const body = bodyOf(wizardSrc, 'tmSellBeforeDrop');
    assert.ok(body);
    assert.match(body, /Promise\.resolve\(\s*switchTab\('transfer'\)\s*\)\s*\.then/,
        'tmSellBeforeDrop must stage inside switchTab’s .then()');
    // And that it is in fact the only tm* function reaching into the wizard.
    assert.match(body, /twSwapPlayer\(/);
});

test('every funnel call in the wizard is inside a function, never at top level', () => {
    /* Top-level code runs the moment transfer-wizard.js is parsed — on the
       Transfers tab, with no funnel present. One such call would break the tab
       outright rather than on a click. */
    const lines = wizardSrc.split('\n');
    let depth = 0;
    const atTop = [];
    for (let i = 0; i < lines.length; i++) {
        if (depth === 0) {
            for (const m of lines[i].matchAll(/\b(twf[A-Z]\w*)\s*\(/g)) {
                if (funnelNames.has(m[1])) atTop.push(`${i + 1}: ${m[1]}`);
            }
        }
        depth += (lines[i].match(/{/g) || []).length - (lines[i].match(/}/g) || []).length;
    }
    assert.deepEqual(atTop, []);
});
