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
/* All, with nothing typed, is the category home now — a grid of tiles, no
   rows. Anything here that wants the mixed list has to ask for it, which is
   what a person does too. */
const UROWS = U + '?tab=assets';
const srv = spawn(process.execPath, [path.join(HERE, 'serve.mjs')],
  { env: { ...process.env, MODE: 'ok', PORT: String(PORT), REWRITE: '0' }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((res, rej) => {          // never wait forever on a server that died
  srv.stdout.once('data', res);
  srv.once('exit', c => rej(new Error('fixture server exited: ' + c)));
});

let fail = 0;
/** Clicks past the sticky search bar, which overlays what scrolls under it. */
const clickRow = (pg, sel = '#results .row:not(.sk)') =>
  pg.locator(sel).first().evaluate(el => el.click());
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fail++; };

// ---- payloads in the documented response shapes ----
const walk = (seed, n, base) => { let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const o = []; let v = base; for (let i = 0; i < n; i++) { h = (h * 1664525 + 1013904223) >>> 0; v *= 1 + ((h / 4294967296) - .5) * .02; o.push(v); } return o; };
/* Same walk, rescaled to finish exactly at `base`. History ends now, and the
   sheet takes its headline from the last point — a series that wanders away
   from the row's own number makes a chart keyed on the wrong entity look
   identical to one that is simply volatile. */
const walkTo = (seed, n, base) => { const o = walk(seed, n, base); const k = base / o[n - 1];
  return o.map(v => v * k); };
const PRICE_OF = { bitcoin: 96240, ethereum: 3412.8, 'usd-coin': 0.9999, ghostcoin: 0.5,
  'tesla-xstock': 412.6, 'apple-xstock': 241.9, 'dead-xstock': 1 };

const markets = [
  { id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://assets.coingecko.com/coins/images/1/large/bitcoin.png',
    current_price: 96240, market_cap: 1.9e12, market_cap_rank: 1, total_volume: 2.8e10,
    price_change_percentage_24h: 1.86, price_change_percentage_7d_in_currency: 5.4,
    price_change_percentage_30d_in_currency: -8.2, price_change_percentage_1y_in_currency: 62.1,
    ath: 108500, ath_change_percentage: -11.3, circulating_supply: 1.98e7, max_supply: 2.1e7,
    high_24h: 97400, low_24h: 94810, fully_diluted_valuation: 2.02e12,
    sparkline_in_7d: { price: walk('btc', 168, 96240) } },
  { id: 'ethereum', symbol: 'eth', name: 'Ethereum', image: 'https://assets.coingecko.com/coins/images/279/large/ethereum.png',
    current_price: 3412.8, market_cap: 4.11e11, market_cap_rank: 2, total_volume: 1.42e10,
    price_change_percentage_24h: -1.14, price_change_percentage_7d_in_currency: -6.8,
    price_change_percentage_30d_in_currency: 3.1, ath: 4878, ath_change_percentage: -30.0,
    circulating_supply: 1.2e8, high_24h: 3480, low_24h: 3361,
    sparkline_in_7d: { price: walk('eth', 168, 3412) } },
  { id: 'usd-coin', symbol: 'usdc', name: 'USDC', image: 'https://assets.coingecko.com/coins/images/6319/large/usdc.png',
    current_price: 0.9999, market_cap: 4.12e10, market_cap_rank: 5, total_volume: 7.1e9,
    price_change_percentage_24h: 0.01, price_change_percentage_7d_in_currency: 0.02,
    price_change_percentage_30d_in_currency: -0.01, ath: 1.17, ath_change_percentage: -14.5,
    circulating_supply: 4.12e10, high_24h: 1.0004, low_24h: 0.9994,
    sparkline_in_7d: { price: walk('usdc', 168, 1) } },
  // nothing has traded in this one for a day
  { id: 'ghostcoin', symbol: 'ghost', name: 'Ghostcoin', current_price: 0.5,
    market_cap: 9e6, market_cap_rank: 900, total_volume: 0 },
];
/* A category has to be bigger than one page, or nothing about paging or about
   sorting the whole category rather than the page of it is exercised at all.
   The rates deliberately peak in the middle of the set, where a sort that only
   ever saw the first page would never reach. */
const bulk = Array.from({ length: 140 }, (_, i) => ({
  pool: `bulk-${i}`, chain: ['Ethereum', 'Solana', 'Base', 'Arbitrum'][i % 4],
  project: ['aave-v3', 'compound-v3', 'spark', 'venus-core-pool'][i % 4],
  symbol: ['USDC', 'WETH', 'WBTC', 'USDT'][i % 4],
  tvlUsd: (4e9) / (i + 2), apyBase: 1 + (i % 5), apy: 1 + (i % 5),
  // one market, deep in the tail, pays far more than anything on the first page
  ...(i === 97 ? { apyBase: 24.5, apy: 24.5 } : {}),
  apyBaseBorrow: 2 + (i % 6), apyRewardBorrow: 0,
  totalSupplyUsd: (4e9) / (i + 2), totalBorrowUsd: (4e9) / (i + 2) * (0.2 + (i % 7) / 12),
  ltv: 0.5 + (i % 40) / 100, stablecoin: i % 4 === 0 || i % 4 === 3,
}));

// borrow fields carried on the pool itself; /lendBorrow is failed below on purpose
const llamaPools = { status: 'success', data: [
  { pool: 'aa11', chain: 'Ethereum', project: 'aave-v3', symbol: 'USDC', tvlUsd: 2.9e9, apyBase: 6.72, apyReward: 0, apy: 6.72,
    poolMeta: null, apyBaseBorrow: 8.44, apyRewardBorrow: 0, totalSupplyUsd: 2.9e9, totalBorrowUsd: 2.4e9, ltv: 0.87,
    apyMean30d: 6.1, stablecoin: true },
  { pool: 'bb22', chain: 'Solana', project: 'kamino-lend', symbol: 'SOL', tvlUsd: 8.4e8, apyBase: 6.42, apyReward: 1.2, apy: 7.62,
    poolMeta: 'main', apyBaseBorrow: 8.91, apyRewardBorrow: 0, totalSupplyUsd: 8.4e8, totalBorrowUsd: 6e8, ltv: 0.75 },
  { pool: 'cc33', chain: 'Fantom', project: 'x', symbol: 'FTM', tvlUsd: 9e8, apy: 5, apyBase: 5,
    totalSupplyUsd: 9e8, totalBorrowUsd: 1e8, ltv: .5 },   // unsupported chain, must drop
  /* Nothing supplied at all. Small is not junk — a $600k market somebody is
     using is a real answer — so this one has a zero where the activity goes. */
  { pool: 'dd44', chain: 'Ethereum', project: 'deadpool-fi', symbol: 'DEADPOOL', tvlUsd: 0,
    apy: 0, apyBase: 0, apyBaseBorrow: 0, totalSupplyUsd: 0, totalBorrowUsd: 0, ltv: .5 },
  /* Small, and perfectly real. It used to be hidden by a $1M floor, which is
     the app deciding for somebody that they did not mean it. */
  { pool: 'zz01', chain: 'Ethereum', project: 'small-fi', symbol: 'SMALLPOOL', tvlUsd: 2.2e5,
    apy: 4.4, apyBase: 4.4, apyBaseBorrow: 6, totalSupplyUsd: 2.2e5, totalBorrowUsd: 4e4, ltv: .6 },
  // 5000% APY on a small pool is the oldest farm scam there is
  { pool: 'ee55', chain: 'Ethereum', project: 'scamfarm', symbol: 'SCAMFARM', tvlUsd: 2e6,
    apy: 5000, apyBase: 5000, apyReward: 0 },
  // real farms: no borrow side, so these are the Yield category
  { pool: 'ff66', chain: 'Ethereum', project: 'curve-dex', symbol: 'USDC-USDT', tvlUsd: 4.2e8,
    apy: 9.14, apyBase: 6.14, apyReward: 3, apyMean30d: 8.72, apyPct30D: 4.8, sigma: 0.11,
    stablecoin: true, ilRisk: 'no', exposure: 'multi', rewardTokens: ['CRV'],
    predictions: { predictedClass: 'Stable', predictedProbability: 78 } },
  { pool: 'gg77', chain: 'Solana', project: 'orca', symbol: 'SOL', tvlUsd: 9.1e7,
    apy: 14.2, apyBase: 14.2, apyMean30d: 15.9, apyPct30D: -11.2, exposure: 'single', ilRisk: 'no',
    predictions: { predictedClass: 'Down', predictedProbability: 64 } },
  // a rate eight times its own month, and one the source itself flags — neither
  // looks unusual in any column the table shows
  { pool: 'hh88', chain: 'Ethereum', project: 'spike-fi', symbol: 'SPIKE', tvlUsd: 6e6,
    apy: 96, apyBase: 96, apyMean30d: 12, apyPct30D: 700 },
  { pool: 'ii99', chain: 'Ethereum', project: 'outlier-fi', symbol: 'OUTLIER', tvlUsd: 8e6,
    apy: 41, apyBase: 41, apyMean30d: 39, outlier: true },
  ...bulk,
] };

const protocols = [
  { id: '1', name: 'Aave V3', slug: 'aave-v3', category: 'Lending', chains: ['Ethereum', 'Base', 'Solana'],
    tvl: 1.9e10, change_1d: 1.2, change_7d: -3.4, url: 'https://aave.com',
    logo: 'https://icons.example/aave-v3.png' },
  { id: '4', name: 'Poison', slug: 'poison', category: 'Dex', chains: ['Ethereum'],
    tvl: 5e9, url: 'javascript:alert(document.domain)' },
  { id: '2', name: 'Kamino Lend', slug: 'kamino-lend', category: 'Lending', chains: ['Solana'],
    tvl: 2.4e9, change_1d: -0.7, change_7d: 5.1, url: 'https://app.kamino.finance',
    // an upstream string that ends up in a src, like every other one
    logo: 'javascript:alert(document.domain)' },
  // small and real: it is indexed, and there is no floor to fall under any more
  { id: '3', name: 'Tiny', slug: 'tiny', category: 'Yield', chains: ['Ethereum'], tvl: 1e5 },
  // listed, and doing nothing: no value locked, no volume, no fees
  { id: '5', name: 'Dormant Labs', slug: 'dormant', category: 'Yield', chains: ['Ethereum'], tvl: 0 },
];
const seen = [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1200, height: 900 } });
p.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });

// one route table, registered on every context that needs the real endpoints
const routes = [];
const R = (glob, fn) => routes.push([glob, fn]);

