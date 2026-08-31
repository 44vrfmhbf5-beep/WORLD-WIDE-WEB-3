/* Walks every category, opens one sheet per kind, and prints what actually
   renders — the columns, the facets, the headline, the stats, the About line
   and whether a chart drew. Run the fixture server first:
     node test/serve.mjs &  node tools/audit-entities.mjs
   The assertions this produced live in test/live.mjs; this is for looking.  */
import { chromium } from 'playwright';
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await c.newPage();
const errs = [];
p.on('pageerror', e => errs.push(`PAGEERROR ${e.message}`));
await p.goto('http://127.0.0.1:8899/?tab=assets', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
await p.waitForTimeout(2500);

const TABS = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
for (const t of TABS) {
  await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(900);
  const info = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('#results .row:not(.sk)')];
    const head = [...document.querySelectorAll('.thead button, .thead div')].map(h => h.textContent.trim()).filter(Boolean);
    const cells = rows.slice(0, 3).map(r => [...r.querySelectorAll('.c')].map(c => c.textContent.trim()));
    return { n: rows.length, head, cells,
      facets: [...document.querySelectorAll('#facetbar button[data-facet]')].map(f =>
        `${f.textContent.trim()}${f.disabled ? '(off)' : ''}`),
      first: rows[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 110) || '(none)' };
  });
  console.log(`\n=== ${t} (${info.n} rows) ===`);
  console.log('  facets:', info.facets.join(' | ') || '(none)');
  if (info.head.length) console.log('  cols  :', info.head.join(' | '));
  info.cells.forEach((r, i) => r.length && console.log(`  row${i} :`, r.join(' | ')));
  if (!info.head.length) console.log('  first :', info.first);

  if (info.n && t !== 'saved') {
    await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click()); await p.waitForTimeout(1800);
    const sheet = await p.evaluate(() => {
      const s = document.querySelector('.sheet-in'); if (!s) return null;
      return { kind: s.dataset.kind,
        head: s.querySelector('h2')?.textContent, sub: s.querySelector('.hsub')?.textContent,
        big: s.querySelector('.big')?.textContent, chg: s.querySelector('.chgline')?.textContent.replace(/\s+/g,' ').trim(),
        stats: [...s.querySelectorAll('.stat')].map(x =>
          `${x.querySelector('.k').textContent}=${x.querySelector('.v').textContent.trim()}`),
        about: s.querySelector('[data-about]')?.textContent.trim().slice(0, 200),
        src: s.querySelector('[data-src]')?.hidden === false ? s.querySelector('[data-src]').textContent.trim().slice(0,90) : '(none)',
        secs: [...s.querySelectorAll('.sec h3')].map(h => h.textContent),
        chart: s.querySelector('.chart svg path') ? 'drawn' : (s.querySelector('.cload')?.textContent || 'MISSING'),
        cta: s.querySelector('.cta a')?.getAttribute('href') };
    });
    if (!sheet) console.log('  SHEET: none opened');
    else {
      console.log(`  SHEET ${sheet.kind}: ${sheet.head} | ${sheet.sub}`);
      console.log(`    big=${sheet.big}  chg=${sheet.chg}  chart=${sheet.chart}`);
      console.log(`    stats: ${sheet.stats.join(' · ')}`);
      console.log(`    about: ${sheet.about}`);
      console.log(`    src  : ${sheet.src}`);
      console.log(`    secs : ${sheet.secs.join(' · ')}  cta=${sheet.cta}`);
    }
    await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  }
}
console.log('\n' + (errs.length ? errs.join('\n') : 'no page errors'));
await b.close();
