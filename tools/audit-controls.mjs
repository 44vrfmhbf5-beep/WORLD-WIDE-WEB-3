/* Every control against every category. The filters were built one at a time,
   each one correct on the tab it was written for; this asks whether they
   compose — whether sorting still works after a chain filter, and whether a
   facet survives a category change.
     node test/serve.mjs &  node tools/audit-controls.mjs                      */
import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
const U = 'http://127.0.0.1:8899/';
await p.goto(U, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk), #results .tile', { timeout: 25000 });
await p.waitForTimeout(2200);

/* The screen is one page of a category. Counting the rows on it says 40 either
   way and hides every filter that narrowed 1,224 to 300, so read what matched —
   which the results line reports — and fall back to counting only when it does
   not. */
const rows = async () => {
  const t = await p.locator('#meta').textContent();
  const m = /([\d.,]+[KMB]?) of ([\d.,]+[KMB]?)/.exec(t);
  if (m) return Number(m[2].replace(/,/g, ''));
  return p.locator('#results .row').count();
};
const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
let bad = 0;
const bad_ = m => { bad++; return 'BROKEN: ' + m; };
const fresh = async tab => { await p.goto(U + '?tab=' + tab, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#results .row:not(.sk), .empty, #results .tile', { timeout: 20000 }); await p.waitForTimeout(1400); };

console.log('cat        rows  chain       sort        facet       page        view');
for (const tab of tabs) {
  await fresh(tab);
  const n0 = await rows();
  const out = [];

  // Chain filter: must narrow, and must not empty a kind that has rows on it
  await p.click('[data-chain=eth]'); await p.waitForTimeout(1400);
  const nEth = await rows();
  /* DEX pairs and Assets are the exception: picking a chain fetches that
     chain's own tokens, so the filtered view legitimately holds rows the
     unfiltered one never loaded. */
  const fetches = tab === 'dex' || tab === 'assets';
  out.push(n0 === 0 ? 'n/a' : nEth === 0 ? bad_('eth empties it')
    : nEth > n0 && !fetches ? bad_('chain widened') : `${n0}->${nEth}`);
  await p.click('[data-chain=""]'); await p.waitForTimeout(1200);

  // Sort: a sortable column must reorder the list
  // the column headers are the sort control on desktop; the chip strip is
  // display:none there, so only one of the two is ever clickable
  const sortBtn = p.locator('.thead button[data-sort]:visible, #sortbar button[data-sort]:visible').first();
  const sortable = await p.locator('.thead button[data-sort]:visible, #sortbar button[data-sort]:visible').count();
  if (!sortable) out.push('none');
  else {
    /* Clicking the column a list is already sorted by is a no-op by design, so
       compare the two directions against each other instead: descending and
       ascending must not agree on the top row. */
    await sortBtn.click(); await p.waitForTimeout(900);
    const desc = await p.locator('#results .row').first().getAttribute('data-id');
    await sortBtn.click(); await p.waitForTimeout(900);
    const asc = await p.locator('#results .row').first().getAttribute('data-id');
    await sortBtn.click(); await p.waitForTimeout(500);
    out.push(desc === asc ? bad_('both directions give the same top row') : 'ok');
  }

  // Facet: must narrow, and must survive alongside a chain filter
  const fs = await p.locator('#facetbar button[data-facet]:not([disabled])').count();
  if (!fs) out.push(tab === 'all' || tab === 'saved' ? 'n/a' : bad_('no facets'));
  else {
    await p.locator('#facetbar button[data-facet]:not([disabled])').first().click();
    await p.waitForTimeout(900);
    const nF = await rows();
    await p.click('[data-chain=eth]'); await p.waitForTimeout(1400);
    const stillOn = await p.locator('#facetbar button.on').count();
    out.push(nF >= n0 && n0 > 0 ? bad_('facet did not narrow')
      : !stillOn ? bad_('chain filter dropped the facet') : 'ok');
    await p.click('[data-chain=""]'); await p.waitForTimeout(900);
  }

  // Show more: present iff there is more
  await fresh(tab);
  const more = await p.locator('[data-more]').count();
  const meta = await p.locator('#meta').textContent();
  const hasMore = /\d+ of [\d,]+/.test(meta);
  out.push(hasMore && !more ? bad_('more exists but no button')
    : !hasMore && more ? bad_('button with nothing more') : hasMore ? 'ok' : 'n/a');

  // table or cards has to apply on every category that has rows
  if (!n0) out.push('n/a');
  else {
    await p.click('#view'); await p.waitForTimeout(700);
    const cards = await p.locator('#results.table').count() === 0;
    await p.click('#view'); await p.waitForTimeout(400);
    out.push(cards ? 'ok' : bad_('view'));
  }

  console.log(tab.padEnd(10), String(n0).padStart(4), ' ', out.map(x => String(x).padEnd(11)).join(' '));
}
console.log(`\n${bad} broken combination(s)`);
console.log(errs.length ? 'PAGE ERRORS: ' + errs.slice(0, 3).join(' | ') : 'no page errors');
await b.close();
