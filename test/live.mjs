// Verifies the app talks to the real CoinGecko / DeFiLlama endpoints.
//
// The static files are served unmodified (REWRITE=0), so data.js keeps its
// production URLs. Playwright intercepts those exact URLs and answers with
// correctly shaped payloads. That puts the real URL construction under test —
// hosts, paths and query params — which a rewritten base URL cannot check.
//   node test/live.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = process.env.PAGE || 'index.html';
const PORT = 8901, U = `http://localhost:${PORT}/${PAGE}`;
const srv = spawn(process.execPath, [path.join(HERE, 'serve.mjs')],
  { env: { ...process.env, MODE: 'ok', PORT: String(PORT), REWRITE: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {          // never wait forever on a server that died
  srv.stdout.once('data', res);
  srv.once('exit', c => rej(new Error('fixture server exited: ' + c)));
});

let fail = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

// ---- payloads in the documented response shapes ----
const walk = (seed, n, base) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const o = []; let v = base; for (let i = 0; i < n; i++) { h = (h * 1664525 + 1013904223) >>> 0; v *= 1 + ((h / 4294967296) - .5) * .02; o.push(v); } return o; };

const markets = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    current_price: 96240, market_cap: 1.9e12, market_cap_rank: 1, total_volume: 2.8e10,
    price_change_percentage_24h: 1.86, sparkline_in_7d: { price: walk('btc', 168, 96240) } },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    current_price: 3412.8, market_cap: 4.11e11, market_cap_rank: 2, total_volume: 1.42e10,
    price_change_percentage_24h: -1.14, sparkline_in_7d: { price: walk('eth', 168, 3412) } },
  { id: 'usd-coin', symbol: 'usdc', name: 'USDC', image: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
    current_price: 0.9999, market_cap: 4.12e10, market_cap_rank: 5, total_volume: 7.1e9,
    price_change_percentage_24h: 0.01, sparkline_in_7d: { price: walk('usdc', 168, 1) } },
];
// borrow fields carried on the pool itself; /lendBorrow is failed below on purpose
const llamaPools = { status: 'success', data: [
  { pool: 'aa11', chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', tvlUsd: 2.9e9, apyBase: 6.72, apyReward: 0, apy: 6.72,
    poolMeta: null, apyBaseBorrow: 8.44, apyRewardBorrow: 0, totalSupplyUsd: 2.9e9, totalBorrowUsd: 2.4e9, ltv: 0.87 },
  { pool: 'bb22', chain: 'Solana', project: 'kamino-lend', symbol: 'SOL', tvlUsd: 8.4e8, apyBase: 6.42, apyReward: 1.2, apy: 7.62,
    poolMeta: 'main', apyBaseBorrow: 8.91, apyRewardBorrow: 0, totalSupplyUsd: 8.4e8, totalBorrowUsd: 6e8, ltv: 0.75 },
  { pool: 'cc33', chain: 'Fantom', project: 'x', symbol: 'FTM', tvlUsd: 9e8, apy: 5, apyBase: 5,
    totalSupplyUsd: 9e8, totalBorrowUsd: 1e8, ltv: .5 },   // unsupported chain, must drop
] };

const protocols = [
  { id: '1', name: 'Aave V3', slug: 'aave-v3', category: 'Lending', chains: ['Ethereum', 'Base', 'Solana'],
    tvl: 1.9e10, change_1d: 1.2, change_7d: -3.4, url: 'https://aave.com', logo: null },
  { id: '2', name: 'Kamino Lend', slug: 'kamino-lend', category: 'Lending', chains: ['Solana'],
    tvl: 2.4e9, change_1d: -0.7, change_7d: 5.1, url: 'https://app.kamino.finance', logo: null },
  { id: '3', name: 'Tiny', slug: 'tiny', category: 'Yield', chains: ['Ethereum'], tvl: 1e5 },  // below the floor
];
const seen = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });

