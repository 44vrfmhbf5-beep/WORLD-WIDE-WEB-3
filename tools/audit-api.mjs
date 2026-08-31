/* Every endpoint the code names, against every endpoint the app actually calls.

   The two lists should be the same list. Where the code names an endpoint
   nothing ever calls, that integration is written and unreachable. Where the
   app calls something the fixture does not answer, the flow behind it has
   never once been exercised — which is how a mistyped path survives review.
     node test/serve.mjs &  node tools/audit-api.mjs                          */
import fs from 'node:fs';
import { chromium } from 'playwright';

const SRC = ['data.js', 'mcp.js', 'trade.js', 'wallet.js'];
/* Path templates as written, with ${…} collapsed — what is being compared is
   the shape of the request, not one instance of it. */
const declared = new Map();              // "HOST /path/shape" -> host it belongs to
const hosts = new Map();                 // const name -> host
for (const f of SRC) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^const ([A-Z_][A-Z0-9_]*) = '(https?:\/\/[^']+)'/gm))
    hosts.set(m[1], m[2]);
  // `${CONST}/path/${id}/more` — the constant names the host, the rest is shape
  for (const m of src.matchAll(/`\$\{([A-Z_][A-Z0-9_]*)\}([^`]*)`/g)) {
    const path = m[2].replace(/\$\{[^}]+\}/g, '*').replace(/\?.*$/, '').replace(/\/$/, '');
    if (path.length > 1) declared.set(`${m[1]}${path}`, hosts.get(m[1]) || '');
  }
  // and the ones written out in full
  for (const m of src.matchAll(/'(https?:\/\/[^']+\/[^']+)'/g)) {
    const url = m[1].replace(/\?.*$/, '');
    try { declared.set(url, new URL(url).host); } catch { /* not a url */ }
  }
  for (const m of src.matchAll(/`(https?:\/\/[^`]+)`/g)) {
    const url = m[1].replace(/\$\{[^}]+\}/g, '*').replace(/\?.*$/, '');
    try { declared.set(url, new URL(url.replace(/\*/g, 'x')).host); } catch { /* not a url */ }
  }
}

const U = 'http://127.0.0.1:8899/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
const p = await ctx.newPage();
const calls = new Map();                 // path -> {n, status}
ctx.on('request', () => {});
p.on('response', async r => {
  const u = new URL(r.url());
  if (u.host !== '127.0.0.1:8899') return;
  const key = u.pathname;
  const hit = calls.get(key) || { n: 0, bad: 0 };
  hit.n++; if (r.status() >= 400) hit.bad++;
  calls.set(key, hit);
});
const errs = [];
p.on('pageerror', e => errs.push(e.message));

const go = async (q, wait = 1500) => {
  await p.goto(U + q, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#results .row:not(.sk), .empty, #results .hcard', { timeout: 20000 });
  await p.waitForTimeout(wait);
};

await go('', 2500);
const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
for (const t of tabs) {
  await go(`?tab=${t}`);
  if (await p.locator('#results .row:not(.sk)').count()) {
    await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click());
    await p.waitForTimeout(2200);
    // every range on the chart, because each is its own request
    for (const d of await p.locator('.rangebar [data-days]').evaluateAll(n => n.map(x => x.dataset.days))) {
      await p.click(`.rangebar [data-days="${d}"]`).catch(() => {});
      await p.waitForTimeout(700);
    }
    await p.locator('[data-tquote]').click().catch(() => {});
    await p.waitForTimeout(2000);
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  }
}
// the flows a tab does not reach
await go('?q=cashcat', 3500);            // long-tail DEX search + CoinGecko MCP
await go('?tab=assets&chain=sol', 3000); // a chain's own tokens
await go('?tab=dex&q=honeycat', 3500);   // a contract scan
await go('?q=meme coins on base up 50% in 24h', 3000);   // a reading
await p.evaluate(() => document.querySelector('[data-more]')?.click());
await p.waitForTimeout(2500);            // the next page of a source

const called = [...calls.keys()].sort();
const bad = [...calls.entries()].filter(([, v]) => v.bad).map(([k, v]) => `${k} (${v.bad}/${v.n})`);

/* The fixture serves each production path under a short prefix, so what can be
   compared is the shape after the host: the last real segment, plus the one
   before it where there is one. A bare host constant is not an endpoint. */
/* An endpoint is identified by its last fixed segment: the host in front of it
   is a constant the fixture rewrites, and everything interpolated is an id.
   A host the fixture does not stand in for is reported separately — unexercised
   here is a different statement from unreached by the app. */
const STANDS_IN = /coingecko|llama|geckoterminal|dexscreener|coinpaprika|uniswap\.org|jup\.ag|magiceden|morpho|gopluslabs|wikipedia|mcp\./;
const lastSeg = d => d.replace(/\*/g, '').split('/').filter(Boolean).pop() || '';
const calledSegs = new Set(called.flatMap(c => c.split('/').filter(Boolean)));
/* Two kinds of URL in this codebase are never fetched and must not be counted
   as unreached: a link somebody clicks (defillama.com, opensea.io, a venue's
   own site) and an image the browser loads rather than the app. */
const LINK_ONLY = /defillama\.com|opensea\.io\/assets|magiceden\.io|app\.uniswap\.org|buy\.moonpay\.com|jup\.ag\/swap|app\.hyperliquid/;
const IMAGE = /\.(png|jpg|jpeg|svg|webp)$|\/icons\//;
const named = [...declared].filter(([d]) => {
  const seg = lastSeg(d);
  if (!seg || /^(api|v[0-9]+|graphql)$/.test(seg)) return false;
  if (hosts.has(d)) return false;
  return !LINK_ONLY.test(d) && !IMAGE.test(d);
});
/* The fixture rewrites each host to a short prefix, so an endpoint whose last
   segment is an interpolated title (Wikipedia's) is found by its prefix
   instead — otherwise it reads as unreached while being called every time. */
const calledPrefixes = new Set(called.map(c => c.split('/').filter(Boolean)[0]));
const PREFIX = { 'en.wikipedia.org': 'wiki', 'api.morpho.org': 'morpho' };
const unreached = named.filter(([d, host]) =>
  !calledSegs.has(lastSeg(d)) && !calledPrefixes.has(PREFIX[host]));
const missing = unreached.filter(([, h]) => STANDS_IN.test(h)).map(([d]) => d).sort();
const outside = unreached.filter(([, h]) => !STANDS_IN.test(h)).map(([d]) => d).sort();

console.log(`${declared.size} endpoints named in source, ${named.length} of them fetchable, ${called.length} paths called\n`);
console.log('# called and answered');
for (const c of called) console.log(`  ${String(calls.get(c).n).padStart(3)}x  ${c}`);
console.log('\n# named in source, never called in any flow');
for (const m of missing) console.log('  ' + m);
console.log('\n# on a host the fixture does not stand in for, so never exercised here');
for (const o of outside) console.log('  ' + o);
console.log('\n# called and refused');
for (const x of bad) console.log('  ' + x);
console.log(`\n${missing.length} unreached, ${outside.length} unexercised, ${bad.length} refused, ${errs.length} page error(s)`);
if (errs.length) console.log('PAGE ERRORS: ' + errs.slice(0, 3).join(' | '));
await b.close();
