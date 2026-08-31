/* Accessibility, over every surface the app actually has.

   axe-core is the industry rule set — the same engine behind Lighthouse's
   accessibility score — and it runs against the live DOM, so it sees what a
   person using a screen reader or a keyboard sees rather than what the source
   suggests. Every tab, every sheet, both pickers, the wallet, and the phone
   layout, because a violation on one kind's sheet is invisible from another's.
     node test/serve.mjs &  node tools/audit-a11y.mjs                         */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const U = 'http://127.0.0.1:8899/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const seen = new Map();                   // rule id -> {impact, nodes, where}
let checked = 0;

async function scan(where) {
  checked++;
  const r = await new AxeBuilder({ page: p })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .analyze();
  for (const v of r.violations) {
    const hit = seen.get(v.id) || { impact: v.impact, nodes: 0, where: new Set(), help: v.help };
    hit.nodes += v.nodes.length;
    hit.where.add(where);
    hit.sample = hit.sample || v.nodes[0]?.html?.slice(0, 90);
    seen.set(v.id, hit);
  }
}

await p.goto(U, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .hcard', { timeout: 25000 });
await p.waitForTimeout(2500);
await scan('home');

const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
for (const t of tabs) {
  await p.goto(`${U}?tab=${t}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#results .row:not(.sk), .empty, #results .hcard', { timeout: 20000 });
  await p.waitForTimeout(1200);
  await scan(`tab:${t}`);
  // and the sheet this category opens, which is a different tree entirely
  if (await p.locator('#results .row:not(.sk)').count()) {
    await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click());
    await p.waitForTimeout(1800);
    await scan(`sheet:${t}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  }
}

// the wallet, which no tab reaches
await p.goto(`${U}?tab=assets`, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
await p.waitForTimeout(1200);
await p.click('#connect'); await p.waitForTimeout(2500); await scan('wallet');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);

/* A phone is a different layout, not a narrower one — and both pickers only
   exist there: on a wide screen the rail is the category list and the chain
   chips are down its side. */
const desktop = p;
const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
const on = page => async where => {
  checked++;
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice']).analyze();
  for (const v of r.violations) {
    const hit = seen.get(v.id) || { impact: v.impact, nodes: 0, where: new Set(), help: v.help };
    hit.nodes += v.nodes.length; hit.where.add(where);
    hit.sample = hit.sample || v.nodes[0]?.html?.slice(0, 90);
    seen.set(v.id, hit);
  }
};
const scanM = on(m);
await m.goto(`${U}?tab=lending`, { waitUntil: 'domcontentloaded' });
await m.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
await m.waitForTimeout(1500);
await scanM('phone');
await m.click('#chainbtn'); await m.waitForTimeout(700); await scanM('chain picker');
await m.keyboard.press('Escape'); await m.waitForTimeout(400);
await m.click('#catbtn'); await m.waitForTimeout(700); await scanM('category picker');
await m.keyboard.press('Escape'); await m.waitForTimeout(400);

const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
const rows = [...seen.entries()].sort((a, b) => order[a[1].impact] - order[b[1].impact]);
console.log(`${checked} surfaces scanned\n`);
for (const [id, v] of rows)
  console.log(`${String(v.impact).padEnd(8)} ${id.padEnd(28)} ${String(v.nodes).padStart(3)} nodes  ${
    [...v.where].slice(0, 4).join(', ')}${v.where.size > 4 ? ` +${v.where.size - 4}` : ''}\n         ${v.help}\n         ${v.sample || ''}`);
console.log(`\n${rows.length} rule(s) violated across ${checked} surfaces`);
await desktop.context().close(); await b.close();
process.exit(rows.filter(([, v]) => v.impact === 'critical' || v.impact === 'serious').length ? 1 : 0);
