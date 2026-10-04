/* What makes a page unusable on a phone, measured rather than eyeballed.
   ============================================

   Twenty-seven pages, and several of them are five tabs wearing one URL.
   Looking at all of that by hand is how things like a 199px-wide overflow on
   the Transfers tab survive for weeks: every fault here was invisible until
   somebody happened to open that screen at that width.

   So this opens every page at phone widths, walks every tab on it, and asks
   the handful of questions that separate "could be prettier" from "cannot be
   used":

     page-scroll    the document is wider than the screen. Everything drifts
                    sideways, nothing lines up, and the page rubber-bands
                    under your thumb. Always a bug.
     escapes        an element sticks out past the right edge with nothing
                    clipping or scrolling it, so part of it is unreachable.
                    This is what page-scroll is usually made of, reported
                    separately because it names the culprit.
     clipped        text that is cut off by its own box. Ellipsis is often
                    deliberate, so only a severe cut (a fifth of the text or
                    more) on something that matters counts.
     tiny-target    a link or button under 32px. Fingers are about 44px; a
                    24px control is a coin toss.
     overlap        two controls on top of each other — whichever is on top
                    takes the taps meant for the other.
     tiny-text      under 10px, which is not reading, it is guessing.

   Run: node tools/audit-mobile.mjs [--width 390,1180,1440] [--json]
   It needs the dev server (npm run dev) and the bundled Chromium.

   Widths, plural, and not only phone ones. This started as a phone tool and
   that was too narrow a reading of its own job: a panel's width is not the
   screen's. My Team's intel panel is 530px on a 1920 monitor, 334px at 1180
   where the body is still two columns, and 922px at 1024 where it has just
   stacked — so the layout is at its tightest on a laptop, and two faults
   lived there precisely because "desktop" had been checked at one width and
   "mobile" at two. `npm run audit:widths` sweeps the laptop and tablet band
   as well; `npm run audit:mobile` keeps the phone-only default.

   Tap-target findings are collected only at touch widths. A 24px button is a
   coin toss under a thumb and completely fine under a mouse, so reporting it
   on a 1440 desktop is noise that buries the geometry faults worth having.

   Not part of `npm run check`: it drives a real browser against a running
   server, which that gate cannot assume. It is the thing you run after
   touching layout.
*/
import { chromium } from 'playwright';

const BASE = process.env.AUDIT_BASE || 'http://127.0.0.1:8080';
const CHROME = process.env.AUDIT_CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const widthArg = args.indexOf('--width');
const WIDTHS = widthArg !== -1
    ? String(args[widthArg + 1]).split(',').map(n => Number(n.trim())).filter(Boolean)
    : [390, 360];
/* Touch emulation follows the width rather than the tool's name: running a
   phone context at 1440 reports hover states and pointer rules that no desktop
   visitor ever sees. */
const isTouch = w => w <= 768;

/* Every page a visitor or a signed-in manager can reach. The app pages are
   listed by their /dashboard/ URL because that is where the redirects send
   people, and a page audited at the wrong URL is a page not audited. */