R('https://api.coingecko.com/**', r => {
  const u = r.request().url(); seen.push(u);
  if (u.includes('/market_chart')) {
    const cid = u.split('/coins/')[1].split('/')[0];
    const base = PRICE_OF[cid] ?? 1;
    const days = +(new URL(u).searchParams.get('days') || 1);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      prices: walkTo(cid + days, 100, base).map((v, i, a) => [Date.now() - (a.length - 1 - i) * 36e5, v]),
      total_volumes: walk('v' + cid, 100, 2e9).map((v, i, a) => [Date.now() - (a.length - 1 - i) * 36e5, v]) }) });
  }
  // /coins/{id}? — not /coins/markets?, which this matched and broke everything
  if (/\/coins\/(?!markets\b)[^/?]+\?/.test(u) && !u.includes('market_chart')) {
    // echo the id back, so a sheet showing the wrong entity's prose is visible
    const id = u.split('/coins/')[1].split('?')[0];
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      description: { en: `<p><a href="https://x.invalid">${id}</a> is described here `
        + 'by its own source, in prose that carries markup.</p>' } }) });
  }
  const cat = new URL(u).searchParams.get('category') || '';
  if (/tokenized-stock|xstocks/.test(cat)) {
    // the two categories overlap on purpose: the loader has to dedupe them
    const all = [
      { id: 'tesla-xstock', symbol: 'tslax', name: 'Tesla xStock', current_price: 412.6,
        market_cap: 8.4e8, market_cap_rank: 1, total_volume: 2.1e7, price_change_percentage_24h: 1.4,
        // an equity carries the same windows and high as any other asset
        price_change_percentage_7d_in_currency: 3.8, ath: 488.5, ath_change_percentage: -15.5,
        circulating_supply: 2.04e6 },
      // and one that does not, so the sheet is still seen to omit what is absent
      { id: 'apple-xstock', symbol: 'aaplx', name: 'Apple xStock', current_price: 241.9,
        market_cap: 5.2e8, market_cap_rank: 2, total_volume: 9e6, price_change_percentage_24h: -0.6 },
      { id: 'dead-xstock', symbol: 'deadx', name: 'Defunct xStock', current_price: 1,
        market_cap: 1e6, market_cap_rank: 9, total_volume: 0, price_change_percentage_24h: 0 }];
    return r.fulfill({ contentType: 'application/json',
      body: JSON.stringify(cat === 'xstocks-ecosystem' ? all : all.slice(0, 3)) });
  }
  r.fulfill({ contentType: 'application/json', body: JSON.stringify(cat ? markets.slice(0, 2) : markets) });
});
R('https://yields.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  if (u.endsWith('/pools')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify(llamaPools) });
  if (u.endsWith('/lendBorrow')) return r.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
  if (u.includes('/chart/')) {
    const id = u.split('/chart/')[1];
    const row = llamaPools.data.find(x => x.pool === id) || bulk.find(x => x.pool === id);
    const now = row ? (row.apy ?? row.apyBase ?? 6) : 6;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      data: walkTo('p' + id, 120, now).map((v, i) => ({ timestamp: i, apy: v, tvlUsd: 1e8 })) }) });
  }
  r.fulfill({ status: 404, body: '{}' });
});
R('https://api.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  const J = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  if (u.includes('/overview/dexs')) return J({ protocols: [{ name: 'Aave V3', total24h: 1.2e9 }] });
  if (u.includes('/overview/fees')) return J({ protocols: [{ name: 'Aave V3', total24h: 3.4e6, revenue24h: 9.1e5 }] });
  if (u.includes('/v2/chains')) return J([{ name: 'Ethereum', tvl: 6.2e10 }, { name: 'Solana', tvl: 9.4e9 }]);
  if (u.includes('/v2/historicalChainTvl/')) {
    const name = decodeURIComponent(u.split('/historicalChainTvl/')[1]);
    const now = { Ethereum: 6.2e10, Solana: 9.4e9 }[name] ?? 5e10;
    return J(walkTo('ch' + name, 200, now).map((v, i) => ({ date: i, tvl: v })));
  }
  if (u.includes('/protocol/')) {
    const slug = u.split('/protocol/')[1];
    const now = protocols.find(x => x.slug === slug)?.tvl ?? 1e9;
    return J({ description: `<p>${slug} is described by its own source.</p>`,
      tvl: walkTo('pr' + slug, 200, now).map((v, i) => ({ date: i, totalLiquidityUSD: v })) });
  }
  if (u.endsWith('/protocols')) return J(protocols);
  if (u.includes('/overview/derivatives')) return J({ protocols: [{ name: 'Aave V3', total24h: 4.2e8 }] });
  if (u.includes('/overview/options')) return J({ protocols: [{ name: 'Aave V3', total24h: 1.1e7 }] });
  if (u.endsWith('/raises')) return J({ raises: [
    // a row with no amount and no date is a row with nothing in it
    { name: 'Undisclosed Co', round: 'Seed', amount: 0, chains: [], sector: 'DeFi',
      leadInvestors: [], otherInvestors: [] },
    { date: Math.floor(Date.now() / 1000) - 86400,
    name: 'Ondo Finance', round: 'Series A', amount: 20, chains: ['Ethereum'], sector: 'RWA',
    leadInvestors: ['Pantera'], otherInvestors: ['Coinbase Ventures'], valuation: 4e9,
    source: 'https://example.invalid' }] });
  if (u.endsWith('/hacks')) return J([
    { name: 'Unquantified incident', amount: 0, classification: 'Other', chains: [] },
    { date: Math.floor(Date.now() / 1000) - 86400 * 5,
    name: 'Curve Finance exploit', amount: 6.1e7, technique: 'Reentrancy', chains: ['Ethereum'] }]);
  r.fulfill({ status: 404, body: '[]' });
});
R('https://stablecoins.llama.fi/**', r => {
  seen.push(r.request().url());
  if (r.request().url().includes('/stablecoincharts/'))
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify(
      walkTo('sc', 200, 4.1e10).map((v, i) => ({ date: i, totalCirculating: { peggedUSD: v } }))) });
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ peggedAssets: [
    { id: '1', symbol: 'USDC', name: 'USD Coin', circulating: { peggedUSD: 4.1e10 },
      price: 1.0001, pegMechanism: 'fiat-backed', chains: ['Ethereum'] },
    // it still calls itself a dollar; it has not been one for a while
    { id: '9', symbol: 'DEADUSD', name: 'Collapsed Dollar', circulating: { peggedUSD: 2.4e7 },
      price: 0.118, pegMechanism: 'algorithmic', chains: ['Ethereum'] }] }) });
});
R('https://bridges.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  const J = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
  // deposits and withdrawals are summed, and the series has to land on the
  // reported day so the sheet's headline agrees with the row it came from
  if (u.includes('/bridgevolume/')) return J(walk('bv', 200, 2.1e8)
    .map((v, i, a) => ({ date: i, depositUSD: v * (2.1e8 / a[a.length - 1]),
      withdrawUSD: v * (2.1e8 / a[a.length - 1]) })));
  J({ bridges: [
    { id: 1, displayName: 'Across', chains: ['Ethereum', 'Base'], lastDailyVolume: 4.2e8, volumePrev2Day: 3.9e8 }] });
});
R('https://api.dexscreener.com/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ pairs: [{
    chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR1', url: 'https://dexscreener.com/solana/PAIR1',
    baseToken: { address: 'CATaddr', name: 'CashCat', symbol: 'CASHCAT' }, quoteToken: { symbol: 'USDC' },
    info: { imageUrl: 'https://img.example/cashcat.png' },
    priceUsd: '0.00000042', priceChange: { h24: 31.4 }, liquidity: { usd: 9.1e5 },
    volume: { h24: 4.2e6 }, fdv: 2.1e7 }, {
    chainId: 'berachain', dexId: 'kodiak', pairAddress: 'BERAPAIR',
    baseToken: { address: 'bera1', name: 'BeraToken', symbol: 'BERATOK' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '2', liquidity: { usd: 8e5 }, volume: { h24: 9e5 } }, {
    chainId: 'fantom', dexId: 'spooky', pairAddress: 'PAIR2',
    baseToken: { address: 'x', name: 'Unsupported', symbol: 'NOPE' }, quoteToken: { symbol: 'USDC' },
    // it trades: this row is about chain coverage, not about being filtered
    priceUsd: '1', liquidity: { usd: 9e5 }, volume: { h24: 5e4 } }, {
    chainId: 'solana', dexId: 'raydium', pairAddress: 'PAIR3',
    baseToken: { address: 'y', name: 'Dust', symbol: 'DUST' },
    priceUsd: '1', liquidity: { usd: 100 } }, {
    // the same ticker twice on one network: one token, one copy
    chainId: 'solana', dexId: 'raydium', pairAddress: 'TWINDEEP',
    baseToken: { address: 'tw1', name: 'TwinCat', symbol: 'TWINCAT' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '1', liquidity: { usd: 8e5 }, volume: { h24: 2e6 } }, {
    chainId: 'solana', dexId: 'raydium', pairAddress: 'TWINSHALLOW',
    baseToken: { address: 'tw2', name: 'TwinCat', symbol: 'TWINCAT' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '1', liquidity: { usd: 9e3 }, volume: { h24: 4e3 } }, {
    // the depth rule would drop this one too, but its contract is on a registry
    chainId: 'solana', dexId: 'raydium', pairAddress: 'VOUCHEDSHALLOW',
    baseToken: { address: 'vouched2', name: 'Vouched', symbol: 'VOUCHED' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '1', liquidity: { usd: 7e3 }, volume: { h24: 3e3 } }, {
    chainId: 'solana', dexId: 'raydium', pairAddress: 'VOUCHEDDEEP',
    baseToken: { address: 'vouched1', name: 'Vouched', symbol: 'VOUCHED' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '1', liquidity: { usd: 9e5 }, volume: { h24: 2e6 } }, {
    // wearing a listed ticker without the liquidity to be it
    chainId: 'solana', dexId: 'raydium', pairAddress: 'FAKEBTC',
    baseToken: { address: 'fk', name: 'Bitcoin', symbol: 'BTC' }, quoteToken: { symbol: 'USDC' },
    priceUsd: '0.004', liquidity: { usd: 9e3 }, volume: { h24: 5e3 } }, {
    /* A deep pool, heavy volume, a dollar quote — every number Atlas can see
       says healthy market, and the contract will not let you sell. Only
       reading the contract catches this one. */
    chainId: 'ethereum', dexId: 'uniswap', pairAddress: 'HONEYPAIR',
    baseToken: { address: '0xhoneypot1', name: 'HoneyCat', symbol: 'HONEYCAT' },
    quoteToken: { symbol: 'USDC' },
    priceUsd: '0.02', liquidity: { usd: 1.4e6 }, volume: { h24: 3e6 } }, {
    // volume forty times the pool that produced it: the same coins going round
    chainId: 'ethereum', dexId: 'uniswap', pairAddress: 'WASHPAIR',
    baseToken: { address: '0xwash1', name: 'WashCat', symbol: 'WASHCAT' },
    quoteToken: { symbol: 'USDC' },
    priceUsd: '0.5', liquidity: { usd: 3e5 }, volume: { h24: 6e7 } }] }) });
});
R('https://api.geckoterminal.com/**', r => {
  const u = r.request().url(); seen.push(u);
  const pool = (id, name, addr) => ({ id, type: 'pool',
    relationships: { base_token: { data: { id: 'tk' + name.split(' ')[0], type: 'token' } } },
    attributes: { name, address: addr, base_token_price_usd: '0.9',
      price_change_percentage: { h24: '12.5' }, reserve_in_usd: '3200000',
      volume_usd: { h24: '8100000' }, fdv_usd: '41000000' } });
  if (u.includes('/search/pools')) {
    const q = new URL(u).searchParams.get('query') || '';
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      data: /cashcat/i.test(q) ? [pool('solana_GTCASH', 'CASHCAT / USDC', 'GTCASHaddr')] : [],
      // JSON:API keeps the token, and its logo, beside the pool
      included: [{ id: 'tkGTCASH', type: 'token',
        attributes: { image_url: 'https://img.example/gtcash.png' } }] }) });
  }
  if (/\/networks\/[^/]+\/pools/.test(u)) {          // that chain's own tokens
    /* Every network answers with its own tokens, never a copy of the last
       one's — six identical answers would make six requests look like one. */
    const net = /\/networks\/([^/]+)\/pools/.exec(u)[1];
    const tag = net === 'solana' ? '' : net.toUpperCase().slice(0, 3);
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({
      data: Array.from({ length: 8 }, (_, i) =>
        // one in four keeps a moving quote, so the rule that drops those is
        // still being exercised rather than being switched off wholesale
        pool(`${net}_C${i}`, `${tag}CHAINTOK${i} / ${i % 4 === 3 ? 'SOL' : 'USDC'}`,
          `${tag.toLowerCase()}chainaddr${i}`)),
      included: Array.from({ length: 8 }, (_, i) => ({ id: `tk${tag}CHAINTOK${i}`, type: 'token',
        // one hostile scheme among them: an upstream string reaching a src
        attributes: { image_url: i === 3 ? 'javascript:alert(1)' : `https://img.example/c${i}.png` } })) }) });
  }
  r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ data: [pool('solana_TREND', 'TRENDY / USDC', 'TRENDaddr')],
      included: [{ id: 'tkTRENDY', type: 'token',
        attributes: { image_url: 'https://img.example/trendy.png' } }] }) });
});
/* The two registries that say which token is real, Morpho's own markets, and
   daily bridge volume. Shapes are from each provider's published docs; this
   sandbox cannot reach any of them to confirm, so every one of these is optional
   enrichment in the app and a failure here must change nothing. */
