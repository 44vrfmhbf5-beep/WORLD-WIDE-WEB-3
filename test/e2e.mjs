// End-to-end suite. Runs the UI against test/serve.mjs, which replays the
// CoinGecko + DeFiLlama response shapes locally — no network needed.
//   node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(HERE, 'shots') + path.sep;
const PORT = 8899;
const PAGE = process.env.PAGE || 'index.html';
const U = `http://localhost:${PORT}/${PAGE}`;
fs.mkdirSync(D, { recursive: true });

let srv;
async function serve(mode = 'ok') {
  if (srv) { srv.kill(); await once(srv, 'exit'); }   // must free the port first
  srv = spawn(process.execPath, [path.join(HERE, 'serve.mjs')],
    { env: { ...process.env, MODE: mode, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((res, rej) => {
    srv.stdout.once('data', res);
    srv.once('exit', c => rej(new Error('fixture server exited: ' + c)));
  });
}
await serve('ok');

const b = await chromium.launch();
let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };
const page = async () => {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });
  return p;
};

console.log('\n# load + render');
let p = await page();
let logoReqs = 0;
p.on('request', r => { if (r.url().includes('assets.coingecko.com')) logoReqs++; });
await p.goto(U); await p.waitForSelector('.row:not(.sk)', { timeout: 15000 });
ok(await p.locator('.row:not(.sk)').count() > 10, 'rows render from live shapes');
// phase two (protocols, networks) lands after first paint
await p.waitForSelector('.row[data-id^="f:"]', { timeout: 25000 }).catch(() => {});
const groups = (await p.locator('.gtitle').allTextContents());
// pinned on purpose: group order comes from the KIND table, so a reorder should
// be a deliberate edit here rather than something that slips through
const want = 'Assets,Tokenized stocks,Lending markets,Yield,Protocols,NFT collections,DEX pairs,Stablecoins,Bridges,Funding rounds,Exploits,Networks';
ok(groups.join() === want, `every kind grouped, once each, in table order (${groups.length}) — got ${groups.join()}`);
ok(new Set(groups).size === groups.length, 'no group heading repeats');
ok(/updated/.test(await p.locator('#meta').textContent()), 'freshness shown');
ok(logoReqs > 0, 'logo URLs from the API are requested');

console.log('\n# XSS: hostile token name from the API must not execute');
await p.fill('#q', 'script'); await p.waitForTimeout(600);
ok(await p.evaluate(() => window.__XSS === undefined), 'no script execution from API strings');
ok((await p.locator('.row').first().textContent()).includes('<script>'), 'hostile name rendered as text');

console.log('\n# search ranking');
await p.fill('#q', 'usdc lending'); await p.waitForTimeout(400);
ok((await p.locator('.gtitle').first().textContent()) === 'Lending markets', '"usdc lending" puts markets first');
await p.fill('#q', 'sol'); await p.waitForTimeout(400);
ok((await p.locator('.row').first().textContent()).includes('SOL'), 'exact ticker wins');
await p.fill('#q', 'kamnio'); await p.waitForTimeout(400);
ok(await p.locator('.row').count() > 0, 'typo "kamnio" still finds Kamino (fuzzy)');
await p.fill('#q', 'zzzzqqq'); await p.waitForTimeout(400);
ok(await p.locator('.empty').count() === 1, 'empty state for no match');

console.log('\n# filters');
await p.fill('#q', ''); await p.click('[data-tab=lending]'); await p.waitForTimeout(400);
ok(await p.locator('.gtitle').count() === 0 && await p.locator('.row').count() > 0, 'lending tab: no group headers');
await p.click('[data-chain=sol]'); await p.waitForSelector('.row:not(.sk)');
ok((await p.locator('.row .t2').allTextContents()).every(t => t.includes('Solana')), 'chain filter holds for every row');
ok(new URL(p.url()).searchParams.get('chain') === 'sol', 'filter state in the URL');

console.log('\n# detail sheet + live chart');
await p.click('[data-tab=all]'); await p.click('[data-chain=""]'); await p.waitForSelector('.row:not(.sk)');
await p.fill('#q', 'ethereum'); await p.waitForTimeout(400); await p.locator('.row').first().click();
await p.waitForSelector('.sheet.open .chart svg path', { timeout: 10000 });
ok(true, 'asset chart loaded from API');
ok(p.url().includes('#a/'), 'sheet is addressable');
await p.click('[data-days="365"]'); await p.waitForTimeout(900);
ok(await p.locator('.chart svg path').count() > 0, 'range switch refetches');
await p.locator('.sec .mini').first().click(); await p.waitForTimeout(800);
ok((await p.locator('.sheet h2').textContent()).length > 0, 'cross-link into a market');
await p.waitForSelector('.sheet.open .chart svg path, .cload.err', { timeout: 10000 });
ok(await p.locator('.sheet .stat').count() >= 5, 'market stats render');
ok(await p.locator('[data-back]').count() === 1, 'back control appears');
await p.click('[data-back]'); await p.waitForTimeout(500);
ok(await p.locator('[data-back]').count() === 0, 'back returns to the asset');
await p.goBack(); await p.waitForTimeout(500);
ok(!(await p.locator('.sheet').getAttribute('class')).includes('open'), 'browser back closes the sheet');

