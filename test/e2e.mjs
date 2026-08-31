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
/* A single-file build carries the app but not the 900KB wallet SDK, and inlines
   the modules a served build fetches — so anything that swaps one out is a
   check on the served app, not on this one. */
const SOLO = PAGE !== 'index.html';
const U = `http://localhost:${PORT}/${PAGE}`;
/* All, with nothing typed, is the category home now — a grid of tiles, no
   rows. Anything here that wants the mixed list has to ask for it, which is
   what a person does too. */
const UROWS = U + '?tab=assets';
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
/** Clicks past the sticky search bar, which overlays what scrolls under it.
    A forced click still lands at the element's coordinates, so the bar would
    receive it; dispatching on the element itself does not have that problem. */
const clickRow = (pg, sel = '.row') => pg.locator(sel).first().evaluate(el => el.click());
const page = async () => {
  const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
  p.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });
  return p;
};

console.log('\n# load + render');
let p = await page();
let logoReqs = 0;
p.on('request', r => { if (r.url().includes('assets.coingecko.com')) logoReqs++; });
/* All, with nothing typed, is a way in rather than a sample of everything: one
   tile per category, in the order the KIND table declares. Pinned on purpose —
   a reorder should be a deliberate edit here rather than something that slips
   through. */
await p.goto(U); await p.waitForSelector('#results .hcard', { timeout: 20000 });
await p.waitForTimeout(2500);
// the loop renders the list twice; the duplicate is hidden from everything
const tiles = await p.locator('#results .hcard:not([aria-hidden]) .ht b').allTextContents();
const want = 'Assets,Tokenized stocks,DEX pairs,NFT collections,Lending markets,Yield,Protocols,Stablecoins,Bridges,Networks,Funding rounds,Exploits,Saved';
ok(tiles.join() === want, `every category is a tile, in rail order (${tiles.length}) — got ${tiles.join()}`);
ok(new Set(tiles).size === tiles.length, 'no category listed twice');
ok(await p.locator('#results .row').count() === 0, 'and nothing is listed before it is asked for');
ok(/updated/.test(await p.locator('#meta').textContent()), 'freshness shown');

// a tile is the way in, and the category it opens is the one it named
await p.locator('#results .hcard').first().evaluate(el => el.click()); await p.waitForTimeout(900);
ok(await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab') === 'assets',
  'clicking a tile opens that category');
ok(await p.locator('#results .row:not(.sk)').count() > 5, 'which has rows in it');

// the grouped, mixed list is what a search across kinds produces
await p.click('[data-tab=all]'); await p.waitForTimeout(700);
await p.fill('#q', 'usdc'); await p.waitForTimeout(1600);
const groups = await p.locator('.gtitle').allTextContents();
ok(groups.length >= 2, `a search across kinds groups them (${groups.join(', ')})`);
ok(new Set(groups).size === groups.length, 'no group heading repeats');
await p.fill('#q', ''); await p.waitForTimeout(600);
ok(logoReqs > 0, 'logo URLs from the API are requested');

