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
  { id: '4', name: 'Poison', slug: 'poison', category: 'Dex', chains: ['Ethereum'],
    tvl: 5e9, url: 'javascript:alert(document.domain)' },
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
  if (u.includes('/v2/historicalChainTvl/'))
    return J(Array.from({ length: 200 }, (_, i) => ({ date: i, tvl: 5e10 + i * 1e8 })));
  if (u.includes('/protocol/')) return J({ tvl: Array.from({ length: 200 }, (_, i) => ({ date: i, totalLiquidityUSD: 1e9 + i * 1e6 })) });
  if (u.endsWith('/protocols')) return J(protocols);
  if (u.includes('/overview/derivatives')) return J({ protocols: [{ name: 'Aave V3', total24h: 4.2e8 }] });
  if (u.includes('/overview/options')) return J({ protocols: [{ name: 'Aave V3', total24h: 1.1e7 }] });
  if (u.endsWith('/raises')) return J({ raises: [{ date: Math.floor(Date.now() / 1000) - 86400,
    name: 'Ondo Finance', round: 'Series A', amount: 20, chains: ['Ethereum'], sector: 'RWA',
    leadInvestors: ['Pantera'], otherInvestors: ['Coinbase Ventures'], valuation: 4e9,
    source: 'https://example.invalid' }] });
  if (u.endsWith('/hacks')) return J([{ date: Math.floor(Date.now() / 1000) - 86400 * 5,
    name: 'Curve Finance exploit', amount: 6.1e7, technique: 'Reentrancy', chains: ['Ethereum'] }]);
  r.fulfill({ status: 404, body: '[]' });
});
await p.route('https://stablecoins.llama.fi/**', r => {
  seen.push(r.request().url());
  if (r.request().url().includes('/stablecoincharts/'))
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(
      Array.from({ length: 200 }, (_, i) => ({ date: i, totalCirculating: { peggedUSD: 4e10 + i * 1e7 } }))) });
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
    priceUsd: '0.00000042', priceChange: { h24: 31.4 }, liquidity: { usd: 9.1e5 },
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
await p.route('https://nft.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  if (u.includes('/chart/')) return r.fulfill({ contentType: 'application/json',
    body: JSON.stringify(Array.from({ length: 120 }, (_, i) => ({ timestamp: i, floorPriceUSD: 90000 + i * 40 }))) });
  r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { collectionId: '0xbayc', name: 'Bored Ape Yacht Club', symbol: 'BAYC', chain: 'Ethereum',
      image: null, floorPrice: 12.4, floorPriceUSD: 42300, floorPricePctChange1Day: -2.1,
      floorPricePctChange7Day: 5.4, dailyVolumeUSD: 3.1e6, totalSupply: 10000 },
    { collectionId: '0xpoly', name: 'Polygon Apes', symbol: 'PAPE', chain: 'Polygon',
      floorPrice: 240, floorPricePctChange1Day: 1.1, totalSupply: 5000 },
    { collectionId: '0xnofloor', name: 'No Floor Collection', symbol: 'NOPE', chain: 'Ethereum' }]) });
});
await p.route('https://api-mainnet.magiceden.dev/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { symbol: 'mad_lads', name: 'Mad Lads', image: null, floorPrice: 118e9, volumeAll: 9.2e11 }]) });
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
ok(hit(/^https:\/\/nft\.llama\.fi\/collections$/), 'DeFiLlama NFT /collections');
ok(hit(/^https:\/\/api-mainnet\.magiceden\.dev\/v2\/marketplace\/popular_collections$/), 'Magic Eden /popular_collections');
{
  await p.waitForSelector('.row[data-id^="n:"]', { timeout: 20000 }).catch(() => {});
  const body = await p.locator('#results').textContent();
  ok(body.includes('Bored Ape'), 'EVM collections are indexed');
  ok(body.includes('Mad Lads'), 'Solana collections are indexed from a second marketplace');
  await p.fill('#q', 'polygon apes'); await p.waitForTimeout(700);
  ok(/240\.000 POL/.test(await p.locator('.row[data-id="n:0xpoly"]').textContent()),
    "a floor is quoted in its own chain's token, not always ETH");
  await p.fill('#q', ''); await p.waitForTimeout(400);
  ok(!body.includes('No Floor Collection'), 'a collection with no floor at all is dropped');
  await p.fill('#q', 'mad lads'); await p.waitForTimeout(600);
  ok(/SOL/.test(await p.locator('.row[data-id^="n:me-"]').first().textContent()),
    'a Solana floor keeps its own unit rather than being mislabelled as dollars');
  await p.fill('#q', 'bored ape'); await p.waitForTimeout(600);
  await p.locator('.row[data-id^="n:"]').first().click();
  await p.waitForSelector('.sheet-in[data-kind="nft"]', { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(hit(/^https:\/\/nft\.llama\.fi\/chart\/0xbayc$/), 'floor history hits /chart/{collectionId}');
  ok(await p.locator('.chart svg .line').count() === 1, 'an NFT collection charts its floor');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.waitForTimeout(400);
}
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
  // toPrecision goes exponential under 1e-6 — the long tail trades right there
  ok(/\$0\.00000042/.test(body) && !/e-7/.test(body), 'a sub-cent price shows its zeros, not scientific notation');
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
  await p.locator('.row[data-id^="f:"]').first().click();
  await p.waitForSelector('.sheet-in[data-kind="raise"]', { timeout: 8000 });
  ok(/\$4\.00B/.test(await p.locator('.sheet').textContent()),
    'a valuation already in dollars is not scaled by a million again');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
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
  // the chain row destructured one field too far, so every network read $0
  await p.fill('#q', 'ethereum'); await p.waitForTimeout(600);
  const net = await p.locator('.row[data-id="c:eth"]').textContent();
  ok(/\$62\.00B/.test(net), `a network carries its real TVL (${net.trim().slice(0, 60)})`);
  await p.locator('.row[data-id="c:eth"]').click();
  await p.waitForSelector('.sheet-in[data-kind="chain"]', { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(hit(/\/v2\/historicalChainTvl\/Ethereum$/), 'a network charts its own TVL history');
  ok(await p.locator('.chart svg .line').count() === 1, 'the network sheet draws a chart');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.waitForTimeout(400);
}

console.log('\n# upstream strings that end up in an href');
{
  await p.fill('#q', 'poison'); await p.waitForTimeout(700);
  await p.locator('.row[data-id="r:poison"]').first().click();
  await p.waitForSelector('.sheet-in[data-kind="protocol"]', { timeout: 8000 });
  const href = await p.locator('.sheet .cta a').getAttribute('href');
  ok(!/^javascript:/i.test(href), `a javascript: url from upstream never reaches the href (${href})`);
  ok(/defillama\.com/.test(href), 'it falls back to the canonical page instead');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.waitForTimeout(400);
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

console.log('\n# every kind with a series over time gets a chart');
for (const [q, sel, kind] of [['usd coin', 's:', 'stablecoin'], ['kamino', 'p:', 'pool']]) {
  await p.fill('#q', q); await p.waitForTimeout(700);
  await p.locator(`.row[data-id^="${sel}"]`).first().click();
  await p.waitForSelector(`.sheet-in[data-kind="${kind}"]`, { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(await p.locator('.chart svg .line').count() === 1, `${kind} sheets chart their history`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
}
ok(hit(/\/stablecoincharts\/all\?stablecoin=1$/), 'stablecoin supply history is fetched');
await p.fill('#q', ''); await p.waitForTimeout(400);

console.log('\n# the combined layout: DefiLlama density, Aave calm');
{
  // every kind is a destination in the rail, and says how much sits behind it
  const rail = await p.locator('#rail [data-tab]').allTextContents();
  ok(rail.length === 13, `rail lists all eleven kinds plus All and Saved (${rail.length})`);
  ok(/Networks/.test(rail.join(' ')) && /Exploits/.test(rail.join(' ')),
    'kinds that were search-only now have their own category');
  ok(await p.locator('#rail [data-tab=protocols] .ct').textContent() !== '',
    'a category carries its row count');

  // aggregate bar, summed from data already loaded
  const stats = await p.locator('#statbar').textContent();
  ok(/Total TVL/.test(stats) && /\$/.test(stats), `the aggregate bar totals the index (${stats.slice(0, 40)})`);

  // browsing a category is a sortable table
  await p.click('[data-tab=protocols]'); await p.waitForTimeout(700);
  ok(await p.locator('#results.table').count() === 1, 'browsing one kind renders a table');
  const heads = await p.locator('.thead button, .thead span').allTextContents();
  ok(/TVL/.test(heads.join(' ')) && /Fees 24h/.test(heads.join(' ')),
    `columns come from the kind descriptor (${heads.join('|')})`);
  ok(await p.locator('.row .cell').count() > 0, 'rows render as cells, not cards');

  // sorting — assert the column is actually ordered, not merely that it moved
  const colVals = async () => (await p.locator('.row .cell:nth-child(3)').allTextContents())
    .map(t => parseFloat(t.replace(/[^0-9.-]/g, '')) || 0);
  await p.locator('.thead button[data-sort=chg1d]').click(); await p.waitForTimeout(400);
  ok(await p.locator('.thead button[data-sort=chg1d]').getAttribute('aria-sort') === 'descending',
    'a column header sorts by that column');
  const desc = await colVals();
  ok(desc.every((v, i) => !i || desc[i - 1] >= v), `descending really descends (${desc.join(' ')})`);
  await p.locator('.thead button[data-sort=chg1d]').click(); await p.waitForTimeout(400);
  const asc = await colVals();
  ok(asc.every((v, i) => !i || asc[i - 1] <= v), `clicking again reverses it (${asc.join(' ')})`);
  await p.locator('.thead button[data-sort=chg1d]').click(); await p.waitForTimeout(400);
  ok(await p.locator('.thead button[data-sort=chg1d]').getAttribute('aria-sort') === null,
    'a third click clears the sort');

  // density: the one control between DefiLlama's rows and Aave's
  await p.click('#density'); await p.waitForTimeout(300);
  ok(await p.locator('#results.compact').count() === 1, 'the density toggle compacts the rows');
  await p.click('#density'); await p.waitForTimeout(300);

  // inside a category the columns survive a query
  await p.fill('#q', 'aave'); await p.waitForTimeout(700);
  ok(await p.locator('#results.table').count() === 1, 'searching within a category keeps the table');
  await p.fill('#q', ''); await p.waitForTimeout(400);

  // on All the list is a ranked mix, where the heading carries the meaning
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
  ok(await p.locator('#results.table').count() === 0, 'a ranked mix of kinds is never a table');
  await p.fill('#q', 'aave'); await p.waitForTimeout(700);
  ok(await p.locator('.gtitle').count() > 0, 'and keeps the group heading that names each kind');
  await p.fill('#q', ''); await p.waitForTimeout(400);
}

console.log('\n# per-chain and chart endpoints');
await p.click('[data-chain=sol]'); await p.waitForTimeout(1500);
ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/solana\/pools\?page=1$/),
  'a chain tab pulls that network\'s own tokens');
{
  // global assets carry no chain, so a chain filter used to empty this tab
  await p.click('[data-tab=assets]'); await p.waitForTimeout(900);
  ok(await p.locator('.row').count() > 0, 'the Assets tab is not empty under a chain filter');
  await p.click('[data-tab=all]'); await p.waitForTimeout(400);
}
await p.click('[data-chain=""]'); await p.waitForTimeout(800);
await p.fill('#q', 'bitcoin'); await p.waitForTimeout(500);
await p.locator('.row').first().click();
await p.waitForSelector('.chart svg path', { timeout: 15000 });
ok(hit(/\/coins\/bitcoin\/market_chart\?vs_currency=usd&days=1$/), 'asset chart hits /market_chart with the coin id');
ok(await p.locator('.chart svg .line').count() === 1, 'the chart draws an animated line');
{
  const head = await p.locator('.chgline').textContent();
  ok(/past 24 hours/.test(head), 'the headline names the chart range, not a fixed window');
}
await p.click('[data-days="365"]'); await p.waitForTimeout(1200);
ok(hit(/\/market_chart\?vs_currency=usd&days=365$/), 'range switch changes the days param');
ok(/past year/.test(await p.locator('.chgline').textContent()), 'the percentage follows the range');
{
  const box = await p.locator('.chart-svg').boundingBox();
  const before = await p.locator('.big').textContent();
  await p.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
  await p.waitForTimeout(220);
  ok((await p.locator('.big').textContent()) !== before, 'hovering the chart reads out that point');
  await p.mouse.move(box.x + box.width * 0.35, box.y - 80); await p.waitForTimeout(220);
  ok((await p.locator('.big').textContent()) === before, 'leaving the chart restores the headline');
}
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.fill('#q', 'kamino'); await p.waitForTimeout(600);
await p.locator('.row[data-id^="p:"]').first().click();
await p.waitForSelector('.chart svg path, .cload.err', { timeout: 15000 });
ok(hit(/^https:\/\/yields\.llama\.fi\/chart\/bb22$/), 'market chart hits /chart/{poolId}');

console.log('\n# CoinGecko refusing the origin must not empty the app');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  q.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });
  await ctx.route('https://api.coingecko.com/**', r => r.abort('failed'));   // what production reported
  await ctx.route('https://api.coinpaprika.com/**', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify(Array.from({ length: 40 }, (_, i) => ({
      id: 'pk-' + i, name: 'Paprika Coin ' + i, symbol: 'PK' + i, rank: i + 1,
      quotes: { USD: { price: 1000 / (i + 1), market_cap: 2e12 / (i + 1), volume_24h: 1e9,
        percent_change_24h: 1.5, percent_change_7d: 4.2, percent_change_30d: -3.1, percent_change_1y: 88 } } }))) }));
  await ctx.route('https://yields.llama.fi/**', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify(r.request().url().endsWith('/pools') ? llamaPools : []) }));
  await ctx.route('https://api.llama.fi/**', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await ctx.route('https://stablecoins.llama.fi/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await ctx.route('https://bridges.llama.fi/**', r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await ctx.route('https://api.geckoterminal.com/**', r => r.fulfill({ contentType: 'application/json', body: '{"data":[]}' }));
  await ctx.route('https://api.dexscreener.com/**', r => r.fulfill({ contentType: 'application/json', body: '{"pairs":[]}' }));
  await ctx.route('https://api.binance.com/**', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify(Array.from({ length: 100 }, (_, i) => [0, 0, 0, 0, String(100 + i), 0])) }));
  await q.goto(U, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 }).catch(() => {});
  const body = await q.locator('#results').textContent();
  ok(body.includes('Paprika Coin'), 'CoinPaprika carries the asset list when CoinGecko refuses');
  ok(await q.locator('.warn').count() === 0, 'a working fallback raises no warning');
  await q.locator('.row[data-id^="a:"]').first().click();
  await q.waitForSelector('.chart svg .line', { timeout: 12000 }).catch(() => {});
  ok(await q.locator('.chart svg .line').count() === 1, 'charts fall back to Binance klines');
  await ctx.close();
}

console.log('\n# a chart always draws, even with no history anywhere');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  await ctx.route('https://api.coingecko.com/**', r => r.request().url().includes('market_chart')
    ? r.abort('failed')
    : r.fulfill({ contentType: 'application/json',
        // no sparkline either, so there is genuinely nothing to draw from
        body: JSON.stringify(markets.map(({ sparkline_in_7d, ...m }) => m)) }));
  await ctx.route('https://api.binance.com/**', r => r.abort('failed'));
  for (const h of ['https://yields.llama.fi/**', 'https://api.llama.fi/**', 'https://stablecoins.llama.fi/**',
    'https://bridges.llama.fi/**', 'https://api.geckoterminal.com/**', 'https://api.dexscreener.com/**'])
    await ctx.route(h, r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await q.goto(U, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 }).catch(() => {});
  await q.locator('.row[data-id^="a:"]').first().click();
  await q.waitForSelector('.chart svg .line', { timeout: 12000 }).catch(() => {});
  ok(await q.locator('.chart svg .line').count() === 1, 'the chart still draws with every source down');
  ok(await q.locator('.nohist').count() === 1, 'and says plainly that there is no history');
  await ctx.close();
}

console.log(fail ? `\n${fail} FAILING\n` : '\nall green\n');
await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
