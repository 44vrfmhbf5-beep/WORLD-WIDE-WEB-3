/* Turns every filter chip on, one at a time, and reports how much it leaves.
   A chip that matches everything or nothing is a filter that does not filter,
   and a fixture where every row answers the same way cannot tell the two apart.
     node test/serve.mjs &  node tools/audit-filters.mjs                     */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('http://127.0.0.1:8899/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
await p.waitForTimeout(2500);
const TABS = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
let bad = 0;
for (const t of TABS) {
  await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(800);
  const fs = await p.locator('#facetbar button[data-facet]').evaluateAll(bs =>
    bs.map(x => ({ id: x.dataset.facet, label: x.textContent.trim(), off: x.disabled })));
  if (!fs.length) continue;
  // the screen is one page of the category; compare against what matched, which
  // the results line now reports, not against the forty rows on screen
  const readMatched = async () => {
    const t = await p.locator('#meta').textContent();
    const m = /([\d.,]+[KMB]?) of ([\d.,]+[KMB]?)/.exec(t);
    const num = v => { const x = v.replace(/,/g,'');
      return /K$/.test(x) ? parseFloat(x)*1e3 : /M$/.test(x) ? parseFloat(x)*1e6 : parseFloat(x); };
    return m ? num(m[2]) : await p.locator('#results .row').count();
  };
  const total = await readMatched();
  console.log(`\n${t} (${total} rows)`);
  for (const f of fs) {
    if (f.off) { console.log(`  ${f.label.padEnd(26)} DISABLED — leaves nothing`); continue; }
    await p.click(`[data-facet="${f.id}"]`); await p.waitForTimeout(650);
    const n = await readMatched();
    const chip = await p.locator(`[data-facet="${f.id}"] .fn`).textContent();
    const flag = n === 0 ? 'EMPTY' : n >= total ? 'NO-OP (matches everything)' : '';
    if (flag) bad++;
    console.log(`  ${f.label.padEnd(26)} -> ${String(n).padStart(4)} rows (chip ${chip}) ${flag}`);
    await p.click(`[data-facet="${f.id}"]`); await p.waitForTimeout(450);
  }
}
console.log(`\n${bad} facet(s) that do not separate anything`);
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
await b.close();
