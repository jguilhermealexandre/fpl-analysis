/* Every page that loads the nav has to say which shell it is.
   ============================================

   The site has two chromes. The app shell is a rail down the left, and every
   item in it leads to a page about a squad. The marketing shell is a top bar,
   and it is what the eight feature pages, pricing, the FAQ, how-it-works,
   methodology, accuracy, contact, privacy, terms and the 404
   are designed around.

   Which one a page gets used to be decided from storage: is there a Team ID.
   That answers the wrong question — whether somebody is signed in is not the
   same as whether the page they are looking at is part of the app — so a
   signed-in manager opening any marketing page got the dashboard's rail down
   the side of it, with the top nav those pages are built around nowhere on
   screen.

   The reason it survived so long is that it is invisible from the outside:
   signed out, which is how anybody tests a marketing page, every one of them
   looked right. It only went wrong for people who already use the product.

   So the choice is declared in the markup now, with data-shell on <html>, and
   scripts/sidebar-nav.js reads only that. This gate is what keeps a new page
   from quietly getting it wrong: it has to say "app" or "marketing", and what
   it says has to match where it actually lives.

   index.html is the one page that is genuinely both. It ships as the
   marketing page and says so; the inline script at the top of its <body>
   upgrades the attribute to "app" when it finds a saved Team ID, in the same
   breath as it decides which of its two selves to paint. That upgrade is
   checked for here too — without it the dashboard would load with no rail.
*/
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const VALID = new Set(['app', 'marketing']);

/* The app pages, by name. A list rather than a pattern on purpose: the
   feature-* pages are marketing pages about app screens, and four of them sit
   one letter away from the app page they describe — feature-league-rivals vs
   fpl-league-rivals, feature-scouts-desk vs fpl-scouts-desk. Any rule clever
   enough to tell those apart from their filenames is a rule that will get it
   wrong the first time somebody adds a page. */
const APP_PAGES = new Set([
    'fpl-my-team-analysis.html',
    'fpl-players-analysis.html',
    'fpl-teams-analysis.html',
    'fpl-league-rivals.html',
    'fpl-scouts-desk.html',
    'fpl-news.html',
    'admin.html',
    'admin-model-accuracy.html'
]);

const problems = [];
const pages = fs.readdirSync(ROOT)
    .filter(f => f.endsWith('.html'))
    .filter(f => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('sidebar-nav.min.js'))
    .sort();

for (const file of pages) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const tag = html.match(/<html\b[^>]*>/i);
    const declared = tag && tag[0].match(/data-shell="([^"]*)"/);
    const value = declared ? declared[1] : null;

    if (!value) {
        problems.push(`${file} loads the nav but does not say which shell it is`);
        continue;
    }
    if (!VALID.has(value)) {
        problems.push(`${file} has data-shell="${value}" (expected "app" or "marketing")`);
        continue;
    }

    // index.html ships as the marketing page and becomes the app at runtime.
    const expected = file === 'index.html' ? 'marketing' : (APP_PAGES.has(file) ? 'app' : 'marketing');
    if (value !== expected) {
        problems.push(`${file} says data-shell="${value}" but is ${expected === 'app' ? 'an app page' : 'a marketing page'}`);
    }
}

// The runtime upgrade, without which a signed-in dashboard has no rail.
const index = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!/dataset\.shell\s*=\s*'app'/.test(index)) {
    problems.push("index.html never upgrades data-shell to 'app', so the dashboard would load with the marketing chrome");
}

// And the reader, so the declaration cannot quietly stop being what decides.
const nav = fs.readFileSync(path.join(ROOT, 'scripts', 'sidebar-nav.js'), 'utf8');
if (!/dataset\.shell\s*===\s*'app'/.test(nav)) {
    problems.push('scripts/sidebar-nav.js no longer picks the shell from data-shell');
}

if (problems.length) {
    console.error('✗ shell declarations are wrong:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
}

const appCount = pages.filter(f => APP_PAGES.has(f)).length;
console.log(`✓ all ${pages.length} page(s) with the nav declare a shell (${appCount} app, ${pages.length - appCount} marketing)`);