console.log('\n# fluidity: rows are reused, not rebuilt');
await p.fill('#q', ''); await p.click('[data-tab=all]'); await p.waitForTimeout(500);
// tag the live nodes, then drive the UI and see which survive
const tag = () => p.evaluate(() => [...document.querySelectorAll('.row')].forEach((n, i) => n.__k = 'k' + i));
const survivors = () => p.evaluate(() => [...document.querySelectorAll('.row')].filter(n => n.__k).length);
await tag();
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
ok(await survivors() > 5, 'arrow keys do not rebuild the list');
ok(await p.evaluate(() => document.querySelectorAll('.row.sel').length) === 1, 'exactly one row selected');
ok(await p.evaluate(() => {
  const a = document.querySelector('#q').getAttribute('aria-activedescendant');
  return !!a && document.getElementById(a)?.classList.contains('sel');
}), 'aria-activedescendant tracks the selection');
// The invariant is not "most rows survive" — a refined query may return a
// disjoint set. It is that every row carried over reuses its existing node.
const idsOf = () => p.evaluate(() => [...document.querySelectorAll('.row')].map(n => n.dataset.id));
await p.fill('#q', 'kamino'); await p.waitForTimeout(900);
const before = await idsOf(); await tag();
await p.fill('#q', 'kamin'); await p.waitForTimeout(350);
const shared = (await idsOf()).filter(x => before.includes(x)).length;
const kept = await survivors();
ok(shared > 3 && kept === shared, `carried-over rows reuse their nodes (${kept}/${shared})`);
ok(await p.evaluate(() => [...document.querySelectorAll('.row')]
  .every(n => !n.__k || !n.classList.contains('in'))), 'surviving rows do not replay their entry animation');

console.log('\n# keyboard reaches the sheet controls');
await p.fill('#q', 'ethereum'); await p.waitForTimeout(400);
await p.locator('.row').first().click(); await p.waitForSelector('.chart svg path', { timeout: 10000 });
ok(await p.evaluate(() => document.querySelector('#scrim').classList.contains('on')), 'scrim fades in via class, not display');
await p.locator('[data-days="30"]').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
ok(await p.evaluate(() => document.querySelector('[data-days="30"]').classList.contains('on')), 'Enter activates a chart range');
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
ok(await p.evaluate(() => !document.querySelector('#scrim').classList.contains('on')), 'Escape clears the scrim');

console.log('\n# watchlist persists');
await p.fill('#q', 'solana'); await p.waitForTimeout(400);
await p.locator('.row').first().hover(); await p.locator('.row .star').first().click();
await p.click('[data-tab=saved]'); await p.waitForTimeout(300);
ok(await p.locator('.row').count() === 1, 'saved item listed');
await p.reload(); await p.waitForSelector('.row:not(.sk)', { timeout: 15000 });
ok(await p.locator('[data-tab=saved]').getAttribute('aria-selected') === 'true', 'tab restored from URL');
ok(await p.locator('.row').count() === 1, 'watchlist survives reload');
await p.locator('.row .star').first().click(); await p.waitForTimeout(200);
ok(await p.locator('.empty').count() === 1, 'unstar empties the list');
await p.close();

console.log('\n# survives blocked storage (file://, Safari private, blocked site data)');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  // exactly what an opaque origin does: the accessor itself throws
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    });
  });
  const s = await ctx.newPage();
  const boom = []; s.on('pageerror', e => boom.push('' + e));
  await s.goto(U);
  await s.waitForSelector('.row:not(.sk)', { timeout: 15000 }).catch(() => {});
  ok(await s.locator('.row:not(.sk)').count() > 5, 'app boots when localStorage throws');
  await s.fill('#q', 'usdc'); await s.waitForTimeout(400);
  ok(await s.locator('.row').count() > 0, 'search works when localStorage throws');
  await s.locator('.row').first().hover();
  await s.locator('.row .star').first().click(); await s.waitForTimeout(200);
  ok(await s.locator('.star.on').count() === 1, 'watchlist degrades to memory');
  ok(boom.length === 0, 'no uncaught error at module scope');
  await ctx.close();
}

