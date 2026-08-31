/* Opens the chart on every kind, at every range it offers, and checks the
   things a chart can get wrong without throwing: a headline that disagrees with
   the row it came from, a series in one unit under a label in another, two axis
   ends printing the same value, a NaN in the path.
     node test/serve.mjs &  node tools/audit-charts.mjs                        */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8899/?tab=assets', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
await p.waitForTimeout(2200);
const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
let bad = 0, seen = 0;
const flag = (m) => { bad++; return '  << ' + m; };
for (const t of tabs) {
  if (t === 'saved') continue;
  await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(700);
  const n = await p.locator('#results .row:not(.sk)').count();
  if (!n) continue;
  // two rows per tab, because sources differ inside a kind
  for (const idx of [0, Math.min(1, n - 1)]) {
    const row = p.locator('#results .row:not(.sk)').nth(idx);
    const id = await row.getAttribute('data-id');
    const num = (await row.locator('.n1, .cell').first().textContent()).trim();
    await row.evaluate(el => el.click()); await p.waitForTimeout(1500);
    if (!await p.locator('.chart').count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); continue; }
    const ranges = await p.locator('.rangebar [data-days]').evaluateAll(x => x.map(e => e.dataset.days));
    for (const d of ranges) {
      await p.click(`.rangebar [data-days="${d}"]`); await p.waitForTimeout(900);
      const r = await p.evaluate(() => {
        const s = document.querySelector('.sheet-in');
        const path = s.querySelector('.chart svg .line')?.getAttribute('d') || '';
        return { big: s.querySelector('.big')?.textContent.trim(),
          hi: s.querySelector('.ax.hi')?.textContent, lo: s.querySelector('.ax.lo')?.textContent,
          t0: s.querySelector('.ax.t0')?.textContent, t1: s.querySelector('.ax.t1')?.textContent,
          nohist: !!s.querySelector('.nohist'), pts: (path.match(/L/g) || []).length,
          nan: /NaN|Infinity|undefined/.test(path) };
      });
      const notes = [];
      if (r.nan) notes.push(flag('NaN in the path'));
      if (r.t0 && r.t0 === r.t1) notes.push(flag('both time ends read the same'));
      if (!r.nohist && r.pts < 2) notes.push(flag('live series with no points'));
      // unit agreement: the headline and the axis must speak the same language
      const unit = v => /^\$/.test(v || '') ? 'usd' : /%$/.test(v || '') ? 'pct'
        : /SOL|ETH/.test(v || '') ? 'native' : 'other';
      if (r.hi && unit(r.big) !== unit(r.hi)) notes.push(flag(`headline ${r.big} vs axis ${r.hi}`));
      if (d === ranges[0] && r.big !== num && !r.nohist) notes.push(flag(`row ${num} vs headline ${r.big}`));
      seen++;
      if (notes.length) console.log(`${t}/${id} @${d}d  big=${r.big} hi=${r.hi} lo=${r.lo} ${r.nohist ? '(flat)' : ''}${notes.join('')}`);
    }
    await p.keyboard.press('Escape'); await p.waitForTimeout(350);
  }
}
console.log(`\n${seen} chart(s) checked, ${bad} problem(s)`);
console.log(errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors');
await b.close();
