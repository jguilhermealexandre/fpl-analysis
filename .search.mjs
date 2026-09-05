import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('fpl_team_id','0'); localStorage.setItem('easyfpl_visited','1'); } catch(e){}
  window.Chart=function(){return{destroy(){},update(){},resize(){}}};window.Chart.register=()=>{};window.Chart.defaults={font:{},plugins:{}};
});
const page = await ctx.newPage();
const errs=[]; page.on('pageerror',e=>errs.push(String(e).slice(0,120)));
await page.goto('http://localhost:8080/fpl-my-team-analysis.html',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(11000);
const count = () => page.evaluate(() => { const d=document.getElementById('tlPlayers'); return d ? d.options.length : 'no datalist'; });
console.log('on load:', await count());
const input = await page.$('#tlPick');
if (!input) { console.log('picker not on page'); } else {
  await input.click(); await page.waitForTimeout(300);
  console.log('after focus:', await count());
  await input.type('s'); await page.waitForTimeout(300);
  console.log('after 1 char:', await count());
  await input.type('al'); await page.waitForTimeout(300);
  console.log('after 3 chars:', await count());
  console.log('sample:', await page.evaluate(() => [...document.getElementById('tlPlayers').options].slice(0,3).map(o=>o.value)));
}
console.log('typeof tlSuggest:', await page.evaluate(()=>typeof tlSuggest));
console.log('allPlayers len:', await page.evaluate(()=>typeof allPlayers === 'undefined' ? 'undefined' : allPlayers.length));
console.log('input value:', await page.evaluate(()=>document.getElementById('tlPick')?.value));
console.log('manual call:', await page.evaluate(()=>{ const el=document.getElementById('tlPick'); if(!el) return 'no el'; el.value='sal'; tlSuggest(el); return document.getElementById('tlPlayers').options.length; }));
console.log('queries:', await page.evaluate(() => {
  const out={}; const el=document.getElementById('tlPick');
  for (const q of ['ric','pal','hal','ars','sal','s']) { el.value=q; tlSuggest(el); out[q]=document.getElementById('tlPlayers').options.length; }
  el.value=''; tlSuggest(el); out['(cleared)']=document.getElementById('tlPlayers').options.length;
  return out;
}));
console.log('filter debug:', await page.evaluate(() => {
  const q='sal';
  const pool = allPlayers;
  const p0 = pool[0];
  const owned = new Set((typeof selectedPlayers!=='undefined'? selectedPlayers:[]).map(p=>p.id));
  const byName = pool.filter(p => (p.name||'').toLowerCase().includes(q)).length;
  const byStatus = pool.filter(p => p.status === 'a').length;
  return { sampleKeys: Object.keys(p0).slice(0,12), sampleName: p0.name, sampleStatus: p0.status, ownedSize: owned.size, byName, byStatus };
}));
console.log('errors:', errs.slice(0,2));
await b.close();
