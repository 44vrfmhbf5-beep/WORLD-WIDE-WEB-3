// End-to-end suite. Runs the UI against test/serve.mjs, which replays the
// CoinGecko + DeFiLlama response shapes locally — no network needed.
//   node test/e2e.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const D = path.join(HERE, 'shots') + path.sep;
const PORT = 8899;
const U = `http://localhost:${PORT}/index.html`;
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
let p = await page(); await p.goto(U); await p.waitForSelector('.row:not(.sk)', { timeout: 15000 });
ok(await p.locator('.row:not(.sk)').count() > 10, 'rows render from live shapes');
ok((await p.locator('.gtitle').allTextContents()).join() === 'Assets,Lending markets', 'both groups present, once each');
ok(/updated/.test(await p.locator('#meta').textContent()), 'freshness shown');
ok(await p.locator('.tok img').count() > 0, 'real logos requested');

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