R('https://tokens.uniswap.org', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ name: 'Uniswap Labs Default', tokens: [
    { chainId: 1, address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USD Coin', decimals: 6 },
    { chainId: 8453, address: '0x4200000000000000000000000000000000000006', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 },
  ] }) });
});
R('https://lite-api.jup.ag/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { id: 'So11111111111111111111111111111111111111112', symbol: 'SOL', name: 'Wrapped SOL', isVerified: true },
    // the shallow half of a duplicated ticker, named by its contract: a registry
    // answer has to beat the depth heuristic that would otherwise drop it
    { id: 'vouched2', symbol: 'VOUCHED', name: 'Vouched', isVerified: true },
    // the ticker of something the long tail impersonates. Matching on this
    // would have waved a fake BTC straight past the rule meant to catch it.
    { id: 'RealBTCmint', symbol: 'BTC', name: 'Bitcoin (Portal)', isVerified: true },
  ]) });
});
R('https://api.morpho.org/**', r => {
  seen.push(r.request().url() + '|' + (r.request().method()));
  r.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { markets: { items: [
    { uniqueKey: '0xmorphoA', lltv: '860000000000000000',
      loanAsset: { symbol: 'USDC' }, collateralAsset: { symbol: 'wstETH' },
      morphoBlue: { chain: { id: 1 } },
      state: { supplyApy: 0.0512, borrowApy: 0.0734, supplyAssetsUsd: 7.4e8, borrowAssetsUsd: 5.1e8, utilization: 0.69 } },
    { uniqueKey: '0xmorphoB', lltv: '770000000000000000',
      loanAsset: { symbol: 'WETH' }, collateralAsset: { symbol: 'cbBTC' },
      morphoBlue: { chain: { id: 8453 } },
      state: { supplyApy: 0.0288, borrowApy: 0.0455, supplyAssetsUsd: 2.2e8, borrowAssetsUsd: 1.4e8, utilization: 0.63 } },
    // below the ingest floor, and on a chain the app does not carry
    { uniqueKey: '0xmorphoC', lltv: '0', loanAsset: { symbol: 'TINY' },
      morphoBlue: { chain: { id: 999999 } },
      state: { supplyApy: 0.9, borrowApy: 1, supplyAssetsUsd: 100, borrowAssetsUsd: 0 } },
  ] } } }) });
});

R('https://nft.llama.fi/**', r => {
  const u = r.request().url(); seen.push(u);
  // reported live: this endpoint answers for some collections and not others
  if (u.includes('/chart/')) return r.fulfill({ contentType: 'application/json',
    body: JSON.stringify(/0xpoly/.test(u) ? []
      : walkTo('nf', 120, 42300).map((v, i) => ({ timestamp: i, floorPriceUSD: v }))) });
  r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { collectionId: '0xbayc', name: 'Bored Ape Yacht Club', symbol: 'BAYC', chain: 'Ethereum',
      image: 'https://img.example/bayc.png',
      floorPrice: 12.4, floorPriceUSD: 42300, floorPricePctChange1Day: -2.1,
      floorPricePctChange7Day: 5.4, dailyVolumeUSD: 3.1e6, totalSupply: 10000 },
    // never traded, no floor: a name in a list
    { collectionId: '0xghost', name: 'Ghost Collection', symbol: 'GHOST', chain: 'Ethereum',
      image: null, floorPrice: 0, floorPriceUSD: 0, dailyVolumeUSD: 0, totalSupply: 1000 },
    { collectionId: '0xpoly', name: 'Polygon Apes', symbol: 'PAPE', chain: 'Polygon',
      floorPrice: 240, floorPricePctChange1Day: 1.1, totalSupply: 5000 },
    { collectionId: '0xnofloor', name: 'No Floor Collection', symbol: 'NOPE', chain: 'Ethereum' }]) });
});
R('https://api-mainnet.magiceden.dev/**', r => {
  seen.push(r.request().url());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify([
    { symbol: 'mad_lads', name: 'Mad Lads', image: null, floorPrice: 118e9, volumeAll: 9.2e11 }]) });
});
/* A tokenized share's About is about the company, so it comes from Wikipedia
   under the company's own name — the wrapper's name must never reach here. */
R('https://en.wikipedia.org/api/rest_v1/page/summary/**', r => {
  seen.push(r.request().url());
  const title = decodeURIComponent(r.request().url().split('/').pop());
  r.fulfill({ contentType: 'application/json', body: JSON.stringify(
    { type: 'standard', title, extract: `${title} is a company described by Wikipedia. It does things.` }) });
});
/* GoPlus, in both its vocabularies. The address decides the answer, so one
   route covers a clean token, a honeypot and an address it has never seen. */
R('https://api.gopluslabs.io/**', r => {
  const u = r.request().url(); seen.push(u);
  /* The endpoint takes a comma-separated list and answers one entry per
     address — which is the whole reason a warning on the row is affordable, so
     the fixture has to answer that way rather than as one blob. */
  const list = (new URL(u).searchParams.get('contract_addresses') || '').toLowerCase()
    .split(',').filter(Boolean);
  const sol = u.includes('/solana/');
  const on = v => v ? '1' : '0';
  const result = {};
  for (const a of list) {
    const evil = /honey|scam|fake/.test(a), mint = /trend|cash/.test(a);
    result[a] = sol
      ? { mintable: { status: on(mint) }, freezable: { status: on(evil) },
          balance_mutable_authority: { status: on(evil) }, metadata_mutable: { status: on(mint) },
          trusted_token: on(!evil), holder_count: '41200' }
      : { is_open_source: on(!evil), is_mintable: on(mint), owner_change_balance: on(evil),
          is_honeypot: on(evil), is_blacklisted: on(evil), transfer_pausable: on(evil),
          is_whitelisted: '0', hidden_owner: '0', selfdestruct: '0', is_proxy: '0',
          buy_tax: evil ? '0.15' : '0', sell_tax: evil ? '0.35' : '0',
          trust_list: on(!evil), holder_count: '88400', lp_holder_count: '640' };
  }
  r.fulfill({ contentType: 'application/json',
    body: JSON.stringify({ code: 1, message: 'OK', result }) });
});
R('https://assets.coingecko.com/**', r => r.fulfill({ status: 200, contentType: 'image/png', body: '' }));

for (const [glob, fn] of routes) await p.route(glob, fn);

console.log(`\n# production endpoints (${PAGE})`);
await p.goto(UROWS); await p.waitForSelector('.row:not(.sk)', { timeout: 20000 });
const hit = re => seen.some(u => re.test(u));
ok(hit(/^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/markets\?/), 'CoinGecko /coins/markets');
ok(hit(/vs_currency=usd/) && hit(/sparkline=true/) && hit(/price_change_percentage=24h/), 'markets query params');
ok(hit(/^https:\/\/yields\.llama\.fi\/pools$/), 'DeFiLlama /pools');
ok(hit(/^https:\/\/yields\.llama\.fi\/lendBorrow$/), 'DeFiLlama /lendBorrow');

console.log('\n# real payloads render');
const txt = await p.locator('#results').textContent();
ok(txt.includes('Bitcoin') && txt.includes('$96,240'), 'CoinGecko fields map to asset rows');
// pools live under their own tab now that All is a category home
await p.click('[data-tab=lending]'); await p.waitForSelector('.row[data-id^="p:"]', { timeout: 20000 });
const ytxt = await p.locator('#results').textContent();
ok(ytxt.includes('Aave V3') || ytxt.includes('Aave v3'), 'DeFiLlama project name is humanised');
ok(!ytxt.includes('FTM'), 'pool on an unsupported chain is dropped');
ok(await p.locator('.warn').count() === 0, '/lendBorrow failing alone is not an error');
ok(ytxt.includes('6.72%'), 'borrow fields read off the pool when /lendBorrow is down');

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
ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/trending_pools\?page=1&include=base_token$/),
  'GeckoTerminal /trending_pools, with the token beside the pool');
/* Trending alone is whichever chain is loud today, so a quiet chain could be
   missing from the category altogether. The busiest pools per network are the
   other half of the index. */
{
  const nets = ['eth', 'solana', 'base', 'arbitrum', 'bsc', 'polygon_pos']
    .filter(n => seen.some(u => u.includes(`/networks/${n}/pools?page=1`)));
  ok(nets.length === 6, `each big network is asked for its own busiest pools (${nets.join(' ')})`);
}
ok(hit(/^https:\/\/nft\.llama\.fi\/collections$/), 'DeFiLlama NFT /collections');
ok(hit(/^https:\/\/api-mainnet\.magiceden\.dev\/v2\/marketplace\/popular_collections$/), 'Magic Eden /popular_collections');
{
  await p.click('[data-tab=nfts]');
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
  await p.locator('.row[data-id^="n:"]').first().evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="nft"]', { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(hit(/^https:\/\/nft\.llama\.fi\/chart\/0xbayc$/), 'floor history hits /chart/{collectionId}');
  ok(await p.locator('.chart svg .line').count() === 1, 'an NFT collection charts its floor');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // the collection whose history endpoint gives back nothing
  await p.fill('#q', 'polygon apes'); await p.waitForTimeout(900);
  await p.locator('.row[data-id="n:0xpoly"]').evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="nft"]', { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(await p.locator('.chart svg .line').count() === 1, 'a collection with no history still charts');
  ok(await p.locator('.nohist').count() === 0, 'from the floor moves it already reports');
  ok(/reported 1d and 7d moves/.test(await p.locator('.chgline').textContent()),
    'and says that is where the line came from');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.click('[data-tab=all]'); await p.waitForTimeout(400);
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
  ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/search\/pools\?query=cashcat&page=1&include=base_token$/),
    'GeckoTerminal /search/pools queried alongside DexScreener');
  ok(await p.locator('.row[data-id^="d:GTCASH"]').count() > 0, 'both DEX indexes contribute results');
  // toPrecision goes exponential under 1e-6 — the long tail trades right there
  ok(/\$0\.00000042/.test(body) && !/e-7/.test(body), 'a sub-cent price shows its zeros, not scientific notation');
  await p.fill('#q', '$cashcat'); await p.waitForTimeout(1200);
  ok(await p.locator('.row[data-id^="d:"]').count() > 0, 'a $-prefixed ticker still resolves');
  ok((await p.locator('.gtitle').allTextContents()).filter(x => x === 'DEX pairs').length <= 1,
    'live DEX results merge into one group');
  await p.locator('.row[data-id^="d:"]').first().evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="pair"]', { timeout: 8000 });
  ok((await p.locator('.sheet').textContent()).includes('Liquidity'), 'DEX pair opens a real sheet');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.waitForTimeout(400);
}
{
  await p.fill('#q', 'pantera'); await p.waitForTimeout(500);
  ok(await p.locator('.row[data-id^="f:"]').count() > 0, 'funding rounds are searchable by investor');
  await p.locator('.row[data-id^="f:"]').first().evaluate(el => el.click());
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
  await p.click('[data-tab=protocols]');
  await p.waitForSelector('.row[data-id^="r:"]', { timeout: 20000 }).catch(() => {});
  const body = await p.locator('#results').textContent();
  ok(body.includes('Aave V3'), 'protocols render as their own kind');
  ok(body.includes('Tiny'), 'a small protocol is small, not junk');
  ok(!body.includes('Dormant'), 'and one with no TVL, no volume and no fees is dropped');
  await p.click('[data-tab=networks]');
  await p.waitForSelector('.row[data-id^="c:"]', { timeout: 20000 }).catch(() => {});
  ok((await p.locator('#results').textContent()).includes('Ethereum'), 'networks render with live TVL');
  // the chain row destructured one field too far, so every network read $0
  await p.fill('#q', 'ethereum'); await p.waitForTimeout(600);
  const net = await p.locator('.row[data-id="c:eth"]').textContent();
  ok(/\$62\.00B/.test(net), `a network carries its real TVL (${net.trim().slice(0, 60)})`);
  await p.locator('.row[data-id="c:eth"]').evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="chain"]', { timeout: 8000 });
  await p.waitForSelector('.chart svg .line', { timeout: 10000 }).catch(() => {});
  ok(hit(/\/v2\/historicalChainTvl\/Ethereum$/), 'a network charts its own TVL history');
  ok(await p.locator('.chart svg .line').count() === 1, 'the network sheet draws a chart');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  await p.fill('#q', ''); await p.click('[data-tab=all]'); await p.waitForTimeout(400);
}