const PAGES = [
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

/* The measuring, in the page. One function so there is one definition of
   each fault, and it runs identically on every tab of every page. */
function collect() {
    const VW = document.documentElement.clientWidth;
    const out = { pageScroll: document.documentElement.scrollWidth - VW, escapes: [], clipped: [], tiny: [], overlap: [], small: [] };

    const name = el => {
        const c = (el.className || '').toString().trim().split(/\s+/).filter(Boolean)[0];
        return (c ? '.' + c : el.tagName.toLowerCase()) + (el.id ? '#' + el.id : '');
    };
    const seen = new Set();
    const once = (bucket, key, value) => {
        const k = bucket + '|' + key;
        if (seen.has(k)) return;
        seen.add(k);
        out[bucket].push(value);
    };
    // An ancestor that clips or scrolls makes sticking out legitimate.
    const contained = el => {
        for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
            const o = getComputedStyle(n);
            if (o.overflowX !== 'visible' || o.overflowY !== 'visible') return true;
        }
        return false;
    };
    /* An element is shown only if everything above it is too. A closed
       flyout, a collapsed panel, an un-opened sheet: they are parked with
       opacity 0 and pointer-events none on the container, and the children
       inside still compute to opacity 1 and a real rectangle. Checking the
       element alone reported every item in the sidebar's closed flyout as
       sitting on top of the page — 22 of them, at every width, on every app
       page, which is a fifth of this run's findings and none of them real. */
    const shown = el => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return false;
            if (n !== el && s.pointerEvents === 'none' && s.position !== 'static') return false;
        }
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
    };

    const all = [...document.querySelectorAll('body *')];
    for (const el of all) {
        if (!shown(el)) continue;
        const r = el.getBoundingClientRect();

        // Off the right edge, and nothing above it is clipping or scrolling.
        if (r.right > VW + 1 && r.left < VW && !contained(el)) {
            once('escapes', name(el), { el: name(el), by: Math.round(r.right - VW) });
        }

        const text = (el.textContent || '').trim();
        const leaf = text && !el.querySelector('*');
        if (leaf) {
            const cut = el.scrollWidth - el.clientWidth;
            // Something that scrolls itself is not cut off — a wide table or a
            // code block in its own scroller is reachable, which is the whole
            // question here.
            const scrolls = getComputedStyle(el).overflowX !== 'visible';
            // A fifth of the box or more, and at least 12px: a word lost, not
            // a letter. Elements narrower than 40px are icons with a label.
            if (!scrolls && cut > 12 && el.clientWidth > 40 && cut / el.clientWidth > 0.2) {
                once('clipped', name(el), { el: name(el), text: text.slice(0, 44), cut: Math.round(cut) });
            }
            const fs = parseFloat(getComputedStyle(el).fontSize);
            if (fs && fs < 10) once('small', name(el) + fs, { el: name(el), px: +fs.toFixed(1), text: text.slice(0, 30) });
        }
    }

    // Controls: too small to hit, or sitting on top of one another.
    const CONTROL = 'a[href], button, input, select, textarea, [role="button"], [role="tab"], [onclick]';
    const controls = [...document.querySelectorAll(CONTROL)].filter(el => {
        if (!shown(el)) return false;
        /* Not everything with an onclick is a thing you press. This codebase
           hangs tooltips off chips and table cells and sets cursor:default or
           help on them to say so — the cursor is the honest answer to "is
           this a control", so take it. */
        const cur = getComputedStyle(el).cursor;
        if (cur === 'default' || cur === 'help' || cur === 'auto' || cur === 'text') return false;
        /* A name inside a clickable row is not a target of its own: the row
           is the target, and it is the row's size that matters. */
        const outer = el.parentElement && el.parentElement.closest(CONTROL);
        if (outer) {
            const o = outer.getBoundingClientRect(), i = el.getBoundingClientRect();
            if (o.height >= 32 && o.height > i.height * 1.4) return false;
        }
        /* A row that opens a player is sometimes built so the name carries the
           click and the row around it does not, which makes the name look like
           a 16px target. The row is what a thumb lands on either way — it is
           the full width and the whole height — so measure that, not the word
           inside it. */
        const row = el.closest('.sq-row, .planner-player, .tm-watch-row, .tm-tb-row, .pl-row, .rd-item');
        if (row && row !== el && row.getBoundingClientRect().height >= 32) return false;
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight * 3;   // the part anyone reaches
    });
    /* The hit area, not the box. This codebase grows small controls with an
       absolutely positioned ::after on coarse pointers — footer links, the
       Team ID change button, the theme switch — so reading the element's own
       rect reports a 16px link that is a 44px target in the hand. */
    const hitArea = el => {
        const r = el.getBoundingClientRect();
        let w = r.width, h = r.height;
        for (const pseudo of ['::after', '::before']) {
            const p = getComputedStyle(el, pseudo);
            if (!p || p.content === 'none' || p.position !== 'absolute') continue;
            const pw = Math.max(parseFloat(p.width) || 0, parseFloat(p.minWidth) || 0);
            const ph = Math.max(parseFloat(p.height) || 0, parseFloat(p.minHeight) || 0);
            if (pw) w = Math.max(w, pw);
            if (ph) h = Math.max(h, ph);
        }
        return { w, h };
    };
    /* An inline link inside a sentence is not a tap target that has been made
       too small — it is a word. WCAG exempts them for the same reason: you
       cannot give "our pricing page" a 44px box without breaking the
       paragraph it is in. Only controls that stand on their own are judged. */
    const inProse = el => {
        if (el.tagName !== 'A') return false;
        if (getComputedStyle(el).display !== 'inline') return false;
        const p = el.parentElement;
        if (!p) return false;
        if (!/^(P|LI|TD|DD|BLOCKQUOTE|SPAN|EM|STRONG|SMALL|DIV)$/.test(p.tagName)) return false;
        // Surrounded by words rather than sitting alone in its container.
        return (p.textContent || '').trim().length > (el.textContent || '').trim().length + 8;
    };
    for (const el of controls) {
        if (inProse(el)) continue;
        const { w, h } = hitArea(el);
        if (w < 32 || h < 32) {
            once('tiny', name(el) + Math.round(w) + 'x' + Math.round(h),
                { el: name(el), size: Math.round(w) + 'x' + Math.round(h), text: (el.textContent || '').trim().slice(0, 24) });
        }
    }
    /* The footer is deliberately behind the page on a phone — it is sticky at
       the bottom and the content scrolls over it — so every control on screen
       overlaps a footer link at some point. That is the design, not a
       collision, and comparing across the boundary buries the real findings. */
    const inFooter = el => !!el.closest('.site-footer');
    for (let i = 0; i < controls.length; i++) {
        const a = controls[i].getBoundingClientRect();
        if (a.width * a.height === 0) continue;
        for (let j = i + 1; j < controls.length; j++) {
            if (controls[i].contains(controls[j]) || controls[j].contains(controls[i])) continue;
            if (inFooter(controls[i]) !== inFooter(controls[j])) continue;
            const b = controls[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox <= 1 || oy <= 1) continue;
            const share = (ox * oy) / Math.min(a.width * a.height, b.width * b.height);
            /* Two controls in the same stacking position are only a fault if
               the one in front actually takes the taps. A pair where neither
               is painted over the other — side-by-side boxes whose rects
               happen to intersect because one of them is a tall flex item —
               is not what this is looking for, so ask the document which one
               is at the shared midpoint. */
            const mx = (Math.max(a.left, b.left) + Math.min(a.right, b.right)) / 2;
            const my = (Math.max(a.top, b.top) + Math.min(a.bottom, b.bottom)) / 2;
            const hit = document.elementFromPoint(mx, my);
            const stolen = hit && ((controls[i].contains(hit) ? controls[j] : controls[j].contains(hit) ? controls[i] : null));
            if (share > 0.45 && stolen) {
                once('overlap', name(controls[i]) + '+' + name(controls[j]),
                    { a: name(controls[i]), b: name(controls[j]), share: Math.round(share * 100) + '%' });
            }
        }
    }
    return out;
}

