import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
const errs=[]; p.on('pageerror', e=>errs.push(e.message.slice(0,140)));
await p.addInitScript(() => { try { localStorage.setItem('fpl_team_id','0'); } catch(e){} });
await p.goto('http://localhost:8080/fpl-players-analysis.html', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(6000);
for (const [tab, sel] of [['RISING','.rising-card'],['PURPLE_PATCH','.pp-card']]) {
  await p.evaluate(t => document.querySelector(`.tab[data-position="${t}"]`).click(), tab);
  await p.waitForTimeout(1000);
  const r = await p.evaluate(([t,s]) => {
    const sec = document.getElementById('section-'+t);
    const cards = [...sec.querySelectorAll(s)];
    const active = sec.querySelector('.sub-tab-panel.active');
    return { cards: cards.length, withHero: cards.filter(c=>c.querySelector('.pdm-hero')).length,
             activeId: active && active.id,
             notice: active && (active.textContent||'').replace(/\s+/g,' ').trim().slice(0,90) };
  }, [tab, sel]);
  console.log(tab, JSON.stringify(r));
}
await p.evaluate(() => document.querySelector('.tab[data-position="RISING"]').click());
await p.waitForTimeout(800);
await p.screenshot({ path: 'rising.png' });
console.log('errors:', errs.length?errs.join(' | '):'(none)');
await b.close();
