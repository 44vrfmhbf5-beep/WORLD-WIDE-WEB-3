/* Which of the stylesheet's rules can still match anything.

   A stylesheet grows by editing: a control is removed, its rules stay, and the
   next person reads them as describing something that exists. This walks every
   selector in styles.css against the app in every state it has — home, each
   category, a sheet of each kind, both pickers, the wallet, and a phone — and
   reports the ones nothing ever matched.
     node test/serve.mjs &  node tools/audit-css.mjs                          */
import fs from 'node:fs';
import { chromium } from 'playwright';

const U = 'http://127.0.0.1:8899/';
const css = fs.readFileSync('styles.css', 'utf8');

/* Selectors only, with at-rule blocks flattened and comments dropped. Pseudo
   states and elements are stripped: :hover cannot be matched by querySelector,
   and the rule behind it is about the element, not the state. */
const selectors = [...new Set(css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/@(media|supports)[^{]+\{/g, '')
  .split('}')
  .map(b => b.split('{')[0])
  .filter(x => x && !/^\s*@/.test(x) && !/^\s*\d+%\s*$/.test(x) && !/^\s*(from|to)\s*$/.test(x))
  .flatMap(x => x.split(','))
  .map(x => x.trim())
  .filter(Boolean)
  /* Longest first, or `focus-visible` is stripped as `focus` and leaves the
     string "-visible" behind — which then matches nothing and reads as a
     finding. An audit that invents its own findings is worse than none. */
  .map(x => x.replace(/::?(focus-visible|focus-within|first-line|first-letter|placeholder|-webkit-[\w-]+|-moz-[\w-]+|backdrop|selection|disabled|checked|active|before|marker|after|empty|hover|focus)(\([^)]*\))?/g, ''))
  .map(x => x.replace(/\s+/g, ' ').trim())
  .filter(x => x && x !== '*' && !/^(html|body|:root)$/.test(x)))];

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const hit = new Set();

const sweep = async page => {
  const found = await page.evaluate(sels => sels.filter(s => {
    try { return !!document.querySelector(s); } catch { return true; }   // invalid here = not our finding
  }), selectors);
  for (const s of found) hit.add(s);
};