console.log('\n# upstream strings that end up in an href');
{
  await p.fill('#q', 'poison'); await p.waitForTimeout(700);
  await p.locator('.row[data-id="r:poison"]').first().evaluate(el => el.click());
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
await p.locator('.row[data-id^="r:"]').first().evaluate(el => el.click());
await p.waitForSelector('.sheet-in[data-kind="protocol"]', { timeout: 10000 });
ok(hit(/\/protocol\/aave-v3$/), 'protocol chart hits /protocol/{slug}');
{
  const sheet = await p.locator('.sheet').textContent();
  ok(/24h DEX volume|24h fees/.test(sheet), 'DEX volume and fees join onto the protocol');
  ok(/Runs on/.test(sheet), 'protocol lists the chains it runs on');
}
await p.keyboard.press('Escape'); await p.waitForTimeout(400);
await p.fill('#q', 'kamino'); await p.waitForTimeout(600);
await p.locator('.row[data-id^="p:"]').first().evaluate(el => el.click());
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
  // >= rather than a pinned count: adding a kind should not break this, but
  // losing a category still should
  const rail = await p.locator('#rail [data-tab]').allTextContents();
  ok(rail.length >= 14, `rail lists every kind plus All and Saved (${rail.length})`);
  for (const cat of ['Networks', 'Exploits', 'Tokenized stocks', 'Bridges', 'NFT collections'])
    ok(rail.some(r => r.includes(cat)), `${cat} has its own category`);
  ok(await p.locator('#rail [data-tab=protocols] .ct').textContent() !== '',
    'a category carries its row count');


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

  // the density switch is gone — one row height, chosen rather than offered
  ok(await p.locator('#density').count() === 0, 'no density control is left to get out of sync');

  // inside a category the columns survive a query
  await p.fill('#q', 'aave'); await p.waitForTimeout(700);
  ok(await p.locator('#results.table').count() === 1, 'searching within a category keeps the table');
  await p.fill('#q', ''); await p.waitForTimeout(400);

  // on All the list is a ranked mix, where the heading carries the meaning
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
  ok(await p.locator('#results.home .hcard').count() > 0, 'All with nothing typed is the category home');
  ok(await p.locator('#results.table').count() === 0, 'a ranked mix of kinds is never a table');
  await p.fill('#q', 'aave'); await p.waitForTimeout(700);
  ok(await p.locator('.gtitle').count() > 0, 'and keeps the group heading that names each kind');
  await p.fill('#q', ''); await p.waitForTimeout(400);
}

console.log('\n# tokenized stocks are their own kind');
{
  await p.click('[data-tab=stocks]'); await p.waitForTimeout(900);
  await p.waitForSelector('.row[data-id^="t:"]', { timeout: 20000 }).catch(() => {});
  ok(hit(/category=tokenized-stock/) && hit(/category=xstocks-ecosystem/),
    'both stock categories are asked, so one slug drifting is survivable');
  const ids = await p.locator('#results .row').evaluateAll(ns => ns.map(n => n.dataset.id));
  ok(ids.length && ids.every(i => i.startsWith('t:')), `the tab holds only equities (${ids.length})`);
  ok(new Set(ids).size === ids.length, 'and the overlapping categories are deduped');
  const body = await p.locator('#results').textContent();
  ok(/tracks TSLA\b/.test(body), `an equity says what it tracks (${body.slice(0, 40).trim()})`);
  ok(!/Defunct/.test(body), 'and one that stopped trading is filtered like anything else');

  // the old stocks switch is gone: the rail is the only way in, and it says so
  ok(await p.locator('#stocks').count() === 0, 'no separate stocks switch to fall out of step');
  ok(/tab=stocks/.test(p.url()), 'the view is in the url');
  await p.click('[data-tab=all]'); await p.waitForTimeout(700);
  ok(await p.locator('[data-tab=stocks]').getAttribute('aria-selected') === 'false',
    'and leaving by the rail deselects it');
}

console.log('\n# things that do not trade, or are not what they say, never show');
{
  const shown = async q => {
    await p.fill('#q', q); await p.waitForTimeout(1400);
    return p.evaluate(() => [...document.querySelectorAll('#results .row')].map(r => r.dataset.id));
  };
  const junk = [
    ['ghostcoin', 'a:ghostcoin', 'an asset nothing has traded'],
    ['deadpool', 'p:dd44', 'a lending market with nothing in it'],
    ['scamfarm', 'y:ee55', 'a four-figure APY on a small pool'],
    ['twincat', 'd:TWINSHALLOW', 'the shallower copy of a duplicated ticker'],
    ['bitcoin', 'd:FAKEBTC', 'a pair wearing a listed ticker it cannot back'],
  ];
  for (const [q, id, what] of junk) {
    const ids = await shown(q);
    ok(!ids.includes(id), `hides ${what}`);
  }
  // the deep half of the duplicate is the one that survives
  ok((await shown('twincat')).includes('d:TWINDEEP'), 'and keeps the real one');
  /* Junk is duplicates, scams, zeroes and bots — never size. A $220k market is
     a real answer to somebody searching for it, and a floor was throwing away
     exactly the long tail this app exists to index. */
  ok((await shown('smallpool')).includes('p:zz01'), 'and keeps a small market that is simply small');
  // and cashcat, the long tail this app exists for, is not collateral damage
  // two indexes carry this same token; neither may be mistaken for a copy
  const cc = await shown('cashcat');
  ok(cc.includes('d:PAIR1') && cc.some(i => i.startsWith('d:GTCASH')),
    `the same real token from two indexes survives (${cc.filter(i => i[0] === 'd').join(' ')})`);

  // hiding is not something to advertise or to offer as a choice
  ok(await p.locator('#safe').count() === 0, 'there is no toggle left to leave in the wrong state');
  ok(!/hidden/.test(await p.locator('#meta').textContent()), 'and no running tally of what it hid');
  await p.fill('#q', ''); await p.waitForTimeout(600);
}

console.log('\n# a row belongs to exactly one category');
{
  await p.click('[data-chain=sol]'); await p.waitForTimeout(2200);
  const ids = await p.locator('#results .row[data-id^="d:"]').evaluateAll(ns => ns.map(n => n.dataset.id));
  // listing a chain's tokens under Assets as well as DEX pairs counted them
  // twice, and the duplicates ate half the per-kind slice
  ok(new Set(ids).size === ids.length, 'no row is rendered twice');
  ok(ids.length >= 5, `the DEX group fills with distinct pairs, not duplicates (${ids.length})`);
  ok(hit(/\/networks\/solana\/pools/), 'those pairs are that chain\'s own tokens');
  await p.click('[data-chain=""]'); await p.waitForTimeout(900);
}

