/* The page list and the tab-walker, shared by every browser audit.
   ============================================

   Two tools drive a real browser over this site — tools/audit-mobile.mjs for
   layout and tools/audit-a11y.mjs for accessibility — and they have to visit
   the same places or their findings cannot be compared. A page missing from one
   list is a page one of them silently never checks, which is the failure mode
   both tools exist to prevent.

   So the list lives here once. Both import it; neither owns it.

   The Team ID seeded into localStorage by the callers matters as much as the
   list: four of these URLs are behind dashboard-gate.js and redirect to the ID
   page without one, so an audit that skips that step audits the sign-in screen
   twelve times and reports it clean.
*/

export const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:8080';

/* Playwright's bundled Chromium. The default is the devcontainer/CI path; set
   AUDIT_CHROME to run it anywhere else. */
export const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* Every page a visitor or a signed-in manager can reach. The app pages are
   listed by their /dashboard/ URL because that is where the redirects send
   people, and a page audited at the wrong URL is a page not audited. */
export const PAGES = [
    ['/', 'landing'],
    ['/dashboard/', 'dashboard'],
    ['/dashboard/my-team', 'my team'],
    ['/dashboard/players', 'players'],
    ['/dashboard/teams', 'teams'],
    ['/dashboard/rivals', 'rivals'],
    ['/dashboard/scouts-desk', "scout's desk"],
    ['/dashboard/news', 'news'],
    ['/dashboard/premium', 'premium'],
    ['/dashboard/login', 'login'],
    ['/fpl-pricing.html', 'pricing'],
    ['/fpl-faq.html', 'faq'],
    ['/fpl-how-it-works.html', 'how it works'],
    ['/fpl-methodology.html', 'methodology'],
    ['/fpl-accuracy.html', 'accuracy'],
    ['/fpl-contact.html', 'contact'],
    ['/fpl-changelog.html', 'changelog'],
    ['/fpl-privacy.html', 'privacy'],
    ['/fpl-terms.html', 'terms'],
    ['/feature-squad-analysis.html', 'feature: squad'],
    ['/feature-transfer-wizard.html', 'feature: transfer wizard'],
    ['/feature-lineup-wizard.html', 'feature: lineup wizard'],
    ['/feature-player-explorer.html', 'feature: players'],
    ['/feature-fixture-ratings.html', 'feature: fixtures'],
    ['/feature-league-rivals.html', 'feature: rivals'],
    ['/feature-scouts-desk.html', "feature: scout's desk"],
    ['/feature-team-news.html', 'feature: team news'],
    ['/404.html', '404']
];

/* Tabs are sections wearing one URL, and a fault on the fourth tab of My Team
   is as real as one on the first. Anything that looks like a tab gets clicked
   and the page measured again. */
export async function sections(page) {
    return page.evaluate(() => {
        const bits = [...document.querySelectorAll('.tab, .sub-tab, [role="tab"], .tm-market-tab, .pa-tab')];
        return bits
            .filter(el => el.offsetParent !== null)
            .map((el, i) => ({ i, label: (el.textContent || '').trim().slice(0, 26) || ('tab ' + i) }))
            .slice(0, 10);
    });
}

export async function openSection(page, i) {
    await page.evaluate(idx => {
        const bits = [...document.querySelectorAll('.tab, .sub-tab, [role="tab"], .tm-market-tab, .pa-tab')]
            .filter(el => el.offsetParent !== null);
        bits[idx] && bits[idx].click();
    }, i);
    await page.waitForTimeout(2200);
}