console.log('\n# the home loop');
{
  /* A grid of tiles is a wall. The same categories as a column of cards that
     keeps moving is something to watch — which means the list is rendered
     twice and the duplicate must be invisible to everything but the eye. */
  await p.goto(U); await p.waitForSelector('#results .hcard', { timeout: 20000 });
  const live = await p.locator('#results .hcard:not([aria-hidden])').count();
  const all = await p.locator('#results .hcard').count();
  ok(all === live * 2, `the list is rendered twice so the loop has no seam (${all} of ${live})`);
  ok(await p.locator('#results .hcard[aria-hidden] [tabindex="-1"], #results .hcard[aria-hidden="true"]').count() === live,
    'and the copy is hidden from assistive tech and the tab order');
  const anim = await p.locator('#results .track').evaluate(e => getComputedStyle(e).animationName);
  ok(anim === 'cycle', `the column cycles (${anim})`);
  /* A card you are reaching for has to hold still, and the whole column stops
     the moment the pointer enters it — not once it reaches a card, which would
     be a target that moves out from under the cursor. Moved by coordinate
     rather than by element, because a moving element is never "stable". */
  const box = await p.locator('#results .loop').boundingBox();
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(200);
  ok(await p.locator('#results .track').evaluate(e => getComputedStyle(e).animationPlayState) === 'paused',
    'and stops the moment the pointer enters it');
  await p.mouse.move(0, 0); await p.waitForTimeout(200);
  ok(await p.locator('#results .track').evaluate(e => getComputedStyle(e).animationPlayState) === 'running',
    'and starts again when it leaves');
  await p.locator('#results .hcard').first().evaluate(el => el.click()); await p.waitForTimeout(700);
  ok(/tab=/.test(p.url()), 'a card is still the way in');
  // hand the page back the way it was found: All, with everything loaded
  await p.goto(U); await p.waitForSelector('#results .hcard', { timeout: 20000 });
  await p.waitForTimeout(800);
}

