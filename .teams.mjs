import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } });
const errs=[]; p.on('pageerror', e=>errs.push(e.message.slice(0,140)));
await p.goto('http://localhost:8080/fpl-teams-analysis.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
for (const v of ['rankings','swings','targets']) {
  await p.evaluate(view => document.querySelector(`.tab[data-view="${view}"]`)?.click(), v);
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => {
    const c = document.getElementById('content-area') || document.querySelector('.content-area') || document.body;
    const secs = [...c.querySelectorAll('.v2-section')];
    const swing = c.querySelector('.swing-section');
    let gaps = null;
    if (swing) {
      const kids = [...swing.children].filter(k => k.getBoundingClientRect().height > 0);
      gaps = [];
      for (let i = 1; i < kids.length; i++) {
        gaps.push(Math.round(kids[i].getBoundingClientRect().top - kids[i-1].getBoundingClientRect().bottom));
      }
    }
    return { sections: secs.length,
             titles: secs.map(s => (s.querySelector('h2,.soft-title')||{}).textContent?.replace(/\s+/g,' ').trim().slice(0,30)),
             teamsGridInSection: !!c.querySelector('.v2-section #teams-grid'),
             softInSection: !!c.querySelector('.v2-section .soft-section'),
             swingGaps: gaps };
  });
  console.log(v.padEnd(10), JSON.stringify(r));
}
console.log('errors:', errs.length ? errs.join(' | ') : '(none)');
await b.close();
