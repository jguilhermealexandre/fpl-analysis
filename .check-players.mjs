import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await b.newPage();
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message.slice(0, 200)));
await p.goto('http://localhost:8080/fpl-players-analysis.html', { waitUntil: 'networkidle', timeout: 60000 });
await p.waitForTimeout(3500);

console.log('--- console errors ---');
console.log(errs.length ? errs.join('\n') : '(none)');

const r = await p.evaluate(() => {
  const q = s => document.querySelector(s);
  const all = s => [...document.querySelectorAll(s)];
  const activePill = q('#posPills .fp-pill.active');
  const recPanel = q('#rec-panel-ALL');
  const card = q('#rec-panel-ALL .rec-card-v2');
  return {
    activeGlobalPill: activePill && activePill.dataset.pos,
    paPanels: all('.pa-panel').length,
    paPills: all('.pa-filter-pill').map(x => x.textContent.trim() + (x.classList.contains('active') ? '*' : '')),
    allPanelExists: !!recPanel,
    allPanelActive: recPanel && recPanel.classList.contains('active'),
    cardsInAll: all('#rec-panel-ALL .rec-card-v2').length,
    firstCardClasses: card && card.className,
    portraitImgs: all('#rec-panel-ALL .rec-face img').length,
    portraitSpans: all('#rec-panel-ALL .rec-face').length,
    doubtfulCheckbox: !!q('#recIncludeDoubtful'),
    starTag: (() => { const s = q('#rec-panel-ALL .shortlist-star'); return s && s.firstElementChild && s.firstElementChild.tagName; })(),
    positionsInAll: [...new Set(all('#rec-panel-ALL .rec-card-v2').map(c =>
      (c.className.match(/pos-(gk|def|mid|fwd)/) || [])[1]))]
  };
});
console.log('--- state ---');
console.log(JSON.stringify(r, null, 2));

// Star: click it and see whether it goes gold and survives.
const star = await p.$('#rec-panel-ALL .shortlist-star');
if (star) {
  const before = await star.evaluate(e => getComputedStyle(e).color);
  await star.click();
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => {
    const s = document.querySelector('#rec-panel-ALL .shortlist-star');
    const svg = s && s.querySelector('svg');
    return { cls: s && s.className, color: s && getComputedStyle(s).color,
             fill: svg && getComputedStyle(svg).fill, tag: s && s.firstElementChild && s.firstElementChild.tagName };
  });
  console.log('--- star ---');
  console.log('before color:', before, '\nafter:', JSON.stringify(after));
}
await p.screenshot({ path: '/tmp/claude-0/-home-user-fpl-analysis/3b54cb06-9875-5c5d-a2b6-82b0e7906225/scratchpad/recs.png', fullPage: false });
await b.close();
