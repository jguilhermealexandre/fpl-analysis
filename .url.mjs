import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
// logged out
let ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { window.Chart=function(){return{destroy(){},update(){},resize(){}}};window.Chart.register=()=>{};window.Chart.defaults={font:{},plugins:{}}; });
let page = await ctx.newPage();
await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(4000);
console.log('logged out ->', await page.title(), '|', new URL(page.url()).pathname);
await ctx.close();
// logged in
ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => {
  try { localStorage.setItem('fpl_team_id','0'); localStorage.setItem('easyfpl_visited','1'); } catch(e){}
  window.Chart=function(){return{destroy(){},update(){},resize(){}}};window.Chart.register=()=>{};window.Chart.defaults={font:{},plugins:{}};
});
page = await ctx.newPage();
await page.goto('http://localhost:8080/',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(4000);
console.log('logged in  ->', await page.title(), '|', new URL(page.url()).pathname);
// refresh at /dashboard must serve the page, not 404
const r = await page.goto('http://localhost:8080/dashboard',{waitUntil:'domcontentloaded'});
await page.waitForTimeout(3000);
console.log('GET /dashboard ->', r.status(), '|', await page.title(), '| has-team:', await page.evaluate(()=>document.documentElement.classList.contains('has-team')));
await b.close();
