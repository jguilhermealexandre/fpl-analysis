/* Product screengrabs for the landing page.
 *
 * The landing page used to draw fake miniatures of the product in markup —
 * a hand-written "Salah / STAR / three fixture chips" that had to be kept in
 * step with a screen it only resembled. These are the screens themselves,
 * captured from the demo team against a local dev server.
 *
 * Run: node tools/dev-server.mjs &  then  node tools/capture-lp-shots.mjs
 *
 * Captured at deviceScaleFactor 2 so they stay sharp on a retina display, and
 * clipped to the panel that matters rather than the whole page — a landing
 * page wants the one thing the section is talking about, not a screenshot of
 * a browser window with a sidebar in it.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.LP_BASE || 'http://localhost:8080';
const OUT = 'assets/lp';
const DEMO = '0';

/* Each shot names the page it comes from, the thing on it worth showing, and
   how long that thing needs before it has finished arriving. */
/* `max` caps how much of a tall panel is taken. A landing page wants the top
   of a screen — enough to show what it is — not a five-thousand-pixel strip
   of every row it can scroll to. */
const SHOTS = [
    { file: 'squad-status', url: '/fpl-my-team-analysis.html', wait: 8000, sel: '.team-overview',
      vw: 1500, vh: 1200, max: 1000 },
    { file: 'players', url: '/fpl-players-analysis.html', wait: 9000, sel: '.pa-panel, .players-table-wrap, table',
      vw: 1500, vh: 1100, max: 860 },
    { file: 'rivals', url: '/fpl-league-rivals.html', wait: 10000, sel: '#tab-insights, .tab-content.active',
      vw: 1500, vh: 1100, max: 860, league: '1' },
    { file: 'wizard', url: '/fpl-my-team-analysis.html#transfers', wait: 10000, sel: '.tw-shell, #transferDisplay, .twc-panel',
      vw: 1500, vh: 1100, max: 900 }
];

const browser = await chromium.launch({
    executablePath: process.env.PW_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
});

fs.mkdirSync(OUT, { recursive: true });

for (const theme of ['dark', 'light']) {
    for (const shot of SHOTS) {
        const page = await browser.newPage({
            viewport: { width: shot.vw, height: shot.vh },
            deviceScaleFactor: 2
        });
        await page.addInitScript(([t, id, lg]) => {
            localStorage.setItem('theme', t);
            localStorage.setItem('fpl_team_id', id);
            if (lg) localStorage.setItem('fpl_league_id', lg);
        }, [theme, DEMO, shot.league || '']);
        try {
            await page.goto(BASE + shot.url, { waitUntil: 'networkidle', timeout: 45000 });
            await page.waitForTimeout(shot.wait);
            /* The compare tray floats over the players page once anything is
               ticked, and it is in the way of the shot rather than part of it. */
            await page.evaluate(() => {
                document.querySelectorAll('.compare-bar, .pa-compare-bar, [class*="compare-tray"]')
                    .forEach(e => { e.style.display = 'none'; });
            });
            const el = await page.$(shot.sel);
            const name = `${OUT}/${shot.file}-${theme}.png`;
            const box = el && await el.boundingBox();
            if (box) {
                await page.screenshot({ path: name, clip: {
                    x: Math.max(0, box.x), y: Math.max(0, box.y),
                    width: Math.min(box.width, shot.vw - Math.max(0, box.x)),
                    height: Math.min(box.height, shot.max || box.height)
                } });
            } else {
                await page.screenshot({ path: name, clip: { x: 0, y: 0, width: shot.vw, height: shot.max || 700 } });
            }
            console.log(`${box ? 'ok  ' : 'page'} ${name} ${box ? Math.round(box.width) + 'x' + Math.round(Math.min(box.height, shot.max || box.height)) : ''}`);
        } catch (e) {
            console.log(`FAIL ${shot.file}-${theme}: ${e.message.split('\n')[0]}`);
        }
        await page.close();
    }
}
await browser.close();