console.log('\n# an empty category says which one');
{
  await p.click('[data-tab=bridges]'); await p.waitForTimeout(600);
  await p.click('[data-chain=apt]'); await p.waitForTimeout(900);
  const t = await p.locator('.empty').textContent().catch(() => '');
  ok(/No bridges on Aptos/.test(t), `an empty category names itself and the chain (${t.slice(0, 46)})`);
  ok(await p.locator('[data-allchains]').count() === 1, 'and offers the way out of the filter');
  await p.click('[data-allchains]'); await p.waitForTimeout(700);
  ok(await p.locator('.row').count() > 0, 'which clears the chain filter');
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a row shows the logo its source already sent');
{
  /* Four kinds had a logo available upstream and were drawing coloured initials
     instead. Image hosts are unreachable from here and the tag removes itself
     on error, so serve a byte back or nothing can be counted. */
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const asked = [];
  const imageRoute = r => {
    if (r.request().resourceType() !== 'image') return r.fallback();
    asked.push(r.request().url());
    return r.fulfill({ contentType: 'image/png', body: PNG });
  };
  await p.route('**', imageRoute);
  const has = async tab => {
    await p.click(`[data-tab="${tab}"]`); await p.waitForTimeout(1100);
    return p.evaluate(() => [...document.querySelectorAll('#results .row:not(.sk)')]
      .filter(r => r.querySelector('.tok img')).length);
  };
  ok(await has('assets') > 0, 'an asset carries its CoinGecko logo');
  ok(await has('nfts') > 0, 'a collection carries its own image');
  // DeFiLlama returns a protocol logo, and a market's tile stands for the
  // protocol running it — both were being thrown away
  ok(await has('protocols') > 0, 'a protocol carries the logo DeFiLlama returned');
  ok(await has('lending') > 0, 'and a market inherits it from the protocol behind it');
  await p.click('[data-tab=dex]'); await p.waitForTimeout(1100);
  ok(hit(/trending_pools\?.*include=base_token/), 'a DEX pool asks for the token beside it');
  ok(await p.locator('#results .row .tok img').count() > 0, 'which is what carries the pair logo');
  // a stablecoin is nearly always also a listed asset, whose logo is loaded already
  await p.click('[data-tab=stables]'); await p.waitForTimeout(1000);
  ok(await p.locator('#results .row .tok img').count() > 0,
    'a stablecoin borrows the logo of the asset it also is');

  // every one of these is an upstream string reaching a src
  ok(!asked.some(u => /^javascript:/.test(u)), 'and a hostile scheme never reaches a src');
  await p.unroute('**', imageRoute);
  await p.click('[data-tab=all]'); await p.waitForTimeout(600);
}

console.log('\n# a network is described by the token that secures it');
{
  await p.click('[data-tab=networks]'); await p.waitForTimeout(900);
  await p.locator('.row[data-id="c:eth"]').evaluate(el => el.click()); await p.waitForTimeout(1600);
  const src = p.locator('.sheet-in [data-src]');
  ok(await src.count() === 1 && !(await src.isHidden()), 'a chain sheet carries source prose');
  ok(/ethereum/i.test(await src.textContent()),
    'from the CoinGecko page of its own token, not another chain\'s');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);

  await p.click('[data-tab=stocks]'); await p.waitForTimeout(900);
  await p.locator('.row[data-id="t:tesla-xstock"]').evaluate(el => el.click()); await p.waitForTimeout(1400);
  const t = await p.locator('.sheet-in .stats').textContent();
  // the equity request carries the same windows and high as any other asset,
  // and the sheet was showing four of them
  ok(/7d/.test(t) && /All-time high/.test(t),
    `an equity sheet shows the fields its row carries (${t.replace(/\s+/g, ' ').trim().slice(0, 90)})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.locator('.row[data-id="t:apple-xstock"]').evaluate(el => el.click()); await p.waitForTimeout(1400);
  const u = await p.locator('.sheet-in .stats').textContent();
  ok(!/All-time high/.test(u), 'and omits the ones its source did not send');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a zero is not a gap, and a gap is not a zero');
{
  await p.click('[data-tab=assets]'); await p.waitForTimeout(900);
  const usdc = await p.locator('.row[data-id="a:usd-coin"]').textContent();
  // 0.02% renders as +0.02%; only a field the source did not send is an em dash
  ok(!/—/.test(usdc), `a change of nearly nothing still prints a number (${usdc.replace(/\s+/g, ' ').trim().slice(0, 76)})`);
  const ghost = await p.locator('.row[data-id="a:ghostcoin"]').count();
  ok(ghost === 0 || /—/.test(await p.locator('.row[data-id="a:ghostcoin"]').textContent()),
    'while a field the source omitted still reads as missing');

  await p.click('[data-tab=lending]'); await p.waitForTimeout(1000);
  // borrow rate is net of incentives, so a missing base minus a reward printed
  // "-0.90% borrow" on a market nobody can borrow from
  const cells = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .map(r => [...r.querySelectorAll('.cell')][1]?.textContent.trim()));
  ok(!cells.some(c => c && /^-/.test(c)), 'no market invents a negative borrow rate');
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a pair belongs to a network under either index\'s name');
{
  // DexScreener says "berachain", GeckoTerminal says "eth" — two tables drifted,
  // and a pair on a chain neither covered was invisible to every network filter
  // GeckoTerminal ids the network as "solana"/"eth"; DexScreener says
  // "berachain". Two tables drifted, and a pair on a chain the DEX one did not
  // list resolved to nothing — no badge, and invisible to every network filter.
  await p.click('[data-tab=dex]'); await p.waitForTimeout(1200);
  const gt = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .filter(r => /TRENDaddr|GTCASH/.test(r.dataset.id))
    .map(r => !!r.querySelector('.tok .badge')));
  ok(gt.length > 0 && gt.every(Boolean), `a GeckoTerminal pair resolves to a network (${gt.length})`);

  await p.fill('#q', 'beratok'); await p.waitForTimeout(1700);
  const bera = p.locator('.row[data-id="d:BERAPAIR"]');
  ok(await bera.count() === 1, 'a Berachain pair is indexed');
  ok(await bera.locator('.tok .badge').count() === 1,
    'and resolves to Berachain, which the old eleven-entry table did not carry');
  ok(/Berachain/.test(await bera.textContent()), 'named, not left as a raw slug');

  // a chain neither table knows keeps its own network name and stays indexed
  await p.fill('#q', 'unsupported'); await p.waitForTimeout(1600);
  ok(await p.locator('.row[data-id="d:PAIR2"]').count() === 1,
    'while a chain outside the set is still indexed under its own name');
  await p.fill('#q', ''); await p.waitForTimeout(700);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a sentence is read into the controls, and can be taken back');
{
  const read = async q => {
    await p.fill('#q', q); await p.waitForTimeout(2200);
    return { tab: await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab'),
      chips: (await p.locator('#facetbar').textContent()).replace(/\s+/g, ' ').trim(),
      chain: new URL(p.url()).searchParams.get('chain') };
  };
  const r = await read('cat meme coin on base up 50% or more in the past 24 hours');
  ok(r.tab === 'dex', `a memecoin question lands on DEX pairs, not Assets (${r.tab})`);
  ok(r.chain === 'base', `the network in the sentence becomes the network filter (${r.chain})`);
  ok(/50/.test(r.chips) && /24h/.test(r.chips), `and the threshold is stated, not applied silently (${r.chips.slice(0, 80)})`);
  ok(/cat/.test(r.chips), 'with only the leftover words searched for');
  const rows = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .map(x => x.dataset.id));
  ok(rows.every(id => id.startsWith('d:')), `every row is the kind it asked for (${rows.length})`);

  // a reading must not leak into the next question
  const r2 = await read('exploits over $50m');
  ok(r2.tab === 'hacks' && !r2.chain,
    `the next sentence starts clean, not on the last one's network (${r2.tab}/${r2.chain})`);

  // and a name is a name: reading "coin" as a category answers nothing asked
  const r3 = await read('usd coin');
  ok(!/Reading/.test(r3.chips), 'a two-word name is searched, not interpreted');

  await p.fill('#q', 'nfts on solana'); await p.waitForTimeout(2200);
  ok(await p.locator('[data-unread]').count() === 1, 'a reading offers to be undone');
  await p.click('[data-unread]'); await p.waitForTimeout(900);
  ok(await p.locator('[data-unread]').count() === 0, 'and undoing it puts the controls back');
  await p.fill('#q', ''); await p.waitForTimeout(800);
  await p.click('[data-tab=all]'); await p.waitForTimeout(600);
}

console.log('\n# one index failing is not the feature being down');
{
  /* Two DEX indexes are queried precisely so that one can fail. GeckoTerminal
     allows thirty calls a minute and versions its API through the Accept
     header; both are ordinary reasons for it to refuse, and neither means DEX
     search is unavailable while the other index is answering. */
  ok(seen.some(u => /geckoterminal/.test(u)), 'GeckoTerminal is queried');
  const hdr = await p.evaluate(() => window.__gtAccept || null);

  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  for (const [g, fn] of routes) await ctx.route(g, fn);
  await ctx.route('https://api.geckoterminal.com/**', r => r.abort('failed'));
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 });
  await q.click('#tabs [data-tab=all]');
  await q.fill('#q', 'cashcat'); await q.waitForTimeout(2600);
  ok(await q.locator('.row[data-id="d:PAIR1"]').count() === 1,
    'the surviving index still returns results');
  ok(await q.locator('.warn').count() === 0,
    'and no banner claims the feature is unavailable');

  // when nothing answers, it does say so, and offers a way to try again
  await ctx.route('https://api.dexscreener.com/**', r => r.abort('failed'));
  await q.fill('#q', ''); await q.waitForTimeout(500);
  await q.fill('#q', 'obscuretoken'); await q.waitForTimeout(2600);
  const warn = await q.locator('.warn').textContent().catch(() => '');
  ok(/No DEX index answered/.test(warn), `with both down it says so (${warn.trim().slice(0, 46)})`);
  ok(await q.locator('.warn [data-retry]').count() === 1, 'and offers to retry');
  await ctx.close();
}

console.log('\n# a typed search does not queue behind the index warming up');
{
  /* One host, one lane, a floor on the gap between calls — which is what keeps
     the rate limit away, and also what could put a person's search tenth in
     line behind requests nobody asked for. */
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  const order = [];
  for (const [g, fn] of routes) await ctx.route(g, fn);
  await ctx.route('https://api.geckoterminal.com/**', async r => {
    order.push(r.request().url());
    const h = routes.find(([g]) => g.startsWith('https://api.geckoterminal.com'))[1];
    return h(r);
  });
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 });
  await q.click('#tabs [data-tab=all]');
  await q.fill('#q', 'cashcat');
  await q.waitForSelector('.row[data-id^="d:GTCASH"]', { timeout: 8000 }).catch(() => {});
  const at = order.findIndex(u => /search\/pools/.test(u));
  ok(at >= 0, 'the search reaches GeckoTerminal');
  ok(await q.locator('.row[data-id^="d:GTCASH"]').count() > 0,
    `and answers while the warm-up is still going (${at} requests ahead of it)`);
  await ctx.close();
}

console.log('\n# a category with no network is not filtered by one');
{
  /* CoinGecko's markets call returns no platform for a tokenized equity, so
     Atlas does not know which chain one is issued on. Filtering by chain
     anyway emptied the whole category — the chip appeared to break the tab. */
  await p.click('[data-tab=stocks]'); await p.waitForTimeout(1000);
  const all = await p.locator('#results .row').count();
  await p.click('[data-chain=eth]'); await p.waitForTimeout(1400);
  ok(await p.locator('#results .row').count() === all,
    `a network chip leaves equities alone rather than emptying them (${all})`);
  ok(/not network-specific/.test(await p.locator('#meta').textContent()),
    'and the results line says why');
  await p.click('[data-chain=""]'); await p.waitForTimeout(900);
  await p.click('[data-tab=all]'); await p.waitForTimeout(600);
}

console.log('\n# a price is only a price if the other side holds still');
{
  const ids = async q => { await p.fill('#q', q); await p.waitForTimeout(1600);
    return p.evaluate(() => [...document.querySelectorAll('#results .row')].map(r => r.dataset.id)); };
  // CHAINTOK3 is quoted in SOL on purpose: the number moves when either leg moves
  await p.click('[data-chain=sol]'); await p.waitForTimeout(1800);
  const shown = await ids('chaintok');
  ok(shown.includes('d:chainaddr0'), 'a pair quoted in a dollar stablecoin is kept');
  ok(!shown.includes('d:chainaddr3'), 'and one quoted in a token that moves is not');
  await p.click('[data-chain=""]'); await p.waitForTimeout(900);
  await p.fill('#q', ''); await p.waitForTimeout(700);
}

console.log('\n# junk is four things, and size is not one of them');
{
  const ids = async q => { await p.fill('#q', q); await p.waitForTimeout(1500);
    return p.evaluate(() => [...document.querySelectorAll('#results .row')].map(r => r.dataset.id)); };
  /* Volume many times the pool that produced it is the same coins going round.
     Nothing else on the row says so: the price, the liquidity and the volume
     are each individually plausible. */
  const wash = await ids('washcat');
  ok(!wash.includes('d:WASHPAIR'), 'hides volume forty times its own liquidity');
  ok((await ids('cashcat')).includes('d:PAIR1'), 'and leaves a busy pool that is simply busy');
  await p.fill('#q', ''); await p.waitForTimeout(500);
}

console.log('\n# the contract itself, read before anyone trades on it');
{
  /* HoneyCat has a deep pool, heavy volume and a dollar quote. Every number
     Atlas can see says healthy market. The contract says otherwise, and the
     only way to know that is to read it. */
  await p.fill('#q', 'honeycat'); await p.waitForTimeout(2500);
  const row = p.locator('.row[data-id="d:HONEYPAIR"]');
  ok(await row.count() === 1, 'a token no price feed can fault is still listed');
  ok(hit(/gopluslabs\.io\/api\/v1\/token_security\/\d+\?contract_addresses=/),
    'and its contract is read, by chain id, from the row itself');
  await p.waitForTimeout(1500);
  ok(await p.locator('.row[data-id="d:HONEYPAIR"] .warnb.bad').count() === 1,
    'the row carries the warning, not only the sheet');
  await row.evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="pair"]', { timeout: 8000 });
  await p.waitForTimeout(1500);
  const risk = await p.locator('[data-risk]').textContent();
  for (const f of ['Honeypot', 'Blacklist', 'Controllable supply', 'Unverified contract'])
    ok(risk.includes(f), `the sheet names it: ${f}`);
  ok(/GoPlus/.test(risk), 'and says who read the contract');
  const dup = (risk.match(/Honeypot/g) || []).length;
  ok(dup === 1, `each finding is said once (${dup})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // a contract with nothing against it must read as "nothing found", never as safe
  await p.fill('#q', 'twincat'); await p.waitForTimeout(2000);
  await p.locator('.row[data-id="d:TWINDEEP"]').evaluate(el => el.click());
  await p.waitForSelector('.sheet-in[data-kind="pair"]', { timeout: 8000 });
  await p.waitForTimeout(1800);
  const clean = await p.locator('[data-risk]').textContent();
  ok(/Nothing in the contract itself was flagged/.test(clean) && /not a guarantee/.test(clean),
    `a clean scan is reported as a clean scan, not as safety (${clean.replace(/\s+/g, ' ').slice(-60)})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.fill('#q', ''); await p.waitForTimeout(500);
}