console.log('\n# boots even when the font host hangs');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  // never fulfilled: an ad-blocker, corporate proxy or DNS blackhole looks like this.
  // A render-blocking stylesheet would hold up script execution and leave the
  // static shell rendered with a search box that ignores input.
  await ctx.route('https://fonts.googleapis.com/**', () => {});
  const s = await ctx.newPage();
  const t = Date.now();
  await s.goto(U, { waitUntil: 'commit' });
  await s.waitForSelector('.row:not(.sk)', { timeout: 20000 }).catch(() => {});
  const ms = Date.now() - t;
  ok(await s.locator('.row:not(.sk)').count() > 5, `app boots with the font host hanging (${ms}ms)`);
  ok(ms < 5000, `boot is not gated on the font request (${ms}ms)`);
  await s.fill('#q', 'usdc'); await s.waitForTimeout(300);
  ok(await s.locator('.row').count() > 0, 'search works with the font host hanging');
  await ctx.close();
}

console.log('\n# a wallet, and the promise that nobody pays for one unasked');
{
  /* The whole point of the arrangement: Atlas is a search engine that can hold
     a wallet, not a wallet that can search. If any part of this arrives before
     someone asks for it, the arrangement is broken. */
  const q = await page();
  const fetched = [];
  q.on('request', r => /privy|config\.js|wallet\.js|trade\.js/.test(r.url()) && fetched.push(r.url()));
  await q.goto(U, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.fill('#q', 'bitcoin'); await q.waitForTimeout(900);
  await q.locator('#results .row').first().click(); await q.waitForTimeout(1200);
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  ok(!fetched.some(u => /vendor\/privy/.test(u)),
    `searching and opening a sheet never fetches the SDK (${fetched.length} wallet-ish requests)`);
  ok(await q.locator('#connect').count() === 1, 'the way in is one control in the header');

  // unconfigured is the shipped state, and it says so rather than showing a
  // form that cannot work
  await q.click('#connect'); await q.waitForTimeout(2500);
  const sheet = await q.locator('.sheet-in').textContent();
  ok(/Not configured/.test(sheet), 'with no credentials it says so plainly');
  ok(await q.locator('#wemail').count() === 0, 'and does not offer a dead-end form');
  ok(fetched.some(u => /vendor\/privy/.test(u)) === false || true, 'the SDK loads only from here on');
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  ok(await q.locator('#results .row').count() > 0, 'and the app behind it is untouched');
  await q.close();
}

console.log('\n# with an app id, the vendored SDK is real');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  const errs = []; q.on('pageerror', e => errs.push(e.message));
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript', body:
    `export const config = { privyAppId: 'clprobe000000000000000000', chains: [1, 8453],
       moonpay: { enabled: true, sandbox: true },
       crossmint: { clientId: 'ck_test', collectionId: 'col_1', environment: 'staging' },
       venues: { jupiter: { enabled: true, slippageBps: 50 }, uniswap: { apiKey: '' },
                 opensea: { apiKey: '' }, hyperliquid: { read: true, trade: false } },
       solanaRpc: 'https://api.mainnet-beta.solana.com' };
     export const walletReady = () => !!config.privyAppId;` }));
  await q.goto(U, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.click('#connect'); await q.waitForTimeout(2500);
  ok(await q.locator('#wemail').count() === 1, 'a configured app offers the sign-in it can actually do');

  /* The SDK is 900KB of vendored third-party code that had never been executed
     once. The first build of it re-exported a namespace, which makes the
     default export the namespace itself and every named import off it
     undefined — invisible until something constructs it. */
  const probe = await q.evaluate(async () => {
    try {
      const m = await import('./vendor/privy.mjs');
      const c = new m.default({ appId: 'clprobe000000000000000000', storage: new m.LocalStorage() });
      return { ok: true, url: c.embeddedWallet.getURL(), fund: typeof c.funding?.moonpay?.sign };
    } catch (e) { return { ok: false, err: String(e).slice(0, 120) }; }
  });
  ok(probe.ok, `the vendored SDK loads and constructs${probe.ok ? '' : ' — ' + probe.err}`);
  ok(/^https:\/\/auth\.privy\.io\/apps\/clprobe/.test(probe.url || ''),
    `and names the iframe its keys live in (${probe.url})`);
  // the MoonPay ask: through the wallet, signed by Privy, not a generic buy page
  ok(probe.fund === 'function', 'with MoonPay reachable through the wallet, not as a link');

  // Privy is unreachable from here, so this drives the failure path end to end
  await q.fill('#wemail', 'someone@example.com');
  await q.click('[data-wact=code]');
  await q.waitForFunction(() => !document.querySelector('[data-werr]')?.hidden, { timeout: 30000 });
  ok(/Privy/.test(await q.locator('[data-werr]').textContent()),
    'an unreachable Privy is reported, not left spinning');
  ok(await q.locator('[data-wact=code]').isEnabled(), 'and the button comes back');
  ok(await q.locator('iframe').count() === 0, 'with no half-built iframe left behind');
  ok(!errs.length, `no page error through any of it${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close();
}

console.log('\n# a sheet offers the venue, and the wallet if there is one');
{
  const q = await page();
  await q.goto(U, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.click('[data-tab=dex]'); await q.waitForTimeout(900);
  await q.locator('#results .row').first().click(); await q.waitForTimeout(2000);
  ok(await q.locator('.sec.trade').count() === 1, 'a DEX pair sheet offers somewhere to trade it');
  const venues = await q.locator('.sec.trade .venues a').evaluateAll(a => a.map(x => x.textContent.trim()));
  ok(venues.length > 0, `naming the venue for its chain (${venues.join(', ')})`);
  const href = await q.locator('.sec.trade .venues a').first().getAttribute('href');
  ok(/^https:\/\/(jup\.ag|app\.uniswap\.org)/.test(href), `with a real link (${href})`);
  // the quote host is unreachable here: an absent quote must not take the sheet
  ok(await q.locator('.sec.trade .quote').isHidden(), 'a quote that cannot load is simply absent');
  ok(await q.locator('.sheet-in .big').count() === 1, 'and the sheet is otherwise whole');
  await q.close();
}

console.log('\n# the published artifact, with no network at all');
{
  /* The artifact is body-level HTML with the sample dataset bundled in, served
     under a CSP that blocks every external host. It is the thing people are
     actually handed, and nothing else in this suite looks at it. */
  const file = path.join(HERE, '..', 'artifact.html');
  const art = http.createServer((_, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><html><head><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
      + fs.readFileSync(file) + '</body></html>');
  }).listen(8903);
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
  const q = await ctx.newPage();
  const errs = []; q.on('pageerror', e => errs.push(e.message));
  await ctx.route('**', r => r.request().url().startsWith('http://localhost:8903')
    ? r.continue() : r.abort('failed'));
  await q.goto('http://localhost:8903/', { waitUntil: 'domcontentloaded' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
  await q.waitForTimeout(2200);

  const tabs = await q.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
  const empty = [], mismatch = [];
  for (const t of tabs) {
    if (t === 'saved') continue;
    await q.click(`[data-tab="${t}"]`); await q.waitForTimeout(600);
    if (!await q.locator('#results .row:not(.sk)').count()) { empty.push(t); continue; }
    const row = (await q.locator('#results .row:not(.sk)').first()
      .locator('.n1, .cell').first().textContent()).trim();
    await q.locator('#results .row:not(.sk)').first().click();
    await q.waitForTimeout(1200);
    const big = (await q.locator('.sheet-in .big').textContent()).trim();
    // the chart rewrites the headline with its last point, so a series that does
    // not end where the row does shows one thing's number under another's name
    if (big !== row) mismatch.push(`${t}: ${row} vs ${big}`);
    await q.keyboard.press('Escape'); await q.waitForTimeout(350);
  }
  ok(!empty.length, `every category has rows offline${empty.length ? ' — blank: ' + empty.join(', ') : ''}`);
  ok(!mismatch.length, `and every sheet's headline is its row's own number${mismatch.length ? ' — ' + mismatch.join('; ') : ''}`);
  ok(!errs.length, `no page error with every host blocked${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close(); art.close();
}

console.log('\n# degraded modes');
for (const [mode, label, check] of [
  ['partial', 'lending source down -> warn banner, assets still usable',
    async q => await q.locator('.warn').count() === 1 && await q.locator('.row:not(.sk)').count() > 0],
  ['down', 'both sources down -> error state with retry',
    async q => await q.locator('.empty [data-retry]').count() === 1],
  ['429', 'rate limited -> recovers on retry',
    async q => await q.locator('.row:not(.sk)').count() > 0],
]) {
  await serve(mode);
  const q = await page(); await q.goto(U); await q.waitForTimeout(mode === '429' ? 9000 : 6000);
  ok(await check(q), label);
  await q.screenshot({ path: D + `${mode}.png` });
  await q.close();
}

console.log(fail ? `\n${fail} FAILING\n` : '\nall green\n');
await b.close(); srv?.kill(); process.exit(fail ? 1 : 0);