await p.goto(U, { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .hcard', { timeout: 25000 });
await p.waitForTimeout(2500);
await sweep(p);

const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
for (const t of tabs) {
  await p.goto(`${U}?tab=${t}`, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#results .row:not(.sk), .empty, #results .hcard', { timeout: 20000 });
  await p.waitForTimeout(1000);
  await sweep(p);
  if (await p.locator('#results .row:not(.sk)').count()) {
    await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click());
    await p.waitForTimeout(1600);
    await sweep(p);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  }
}
/* States no tab reaches on its own. Each one is cheap, and skipping it makes
   the rules written for it look dead — an audit that cries wolf gets ignored,
   which is worse than not having one. */
await p.goto(`${U}?q=usdc`, { waitUntil: 'domcontentloaded' });        // All + query: group headings
await p.waitForTimeout(2500); await sweep(p);
await p.goto(`${U}?tab=yield&f=stable`, { waitUntil: 'domcontentloaded' });  // a facet is on
await p.waitForTimeout(2000); await sweep(p);
await p.goto(`${U}?tab=protocols&sort=-tvl`, { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
await p.locator('.thead button[data-sort]').first().click().catch(() => {});
await p.waitForTimeout(600); await sweep(p);                            // aria-sort both ways
await p.goto(`${U}?tab=dex&q=honeycat`, { waitUntil: 'domcontentloaded' });  // a flagged row
await p.waitForTimeout(3500); await sweep(p);
await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click()).catch(() => {});
await p.waitForTimeout(2500); await sweep(p);                           // its risk flags
await p.locator('[data-tquote]').click().catch(() => {});
await p.waitForTimeout(2500); await sweep(p);                           // a live quote
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.goto(`${U}?tab=nfts&q=mad`, { waitUntil: 'domcontentloaded' }); // a collection with items
await p.waitForTimeout(2500);
await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click()).catch(() => {});
await p.waitForTimeout(2500); await sweep(p);
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.locator('[data-star]').first().click().catch(() => {});         // a starred row
await p.waitForTimeout(500); await sweep(p);
await p.click('#connect'); await p.waitForTimeout(2500); await sweep(p);
await p.keyboard.press('Escape');

/* The states a happy path never reaches: loading, one source down, both down,
   rate limited, and the sample fallback. Half the stylesheet is for exactly
   these, so an audit that skips them reports them all as dead. */
for (const [mode, port] of [['slow', 8896], ['partial', 8897], ['down', 8898], ['429', 8895]]) {
  const { spawn } = await import('node:child_process');
  const srv = spawn(process.execPath, ['test/serve.mjs'],
    { env: { ...process.env, MODE: mode, PORT: String(port) }, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise(r => srv.stdout.once('data', r));
  const q = await ctx.newPage();
  await q.goto(`http://127.0.0.1:${port}/?tab=assets`, { waitUntil: 'domcontentloaded' });
  await q.waitForTimeout(mode === 'slow' ? 600 : 4000);     // slow: catch the skeletons
  await sweep(q);
  await q.fill('#q', 'cashcat').catch(() => {});
  await q.waitForTimeout(2500);
  await sweep(q);
  await q.close(); srv.kill();
}

const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
await m.goto(`${U}?tab=lending`, { waitUntil: 'domcontentloaded' });
await m.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
await m.waitForTimeout(1500); await sweep(m);
await m.click('#chainbtn'); await m.waitForTimeout(600); await sweep(m);
await m.keyboard.press('Escape'); await m.waitForTimeout(300);
await m.click('#catbtn'); await m.waitForTimeout(600); await sweep(m);
await m.keyboard.press('Escape'); await m.waitForTimeout(300);
await m.goto(`${U}?tab=lending&chain=eth`, { waitUntil: 'domcontentloaded' });   // chip is on
await m.waitForTimeout(2500); await sweep(m);

/* Some states cannot be entered from a fixture: a Privy session, a paid key, a
   build flag, a 300ms animation. Those rules are not dead, and listing them
   here with the reason keeps the report a list of findings rather than a list
   to learn to ignore. Anything unmatched and not named here is a finding. */
const STATE = {
  '.cload': 'chart still loading', '.cload:not(.err)': 'chart still loading',
  '.results.stale': 'the moment a chain is picked',
  '.row.in': 'the 300ms entry animation',
  '.tok.img': 'an image that actually loaded — see audit-images',
  '.sample': 'the artifact build with no network', '.sample b': 'the artifact build with no network',
  '.ghost-btn.wallet.on': 'signed in to Privy',
  '.waddr': 'signed in to Privy', '.waddr .k': 'signed in to Privy',
  '.waddr code': 'signed in to Privy', '.waddr .copy': 'signed in to Privy',
  '[data-werr] + .wsec': 'signed in to Privy',
  '.s.card': 'Crossmint configured',
  '.sec.items .buy': 'an OpenSea key', '.sec.items .item .buy': 'an OpenSea key',
  '.sec.items .ph img': 'an OpenSea key',
  '.thead button[aria-sort=descending]': 'a second click on a sorted column',
  '.mnote': 'a chain chip on a kind that has no chain',
  '.facetbar .rd': 'a sentence the parser reads', '.searchbar #q.read': 'a sentence the parser reads',
};
const unmatched = selectors.filter(s => !hit.has(s)).sort();
const dead = unmatched.filter(s => !STATE[s]);
const gated = unmatched.filter(s => STATE[s]);
console.log(`${selectors.length} selectors, ${hit.size} matched somewhere\n`);
for (const s of dead) console.log('  never matched: ' + s);
if (gated.length) {
  console.log('\n# unmatched, but the state is not reachable from a fixture');
  for (const s of gated) console.log(`  ${s.padEnd(38)} needs ${STATE[s]}`);
}
console.log(`\n${dead.length} selector(s) that match nothing in any state`);
await b.close();
process.exit(dead.length ? 1 : 0);
