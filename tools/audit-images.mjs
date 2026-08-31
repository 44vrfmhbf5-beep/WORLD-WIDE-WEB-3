/* Counts, per category, how many rows carry the logo their source sent, how
   many resolve to a network, and how many table cells are an em dash. Image
   hosts are unreachable here and the tag removes itself on error, so a byte is
   served back or nothing can be counted at all.
     node test/serve.mjs &  node tools/audit-images.mjs                       */
import { chromium } from 'playwright';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await c.newPage();
const errs = [], reqs = [];
p.on('pageerror', e => errs.push(e.message));
p.on('request', r => r.resourceType() === 'image' && reqs.push(r.url()));
// every image host is unreachable here, and onerror removes the tag — serve a
// 1x1 so what the app asked for can actually be counted
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await c.route('**', r => r.request().resourceType() === 'image'
  && !r.request().url().startsWith('http://127.0.0.1')
  ? r.fulfill({ contentType: 'image/png', body: PNG }) : r.continue());
await p.goto('http://127.0.0.1:8899/?tab=assets', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
await p.waitForTimeout(2500);
const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
for (const t of tabs) {
  await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(800);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#results .row:not(.sk)')].slice(0, 12);
    return { n: rows.length,
      withImg: rows.filter(x => x.querySelector('.tok img')).length,
      badge: rows.filter(x => x.querySelector('.tok .badge')).length,
      // an em dash in a table cell is a field the row does not carry
      dashes: rows.reduce((a, x) => a + [...x.querySelectorAll('.cell')]
        .filter(c => c.textContent.trim() === '—').length, 0),
      cells: rows.length ? [...rows[0].querySelectorAll('.cell')].length : 0,
      nan: rows.filter(x => /NaN|undefined|Infinity|\$NaN|—%/.test(x.textContent)).length,
    };
  });
  console.log(`${t.padEnd(10)} rows ${String(r.n).padStart(2)}  logos ${String(r.withImg).padStart(2)}/${r.n}  chainbadge ${String(r.badge).padStart(2)}/${r.n}  em-dash cells ${r.dashes}/${r.n * r.cells}  suspect ${r.nan}`);
}
console.log('\nimage requests:', reqs.length, reqs.slice(0, 4));
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
await b.close();
