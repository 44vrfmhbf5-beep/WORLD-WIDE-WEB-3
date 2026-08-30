/* Serves the built artifact.html the way the host wraps it, blocks every
   external request, and checks each category still fills and each sheet's
   headline still matches its row. The artifact is what people are handed.
     node build.mjs --artifact && node tools/audit-artifact.mjs              */
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs';
const srv = http.createServer((q, r) => {
  r.writeHead(200, { 'content-type': 'text/html' });
  // the artifact page is body-level content; the host wraps it like this
  r.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
    + fs.readFileSync('/home/user/WORLD-WIDE-WEB-3/artifact.html') + '</body></html>');
}).listen(8907);
const b = await chromium.launch();
const c = await b.newContext({ viewport: { width: 1400, height: 1000 } });
const p = await c.newPage();
const errs = []; p.on('pageerror', e => errs.push(e.message));
// the artifact runs with no network at all
await c.route('**', r => r.request().url().startsWith('http://localhost:8907') ? r.continue() : r.abort('failed'));
await p.goto('http://localhost:8907/', { waitUntil: 'domcontentloaded' });
await p.waitForSelector('#results .row:not(.sk)', { timeout: 25000 });
await p.waitForTimeout(2500);
const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
const wrong = [];
for (const t of tabs) {
  if (t === 'saved') continue;
  await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(700);
  if (!await p.locator('#results .row:not(.sk)').count()) { console.log(`${t}: EMPTY`); continue; }
  const rowNum = (await p.locator('#results .row:not(.sk)').first().locator('.n1, .cell').first().textContent()).trim();
  await p.locator('#results .row:not(.sk)').first().click(); await p.waitForTimeout(1400);
  const kind = await p.locator('.sheet-in').getAttribute('data-kind');
  const big = (await p.locator('.sheet-in .big').textContent()).trim();
  const nohist = await p.locator('.nohist').count();
  console.log(`${t.padEnd(10)} ${kind.padEnd(11)} row ${rowNum.padEnd(12)} sheet ${big.padEnd(12)} ${big === rowNum ? 'ok' : 'MISMATCH'}${nohist ? ' NO-HISTORY' : ''}`);
  if (big !== rowNum) wrong.push(t);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
}
await p.click('[data-tab=dex]'); await p.waitForTimeout(800);
console.log('dex facets:', await p.locator('#facetbar button[data-facet]').evaluateAll(bs => bs.map(x => x.textContent.trim() + (x.disabled ? '(off)' : ''))));
console.log(errs.length ? 'PAGE ERRORS: ' + errs.join(' | ') : 'no page errors');
await b.close(); srv.close();
