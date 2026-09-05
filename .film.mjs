import { chromium } from 'playwright';
const SP = process.env.SP;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('fpl_team_id','0'); localStorage.setItem('easyfpl_visited','1'); } catch(e){}
  window.Chart=function(){return{destroy(){},update(){},resize(){}}};window.Chart.register=()=>{};window.Chart.defaults={font:{},plugins:{}};
  window.__marks = [];
  const mark = (what) => window.__marks.push([Math.round(performance.now()), what]);
  window.__mark = mark;
  document.addEventListener('DOMContentLoaded', () => mark('DOMContentLoaded'));
  // Watch when the reveal class lands and when each panel first has content.
  new MutationObserver(() => {
    if (document.body && document.body.classList.contains('v2-sequence-ready') && !window.__seq) { window.__seq = 1; mark('v2-sequence-ready'); }
    for (const [sel, name] of [['.md-panel','matchday'],['#v2PitchWrap .v2-pitch','pitch'],['.mk-panel','market'],['.hero-deadline-banner','deadline'],['.hero-banner.hero-logged-in','hero-logged-in']]) {
      const el = document.querySelector(sel);
      if (el && !window['__'+name]) { window['__'+name] = 1; mark(name); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true });
});
const page = await ctx.newPage();
const start = Date.now();
await page.goto('http://localhost:8080/', { waitUntil: 'commit' });
const shots = [];
for (let i = 0; i < 16; i++) {
  const t = Date.now() - start;
  await page.screenshot({ path: `${SP}/film_${String(i).padStart(2,'0')}_${t}ms.png` });
  shots.push(t);
  await page.waitForTimeout(280);
}
console.log('frames at ms:', shots.join(', '));
console.log('marks:', JSON.stringify(await page.evaluate(() => window.__marks), null, 0));
await b.close();