/* Tabs are sections wearing one URL, and a fault on the fourth tab of My Team
   is as real as one on the first. Anything that looks like a tab gets clicked
   and the page measured again. */
async function sections(page) {
    return page.evaluate(() => {
        const bits = [...document.querySelectorAll('.tab, .sub-tab, [role="tab"], .tm-market-tab, .pa-tab')];
        return bits
            .filter(el => el.offsetParent !== null)
            .map((el, i) => ({ i, label: (el.textContent || '').trim().slice(0, 26) || ('tab ' + i) }))
            .slice(0, 10);
    });
}

async function openSection(page, i) {
    await page.evaluate(idx => {
        const bits = [...document.querySelectorAll('.tab, .sub-tab, [role="tab"], .tm-market-tab, .pa-tab')]
            .filter(el => el.offsetParent !== null);
        bits[idx] && bits[idx].click();
    }, i);
    await page.waitForTimeout(2200);
}

const SEVERITY = { pageScroll: 'CRITICAL', escapes: 'HIGH', overlap: 'HIGH', clipped: 'MEDIUM', tiny: 'MEDIUM', small: 'LOW' };

const browser = await chromium.launch({ executablePath: CHROME });
const report = [];

for (const width of WIDTHS) {
    const ctx = await browser.newContext({
        viewport: { width, height: isTouch(width) ? 844 : 1000 },
        isMobile: isTouch(width), hasTouch: isTouch(width), deviceScaleFactor: 1
    });
    await ctx.addInitScript(() => { try { localStorage.setItem('fpl_team_id', '0'); } catch { /* private mode */ } });
    const page = await ctx.newPage();

    for (const [path, label] of PAGES) {
        try {
            await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 25000 });
        } catch {
            report.push({ width, page: label, section: null, error: 'did not load' });
            continue;
        }
        await page.waitForTimeout(5200);

        const tabs = await sections(page);
        const stops = tabs.length ? tabs : [{ i: -1, label: null }];
        for (const stop of stops) {
            if (stop.i >= 0) {
                try { await openSection(page, stop.i); } catch { continue; }
            }
            let found;
            try { found = await page.evaluate(collect); } catch { continue; }
            // A small control is a fault for a thumb, not for a cursor.
            if (!isTouch(width)) found.tiny = [];
            report.push({ width, page: label, section: stop.label, ...found });
        }
    }
    await ctx.close();
}
await browser.close();

if (asJson) {
    console.log(JSON.stringify(report, null, 1));
} else {
    let faults = 0;
    for (const r of report) {
        if (r.error) { console.log(`\n${r.width}  ${r.page}  — ${r.error}`); faults++; continue; }
        const lines = [];
        if (r.pageScroll > 1) lines.push(`  ${SEVERITY.pageScroll.padEnd(8)} page scrolls sideways by ${r.pageScroll}px`);
        for (const e of r.escapes) lines.push(`  ${SEVERITY.escapes.padEnd(8)} ${e.el} sticks out ${e.by}px`);
        for (const o of r.overlap) lines.push(`  ${SEVERITY.overlap.padEnd(8)} ${o.a} covers ${o.b} (${o.share})`);
        for (const c of r.clipped) lines.push(`  ${SEVERITY.clipped.padEnd(8)} ${c.el} cut by ${c.cut}px — "${c.text}"`);
        for (const t of r.tiny) lines.push(`  ${SEVERITY.tiny.padEnd(8)} ${t.el} is ${t.size}${t.text ? ` — "${t.text}"` : ''}`);
        for (const s of r.small) lines.push(`  ${SEVERITY.small.padEnd(8)} ${s.el} at ${s.px}px — "${s.text}"`);
        if (!lines.length) continue;
        faults += lines.length;
        console.log(`\n${r.width}px  ${r.page}${r.section ? '  ›  ' + r.section : ''}`);
        console.log(lines.join('\n'));
    }
    console.log(faults ? `\n${faults} finding(s).` : '\nNothing unusable found.');
}
