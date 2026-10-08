#!/usr/bin/env node
/* What is unusable with a keyboard or a screen reader, measured rather than guessed.
   ============================================

   The static scan that opened this work found 61 click handlers on <div>s and
   <td>s, 21 icon-only buttons with no name, 112 of 148 table headers with no
   scope, and three role="dialog" on a site with a dozen modals. Grep can find
   those. What grep cannot do is tell you which of them a real user actually hits,
   whether a contrast pair fails against the colour it really renders on, or
   whether the fourth tab of My Team has a focus order at all — because none of
   that exists until the page is running.

   So this drives the same browser over the same pages as tools/audit-mobile.mjs,
   through the same tab-walker, and runs axe-core at every stop. Same page list,
   imported from the same module: an audit that visits a different set of screens
   from its sibling produces findings that cannot be compared.

   WHY A TEAM ID IS SEEDED. Four of these URLs sit behind dashboard-gate.js and
   redirect to the sign-in screen without one. An audit that skipped it would
   report the login page clean a dozen times and never see the app at all.

   WHY TABS ARE WALKED. My Team is six screens wearing one URL. A violation on
   the Lineup Wizard is as real as one on Squad Analysis, and only one of them is
   visible when the page loads.

   WHAT IT DOES NOT DO. It does not pass judgement on whether a finding is worth
   fixing, and it is not the whole of accessibility — axe catches perhaps a third
   of real barriers. The keyboard walk and the screen-reader read in the
   per-surface checklist are the other two thirds, and they are done by hand.

   Needs the dev server (npm run dev) and Playwright's Chromium. Not part of
   `npm run check` for the same reason audit-mobile is not: that gate cannot
   assume a running server.

   Usage:
     node tools/audit-a11y.mjs                     every page
     node tools/audit-a11y.mjs --pages app         the signed-in screens only
     node tools/audit-a11y.mjs --pages "my team"   one page, by label
     node tools/audit-a11y.mjs --json              machine-readable, for a baseline
*/
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { BASE, CHROME, PAGES, sections, openSection } from './audit-pages.mjs';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const pagesArg = args.indexOf('--pages');
const FILTER = pagesArg !== -1 ? String(args[pagesArg + 1]) : null;

/* One width, and it is a phone. Nearly every axe rule is width-independent —
   a button with no name has no name at any size — and the handful that are not
   (target size, reflow) fail on the narrow one first. Six widths would take six
   times as long to find the same list. */
const WIDTH = 390;

/* The rule tags worth gating on. wcag2a/wcag2aa/wcag21a/wcag21aa are the
   conformance levels; best-practice is advisory and is collected but reported
   separately, because mixing "this is a barrier" with "this is a preference" is
   how a long list stops being read. */
const CONFORMANCE = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const chosen = FILTER === 'app'
    ? PAGES.filter(([p]) => p.startsWith('/dashboard/'))
    : FILTER
        ? PAGES.filter(([, label]) => label.includes(FILTER))
        : PAGES;

if (!chosen.length) {
    console.error(`No page matches --pages "${FILTER}". Labels: ${PAGES.map(p => p[1]).join(', ')}`);
    process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({
    viewport: { width: WIDTH, height: 844 },
    isMobile: true, hasTouch: true, deviceScaleFactor: 1
});
await ctx.addInitScript(() => {
    try { localStorage.setItem('fpl_team_id', '0'); } catch { /* private mode */ }
});
const page = await ctx.newPage();
const axeSource = fs.readFileSync(AXE, 'utf8');

const findings = [];

for (const [path, label] of chosen) {
    try {
        await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
        findings.push({ page: label, section: null, error: 'did not load' });
        continue;
    }
    // The app pages fetch four data files and build the squad before anything is
    // in the DOM to audit. Same wait audit-mobile uses, for the same reason.
    await page.waitForTimeout(5200);

    const tabs = await sections(page);
    const stops = tabs.length ? tabs : [{ i: -1, label: null }];

    for (const stop of stops) {
        if (stop.i >= 0) {
            try { await openSection(page, stop.i); } catch { continue; }
        }
        let result;
        try {
            await page.evaluate(axeSource);
            result = await page.evaluate(async () => {
                /* eslint-disable no-undef */
                return await axe.run(document, {
                    resultTypes: ['violations'],
                    // Iframes: there are none on this site, and asking for them
                    // costs a timeout per page when one cannot be reached.
                    iframes: false
                });
                /* eslint-enable no-undef */
            });
        } catch (err) {
            findings.push({ page: label, section: stop.label, error: `axe failed: ${err.message}` });
            continue;
        }
        for (const v of result.violations) {
            const conformance = v.tags.some(t => CONFORMANCE.includes(t));
            findings.push({
                page: label, section: stop.label, id: v.id, impact: v.impact,
                conformance, help: v.help,
                nodes: v.nodes.length,
                // One example is enough to find it; twenty is a wall of HTML.
                example: (v.nodes[0]?.target || []).join(' ')
            });
        }
        process.stderr.write(`  ${label}${stop.label ? ' › ' + stop.label : ''}: `
            + `${result.violations.length} violation type(s)\n`);
    }
}

await browser.close();

if (asJson) {
    console.log(JSON.stringify({ base: BASE, width: WIDTH, at: new Date().toISOString(), findings }, null, 2));
    process.exit(0);
}

const errors = findings.filter(f => f.error);
const real = findings.filter(f => f.id && f.conformance);
const advisory = findings.filter(f => f.id && !f.conformance);

const RANK = { critical: 0, serious: 1, moderate: 2, minor: 3 };
real.sort((a, b) => (RANK[a.impact] ?? 9) - (RANK[b.impact] ?? 9) || b.nodes - a.nodes);

console.log(`\n=== WCAG A/AA violations: ${real.length} findings over ${chosen.length} page(s) at ${WIDTH}px ===`);
if (!real.length) console.log('  none');
for (const f of real) {
    console.log(`  [${(f.impact || '?').toUpperCase().padEnd(8)}] ${f.page}${f.section ? ' › ' + f.section : ''}`
        + `  ${f.id} ×${f.nodes}`);
    console.log(`             ${f.help}`);
    if (f.example) console.log(`             e.g. ${f.example}`);
}

/* Which rules bite most, which is how you decide what to fix first: one rule
   failing on 300 nodes is one afternoon, and 300 rules failing once each is a
   month. */
const byRule = {};
for (const f of real) byRule[f.id] = (byRule[f.id] || 0) + f.nodes;
const ranked = Object.entries(byRule).sort((a, b) => b[1] - a[1]);
if (ranked.length) {
    console.log('\n  by rule, worst first:');
    for (const [id, n] of ranked) console.log(`    ${String(n).padStart(5)} nodes  ${id}`);
}

console.log(`\n  advisory (best-practice, not gated): ${advisory.length} findings`);
if (errors.length) {
    console.log(`\n  pages that could not be audited: ${errors.length}`);
    for (const e of errors) console.log(`    ${e.page}${e.section ? ' › ' + e.section : ''} — ${e.error}`);
}
