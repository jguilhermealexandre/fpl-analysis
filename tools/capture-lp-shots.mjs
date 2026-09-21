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
    { file: 'teams', url: '/fpl-teams-analysis.html', wait: 9000, sel: '.pa-panel, .v2-section, main',
      vw: 1500, vh: 1100, max: 900 },
    /* The rivals page is the only one here that needs the live FPL worker: the
       others read the committed data files. Without a league it draws its
       setup form and an error, which is not a screenshot of the product, so
       this one is served a synthetic league built from the local bootstrap. */
    { file: 'rivals', url: '/fpl-league-rivals.html', wait: 10000, sel: '#tab-insights, .tab-content.active',
      vw: 1500, vh: 1100, max: 900, league: '1', mockLeague: true },
    { file: 'wizard', url: '/fpl-my-team-analysis.html#transfers', wait: 10000, sel: '.tw-shell, #transferDisplay, .twc-panel',
      vw: 1500, vh: 1100, max: 900 }
];


/* Six managers with plausible squads, answered in place of the FPL worker.
   Named so nobody mistakes the screenshot for real league data. */
async function mockLeague(page) {
    const boot = JSON.parse(fs.readFileSync('data/bootstrap-static.json', 'utf8'));
    const els = boot.elements;
    const byPos = n => els.filter(e => e.element_type === n).sort((a, b) => b.total_points - a.total_points);
    const pool = { 1: byPos(1), 2: byPos(2), 3: byPos(3), 4: byPos(4) };
    const NAMES = ['Ada Byron', 'Kofi Mensah', 'Yuki Tanaka', 'Lena Vogel', 'Sam Okafor', 'Rita Alves'];
    /* The first entry is the demo team itself. The page refuses to analyse a
       league the signed-in id is not in — correctly — so a synthetic league
       without it renders an error instead of a board. */
    const entries = NAMES.map((name, i) => ({ entry: i === 0 ? Number(DEMO) : 100 + i, name }));
    const seedOf = entry => (entry === Number(DEMO) ? 0 : entry - 100);

    const squad = seed => [
        ...pool[1].slice(seed % 3, seed % 3 + 2), ...pool[2].slice(seed % 5, seed % 5 + 5),
        ...pool[3].slice(seed % 7, seed % 7 + 5), ...pool[4].slice(seed % 4, seed % 4 + 3)
    ].map(e => e.id);

    const picksFor = entry => {
        const seed = seedOf(entry), ids = squad(seed);
        const gk = ids.slice(0, 2), def = ids.slice(2, 7), mid = ids.slice(7, 12), fwd = ids.slice(12, 15);
        const starters = [gk[0], ...def.slice(0, 4), ...mid.slice(0, 4), ...fwd.slice(0, 2)];
        const ordered = [...starters, ...ids.filter(i => !starters.includes(i))];
        const cap = mid[0];
        return {
            picks: ordered.map((element, i) => ({
                element, position: i + 1, is_captain: element === cap,
                is_vice_captain: element === fwd[0],
                multiplier: i < 11 ? (element === cap ? 2 : 1) : 0
            })),
            entry_history: {
                bank: 5, value: 1003, event_transfers: 1, event_transfers_cost: 0,
                points: 50 + seed * 3, total_points: 400 + seed * 20, overall_rank: 100000 + seed * 5000
            },
            active_chip: null
        };
    };
    const historyFor = entry => ({
        current: Array.from({ length: 5 }, (_, i) => ({
            event: i + 1, points: 45 + seedOf(entry) * 2 + i * 3,
            total_points: (45 + seedOf(entry) * 2) * (i + 1),
            rank: 500000, overall_rank: 400000 - seedOf(entry) * 9000 - i * 5000,
            event_transfers: 1, event_transfers_cost: 0, bank: 5, value: 1000 + i, points_on_bench: 6
        })), chips: [], past: []
    });

    await page.route('**/api/**', route => {
        const u = route.request().url();
        const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        let m;
        if (/leagues-classic\/\d+\/standings/.test(u)) {
            return json({
                league: { id: 1, name: 'Sunday League' },
                standings: { results: entries.map((e, i) => ({
                    entry: e.entry, entry_name: e.name + ' FC', player_name: e.name,
                    rank: i + 1, last_rank: i + 2, total: 500 - i * 20, event_total: 60 - i * 3
                })) }
            });
        }
        if ((m = u.match(/entry\/(\d+)\/event\/\d+\/picks/))) return json(picksFor(Number(m[1])));
        if ((m = u.match(/entry\/(\d+)\/history/))) return json(historyFor(Number(m[1])));
        if (/event\/\d+\/live/.test(u)) {
            return json({ elements: els.map(e => ({ id: e.id, stats: { total_points: e.event_points || 0, minutes: 90 } })) });
        }
        return route.continue();
    });
}

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
        if (shot.mockLeague) await mockLeague(page);
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