console.log('\n# CoinGecko, asked directly');
{
  /* The local index is the top few hundred assets. A search that finds nothing
     locally can still find something, and what comes back has to be a row like
     any other rather than a suggestion nobody can act on. */
  const q = await page();
  await q.goto(U + '?tab=assets', { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.fill('#q', 'frog'); await q.waitForTimeout(3500);
  const row = q.locator('.row[data-id="a:obscure-frog"]');
  ok(await row.count() === 1, 'a coin the local index never carried is found');
  ok(/\$0\.42/.test(await row.textContent()), 'with its numbers on it, not just its name');
  await row.evaluate(el => el.click()); await q.waitForTimeout(1500);
  ok(await q.locator('.sheet-in[data-kind="asset"]').count() === 1, 'and it opens like any other asset');
  ok(/Counted in/.test(await q.locator('.sec.about').textContent()),
    'the sheet asks CoinGecko what else it knows');
  await q.close();
}

console.log('\n# a category is as deep as the source, not as deep as one page');
{
  /* CoinGecko lists seventeen thousand assets and GeckoTerminal indexes
     millions of pools. Atlas took one page of each and stopped, which is why a
     category could hold twenty rows while a search for the same thing found
     thousands. Showing more now reaches past the end of what is loaded. */
  const q = await page();
  for (const [tab, what] of [['assets', 'assets'], ['dex', 'DEX pairs']]) {
    await q.goto(U + '?tab=' + tab, { waitUntil: 'commit' });
    await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
    await q.waitForTimeout(1500);
    const before = await q.locator('#results .row').count();
    for (let i = 0; i < 3; i++) {
      await q.evaluate(() => document.querySelector('[data-more]')?.click());
      await q.waitForTimeout(2200);
    }
    const after = await q.locator('#results .row').count();
    ok(after > before + 40, `${what}: showing more fetched more, not just revealed more (${before} to ${after})`);
  }
  await q.close();
}

console.log('\n# the home cards say what the categories actually hold');
{
  await p.goto(U); await p.waitForSelector('#results .hcard', { timeout: 20000 });
  await p.waitForTimeout(2500);
  const cards = await p.locator('#results .hcard:not([aria-hidden])').evaluateAll(ns =>
    ns.map(n => [n.dataset.go, n.querySelector('.hn').textContent.trim()]));
  const rail = await p.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#tabs .tab')].map(t => [t.dataset.tab, t.querySelector('.ct').textContent.trim()])));
  const off = cards.filter(([t, n]) => t !== 'saved' && n !== (rail[t] || '—'));
  ok(!off.length, `every card matches its category${off.length ? ' — ' + off.map(x => x.join('=')).join(' ') : ''}`);
  // and the number is the number, not a rounding of it
  const dex = cards.find(([t]) => t === 'dex')[1];
  await p.click('[data-tab=dex]'); await p.waitForTimeout(1200);
  const meta = await p.locator('#meta').textContent();
  ok(meta.includes(dex), `the card's count is the one the category reports (${dex} in "${meta.trim().slice(0, 40)}")`);
  await p.goto(U); await p.waitForSelector('#results .hcard', { timeout: 20000 });
  await p.waitForTimeout(800);
}

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
await p.click('[data-tab=all]'); await p.click('[data-chain=""]'); await p.waitForTimeout(500);
// All shows the categories until something is asked of it
await p.fill('#q', 'ethereum'); await p.waitForSelector('.row:not(.sk)', { timeout: 15000 });
await p.waitForTimeout(500); await clickRow(p);
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
// a list to be fluid about: All with nothing typed is the category home, so
// this needs a query to have rows at all
await p.click('[data-tab=all]'); await p.fill('#q', 'usdc'); await p.waitForTimeout(1200);
// tag the live nodes, then drive the UI and see which survive
const tag = () => p.evaluate(() => [...document.querySelectorAll('.row')].forEach((n, i) => n.__k = 'k' + i));
const survivors = () => p.evaluate(() => [...document.querySelectorAll('.row')].filter(n => n.__k).length);
await tag();
await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
ok(await survivors() > 5, 'arrow keys do not rebuild the list');
ok(await p.evaluate(() => document.querySelectorAll('.row.sel').length) === 1, 'exactly one row selected');
/* The rows carry their own controls, which rules out the listbox pattern this
   used to claim — an ARIA option may not contain anything interactive. The
   cursor is `aria-current`, and because focus stays in the search box where
   someone is still typing, where it lands is announced in a live region. */
ok(await p.evaluate(() => document.querySelectorAll('.row[aria-current=true]').length) === 1,
  'the keyboard cursor marks exactly one row');
ok(await p.evaluate(() => {
  const n = document.querySelector('.row[aria-current=true]');
  return n?.classList.contains('sel') && /\d+ of \d+/.test(document.querySelector('#selsay').textContent);
}), 'and what it lands on is announced, since focus stays in the search box');
// The invariant is not "most rows survive" — a refined query may return a
// disjoint set. It is that every row carried over reuses its existing node.
const idsOf = () => p.evaluate(() => [...document.querySelectorAll('.row')].map(n => n.dataset.id));
await p.fill('#q', 'kamino'); await p.waitForTimeout(1100);
const before = await idsOf(); await tag();
await p.fill('#q', 'kamin'); await p.waitForTimeout(500);
const shared = (await idsOf()).filter(x => before.includes(x)).length;
const kept = await survivors();
ok(shared > 3 && kept === shared, `carried-over rows reuse their nodes (${kept}/${shared})`);
ok(await p.evaluate(() => [...document.querySelectorAll('.row')]
  .every(n => !n.__k || !n.classList.contains('in'))), 'surviving rows do not replay their entry animation');

console.log('\n# keyboard reaches the sheet controls');
await p.fill('#q', 'ethereum'); await p.waitForTimeout(700);
await clickRow(p); await p.waitForSelector('.chart svg path', { timeout: 10000 });
ok(await p.evaluate(() => document.querySelector('#scrim').classList.contains('on')), 'scrim fades in via class, not display');
await p.locator('[data-days="30"]').focus(); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
ok(await p.evaluate(() => document.querySelector('[data-days="30"]').classList.contains('on')), 'Enter activates a chart range');
await p.keyboard.press('Escape'); await p.waitForTimeout(500);
ok(await p.evaluate(() => !document.querySelector('#scrim').classList.contains('on')), 'Escape clears the scrim');

console.log('\n# watchlist persists');
await p.click('[data-tab=all]'); await p.fill('#q', 'solana'); await p.waitForTimeout(1100);
await clickRow(p, '.row .star');
await p.fill('#q', ''); await p.waitForTimeout(400);
await p.click('[data-tab=saved]'); await p.waitForTimeout(600);
ok(await p.locator('.row').count() === 1, 'saved item listed');
await p.reload(); await p.waitForSelector('.row:not(.sk), #results .hcard', { timeout: 15000 });
await p.waitForTimeout(600);
ok(await p.locator('[data-tab=saved]').getAttribute('aria-selected') === 'true', 'tab restored from URL');
ok(await p.locator('.row').count() === 1, 'watchlist survives reload');
await clickRow(p, '.row .star'); await p.waitForTimeout(300);
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
  await s.goto(UROWS);
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
  await s.goto(UROWS, { waitUntil: 'commit' });
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
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.fill('#q', 'bitcoin'); await q.waitForTimeout(900);
  await q.locator('#results .row').first().click(); await q.waitForTimeout(1200);
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  ok(!fetched.some(u => /vendor\/privy/.test(u)),
    `searching and opening a sheet never fetches the SDK (${fetched.length} wallet-ish requests)`);
  ok(await q.locator('#connect').count() === 1, 'the way in is one control in the header');

  /* An app id is configured, so Connect offers the sign-in it can actually do —
     except in a single-file build, where the SDK is the one thing that cannot
     be inlined and the sheet says so instead of failing on an import. */
  await q.click('#connect'); await q.waitForTimeout(2500);
  /* The single-file build used to stop here — no wallet, because the SDK could
     not be inlined. It can be, and a build whose only remaining action is a
     link to somewhere else is worth less than the megabyte. */
  ok(await q.locator('#wemail').count() === 1, 'with an app id it offers to sign in');
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  ok(await q.locator('#results .row').count() > 0, 'and the app behind it is untouched');
  await q.close();
}

console.log('\n# the app id is not a plaintext string in the repository');
{
  /* It cannot be a secret — Privy puts it in the wallet iframe's URL, so every
     user's network tab has it. What it can avoid is being greppable in a public
     repo, which is what the scrapers crawling GitHub for credentials read. */
  const src = fs.readFileSync(path.join(HERE, '..', 'config.js'), 'utf8');
  const { config } = await import('../config.js');
  ok(!!config.privyAppId, 'the app id resolves at runtime');
  ok(!src.includes(config.privyAppId), 'and is not sitting in the file as plain text');
  ok(/not encryption/i.test(src), 'with the file saying plainly that this is not encryption');

  // and a deployment can supply it without the repository carrying it at all
  const ctx = await b.newContext();
  const q = await ctx.newPage();
  await ctx.addInitScript(() => { window.ATLAS_CONFIG = { privyAppId: 'from-the-deploy-step' }; });
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  const injected = await q.evaluate(async () => (await import('./config.js')).config.privyAppId);
  ok(injected === 'from-the-deploy-step', `a deploy step can override it (${injected})`);
  await ctx.close();
}

/* Both sections below replace config.js over the wire, which a build that has
   already inlined it never asks for. They belong to the served app. */
if (!SOLO) {
console.log('\n# with no credentials at all, it says so rather than showing a dead end');
{
  const ctx = await b.newContext();
  const q = await ctx.newPage();
  await ctx.route('**/config.js', r => r.fulfill({ contentType: 'text/javascript',
    body: `export const config = { privyAppId: '', venues: {}, moonpay: {}, crossmint: {} };
           export const walletReady = () => false;` }));
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.click('#connect'); await q.waitForTimeout(2500);
  const sheet = await q.locator('.sheet-in').textContent();
  ok(/Not configured/.test(sheet), 'it says so plainly');
  ok(await q.locator('#wemail').count() === 0, 'and does not offer a form that cannot work');
  await ctx.close();
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
  await q.goto(UROWS, { waitUntil: 'commit' });
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

}   // !SOLO

console.log('\n# a sheet trades the thing, rather than linking to somewhere that does');
{
  const q = await page();
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.click('[data-tab=dex]'); await q.waitForTimeout(900);
  await q.locator('#results .row').first().evaluate(el => el.click()); await q.waitForTimeout(2000);
  ok(await q.locator('.sec.trade').count() === 1, 'a DEX pair sheet offers somewhere to trade it');
  /* The old shape was a row of links out. A link is the app saying it knows
     what you want and cannot do it, so there must not be one left. */
  ok(await q.locator('.sec.trade a[href^="http"]').count() === 0,
    'and no link out to a venue to finish the job elsewhere');
  ok(await q.locator('.sec.trade [data-amt]').count() === 1, 'it asks how much');
  ok(await q.locator('.sec.trade [data-tquote]').count() === 1, 'and offers to price it');
  ok(/Connect a wallet/.test(await q.locator('[data-tnote]').textContent()),
    'with no wallet, it says what is missing rather than hiding');
  // the venue is unreachable here: the failure belongs in the panel, not the sheet
  await q.click('[data-tquote]'); await q.waitForTimeout(2500);
  ok(await q.locator('[data-tnote]').textContent() !== '', 'a quote that cannot load says so');
  ok(await q.locator('.sheet-in .big').count() === 1, 'and the sheet is otherwise whole');
  await q.close();
}

console.log('\n# the chart readout sits on the line it is reading');
{
  const q = await page();
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  await q.locator('#results .row').first().evaluate(el => el.click());
  await q.waitForSelector('.sheet.open .chart svg .line', { timeout: 20000 });
  await q.waitForTimeout(1200);
  const box = await q.locator('.chart-svg').boundingBox();
  const off = [], clipped = [];
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    await q.mouse.move(box.x + Math.min(box.width - 1, box.width * f), box.y + box.height / 2);
    await q.waitForTimeout(120);
    const r = await q.evaluate(() => {
      const host = document.querySelector('.chart-svg');
      const hb = host.getBoundingClientRect();
      const d = document.querySelector('.cdot').getBoundingClientRect();
      const tip = document.querySelector('.tip').getBoundingClientRect();
      const xy = [...document.querySelector('.chart svg .line').getAttribute('d')
        .matchAll(/([\d.]+) ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
      const dx = d.x + d.width / 2 - hb.x, dy = d.y + d.height / 2 - hb.y;
      const near = xy.reduce((a, c) => Math.abs(c[0] - dx) < Math.abs(a[0] - dx) ? c : a);
      return { dx: Math.abs(near[0] - dx), dy: Math.abs(near[1] - dy),
        inside: tip.left >= hb.left - 0.5 && tip.right <= hb.right + 0.5 };
    });
    /* The readout is HTML over the svg and used to be placed as a percentage of
       a box 17px taller than the chart, with the padding the line is drawn
       inside ignored. The dot sat below and beside the point it marked. */
    if (r.dx > 1 || r.dy > 1) off.push(`${(f * 100).toFixed(0)}%: ${r.dx.toFixed(1)},${r.dy.toFixed(1)}`);
    if (!r.inside) clipped.push(`${(f * 100).toFixed(0)}%`);
  }
  ok(!off.length, `the dot sits on the line at every point${off.length ? ' — off by ' + off.join(' ') : ''}`);
  ok(!clipped.length, `and the label stays inside the chart at both ends${clipped.length ? ' — clipped at ' + clipped.join(' ') : ''}`);
  await q.close();
}

console.log('\n# a host that serves the file badly is not a missing file');
if (!SOLO) {
  /* Two things real hosts do, both of which the browser reports as "Importing a
     module script failed" — a sentence with no subject. One is survivable and
     the other is not, and telling them apart is the whole job. */
  const http = await import('node:http');
  const fsx = await import('node:fs');
  const pathx = await import('node:path');
  const ROOT = pathx.join(HERE, '..');
  const serve = (mode, port) => http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const f = pathx.join(ROOT, rel === '/' ? 'index.html' : rel);
    const lazy = /\/(config|wallet|trade|mcp|nl)\.js$/.test(rel);
    if (mode === 'html' && lazy) {
      res.writeHead(200, { 'content-type': 'text/html' });
      return res.end('<!doctype html><title>404</title><h1>Not found</h1>');
    }
    if (!f.startsWith(ROOT) || !fsx.existsSync(f)) { res.writeHead(404); return res.end('no'); }
    const ext = pathx.extname(f);
    const type = (mode === 'octet' && lazy) ? 'application/octet-stream'
      : { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' }[ext] || 'text/plain';
    res.writeHead(200, { 'content-type': type });
    res.end(fsx.readFileSync(f));
  }).listen(port);

  // 1. served with a type the browser will not import — the file is really there
  {
    const s1 = serve('octet', 8912);
    const q = await b.newPage();
    await q.goto('http://127.0.0.1:8912/index.html?tab=assets', { waitUntil: 'domcontentloaded' });
    await q.waitForTimeout(3000);
    await q.click('#connect'); await q.waitForTimeout(4500);
    ok(await q.locator('#wemail').count() === 1,
      'a module served as octet-stream is fetched and run anyway');
    await q.close(); s1.close();
  }
  // 2. a missing file answered with an HTML page and a 200, which is worse
  {
    const s2 = serve('html', 8913);
    const q = await b.newPage();
    await q.goto('http://127.0.0.1:8913/index.html?tab=assets', { waitUntil: 'domcontentloaded' });
    await q.waitForTimeout(3000);
    await q.click('#connect'); await q.waitForTimeout(4500);
    const said = (await q.locator('[data-werr]').textContent()).replace(/\s+/g, ' ');
    ok(/(config|wallet)\.js is not on this host/.test(said) && /HTML page/.test(said),
      `and one that is not there says so, with the status (${said.slice(0, 70)})`);
    await q.close(); s2.close();
  }
}

console.log('\n# the build says what it carries, and carries what it says');
{
  /* "Wallet js is missing" is a real report, and the only way to answer it is
     to make the build provable: what it contains is in a manifest, the manifest
     is derived from the same list the modules table is built from, and the app
     resolves every lazy module against it. A build that ships without the
     wallet now fails here rather than in somebody's browser. */
  const q = await page();
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('#results .row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(1200);
  const build = await q.evaluate(() => window.__ATLAS_BUILD__ || null);
  const live = await q.evaluate(() => Object.keys(window.__ATLAS_MODULES__ || {}));
  if (SOLO) {
    ok(!!build, 'a single-file build states what it carries');
    for (const m of ['config', 'nl', 'mcp', 'wallet', 'trade'])
      ok(build?.modules.includes(m) && live.includes(m), `and carries ${m}`);
    ok(await q.evaluate(() => typeof window.__ATLAS_VENDOR__?.default === 'function'),
      'including the wallet SDK itself, constructible');
    ok(await q.evaluate(() => typeof window.__ATLAS_MODULES__.wallet.sendEmailCode === 'function'),
      'and the wallet module is the real one, not a stub');
    ok(await q.evaluate(() => typeof window.__ATLAS_MODULES__.trade.quote === 'function'),
      'and so is the trade module');
  } else {
    ok(build === null && live.length === 0, 'a served build inlines nothing and fetches its modules');
  }
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
  // All is the category home now, so the landing screen is tiles
  await q.waitForSelector('#results .hcard', { timeout: 25000 });
  await q.waitForTimeout(2200);
  ok(await q.locator('#results .hcard:not([aria-hidden])').count() >= 12, 'the offline build lands on its categories');

  const tabs = await q.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
  const empty = [], mismatch = [];
  for (const t of tabs) {
    if (t === 'saved' || t === 'all') continue;
    await q.click(`[data-tab="${t}"]`); await q.waitForTimeout(600);
    if (!await q.locator('#results .row:not(.sk)').count()) { empty.push(t); continue; }
    const row = (await q.locator('#results .row:not(.sk)').first()
      .locator('.n1, .cell').first().textContent()).trim();
    await clickRow(q, '#results .row:not(.sk)');
    await q.waitForTimeout(1200);
    const big = (await q.locator('.sheet-in .big').textContent()).trim();
    // the chart rewrites the headline with its last point, so a series that does
    // not end where the row does shows one thing's number under another's name
    if (big !== row) mismatch.push(`${t}: ${row} vs ${big}`);
    await q.keyboard.press('Escape'); await q.waitForTimeout(350);
  }
  ok(!empty.length, `every category has rows offline${empty.length ? ' — blank: ' + empty.join(', ') : ''}`);

  /* A dynamic import in a single-file build has nothing to fetch. Two modules
     have no reason to be separate, so the bundler inlines them; the reader was
     silently dead in every published build until it did. */
  await q.click('[data-tab=all]'); await q.waitForTimeout(600);
  await q.fill('#q', 'meme coins on solana up 5% in the past 24 hours');
  await q.waitForTimeout(2400);
  const chips = (await q.locator('#facetbar').textContent()).replace(/\s+/g, ' ').trim();
  ok(/Reading/.test(chips), `a sentence is still read in a single-file build (${chips.slice(0, 60)})`);
  ok(await q.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab') === 'dex',
    'and still sets the category it names');
  await q.fill('#q', ''); await q.waitForTimeout(700);

  /* The wallet used to be the one thing left out of this build, and the sheet
     said so. It carries the SDK now, so the artifact offers the same sign-in
     the served app does — the whole point of a build somebody can actually
     use. */
  await q.click('#connect'); await q.waitForTimeout(2500);
  const w = (await q.locator('.sheet-in').textContent()).replace(/\s+/g, ' ').trim();
  ok(await q.locator('#wemail').count() === 1,
    `the offline build still offers to sign in (${w.slice(0, 70)})`);
  ok(!/single-file build has no wallet/.test(w), 'and no longer says it has no wallet');
  ok(!/module|failed to fetch/i.test(w), 'without reporting a module error to somebody who cannot act on it');
  ok(await q.locator('[data-werr]').isVisible() === false, 'and without showing an error at all');
  await q.keyboard.press('Escape'); await q.waitForTimeout(400);
  ok(!mismatch.length, `and every sheet's headline is its row's own number${mismatch.length ? ' — ' + mismatch.join('; ') : ''}`);
  ok(!errs.length, `no page error with every host blocked${errs.length ? ' — ' + errs[0] : ''}`);
  await ctx.close(); art.close();
}

console.log('\n# degraded modes');
/* The artifact build carries a sample dataset, so a source being down is not a
   degraded state there — it falls back and still lists rows, which the
   no-network section above already holds it to. */
const BUNDLED = PAGE === 'artifact.html';
for (const [mode, label, check] of [
  ['partial', 'lending source down -> warn banner, assets still usable',
    async q => BUNDLED
      ? await q.locator('.row:not(.sk)').count() > 0
      : await q.locator('.warn').count() === 1 && await q.locator('.row:not(.sk)').count() > 0],
  ['down', 'both sources down -> error state with retry',
    async q => BUNDLED
      ? await q.locator('.row:not(.sk)').count() > 0
      : await q.locator('.empty [data-retry]').count() === 1],
  ['429', 'rate limited -> recovers on retry',
    async q => await q.locator('.row:not(.sk)').count() > 0],
]) {
  await serve(mode);
  const q = await page(); await q.goto(UROWS); await q.waitForTimeout(mode === '429' ? 9000 : 6000);
  ok(await check(q), label);
  await q.screenshot({ path: D + `${mode}.png` });
  await q.close();
}

console.log(fail ? `\n${fail} FAILING\n` : '\nall green\n');
await b.close(); srv?.kill(); process.exit(fail ? 1 : 0);