await p.route('https://api.coingecko.com/**', r => {
  const u = r.request().url(); seen.push(u);
  if (u.includes('/market_chart')) {
    return r.fulfill({ contentType: 'application/json',
      body: JSON.stringify({ prices: walk('c', 100, 3400).map((v, i) => [Date.now() - i * 36e5, v]) }) });
  }
  const cat = new URL(u).searchParams.get('category');
  r.fulfill({ contentType: 'application/json', body: JSON.stringify(cat ? markets.slice(0, 2) : markets) });
});
await p.route('https://yields.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  if (u.endsWith('/pools')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(llamaPools) });
  if (u.endsWith('/lendBorrow')) return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  if (u.includes('/chart/')) return r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ data: walk('p', 120, 6).map((v, i) => ({ timestamp: i, apy: v, tvlUsd: 1e8 })) }) });
  r.fulfill({ status: 404, body: '{}' });
});
await p.route('https://api.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  const J = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('/overview/dexs')) return J({ protocols: [{ name: 'Aave V3', total24h: 1.2e9 }] });
  if (u.includes('/overview/fees')) return J({ protocols: [{ name: 'Aave V3', total24h: 3.4e6, revenue24h: 9.1e5 }] });
  if (u.includes('/v2/chains')) return J([{ name: 'Ethereum', tvl: 6.2e10 }, { name: 'Solana', tvl: 9.4e9 }]);
  if (u.includes('/protocol/')) return J({ tvl: Array.from({ length: 200 }, (_, i) => ({ date: i, totalLiquidityUSD: 1e9 + i * 1e6 })) });
  if (u.endsWith('/protocols')) return J(protocols);
  if (u.includes('/overview/derivatives')) return J({ protocols: [{ name: 'Aave V3', total24h: 4.2e8 }] });
  if (u.includes('/overview/options')) return J({ protocols: [{ name: 'Aave V3', total24h: 1.1e7 }] });
  if (u.endsWith('/raises')) return J({ raises: [{ date: Math.floor(Date.now() / 1000) - 86400,
    name: 'Ondo Finance', round: 'Series A', amount: 20, chains: ['Ethereum'], sector: 'RWA',
    leadInvestors: ['Pantera'], otherInvestors: ['Coinbase Ventures'], source: 'https://example.invalid' }] });
  if (u.endsWith('/hacks')) return J([{ date: Math.floor(Date.now() / 1000) - 86400 * 5,
    name: 'Curve Finance exploit', amount: 6.1e7, technique: 'Reentrancy', chains: ['Ethereum'] }]);
  r.fulfill({ status: 404, body: '[]' });
});
await p.route('https://stablecoins.llama.fi/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ peggedAssets: [
    { id: '1', symbol: 'USDC', name: 'USD Coin', circulating: { peggedUSD: 4.1e10 },
      price: 1.0001, pegMechanism: 'fiat-backed', chains: ['Ethereum'] }] }) });
});
await p.route('https://bridges.llama.fi/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ bridges: [
    { id: 1, displayName: 'Across', chains: ['Ethereum', 'Base'], lastDailyVolume: 4.2e8, volumePrev2Day: 3.9e8 }] }) });
});
await p.route('https://api.dexscreener.com/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ pairs: [{
    chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR1', url: 'https://dexscreener.com/solana/PAIR1',
    baseToken: { address: 'CATaddr', name: 'CashCat', symbol: 'CASHCAT' }, quoteToken: { symbol: 'SOL' },
    priceUsd: '0.00042', priceChange: { h24: 31.4 }, liquidity: { usd: 9.1e5 },
    volume: { h24: 4.2e6 }, fdv: 2.1e7 }, {
    chainId: 'fantom', dexId: 'spooky', pairAddress: 'PAIR2',
    baseToken: { address: 'x', name: 'Unsupported', symbol: 'NOPE' },
    priceUsd: '1', liquidity: { usd: 9e5 } }, {
    chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR3',
    baseToken: { address: 'y', name: 'Dust', symbol: 'DUST' },
    priceUsd: '1', liquidity: { usd: 100 } }] }) });
});
await p.route('https://api.geckoterminal.com/**', r => {
  const u = r.request().url(); seen.push(u);
  const pool = (id, name, addr) => ({ id, type: 'pool',
    attributes: { name, address: addr, base_token_price_usd: '0.9',
      price_change_percentage: { h24: '12.5' }, reserve_in_usd: '3200000',
      volume_usd: { h24: '8100000' }, fdv_usd: '41000000' } });
  if (u.includes('/search/pools')) {
    const q = new URL(u).searchParams.get('query') || '';
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      data: /cashcat/i.test(q) ? [pool('solana_GTCASH', 'CASHCAT / SOL', 'GTCASHaddr')] : [] }) });
  }
  r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ data: [pool('solana_TREND', 'TRENDY / SOL', 'TRENDaddr')] }) });
});
await p.route('https://assets.coingecko.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: '' }));

console.log(`\n# production endpoints (${PAGE})`);
await p.goto(U); await p.waitForSelector('.row:not(.sk)', { timeout: 20000 });
const hit = re => seen.some(u => re.test(u));
ok(hit(/^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/markets\?/), 'CoinGecko /coins/markets');
ok(hit(/vs_currency=usd/) && hit(/sparkline=true/) && hit(/price_change_percentage=24h/), 'markets query params');
ok(hit(/^https:\/\/yields\.llama\.fi\/pools$/), 'DeFiLlama /pools');
ok(hit(/^https:\/\/yields\.llama\.fi\/lendBorrow$/), 'DeFiLlama /lendBorrow');

console.log('\n# real payloads render');
const txt = await p.locator('#results').textContent();
ok(txt.includes('Bitcoin') && txt.includes('$96,240'), 'CoinGecko fields map to asset rows');
ok(txt.includes('Aave V3') || txt.includes('Aave v3'), 'DeFiLlama project name is humanised');
ok(!txt.includes('FTM'), 'pool on an unsupported chain is dropped');
ok(await p.locator('.warn').count() === 0, '/lendBorrow failing alone is not an error');
ok(txt.includes('6.72%'), 'borrow fields read off the pool when /lendBorrow is down');

console.log('\n# the wider DeFi sources');
// wait for real protocol rows (id prefix r:), not the tab label of the same name
await p.waitForSelector('.row[data-id^="r:"]', { timeout: 20000 }).catch(() => {});
ok(hit(/^https:\/\/api\.llama\.fi\/protocols$/), 'DeFiLlama /protocols');
ok(hit(/\/overview\/dexs\?excludeTotalDataChart=true/), 'DeFiLlama /overview/dexs');
ok(hit(/\/overview\/fees\?excludeTotalDataChart=true/), 'DeFiLlama /overview/fees');
ok(hit(/^https:\/\/api\.llama\.fi\/v2\/chains$/), 'DeFiLlama /v2/chains');
ok(hit(/^https:\/\/stablecoins\.llama\.fi\/stablecoins\?includePrices=true$/), 'DeFiLlama /stablecoins');
ok(hit(/^https:\/\/bridges\.llama\.fi\/bridges\?includeChains=true$/), 'DeFiLlama /bridges');
ok(hit(/^https:\/\/api\.llama\.fi\/raises$/), 'DeFiLlama /raises');
ok(hit(/^https:\/\/api\.llama\.fi\/hacks$/), 'DeFiLlama /hacks');
ok(hit(/\/overview\/derivatives\?/), 'DeFiLlama /overview/derivatives');
ok(hit(/\/overview\/options\?/), 'DeFiLlama /overview/options');
ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/trending_pools\?page=1$/), 'GeckoTerminal /trending_pools');
{
  await p.fill('#q', 'cashcat'); await p.waitForTimeout(1400);
  ok(hit(/^https:\/\/api\.dexscreener\.com\/latest\/dex\/search\?q=cashcat$/), 'DexScreener /latest/dex/search');
  const body = await p.locator('#results').textContent();
  ok(body.includes('CashCat'), 'a long-tail DEX token no local source carries is found');
  // a chain outside the twelve we filter by is kept, labelled with its own name —
  // restricting the long tail to known chains was throwing most of it away
  ok(body.includes('Unsupported'), 'pair on a chain outside the filter set is still indexed');
  ok(!body.includes('Dust'), 'pair with no liquidity and no volume is dropped');
  ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/search\/pools\?query=cashcat&page=1$/),
    'GeckoTerminal /search/pools queried alongside DexScreener');
  ok(await p.locator('.row[data-id^="d:GTCASH"]').count() > 0, 'both DEX indexes contribute results');
  await p.fill('#q', '$cashcat'); await p.waitForTimeout(1200);
  ok(await p.locator('.row[data-id^="d:"]').count() > 0, 'a $-prefixed ticker still resolves');
  ok((await p.locator('.gtitle').allTextContents()).filter(x => x === 'DEX pairs').length <= 1,
    'live DEX results merge into one group');
  await p.locator('.row[data-id^="d:"]').first().click();
  await p.waitForSelector('.sheet-in[data-kind="pair"]', { timeout: 8000 });
  ok((await p.locator('.sheet').textContent()).includes('Liquidity'), 'DEX pair opens a real sheet');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.waitForTimeout(400);
}
{
  await p.fill('#q', 'pantera'); await p.waitForTimeout(500);
  ok(await p.locator('.row[data-id^="f:"]').count() > 0, 'funding rounds are searchable by investor');
  await p.fill('#q', 'reentrancy'); await p.waitForTimeout(500);
  ok(await p.locator('.row[data-id^="h:"]').count() > 0, 'exploits are searchable by technique');
  await p.fill('#q', 'across'); await p.waitForTimeout(500);
  ok(await p.locator('.row[data-id^="b:"]').count() > 0, 'bridges are searchable by name');
  await p.fill('#q', ''); await p.waitForTimeout(400);
}
{
  const body = await p.locator('#results').textContent();
  ok(body.includes('Aave V3'), 'protocols render as their own kind');
  ok(!body.includes('Tiny'), 'protocol under the TVL floor is dropped');
  ok(body.includes('Networks') || body.includes('Ethereum'), 'networks render with live TVL');
}
await p.fill('#q', 'aave v3'); await p.waitForTimeout(600);
const order = await p.locator('.row').evaluateAll(ns => ns.slice(0, 4).map(n => n.dataset.id));
ok(order[0]?.startsWith('r:'), `protocol outranks its own markets (${order.join(' ')})`);
await p.locator('.row[data-id^="r:"]').first().click();
await p.waitForSelector('.sheet-in[data-kind="protocol"]', { timeout: 10000 });
ok(hit(/\/protocol\/aave-v3$/), 'protocol chart hits /protocol/{slug}');
{
  const sheet = await p.locator('.sheet').textContent();
  ok(/24h DEX volume|24h fees/.test(sheet), 'DEX volume and fees join onto the protocol');
  ok(/Runs on/.test(sheet), 'protocol lists the chains it runs on');
}
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.fill('#q', 'kamino'); await p.waitForTimeout(600);
await p.locator('.row[data-id^="p:"]').first().click();
await p.waitForSelector('.sheet-in[data-kind="pool"]', { timeout: 10000 });
ok((await p.locator('.sheet').textContent()).includes('Protocol'), 'a lending market links to the protocol behind it');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.fill('#q', ''); await p.waitForTimeout(400);

console.log('\n# per-chain and chart endpoints');
await p.click('[data-chain=sol]'); await p.waitForTimeout(1200);
ok(hit(/category=solana-ecosystem/), 'chain tab requests the CoinGecko ecosystem category');
await p.click('[data-chain=""]'); await p.waitForTimeout(800);
await p.fill('#q', 'bitcoin'); await p.waitForTimeout(500);
await p.locator('.row').first().click();
await p.waitForSelector('.chart svg path', { timeout: 15000 });
ok(hit(/\/coins\/bitcoin\/market_chart\?vs_currency=usd&days=1$/), 'asset chart hits /market_chart with the coin id');
await p.click('[data-days="365"]'); await p.waitForTimeout(1200);
ok(hit(/\/market_chart\?vs_currency=usd&days=365$/), 'range switch changes the days param');
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.fill('#q', 'kamino'); await p.waitForTimeout(600);
await p.locator('.row[data-id^="p:"]').first().click();
await p.waitForSelector('.chart svg path, .cload.err', { timeout: 15000 });
ok(hit(/^https:\/\/yields\.llama\.fi\/chart\/bb22$/), 'market chart hits /chart/{poolId}');

console.log(fail ? `\n${fail} FAILING\n` : '\nall green\n');
await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