console.log('\n# a trade is made here, not somewhere else');
{
  await p.click('[data-tab=dex]'); await p.waitForTimeout(900);
  await p.locator('#results .row').first().evaluate(el => el.click());
  await p.waitForSelector('.sec.trade', { timeout: 8000 });
  ok(await p.locator('.sec.trade a[href^="http"]').count() === 0,
    'the sheet has no link out to a venue to finish the job');
  ok(await p.locator('.sec.trade [data-amt]').count() === 1, 'it asks how much instead');
  await p.click('[data-tquote]'); await p.waitForTimeout(2500);
  const note = await p.locator('[data-tnote]').textContent();
  const priced = await p.locator('.sec.trade .quote').isVisible();
  ok(priced || /HTTP|reach|route|registry/.test(note),
    `it prices the trade itself, or says why it cannot (${note.slice(0, 70)})`);
  if (priced) {
    ok(/via /.test(await p.locator('.qmeta').textContent()), 'and names the venue that priced it');
    ok(/Connect a wallet|Signing sends/.test(note), 'and says what signing it would do');
  }
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# every kind says what junk means for it');
{
  // six kinds had no rule at all, so nothing could be junk in them
  const off = await p.evaluate(() => window.__ATLAS_RAWCOUNTS__());
  const on = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab .ct')]
    .map(e => ({ tab: e.parentElement.dataset.tab, n: e.textContent })));
  const num = v => Number(String(v).replace(/,/g, '')) || 0;
  const filtered = on.filter(x => num(x.n) < num(off[x.tab])).map(x => x.tab);
  ok(filtered.length >= 9,
    `the filter reaches most categories, not a handful (${filtered.join(', ')})`);
}

console.log('\n# a sheet is about the row you opened, all the way down');
{
  /* The chart owns the headline — it rewrites it with the series' last point,
     which is what makes the hover readout work. So a loader keyed on the wrong
     entity does not throw, it quietly shows another thing's number under this
     thing's name. Walk every kind and hold the headline to the row. */
  const tabs = await p.evaluate(() => [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab));
  let checked = 0, wrong = [];
  for (const t of tabs) {
    if (t === 'saved') continue;
    await p.click(`[data-tab="${t}"]`); await p.waitForTimeout(700);
    if (!await p.locator('#results .row:not(.sk)').count()) continue;
    const rowNum = (await p.locator('#results .row:not(.sk)').first()
      .locator('.n1, .cell').first().textContent()).trim();
    await p.locator('#results .row:not(.sk)').first().evaluate(el => el.click());
    await p.waitForTimeout(1500);
    const kind = await p.locator('.sheet-in').getAttribute('data-kind');
    const big = (await p.locator('.sheet-in .big').textContent()).trim();
    checked++;
    if (big !== rowNum) wrong.push(`${kind}: row ${rowNum} vs sheet ${big}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(450);
  }
  ok(checked >= 12, `every kind opens a sheet (${checked})`);
  ok(!wrong.length, `and its headline is the row's own number${wrong.length ? ' — ' + wrong.join('; ') : ''}`);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a column sort sees the whole category, not the page of it');
{
  await p.click('[data-tab=lending]'); await p.waitForTimeout(1200);
  const meta = await p.locator('#meta').textContent();
  ok(/\d+ of [\d,]+/.test(meta), `the list says what it is showing out of what it found (${meta.trim().slice(0, 34)})`);
  // "1K of 1K" hid the difference between 1,029 and 1,224
  ok(!/\bof \d+(\.\d+)?[KMB]\b/.test(meta), 'and counts a category exactly rather than rounding it');

  await p.locator('.thead button[data-sort=sup]').click(); await p.waitForTimeout(800);
  const top = await p.locator('#results .row .cell').first().textContent();
  // sorting the page instead of the category answered a different question:
  // "highest APY" meant "highest APY among the forty biggest"
  const best = await p.evaluate(() => {
    const cells = [...document.querySelectorAll('#results .row')].map(r =>
      parseFloat(r.querySelector('.cell').textContent));
    return Math.max(...cells);
  });
  ok(parseFloat(top) === best, `the top row is the highest on screen (${top.trim()})`);
  // bulk-97 pays 24.5% and sits a hundred rows past the first page
  ok(parseFloat(top) > 20, `and it is the category's own maximum, not the page's (${top.trim()})`);

  const first = await p.locator('#results .row').count();
  ok(await p.locator('[data-more]').count() === 1, 'a category too big for one screen offers the rest');
  await p.click('[data-more]'); await p.waitForTimeout(700);
  ok(await p.locator('#results .row').count() > first,
    `and showing more grows the list (${first} to ${await p.locator('#results .row').count()})`);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# two registries settle what a heuristic can only guess');
{
  ok(hit(/^https:\/\/tokens\.uniswap\.org/), 'the Uniswap token list is fetched');
  ok(hit(/lite-api\.jup\.ag\/tokens\/v2\/tag/), 'and Jupiter\'s verified tag');
  const shown = async q => { await p.fill('#q', q); await p.waitForTimeout(1600);
    return p.evaluate(() => [...document.querySelectorAll('#results .row')].map(r => r.dataset.id)); };
  // the depth rule alone drops the shallow half; a registry naming its contract
  // outranks the guess
  ok((await shown('vouched')).includes('d:VOUCHEDSHALLOW'),
    'a contract a registry names survives the duplicate rule');
  // and the ticker alone must never do that, or every impersonator inherits the
  // reputation of what it is imitating
  ok(!(await shown('bitcoin')).includes('d:FAKEBTC'),
    'while sharing a listed ticker with a registry entry rescues nothing');
  ok(!(await shown('twincat')).includes('d:TWINSHALLOW'),
    'and an unlisted shallow copy is still dropped');
  await p.fill('#q', ''); await p.waitForTimeout(700);

  await p.click('[data-tab=dex]'); await p.waitForTimeout(900);
  ok(await p.locator('[data-facet=real]').count() === 1, 'and it becomes a filter of its own');
  await p.locator('#results .row[data-id="d:PAIR1"], #results .row').first().evaluate(el => el.click());
  await p.waitForTimeout(1200);
  const sheet = await p.locator('.sheet-in').textContent();
  ok(/Listed by/.test(sheet) || /Jupiter|Uniswap/.test(sheet),
    'a verified row names the registry that vouched for it');
  // Atlas holds no wallet and quotes no price; it hands off with the token resolved
  ok(await p.locator('.cta a').count() >= 1, 'and offers somewhere to act on it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# the isolated markets an aggregator only samples');
{
  ok(hit(/api\.morpho\.org/), 'Morpho is asked for its own markets');
  ok(seen.some(u => /api\.morpho\.org.*\|POST/.test(u)), 'over POST, since it speaks GraphQL');
  await p.fill('#q', 'morpho'); await p.waitForTimeout(1600);
  const rows = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .map(r => r.dataset.id).filter(x => x.startsWith('p:morpho:')));
  ok(rows.length >= 2, `its markets join the lending category (${rows.length})`);
  await p.locator(`.row[data-id="${rows[0]}"]`).click(); await p.waitForTimeout(1300);
  const t = await p.locator('.sheet-in').textContent();
  // the API reports rates as fractions and lltv as an 18-decimal integer
  ok(/5\.12%/.test(t), 'with its rates converted out of fractions');
  ok(/86%/.test(t), 'and its LLTV out of 18-decimal fixed point');
  ok(/wstETH collateral/.test(t), 'and the collateral it is actually against');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.fill('#q', ''); await p.waitForTimeout(700);
}

console.log('\n# a mixed result set says what it is made of');
{
  await p.fill('#q', 'usdc'); await p.waitForTimeout(1700);
  const chips = await p.locator('#facetbar [data-jump]').evaluateAll(bs =>
    bs.map(b => ({ k: b.dataset.jump, t: b.textContent.trim() })));
  ok(chips.length >= 2, `a search across kinds offers a way into each (${chips.map(c => c.t).join(' · ')})`);
  await p.click(`[data-jump="${chips[0].k}"]`); await p.waitForTimeout(900);
  const only = await p.evaluate(() => new Set([...document.querySelectorAll('#results .row')]
    .map(r => r.dataset.id.split(':')[0])).size);
  ok(only === 1, 'and clicking one narrows to that kind alone');
  ok(await p.locator('#q').inputValue() === 'usdc', 'keeping the query');
  await p.fill('#q', ''); await p.waitForTimeout(700);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
  ok(await p.locator('#facetbar [data-jump]').count() === 0,
    'with nothing typed the rail already names the categories, so the row stays out of the way');
}

console.log('\n# categories are walkable from the keyboard');
{
  const before = await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab');
  await p.locator('body').click({ position: { x: 5, y: 400 } });
  await p.keyboard.press(']'); await p.waitForTimeout(600);
  const after = await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab');
  ok(before !== after, `] moves to the next category (${before} to ${after})`);
  await p.keyboard.press('['); await p.waitForTimeout(600);
  ok(await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab') === before, '[ moves back');
  // a bracket belongs to whatever you are typing
  await p.click('#q'); await p.fill('#q', 'a['); await p.waitForTimeout(700);
  ok(await p.locator('#tabs .tab[aria-selected=true]').getAttribute('data-tab') === before,
    'and a bracket typed into the search box is a search, not a category change');
  await p.fill('#q', ''); await p.waitForTimeout(600);
}

console.log('\n# the chart says where, not only how much');
{
  await p.click('[data-tab=assets]'); await p.waitForTimeout(800);
  await p.locator('#results .row').first().evaluate(el => el.click());
  await p.waitForSelector('.chart svg .line', { timeout: 15000 });
  await p.waitForTimeout(900);
  ok(await p.locator('.chart .pin.pk').count() === 1, 'the period high is marked on the line');
  ok(await p.locator('.chart .pin.tr').count() === 1, 'and so is the low');
  /* The marks are circles in the same svg as the line now, so the check is the
     one that matters: does each sit on the line, to the pixel. */
  const offLine = await p.evaluate(() => {
    const pts = document.querySelector('.chart svg .line')?.getAttribute('d') || '';
    const xy = [...pts.matchAll(/([\d.]+) ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
    return [...document.querySelectorAll('.chart svg .pin')].map(c => {
      const cx = +c.getAttribute('cx'), cy = +c.getAttribute('cy');
      const near = xy.find(([x]) => Math.abs(x - cx) < 0.6);
      return !near || Math.abs(near[1] - cy) > 0.6 ? `${cx},${cy}` : null;
    }).filter(Boolean);
  });
  ok(offLine.length === 0, `both marks sit on the line, to the pixel (${offLine.join(' ') || 'on'})`);
  const vk = await p.locator('.chart .vk').textContent().catch(() => '');
  ok(/peak \$/.test(vk), `the volume strip carries its own scale (${vk})`);
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
}

console.log('\n# bridges have history too');
{
  await p.click('[data-tab=bridges]'); await p.waitForTimeout(900);
  await p.locator('#results .row').first().evaluate(el => el.click());
  await p.waitForSelector('.chart svg .line', { timeout: 15000 });
  await p.waitForTimeout(800);
  ok(hit(/bridges\.llama\.fi\/bridgevolume/), 'a bridge asks for its own daily volume');
  ok(await p.locator('.nohist').count() === 0, 'and draws it rather than a flat line');
  await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# the rail groups its categories, and loses none of them');
{
  const rail = await p.evaluate(() => ({
    heads: [...document.querySelectorAll('#tabs .railk')].map(h => h.textContent),
    tabs: [...document.querySelectorAll('#tabs .tab')].map(t => t.dataset.tab),
  }));
  ok(rail.heads.length >= 4, `the column is grouped under headings (${rail.heads.join(', ')})`);
  // a kind added to the table but left out of a group would vanish from the
  // rail with nothing failing, so check the rail against the kinds themselves
  // All groups a typed search by kind; with nothing typed it is the tile home
  await p.fill('#q', 'usdc'); await p.waitForTimeout(1200);
  const kinds = await p.evaluate(() =>
    [...document.querySelectorAll('#results .gtitle')].length);
  await p.fill('#q', ''); await p.waitForTimeout(500);
  for (const t of ['assets', 'stocks', 'dex', 'nfts', 'lending', 'yield', 'protocols',
    'stables', 'bridges', 'networks', 'raises', 'hacks', 'all', 'saved'])
    ok(rail.tabs.includes(t), `${t} has a place in the rail`);
  ok(rail.tabs.length === new Set(rail.tabs).size, 'and none of them is listed twice');
  ok(kinds > 0, `the All view still groups its rows (${kinds} headings)`);
}

console.log('\n# the payloads already downloaded carry more than four columns');
{
  await p.click('[data-tab=assets]'); await p.waitForTimeout(900);
  const head = await p.locator('.thead').textContent();
  ok(/7d/.test(head) && /30d/.test(head), `assets carry their week and month (${head.replace(/\s+/g, ' ').trim()})`);
  const btc = await p.locator('.row[data-id="a:bitcoin"]').textContent();
  ok(/\+5\.40%/.test(btc) && /-8\.20%/.test(btc), `and they are the real numbers, not zeroes (${btc.replace(/\s+/g, ' ').trim().slice(0, 80)})`);

  await p.click('[data-tab=yield]'); await p.waitForTimeout(900);
  const yh = await p.locator('.thead').textContent();
  ok(/30d avg/i.test(yh) && /Trend/.test(yh), 'a farm shows the rate\'s own month beside the rate');
  const ff = await p.locator('.row[data-id="y:ff66"]').textContent();
  ok(/8\.72%/.test(ff), `the 30-day mean is read off the payload (${ff.replace(/\s+/g, ' ').trim().slice(0, 70)})`);
  ok(/Holding/.test(ff), 'and so is the outlook the source publishes');

  await p.click('[data-tab=lending]'); await p.waitForTimeout(900);
  ok(/Available/.test(await p.locator('.thead').textContent()),
    'a lending market says what is left to take out');
  const aa = await p.locator('.row[data-id="p:aa11"]').textContent();
  ok(/\$500\.0M/.test(aa), `supplied minus borrowed, not supplied (${aa.replace(/\s+/g, ' ').trim().slice(0, 90)})`);

  await p.click('[data-tab=protocols]'); await p.waitForTimeout(900);
  ok(/Revenue 24h/.test(await p.locator('.thead').textContent()),
    'revenue was being fetched and never shown');
  ok(/\$910K/.test(await p.locator('#results').textContent()), 'and it reaches the row');
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# a rate far above its own month is the same trick told quietly');
{
  const idsFor = async q => { await p.fill('#q', q); await p.waitForTimeout(1400);
    return p.evaluate(() => [...document.querySelectorAll('#results .row')].map(r => r.dataset.id)); };
  ok(!(await idsFor('spike')).includes('y:hh88'), 'hides a farm paying eight times its 30-day mean');
  ok(!(await idsFor('outlier')).includes('y:ii99'), 'hides a farm the source itself flags');
  await p.fill('#q', ''); await p.waitForTimeout(600);
}

console.log('\n# a category narrows by question, not only by sort');
{
  await p.click('[data-tab=yield]'); await p.waitForTimeout(1000);
  const chips = await p.locator('#facetbar button[data-facet]').evaluateAll(
    bs => bs.map(b => b.textContent.trim()));
  ok(chips.length >= 4, `the category offers its own filters (${chips.join(' · ')})`);
  ok(chips.every(c => /\d/.test(c)), 'and every chip says how much it would leave');

  const before = await p.locator('#results .row').count();
  await p.click('[data-facet=stable]'); await p.waitForTimeout(900);
  const after = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .map(r => r.dataset.id));
  ok(after.length && after.length < before, `one chip narrows the list (${before} to ${after.length})`);
  ok(after.includes('y:ff66'), 'keeping the rows that answer it');
  ok(!after.includes('y:gg77'), 'and dropping the rows that do not');
  ok(/f=stable/.test(p.url()), `the filter is in the url (${p.url().split('?')[1]})`);

  // a chip that would empty the screen is offered as unavailable, not as a trap
  ok(await p.locator('#facetbar button[data-facet]:disabled').count() > 0,
    'a chip that would leave nothing is not clickable');

  // two chips are an and, not an or
  const next = await p.locator('#facetbar button[data-facet]:not(.on):not([disabled])')
    .first().getAttribute('data-facet');
  await p.click(`[data-facet="${next}"]`); await p.waitForTimeout(900);
  const both = await p.evaluate(() => [...document.querySelectorAll('#results .row')]
    .map(r => r.dataset.id));
  ok(both.length && both.every(id => after.includes(id)),
    `a second chip narrows what the first left (${next}: ${after.length} to ${both.length})`);
  ok(await p.locator('#facetbar .clr').count() === 1, 'and the row offers to clear them');

  await p.goto(p.url()); await p.waitForSelector('.row:not(.sk), .empty', { timeout: 20000 });
  await p.waitForTimeout(1400);
  ok(await p.locator('#facetbar button.on').count() === 2, 'both survive a reload of the link');

  await p.click('#facetbar .clr'); await p.waitForTimeout(900);
  ok(await p.locator('#facetbar button.on').count() === 0, 'clear turns them all off');
  ok(await p.locator('#results .row').count() === before, 'and the category comes back whole');
}

console.log('\n# a filter can never trap you behind an empty screen');
{
  await p.click('[data-tab=bridges]'); await p.waitForTimeout(900);
  const bridge = await p.locator('#facetbar button[data-facet]').evaluateAll(
    bs => bs.map(b => b.dataset.facet));
  ok(bridge.length >= 1, 'bridges have their own questions, not the yield ones');
  ok(!bridge.includes('stable'), 'switching category drops the last category\'s chips');
  ok(!/f=/.test(p.url()), 'and does not carry its filters over');

  // force the empty case: every chip on at once
  for (const f of bridge) { await p.click(`[data-facet="${f}"]`); await p.waitForTimeout(500); }
  if (await p.locator('#results .row').count() === 0) {
    ok(await p.locator('#facetbar').isVisible(), 'an emptied list still shows the filter row');
    ok(await p.locator('.empty [data-facet=""]').count() === 1, 'and offers to clear it');
    await p.click('.empty [data-facet=""]'); await p.waitForTimeout(800);
    ok(await p.locator('#results .row').count() > 0, 'which brings the rows back');
  } else {
    ok(await p.locator('#facetbar button.on').count() === bridge.length,
      'every chip can be on at once');
    await p.click('#facetbar .clr'); await p.waitForTimeout(600);
  }
  await p.click('[data-tab=all]'); await p.waitForTimeout(600);
}

console.log('\n# a sorted view survives a reload and a shared link');
{
  await p.click('[data-tab=protocols]'); await p.waitForTimeout(700);
  await p.locator('.thead button[data-sort=tvl]').click(); await p.waitForTimeout(500);
  const url = p.url();
  ok(/sort=-tvl/.test(url), `the sort is in the url (${url.split('?')[1]})`);
  await p.goto(url); await p.waitForSelector('.row:not(.sk)', { timeout: 20000 });
  await p.waitForTimeout(1200);
  ok(await p.locator('.thead button[data-sort=tvl]').getAttribute('aria-sort') === 'descending',
    'and comes back on a reload');
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# every entity says what it is');
{
  await p.fill('#q', 'bitcoin'); await p.waitForTimeout(700);
  await p.locator('.row[data-id^="a:"]').first().evaluate(el => el.click());
  await p.waitForSelector('[data-about]', { timeout: 8000 });
  await p.waitForTimeout(1300);
  const line = await p.locator('[data-about]').textContent();
  ok(/Bitcoin trades as BTC/.test(line), `every row says what it is (${line.slice(0, 40)})`);
  const src = await p.locator('[data-src]').textContent();
  ok(/^bitcoin is described here by its own source/.test(src),
    `and carries its source's own words, for itself (${src.slice(0, 44)})`);
  ok(!/<|href=/.test(src), 'with the markup its source ships stripped out');
  ok(await p.locator('[data-src]:not([hidden])').count() === 1, 'shown beside the line, not instead of it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  await p.fill('#q', 'across'); await p.waitForTimeout(800);
  await p.locator('.row[data-id^="b:"]').first().evaluate(el => el.click()); await p.waitForTimeout(700);
  ok(/moves value between Ethereum, Base/.test(await p.locator('[data-about]').textContent()),
    'a kind with no published description names what it actually connects');
  ok(await p.locator('[data-src]:not([hidden])').count() === 0, 'and shows no empty source block');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);

  // a market is run by a protocol, and that protocol describes itself
  await p.fill('#q', 'kamino'); await p.waitForTimeout(800);
  await p.locator('.row[data-id^="p:"]').first().evaluate(el => el.click()); await p.waitForTimeout(1400);
  ok(/Supply .* and earn/.test(await p.locator('[data-about]').textContent()),
    'a lending market states its own terms');
  ok(/kamino-lend is described by its own source/.test(await p.locator('[data-src]').textContent()),
    'and inherits the description of the protocol running it');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.fill('#q', ''); await p.waitForTimeout(400);
}

console.log('\n# a tokenized stock opens like anything else');
{
  await p.click('[data-tab=stocks]'); await p.waitForTimeout(800);
  await p.locator('.row[data-id^="t:"]').first().evaluate(el => el.click()); await p.waitForTimeout(800);
  // it fell through to the lending renderer and threw on a field it does not
  // have, so the sheet never opened at all
  ok(await p.locator('.sheet-in[data-kind="stock"]').count() === 1, 'clicking an equity opens its sheet');
  const sheet = await p.locator('.sheet').textContent();
  ok(/Underlying/.test(sheet) && /Market cap/.test(sheet), 'with the stats that belong to it');
  await p.waitForTimeout(1300);
  // this fixture's largest equity is Tesla; the line must name its own underlying
  const about = await p.locator('[data-about]').textContent();
  ok(/\bTSLA\b/.test(about) && /Backed/.test(about),
    `and an about line naming its own underlying and who issued it (${about.slice(0, 70)})`);
  const prose = await p.locator('[data-src]').textContent();
  ok(/^Tesla is a company/.test(prose), `with prose about the company behind it (${prose.slice(0, 40)})`);
  ok(hit(/wikipedia\.org\/api\/rest_v1\/page\/summary\/Tesla$/),
    'looked up under the company name, with the wrapper stripped off');
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  await p.click('[data-tab=all]'); await p.waitForTimeout(500);
}

console.log('\n# per-chain and chart endpoints');
await p.click('[data-chain=sol]'); await p.waitForTimeout(1500);
ok(hit(/^https:\/\/api\.geckoterminal\.com\/api\/v2\/networks\/solana\/pools\?page=1&include=base_token$/),
  'a chain tab pulls that network\'s own tokens');
{
  // global assets carry no chain, so a chain filter used to empty this tab
  await p.click('[data-tab=assets]'); await p.waitForTimeout(900);
  ok(await p.locator('.row').count() > 0, 'the Assets tab is not empty under a chain filter');
  await p.click('[data-tab=all]'); await p.waitForTimeout(400);
}
await p.click('[data-chain=""]'); await p.waitForTimeout(800);
await p.fill('#q', 'bitcoin'); await p.waitForTimeout(500);
await p.locator('.row').first().evaluate(el => el.click());
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
console.log('\n# what the chart encodes');
{
  // charts open on 1D, and that is the range where a clock-only label collided
  await p.click('[data-days="1"]'); await p.waitForTimeout(900);
  const d1 = await p.locator('.chart-svg .ax').allTextContents();
  ok(d1[2] !== d1[3], `1D labels its two ends apart (${d1[2]} -> ${d1[3]})`);
  await p.click('[data-days="365"]'); await p.waitForTimeout(900);
  // price, its high/low envelope and volume, on two panels sharing one x-axis —
  // never one plot with two y-scales
  ok(await p.locator('.chart-svg .vol rect').count() > 0, 'volume rides under the price on its own panel');
  const ax = await p.locator('.chart-svg .ax').allTextContents();
  ok(ax.filter(Boolean).length >= 4, `the scale is readable without hovering (${ax.join(' | ')})`);
  ok(/\$/.test(ax[0] || ''), 'the high and low of the range are labelled');
  // a year-long range printed "Aug 29" at both ends, which reads as no span
  ok(ax[2] !== ax[3], `the two ends of the range are distinguishable (${ax[2]} -> ${ax[3]})`);

  // the same readout on keyboard as on hover
  const rest = await p.locator('.big').textContent();
  await p.locator('.chart-svg').focus(); await p.waitForTimeout(200);
  await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(250);
  ok((await p.locator('.big').textContent()) !== rest, 'arrow keys scrub the chart');
  ok(/\d/.test(await p.locator('.chart-svg .tip b').textContent()), 'and the tooltip leads with the value');
  // Escape belongs to the sheet; blurring the chart is what puts the readout back
  await p.locator('.chart-svg').blur(); await p.waitForTimeout(250);
  ok((await p.locator('.big').textContent()) === rest, 'leaving the chart restores the headline');
  ok(await p.locator('.sheet.open').count() === 1, 'and scrubbing never closed the sheet');
}
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
await p.locator('.row[data-id^="p:"]').first().evaluate(el => el.click());
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
    body: JSON.stringify(Array.from({ length: 100 }, (_, i) =>
      [0, 0, String(104 + i), String(96 + i), String(100 + i), '5', 0, String(1e6 + i * 1e4)])) }));
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 }).catch(() => {});
  const body = await q.locator('#results').textContent();
  ok(body.includes('Paprika Coin'), 'CoinPaprika carries the asset list when CoinGecko refuses');
  ok(await q.locator('.warn').count() === 0, 'a working fallback raises no warning');
  await q.locator('.row[data-id^="a:"]').first().evaluate(el => el.click());
  await q.waitForSelector('.chart svg .line', { timeout: 12000 }).catch(() => {});
  ok(await q.locator('.chart svg .line').count() === 1, 'charts fall back to Binance klines');
  // klines carry high, low and quote volume in the same rows
  ok(await q.locator('.chart-svg .band').count() === 1, 'and bring a high/low envelope with them');
  ok(await q.locator('.chart-svg .vol rect').count() > 0, 'and their volume');
  await ctx.close();
}

console.log('\n# an asset off every price feed still gets a real chart');
{
  const ctx = await b.newContext({ viewport: { width: 1200, height: 900 } });
  const q = await ctx.newPage();
  q.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });
  const gt = [];
  await ctx.route('https://api.coingecko.com/**', r => r.abort('failed'));   // no cg id downstream
  await ctx.route('https://api.coinpaprika.com/**', r => r.fulfill({ contentType: 'application/json',
    body: JSON.stringify([{ id: 'pk-obscure', name: 'Obscure Token', symbol: 'OBSC', rank: 1,
      quotes: { USD: { price: 0.42, market_cap: 9e8, volume_24h: 1e6, percent_change_24h: 2 } } }]) }));
  await ctx.route('https://api.binance.com/**', r => r.abort('failed'));     // not listed there either
  await ctx.route('https://api.geckoterminal.com/**', r => {
    const u = r.request().url(); gt.push(u);
    const J = o => r.fulfill({ contentType: 'application/json', body: JSON.stringify(o) });
    if (u.includes('/search/pools')) return J({ data: [
      { id: 'solana_SHALLOW', attributes: { address: 'shallow', reserve_in_usd: '4000' } },
      { id: 'solana_DEEP', attributes: { address: 'deep', reserve_in_usd: '900000' } }] });
    if (u.includes('/ohlcv/')) return J({ data: { attributes: { ohlcv_list:
      Array.from({ length: 60 }, (_, i) => [i, 0.4, 0.45, 0.38, 0.4 + i * 0.001, 1e4 + i * 50]) } } });
    return J({ data: [] });
  });
  for (const h of ['https://yields.llama.fi/**', 'https://api.llama.fi/**', 'https://stablecoins.llama.fi/**',
    'https://bridges.llama.fi/**', 'https://api.dexscreener.com/**', 'https://nft.llama.fi/**',
    'https://api-mainnet.magiceden.dev/**'])
    await ctx.route(h, r => r.fulfill({ contentType: 'application/json', body: '{}' }));
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('.row[data-id^="a:"]', { timeout: 20000 }).catch(() => {});
  await q.locator('.row[data-id^="a:"]').first().evaluate(el => el.click());
  await q.waitForSelector('.chart svg .line', { timeout: 12000 }).catch(() => {});
  ok(await q.locator('.chart svg .line').count() === 1, 'a token on no price feed still charts');
  ok(gt.some(u => /\/search\/pools\?query=OBSC/.test(u)), 'by finding where it actually trades');
  ok(gt.some(u => /\/pools\/deep\/ohlcv\//.test(u)), 'and charting the deepest pool, not the first');
  ok(await q.locator('.nohist').count() === 0, 'so it is not labelled as having no history');
  ok(/via a DEX pool/.test(await q.locator('.chgline').textContent()), 'and it says where the data came from');
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
  await q.goto(UROWS, { waitUntil: 'commit' });
  await q.waitForSelector('.row:not(.sk)', { timeout: 20000 }).catch(() => {});
  await q.locator('.row[data-id^="a:"]').first().evaluate(el => el.click());
  await q.waitForSelector('.chart svg .line', { timeout: 12000 }).catch(() => {});
  ok(await q.locator('.chart svg .line').count() === 1, 'the chart still draws with every source down');
  ok(await q.locator('.nohist').count() === 1, 'and says plainly that there is no history');
  await ctx.close();
}

ok(await p.locator('.railchains').isVisible() && !await p.locator('#chainbtn').isVisible(),
  'desktop keeps the whole chain list in the rail');

console.log('\n# mobile');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const q = await ctx.newPage();
  q.on('pageerror', e => { console.log('  JS ERROR', e.message); fail++; });
  for (const [h, fn] of routes) await ctx.route(h, fn);
  await q.goto(UROWS); await q.waitForSelector('.row:not(.sk)', { timeout: 20000 });
  await q.waitForTimeout(2500);
  await q.click('[data-tab=lending]'); await q.waitForTimeout(900);

  ok(!(await q.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)),
    'the page never scrolls sideways');
  ok(await q.locator('#results.table').count() === 0, 'a phone gets cards, not five numeric columns');
  ok(!await q.locator('#view').isVisible(), 'and is not offered a table toggle that cannot work');
  ok(!await q.locator('.hero').isVisible(), 'the decorative hero does not cost a phone its first screen');

  ok(await q.locator('[data-unsafe]').count() === 0,
    'a phone is not asked to manage what it never sees');

  // the column headers are the desktop sort control; a phone needs its own
  ok(await q.locator('#sortbar button').count() >= 4, 'sort is reachable as chips');
  await q.locator('#sortbar button', { hasText: 'Supplied' }).click(); await q.waitForTimeout(500);
  ok(await q.locator('#sortbar button.on').count() === 1, 'a chip sorts and shows it is active');
  ok(/sort=-supplyUsd/.test(q.url()), 'and the sort reaches the url from a phone too');

  // The headline figure had been dropped at this width entirely. Restoring it
  // then made the line 7px too long at 390 and 16px too long at 360, so the
  // second line now sheds the tag, then the network, and keeps the figure.
  for (const w of [320, 360, 390]) {
    await q.setViewportSize({ width: w, height: 844 }); await q.waitForTimeout(400);
    const t2 = q.locator('.row .t2').first();
    ok(/supplied/.test(await t2.innerText()), `${w}px keeps the headline figure`);
    ok(!(await t2.evaluate(e => e.scrollWidth > e.clientWidth + 1)), `${w}px does not clip it`);
    ok(!(await q.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)),
      `${w}px never scrolls sideways`);
  }
  await q.setViewportSize({ width: 390, height: 844 }); await q.waitForTimeout(400);

  // the first screen was 70% chrome: hero, stacked stat cards, and a results
  // line and toolbar on separate rows, with the first row at y=474 of 844
  const geo = await q.evaluate(() => {
    const fr = document.querySelector('#results .row');
    const vis = [...document.querySelectorAll('#results .row')].filter(r => {
      const b = r.getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; });
    return { rail: Math.round(document.querySelector('.rail').getBoundingClientRect().height),
      firstRow: Math.round(fr.getBoundingClientRect().top), rows: vis.length };
  });
  ok(geo.rail < 70, `the rail is one row, not two (${geo.rail}px)`);
  ok(geo.firstRow < 340, `content starts in the top half of the screen (y=${geo.firstRow})`);
  // this fixture carries only two lending markets, so ask for what exists
  const total = await q.locator('#results .row').count();
  ok(geo.rows >= Math.min(7, total), `and fills it with rows (${geo.rows} of ${total})`);

  // thirty chains in a horizontal scroller is a scroll hunt; a grid is not
  ok(await q.locator('#chainbtn').isVisible(), 'the network filter is one button');
  await q.click('#chainbtn'); await q.waitForTimeout(600);
  ok(await q.locator('.pickgrid .chip').count() === 31, 'which opens every network at once');
  await q.locator('.pickgrid [data-chain=sol]').click(); await q.waitForTimeout(1800);
  ok(await q.locator('.sheet.open').count() === 0, 'picking one closes the picker');
  ok(/Solana/.test(await q.locator('#chainbtn .cn').textContent()), 'and the button reports it');
  // closing the picker rewinds history, and history.go is async — applying the
  // chain before that landed used to overwrite the url and drop ?chain=
  ok(/chain=sol/.test(q.url()), `the filter survives the picker closing (${q.url().split('?')[1]})`);
  await q.click('#chainbtn'); await q.waitForTimeout(500);
  await q.goBack(); await q.waitForTimeout(600);
  ok(await q.locator('.sheet.open').count() === 0, 'back closes the picker');
  ok(/chain=sol/.test(q.url()), 'without undoing the filter');
  await q.locator('#chainbtn').click(); await q.waitForTimeout(500);
  await q.locator('.pickgrid [data-chain=""]').click(); await q.waitForTimeout(1500);

  // a bottom sheet you cannot throw away feels stuck
  await q.locator('.row').first().evaluate(el => el.click());
  await q.waitForSelector('.sheet.open', { timeout: 8000 }); await q.waitForTimeout(600);
  ok(await q.locator('.grab').isVisible(), 'the sheet has something to grab');
  const g = await q.locator('.grab').boundingBox();
  await q.mouse.move(g.x + g.width / 2, g.y + 8);
  await q.mouse.down();
  await q.mouse.move(g.x + g.width / 2, g.y + 140, { steps: 8 });
  await q.mouse.up(); await q.waitForTimeout(700);
  ok(await q.locator('.sheet.open').count() === 0, 'and swiping it down closes it');

  // thumb-sized targets
  const star = await q.locator('.row .star').first().boundingBox();
  ok(star && star.height >= 40, `star is a thumb target (${Math.round(star?.height ?? 0)}px)`);
  await ctx.close();
}

console.log(fail ? `\n${fail} FAILING\n` : '\nall green\n');
await b.close(); srv.kill(); process.exit(fail ? 1 : 0);
