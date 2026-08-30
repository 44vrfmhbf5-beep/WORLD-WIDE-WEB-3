/* data.js — live data, no API keys and no backend: every source below allows
   direct browser calls.

     api.coingecko.com      assets, prices, price history
     api.coinpaprika.com    the same, when CoinGecko refuses the origin
     api.binance.com        price history, when neither of the above has it
     yields.llama.fi        lending markets, borrow side, APY history
     api.llama.fi           protocols, TVL history, DEX volume, fees & revenue,
                            per-chain TVL and its history, raises, hacks
     stablecoins.llama.fi   stablecoin supply and its history
     bridges.llama.fi       cross-chain bridge volume
     nft.llama.fi           NFT collections and floor history
     api-mainnet.magiceden.dev  Solana NFT collections
     api.dexscreener.com    live DEX pair search
     api.geckoterminal.com  DEX pair search, trending pools, per-chain tokens,
                            pair OHLCV

   They are joined into one index: a lending market carries the protocol behind
   it, a protocol carries the chains it runs on, and every chain knows its own
   assets, markets and protocols. */

const CG = 'https://api.coingecko.com/api/v3';
const YIELDS = 'https://yields.llama.fi';
const LLAMA = 'https://api.llama.fi';
const STABLE = 'https://stablecoins.llama.fi';
const BRIDGES = 'https://bridges.llama.fi';
const DEXS = 'https://api.dexscreener.com';
const PAPRIKA = 'https://api.coinpaprika.com/v1';
const BINANCE = 'https://api.binance.com/api/v3';
const NFT = 'https://nft.llama.fi';
const ME = 'https://api-mainnet.magiceden.dev/v2';
const GT = 'https://api.geckoterminal.com/api/v2';
// verification and coverage, all keyless and CORS-open like the rest
const UNI = 'https://tokens.uniswap.org';
const JUP = 'https://lite-api.jup.ag';
const MORPHO = 'https://api.morpho.org/graphql';

// id, label, colour, DeFiLlama chain name
export const CHAINS = [
  ['eth',   'Ethereum',    '#7b8cf5', 'Ethereum'],
  ['sol',   'Solana',      '#14f195', 'Solana'],
  ['base',  'Base',        '#3b7cff', 'Base'],
  ['arb',   'Arbitrum',    '#28a0f0', 'Arbitrum'],
  ['bnb',   'BNB Chain',   '#f0b90b', 'BSC'],
  ['hl',    'Hyperliquid', '#97fce4', 'Hyperliquid'],
  ['op',    'Optimism',    '#ff5c6c', 'Optimism'],
  ['poly',  'Polygon',     '#a06bf0', 'Polygon'],
  ['avax',  'Avalanche',   '#e84142', 'Avalanche'],
  ['sui',   'Sui',         '#4da2ff', 'Sui'],
  ['apt',   'Aptos',       '#2ed3b7', 'Aptos'],
  ['tron',  'Tron',        '#ff4a4a', 'Tron'],
  ['ton',   'TON',         '#3aa8f0', 'TON'],
  ['btc',   'Bitcoin',     '#f7931a', 'Bitcoin'],
  ['bera',  'Berachain',   '#c46a2b', 'Berachain'],
  ['sonic', 'Sonic',       '#f2c14e', 'Sonic'],
  ['mnt',   'Mantle',      '#57b8a9', 'Mantle'],
  ['blast', 'Blast',       '#fcfc03', 'Blast'],
  ['scrl',  'Scroll',      '#ffb682', 'Scroll'],
  ['linea', 'Linea',       '#9fe870', 'Linea'],
  ['zks',   'zkSync Era',  '#8c8dfc', 'zkSync Era'],
  ['sei',   'Sei',         '#e05c5c', 'Sei'],
  ['uni',   'Unichain',    '#ff6fb0', 'Unichain'],
  ['ink',   'Ink',         '#7a5cff', 'Ink'],
  ['abs',   'Abstract',    '#6fe3a1', 'Abstract'],
  ['plume', 'Plume',       '#f08a5c', 'Plume'],
  ['story', 'Story',       '#b1b6c9', 'Story'],
  ['monad', 'Monad',       '#8b5cf6', 'Monad'],
  ['celo',  'Celo',        '#f5d130', 'Celo'],
  ['rhc',   'Robinhood Chain', '#63d16a', 'Robinhood Chain'],
];
export const CH = Object.fromEntries(CHAINS.map(([id, name, color, llama]) =>
  [id, { id, name, color, llama }]));
const BY_LLAMA = Object.fromEntries(CHAINS.map(c => [c[3], c[0]]));
// DeFiLlama is not always consistent about a chain's display name
for (const [alias, id] of Object.entries({ 'BNB': 'bnb', 'Binance': 'bnb', 'Avalanche C-Chain': 'avax',
  'zkSync': 'zks', 'Era': 'zks', 'Polygon zkEVM': 'poly', 'op_bnb': 'bnb', 'Robinhood': 'rhc' }))
  if (!BY_LLAMA[alias]) BY_LLAMA[alias] = id;

/* ---------- plumbing ---------- */
export class ApiError extends Error {
  constructor(msg, { rateLimited = false } = {}) { super(msg); this.rateLimited = rateLimited; }
}

const hostOf = u => { try { return new URL(u).host; } catch { return String(u); } };

/* Every `url`/`source` below is an upstream string we drop into an href.
   Escaping stops attribute breakout but not the scheme: `javascript:` and
   `data:text/html` still execute on click, with this origin's storage. Only
   http(s) gets through. */
const safeUrl = (u, fallback = '') => {
  try { const p = new URL(u); return /^https?:$/.test(p.protocol) ? p.href : fallback; }
  catch { return fallback; }
};
// A page opened straight off disk sends `Origin: null`, which an API may refuse.
// The browser reports that identically to being offline, so say so explicitly.
const FILE_ORIGIN = typeof location !== 'undefined' && location.protocol === 'file:';

function reachMessage(url, e) {
  const h = hostOf(url);
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return `${h} timed out.`;
  return FILE_ORIGIN
    ? `Could not reach ${h}. This page is open from a file:// path, so the browser sends a null origin that the API may reject — serving it over http fixes that.`
    : `Could not reach ${h} — network error, blocked request, or the API refused this origin.`;
}

/* Where the page cannot reach the network at all — a hosted artifact runs under
   a CSP that blocks external hosts — fall back to a bundled sample dataset if one
   was injected. The UI labels it plainly; it is illustrative, not market data. */
export const flags = { sample: false };

function sampleFor(url) {
  const S = typeof window !== 'undefined' && window.__ATLAS_SAMPLE__;
  if (!S) return null;
  const u = new URL(url, 'https://x');
  if (u.pathname.endsWith('/coins/markets')) return S.markets(u.searchParams.get('category'));
  if (u.pathname.endsWith('/market_chart'))
    return { prices: S.priceSeries(u.pathname.split('/')[4], +u.searchParams.get('days') || 1) };
  if (u.pathname.endsWith('/pools')) return { status: 'success', data: S.pools };
  if (u.pathname.endsWith('/lendBorrow')) return [];
  if (u.pathname.includes('/chart/') && u.host.startsWith('nft')) {
    const cid = u.pathname.split('/').pop();
    return S.nftChart(S.nfts.find(n => n.collectionId === cid)?.floorPriceUSD);
  }
  if (u.pathname.includes('/chart/')) {
    const id = u.pathname.split('/').pop();
    return { data: S.apySeries(id, 180, S.pools.find(p => p.pool === id)?.apy) };
  }
  if (u.pathname.endsWith('/protocols')) return S.protocols;
  if (u.pathname.includes('/overview/dexs')) return { protocols: S.dexs };
  if (u.pathname.includes('/overview/fees')) return { protocols: S.fees };
  if (u.pathname.endsWith('/v2/chains')) return S.chains;
  if (u.pathname.includes('/historicalChainTvl/')) {
    const name = decodeURIComponent(u.pathname.split('/').pop());
    return S.tvlSeries(name, S.chainTvl(name)).map((v, i) => ({ date: i, tvl: v }));
  }
  if (u.pathname.includes('/bridgevolume/'))
    return S.bridgeSeries(u.searchParams.get('id') || '0')
      .map((v, i) => ({ date: i, depositUSD: v / 2, withdrawUSD: v / 2 }));
  if (u.host === 'tokens.uniswap.org')
    return { tokens: S.uniTokens.map(([symbol, address, chainId]) =>
      ({ chainId, address, symbol, name: symbol })) };
  if (u.host.includes('jup.ag'))
    return S.jupTokens.map(([symbol, id]) => ({ id, symbol, name: symbol, isVerified: true }));
  if (u.pathname.includes('/stablecoincharts/')) {
    const sid = u.searchParams.get('stablecoin') || '0';
    const now = S.stables.find(x => x.id === sid)?.circulating?.peggedUSD || 4e10;
    return S.tvlSeries('s' + sid, now).map((v, i) => ({ date: i, totalCirculating: { peggedUSD: v } }));
  }
  if (u.pathname.includes('/protocol/')) {
    const slug = u.pathname.split('/').pop();
    const now = S.protocols.find(p => p.slug === slug)?.tvl || 1e9;
    return { tvl: S.tvlSeries(slug, now).map((v, i) => ({ date: i, totalLiquidityUSD: v })) };
  }
  if (u.pathname.endsWith('/stablecoins')) return { peggedAssets: S.stables };
  if (u.pathname.endsWith('/bridges')) return { bridges: S.bridges };
  if (u.pathname.endsWith('/raises')) return { raises: S.raises };
  if (u.pathname.endsWith('/hacks')) return S.hacks;
  if (u.pathname.includes('/dex/search')) return { pairs: S.pairs(u.searchParams.get('q') || '') };
  if (u.pathname.includes('/search/pools')) return { data: S.gtSearch(u.searchParams.get('query') || '') };
  if (/\/networks\/[^/]+\/pools$/.test(u.pathname)) return { data: S.chainPools(u.pathname.split('/')[3]) };
  if (u.pathname.includes('/ohlcv/')) return { data: { attributes: { ohlcv_list: S.ohlcv(u.pathname, 60) } } };
  if (u.pathname.endsWith('/klines')) return S.klines(u.searchParams.get('symbol') || '', 100);
  if (u.pathname.endsWith('/tickers')) return [];
  if (u.pathname.endsWith('/collections')) return S.nfts;
  if (u.pathname.includes('popular_collections')) return S.meNfts;
  if (u.pathname.includes('trending_pools')) return { data: S.trending };
  return null;
}

async function get(url, opts) {
  try { return await fetchJson(url, opts); }
  catch (e) {
    const s = sampleFor(url);
    if (!s) throw e;
    flags.sample = true;
    return s;
  }
}

async function fetchJson(url, { tries = 2, timeout = 25000, post = null } = {}) {
  // one source speaks GraphQL; everything else is a plain GET
  const init = post
    ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(post) }
    : {};
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (e) {
      if (i >= tries - 1) throw new ApiError(reachMessage(url, e));
      await sleep(600 * 2 ** i); continue;
    }
    if (r.status === 429) {
      if (i >= tries - 1) throw new ApiError(`Rate limited by ${hostOf(url)}. Give it a minute.`, { rateLimited: true });
      await sleep(2500 * 2 ** i); continue;
    }
    if (!r.ok) {
      if (i >= tries - 1) throw new ApiError(`${hostOf(url)} returned HTTP ${r.status}.`);
      await sleep(600 * 2 ** i); continue;
    }
    return r.json();
  }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Session cache, two tiers. sessionStorage survives a reload but silently
   refuses anything over its quota — the pool payload alone is ~10MB — so a
   memory tier sits in front of it, otherwise every large fetch is a cache miss
   forever. Stale entries are still served if a refetch fails. */
const TTL = 5 * 60 * 1000;
const inflight = new Map(), mem = new Map();
export function clearCache() {
  mem.clear(); inflight.clear();
  try { Object.keys(sessionStorage).forEach(k => k.startsWith('atlas:') && sessionStorage.removeItem(k)); } catch {}
}
function cache(key, ttl, fn) {
  if (inflight.has(key)) return inflight.get(key);
  let hit = mem.get(key) || null;
  if (!hit) try { hit = JSON.parse(sessionStorage.getItem('atlas:' + key) || 'null'); } catch {}
  if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.v);
  const p = fn().then(v => {
    const rec = { t: Date.now(), v };
    mem.set(key, rec);
    try { sessionStorage.setItem('atlas:' + key, JSON.stringify(rec)); } catch {}
    inflight.delete(key);
    return v;
  }).catch(e => {
    inflight.delete(key);
    if (hit) return hit.v;           // serve stale rather than nothing
    throw e;
  });
  inflight.set(key, p);
  return p;
}

/* ---------- normalise ---------- */
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
const colorOf = s => `hsl(${hue(s)} 72% 62%)`;
const title = s => s.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()).replace(/\bV(\d)/g, 'v$1');

/* The markets call already asks for 7d, 30d and 1y moves and returns supply and
   all-time-high alongside them. All of it was being dropped on the floor; the
   request is unchanged, the row now carries what it paid for. */
function asset(c, chain) {
  const sym = (c.symbol || '?').toUpperCase();
  const spark = c.sparkline_in_7d?.price || [];
  const price = c.current_price ?? 0;
  return {
    kind: 'asset', id: `a:${c.id}`, cg: c.id, sym, name: c.name || sym, img: c.image,
    chain, price, chg: c.price_change_percentage_24h ?? 0,
    chg7d: num(c.price_change_percentage_7d_in_currency),
    chg30d: num(c.price_change_percentage_30d_in_currency),
    chg1y: num(c.price_change_percentage_1y_in_currency),
    mcap: c.market_cap ?? 0, vol: c.total_volume ?? 0, rank: c.market_cap_rank,
    fdv: num(c.fully_diluted_valuation), supply: num(c.circulating_supply),
    maxSupply: num(c.max_supply), high24: num(c.high_24h), low24: num(c.low_24h),
    ath: num(c.ath), athChg: num(c.ath_change_percentage),
    // turnover is the one liquidity read that compares a $2T asset to a $2M one
    turn: c.market_cap ? num(c.total_volume) / c.market_cap * 100 : 0,
    spark: spark.slice(-24), color: colorOf(sym),
    key: `${sym} ${c.name || ''} ${CH[chain]?.name || ''} token coin asset price`,
  };
}

function pool(p, lb) {
  const chain = BY_LLAMA[p.chain];
  const sym = (p.symbol || '?').toUpperCase();
  const supplyUsd = lb.totalSupplyUsd || p.tvlUsd || 0;
  const borrowUsd = lb.totalBorrowUsd || 0;
  const proto = title(p.project || '');
  return {
    kind: 'pool', id: `p:${p.pool}`, pool: p.pool, proto, slug: p.project || '', sym, chain,
    sup: p.apy ?? p.apyBase ?? 0,
    supBase: p.apyBase ?? 0, supReward: p.apyReward ?? 0,
    bor: (lb.apyBaseBorrow ?? 0) - (lb.apyRewardBorrow ?? 0),
    borBase: num(lb.apyBaseBorrow), borReward: num(lb.apyRewardBorrow),
    tvl: p.tvlUsd ?? 0, supplyUsd, borrowUsd,
    util: supplyUsd > 0 ? Math.min(100, borrowUsd / supplyUsd * 100) : 0,
    mean30: num(p.apyMean30d), stable: !!p.stablecoin,
    // free liquidity is what you can actually withdraw or borrow right now
    free: Math.max(0, supplyUsd - borrowUsd),
    ltv: lb.ltv ?? 0, meta: p.poolMeta || '', color: colorOf(sym),
    key: `${proto} ${sym} ${CH[chain]?.name || ''} ${p.poolMeta || ''} lending lend borrow supply pool market yield apy earn`,
  };
}

/* ---------- public API ---------- */

/** Top assets. `chainId` null = global market leaders, else that chain's ecosystem. */
/* CoinGecko refuses some browser origins outright, which used to take the whole
   asset layer with it. Two independent price sources are tried and the first
   that answers wins; CoinPaprika also carries 7d/30d/1y moves, which the charts
   use to label a range. */
function paprikaAsset(p, i) {
  const q = p.quotes?.USD || {};
  const sym = String(p.symbol || '?').toUpperCase();
  return {
    kind: 'asset', id: `a:${p.id}`, cg: null, sym, name: p.name || sym, img: null,
    chain: null, price: num(q.price), chg: num(q.percent_change_24h),
    chg7d: num(q.percent_change_7d), chg30d: num(q.percent_change_30d),
    chg1y: num(q.percent_change_1y), ath: num(q.ath_price),
    athChg: num(q.percent_from_price_ath), supply: num(p.circulating_supply),
    maxSupply: num(p.max_supply), high24: 0, low24: 0,
    turn: q.market_cap ? num(q.volume_24h) / num(q.market_cap) * 100 : 0,
    mcap: num(q.market_cap), vol: num(q.volume_24h), rank: p.rank || i + 1, spark: [],
    color: colorOf(sym),
    key: `${sym} ${p.name || ''} token coin asset price`,
  };
}

/** Top assets by market cap, from whichever price source is reachable. */
export function loadAssets() {
  return cache('assets:all', TTL, async () => {
    const cg = get(`${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1` +
      `&sparkline=true&price_change_percentage=24h,7d,30d,1y`);
    const pk = get(`${PAPRIKA}/tickers?quotes=USD`, { timeout: 30000 });
    const [a, b] = await Promise.allSettled([cg, pk]);
    if (a.status === 'fulfilled' && Array.isArray(a.value) && a.value.length)
      return a.value.map(c => asset(c, null));
    if (b.status === 'fulfilled' && Array.isArray(b.value) && b.value.length)
      return b.value.slice(0, 150).map(paprikaAsset);
    throw a.reason || b.reason || new ApiError('No price source answered.');
  });
}

/* ---------- tokenized stocks ----------
   Equities issued onchain — Backed's xStocks, Ondo, Dinari and the rest. They
   price like an asset and reuse that normaliser, but they are not crypto and
   they are not curated by the same floors, so they are their own kind behind
   their own switch. Two stock-specific CoinGecko categories are merged; if one
   slug drifts the other still answers, and neither pulls in the wider RWA bucket
   of treasuries and gold, which are not stocks. */
const STOCK_CATS = ['tokenized-stock', 'xstocks-ecosystem'];

/** "TSLAx" tracks TSLA. Only strip a trailing x, and only when what is left
    still looks like a ticker — guessing harder than that invents provenance. */
function underlying(sym, name) {
  const m = /^([A-Z0-9]{1,5})X$/.exec(sym);
  if (m && /x ?stock|tokenized|backed|ondo|dinari/i.test(name || '')) return m[1];
  return /^[A-Z0-9]{1,5}$/.test(sym) && /x ?stock|tokenized/i.test(name || '') ? sym : null;
}

export function loadStocks() {
  return cache('stocks', TTL, async () => {
    const got = await Promise.allSettled(STOCK_CATS.map(c =>
      get(`${CG}/coins/markets?vs_currency=usd&category=${c}&order=market_cap_desc` +
        `&per_page=100&page=1&sparkline=true&price_change_percentage=24h,7d,30d`, { tries: 1 })));
    const seen = new Set(), out = [];
    for (const r of got) {
      if (r.status !== 'fulfilled' || !Array.isArray(r.value)) continue;
      for (const c of r.value) {
        if (!c?.id || seen.has(c.id)) continue;
        seen.add(c.id);
        const a = asset(c, null);
        out.push({ ...a, kind: 'stock', id: `t:${c.id}`,
          under: underlying(a.sym, a.name),
          key: `${a.sym} ${a.name} tokenized stock equity share rwa` });
      }
    }
    return out.sort((x, y) => y.mcap - x.mcap);
  });
}

/* GeckoTerminal network slugs. A chain missing here simply has no per-chain
   token list; everything else about it still works. */
const GT_NET = { eth: 'eth', sol: 'solana', base: 'base', arb: 'arbitrum', bnb: 'bsc',
  poly: 'polygon_pos', avax: 'avax', op: 'optimism', sui: 'sui-network', apt: 'aptos',
  ton: 'ton', tron: 'tron', bera: 'berachain', sonic: 'sonic', mnt: 'mantle',
  blast: 'blast', scrl: 'scroll', linea: 'linea', zks: 'zksync', sei: 'sei-evm',
  uni: 'unichain', ink: 'ink', abs: 'abstract', hl: 'hyperliquid', celo: 'celo',
  monad: 'monad', plume: 'plume', story: 'story' };

/** The tokens actually trading on one chain. */
export function loadChainTokens(chainId) {
  const net = GT_NET[chainId];
  if (!net) return Promise.resolve([]);
  return cache(`chaintok:${chainId}`, TTL, async () => {
    const j = await get(`${GT}/networks/${net}/pools?page=1`, { tries: 1 }).catch(() => null);
    return mergePairs([(j?.data || []).map(gtPool)]).map(p => ({ ...p, chain: chainId })).slice(0, 40);
  });
}

/* A headline APY on its own says nothing about whether the rate will still be
   there tomorrow. The same payload carries the 30-day mean, the 30-day drift and
   DeFiLlama's own outlook, and those are what separate a real yield from a rate
   that spiked this morning. */
const OUTLOOK = { Stable: 'holding', Up: 'rising', Down: 'falling' };

function farm(p) {
  const sym = (p.symbol || '?').toUpperCase();
  const proto = title(p.project || '');
  const chain = BY_LLAMA[p.chain];
  const apy = num(p.apy ?? p.apyBase);
  const mean = num(p.apyMean30d);
  return {
    kind: 'yield', id: `y:${p.pool}`, pool: p.pool, proto, slug: p.project || '', sym, chain,
    apy, apyBase: num(p.apyBase), apyReward: num(p.apyReward),
    mean30: mean, drift30: num(p.apyPct30D),
    // how far today sits above its own month — 2 means the rate has doubled
    spike: mean > 0 ? apy / mean : 0,
    outlook: OUTLOOK[p.predictions?.predictedClass] || '',
    conf: num(p.predictions?.predictedProbability),
    sigma: num(p.sigma), exposure: p.exposure || '', outlier: !!p.outlier,
    rewards: (p.rewardTokens || []).length,
    tvl: num(p.tvlUsd), meta: p.poolMeta || '', stable: !!p.stablecoin,
    risk: p.ilRisk || '', color: colorOf(sym),
    key: `${proto} ${sym} ${CH[chain]?.name || ''} ${p.poolMeta || ''} yield farm pool apy earn staking liquidity`,
  };
}

// Borrow-side fields live on the pool itself in some responses and only in
// /lendBorrow in others. Accept either, so neither shape breaks lending.
const borrowOf = p => p.totalSupplyUsd != null || p.apyBaseBorrow != null
  ? { apyBaseBorrow: p.apyBaseBorrow, apyRewardBorrow: p.apyRewardBorrow,
      totalSupplyUsd: p.totalSupplyUsd, totalBorrowUsd: p.totalBorrowUsd, ltv: p.ltv }
  : null;

/** Lending markets and yield farms — one ~10MB payload feeds both. */
export function loadPools() {
  return cache('pools', TTL, async () => {
    const [pools, lend] = await Promise.all([
      get(`${YIELDS}/pools`, { timeout: 60000 }),
      get(`${YIELDS}/lendBorrow`).catch(() => null),     // enrichment, not required
    ]);
    const lb = Object.fromEntries((lend || []).map(x => [x.pool, x]));
    const rows = (pools?.data || []).filter(p => BY_LLAMA[p.chain]);
    const lending = rows
      .map(p => [p, lb[p.pool] || borrowOf(p)])
      .filter(([p, b]) => b && (b.totalSupplyUsd || p.tvlUsd || 0) > 5e5)
      .map(([p, b]) => pool(p, b))
      .sort((a, b) => b.supplyUsd - a.supplyUsd)
      .slice(0, 1200);
    const borrowed = new Set(lending.map(l => l.pool));
    const yields = rows
      .filter(p => !borrowed.has(p.pool) && num(p.tvlUsd) > 1e6 && num(p.apy ?? p.apyBase) > 0)
      .map(farm)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 1200);
    return { lending, yields };
  });
}

const OHLCV = { 1: ['hour', 24], 7: ['hour', 168], 30: ['day', 30], 90: ['day', 90], 365: ['day', 365] };

/* Charts must always draw. Sources are tried in order and, if none answers,
   a flat series at the current value is returned with live:false so the UI can
   say so rather than showing an empty box. */
const KLINE = { 1: ['15m', 96], 7: ['1h', 168], 30: ['4h', 180], 90: ['12h', 180], 365: ['1d', 365] };

/* Both candle sources hand back high, low and volume alongside the close, and
   we were keeping only the close. Same request, three more encodings. */
function candles(rows, h, l, c, v) {
  const s = { pts: [], hi: [], lo: [], vol: [] };
  for (const r of rows || []) {
    const close = Number(r[c]);
    if (!Number.isFinite(close)) continue;
    s.pts.push(close);
    s.hi.push(Number(r[h]) || close);
    s.lo.push(Number(r[l]) || close);
    s.vol.push(Math.max(0, Number(r[v]) || 0));
  }
  return s;
}

async function binance(sym, days) {
  const [interval, limit] = KLINE[days] || KLINE[30];
  const j = await get(`${BINANCE}/klines?symbol=${encodeURIComponent(sym)}USDT&interval=${interval}&limit=${limit}`,
    { tries: 1, timeout: 12000 });
  // [openTime, o, h, l, c, baseVol, closeTime, quoteVol, ...] — quote volume is USDT
  return candles(Array.isArray(j) ? j : [], 2, 3, 4, 7);
}

/** OHLCV for one GeckoTerminal pool. Rows arrive newest first. */
async function poolCandles(net, addr, days) {
  const [tf, limit] = OHLCV[days] || OHLCV[7];
  const j = await get(`${GT}/networks/${net}/pools/${encodeURIComponent(addr)}/ohlcv/${tf}?limit=${limit}`,
    { tries: 1, timeout: 12000 });
  const rows = (j?.data?.attributes?.ohlcv_list || []).slice().reverse();
  return candles(rows, 2, 3, 4, 5);
}

/* Last resort before giving up on an asset: it is not on CoinGecko and not on
   Binance, but if anyone trades it at all there is a pool somewhere. Find the
   deepest one and chart that. */
async function poolChartFor(sym, days) {
  const j = await get(`${GT}/search/pools?query=${encodeURIComponent(sym)}&page=1`,
    { tries: 1, timeout: 12000 });
  const best = (j?.data || [])
    .map(row => ({ net: String(row.id || '').split('_')[0],
      addr: row.attributes?.address, liq: Number(row.attributes?.reserve_in_usd) || 0 }))
    .filter(p => p.net && p.addr)
    .sort((x, y) => y.liq - x.liq)[0];
  return best ? poolCandles(best.net, best.addr, days) : { pts: [] };
}

const flat = v => Array.from({ length: 24 }, () => Number(v) || 0);
// Daily series share one rule: take the tail the range asks for, and never
// hand back an empty chart — a flat line at the current value says more.
const slice = (all, days, now) => {
  const pts = days >= 3650 ? all : all.slice(-days);
  return pts.length > 1 ? { pts, live: true } : { pts: flat(now), live: false };
};

/** Asset price history, days: 1 | 7 | 30 | 365. Five sources, in order of how
    much they know, so a chart is only ever flat when nobody trades the thing. */
export function loadAssetChart(a, days) {
  return cache(`chart:${a.id}:${days}`, TTL, async () => {
    if (a.cg) {
      try {
        const j = await get(`${CG}/coins/${encodeURIComponent(a.cg)}/market_chart?vs_currency=usd&days=${days}`);
        const pts = (j?.prices || []).map(p => p[1]).filter(Number.isFinite);
        // market_chart carries volume in the same payload; it was being dropped
        const vol = (j?.total_volumes || []).map(p => p[1]).filter(Number.isFinite);
        if (pts.length > 1) return { pts, vol: vol.length === pts.length ? vol : null, live: true };
      } catch { /* try the next source */ }
    }
    try {
      const s = await binance(a.sym, days);
      if (s.pts.length > 1) return { ...s, live: true };
    } catch { /* try the next source */ }
    try {
      const s = await poolChartFor(a.sym, days);       // whoever does trade it
      if (s.pts.length > 1) return { ...s, live: true, via: 'a DEX pool' };
    } catch { /* try the next source */ }
    if (days <= 7 && a.spark?.length > 1) return { pts: a.spark, live: true };
    return { pts: flat(a.price), live: false };
  });
}

/** DEX pair history from GeckoTerminal OHLCV, then by symbol if the pool
    address does not resolve — a pair is never left without a chart. */
export function loadPairChart(p, days) {
  return cache(`pchart:${p.id}:${days}`, TTL, async () => {
    const net = GT_NET[p.chain];
    if (net && p.addr) {
      try {
        const s = await poolCandles(net, p.addr, days);
        if (s.pts.length > 1) return { ...s, live: true };
      } catch { /* fall through */ }
    }
    try {
      const s = await poolChartFor(p.sym, days);
      if (s.pts.length > 1) return { ...s, live: true, via: 'the deepest pool for this ticker' };
    } catch { /* fall through */ }
    return { pts: flat(p.price), live: false };
  });
}

/** APY history for a lending market or a yield farm — same endpoint, and the
    two kinds name their headline rate differently. */
export function loadPoolChart(pool, days) {
  return cache(`apy:${pool.pool}`, TTL, async () => {
    const j = await get(`${YIELDS}/chart/${encodeURIComponent(pool.pool)}`).catch(() => null);
    return (j?.data || []).map(d => num(d.apy));
  }).then(all => slice(all, days, pool.sup ?? pool.apy));
}

/* ---------- protocols, chains, stablecoins ---------- */
const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

function protocol(p, dex, fee, perp, opt) {
  const chains = (p.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
  const name = p.name || p.slug || '?';
  return {
    kind: 'protocol', id: `r:${p.slug || slugOf(name)}`, slug: p.slug || slugOf(name),
    name, cat: p.category || 'DeFi', chains, chain: chains[0] || null,
    tvl: num(p.tvl), chg1d: num(p.change_1d), chg7d: num(p.change_7d),
    url: safeUrl(p.url), img: p.logo || null, color: colorOf(name),
    vol24: num(dex?.total24h), fees24: num(fee?.total24h),
    rev24: num(fee?.revenue24h ?? fee?.dailyRevenue),
    perps24: num(perp?.total24h), opts24: num(opt?.total24h),
    key: `${name} ${p.category || ''} ${(p.chains || []).join(' ')} protocol dapp defi tvl`,
  };
}

/** Protocols, with DEX volume and fee/revenue folded in where they exist. */
export function loadProtocols() {
  return cache('protocols', TTL, async () => {
    const q = '?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
    const [ps, dex, fees, perps, opts] = await Promise.all([
      get(`${LLAMA}/protocols`, { timeout: 60000 }),
      get(`${LLAMA}/overview/dexs${q}`).catch(() => null),          // all enrichment,
      get(`${LLAMA}/overview/fees${q}`).catch(() => null),          // none required
      get(`${LLAMA}/overview/derivatives${q}`).catch(() => null),
      get(`${LLAMA}/overview/options${q}`).catch(() => null),
    ]);
    const index = l => Object.fromEntries((l?.protocols || []).map(x => [slugOf(x.name), x]));
    const dv = index(dex), fv = index(fees), pv = index(perps), ov = index(opts);
    return (Array.isArray(ps) ? ps : [])
      .filter(p => num(p.tvl) > 1e6)
      .map(p => protocol(p, dv[slugOf(p.name)], fv[slugOf(p.name)], pv[slugOf(p.name)], ov[slugOf(p.name)]))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 500);
  });
}

/* ---------- verification ----------
   The duplicate-ticker heuristic can only guess which SOL/USDC/PEPE is the real
   one. Two registries answer it outright: the Uniswap token list is the EVM
   side's curated set, and Jupiter publishes a verified tag for Solana. Both are
   static, keyless and CORS-open. Neither is required — when they do not answer
   the heuristic stands on its own, exactly as before. */

// EVM chain ids, for the token list's `chainId` field
const EVM = { 1: 'eth', 10: 'op', 56: 'bnb', 137: 'poly', 8453: 'base', 42161: 'arb',
  43114: 'avax', 324: 'zks', 59144: 'linea', 534352: 'scrl', 81457: 'blast', 5000: 'mnt',
  130: 'uni', 57073: 'ink', 146: 'sonic', 80094: 'bera', 1329: 'sei', 2741: 'abs' };

const addSym = (set, sym, chain) => sym && set.add(`${String(sym).toUpperCase()}@${chain}`);

async function uniswapList() {
  const j = await get(UNI, { tries: 1, timeout: 20000 }).catch(() => null);
  const out = { syms: new Set(), addrs: new Set() };
  for (const t of j?.tokens || []) {
    const chain = EVM[t.chainId];
    if (chain) addSym(out.syms, t.symbol, chain);
    if (t.address) out.addrs.add(String(t.address).toLowerCase());
  }
  return out;
}

async function jupiterList() {
  const j = await get(`${JUP}/tokens/v2/tag?query=verified`, { tries: 1, timeout: 20000 })
    .catch(() => null);
  const out = { syms: new Set(), addrs: new Set() };
  // the field carrying the mint has moved between versions; accept any of them
  for (const t of Array.isArray(j) ? j : j?.tokens || []) {
    addSym(out.syms, t.symbol, 'sol');
    const mint = t.id || t.address || t.mint;
    if (mint) out.addrs.add(String(mint).toLowerCase());
  }
  return out;
}

/* Two registries, kept apart so a row can name the one that vouched for it —
   "listed by Jupiter" says more than "listed". Sets are not JSON, so this one
   is memory-only. */
let verified = null;
export function loadVerified() {
  if (verified) return verified;
  verified = Promise.all([uniswapList(), jupiterList()]).then(([a, b]) => ({
    by: [['Uniswap', a], ['Jupiter', b]],
    count: a.syms.size + b.syms.size,
  })).catch(() => ({ by: [], count: 0 }));
  return verified;
}

/* ---------- Morpho ----------
   Morpho Blue is thousands of isolated lending markets, each its own pair of a
   collateral and a loan asset. DeFiLlama indexes the largest of them and stops;
   the protocol publishes all of them over a keyless GraphQL endpoint. Rows that
   arrive here join the lending category alongside everything else, deduped
   against what DeFiLlama already returned. */
const MORPHO_Q = `{ markets(first: 200, orderBy: SupplyAssetsUsd, orderDirection: Desc,
  where: { whitelisted: true }) { items {
    uniqueKey lltv
    loanAsset { symbol } collateralAsset { symbol }
    morphoBlue { chain { id } }
    state { supplyApy borrowApy supplyAssetsUsd borrowAssetsUsd utilization } } } }`;

function morphoMarket(m) {
  const chain = EVM[m?.morphoBlue?.chain?.id];
  const sym = (m?.loanAsset?.symbol || '?').toUpperCase();
  const supplyUsd = num(m?.state?.supplyAssetsUsd);
  const borrowUsd = num(m?.state?.borrowAssetsUsd);
  // wstETH and cbBTC are not WSTETH and CBBTC; the collateral is prose here, not
  // a key, so it keeps the casing its issuer gave it
  const coll = m?.collateralAsset?.symbol ? String(m.collateralAsset.symbol) : '';
  return {
    kind: 'pool', id: `p:morpho:${m.uniqueKey}`, pool: m.uniqueKey, proto: 'Morpho',
    slug: 'morpho-blue', sym, chain,
    // the API reports rates as fractions, the rest of the app in percent
    sup: num(m?.state?.supplyApy) * 100, supBase: num(m?.state?.supplyApy) * 100, supReward: 0,
    bor: num(m?.state?.borrowApy) * 100, borBase: num(m?.state?.borrowApy) * 100, borReward: 0,
    tvl: supplyUsd, supplyUsd, borrowUsd,
    util: supplyUsd > 0 ? Math.min(100, borrowUsd / supplyUsd * 100) : 0,
    free: Math.max(0, supplyUsd - borrowUsd),
    mean30: 0, stable: false,
    // lltv arrives as an 18-decimal fixed-point integer
    ltv: m?.lltv ? Number(m.lltv) / 1e18 : 0,
    meta: coll ? `${coll} collateral` : '', color: colorOf(sym), source: 'Morpho',
    key: `morpho ${sym} ${coll} ${CH[chain]?.name || ''} lending lend borrow supply market isolated`,
  };
}

/** Whitelisted Morpho markets. Optional: a failure leaves lending as it was. */
export function loadMorpho() {
  return cache('morpho', TTL, async () => {
    const j = await get(MORPHO, { tries: 1, timeout: 25000, post: { query: MORPHO_Q } })
      .catch(() => null);
    return (j?.data?.markets?.items || [])
      .map(morphoMarket)
      .filter(m => m.chain && m.supplyUsd >= 1e6)
      .sort((a, b) => b.supplyUsd - a.supplyUsd)
      .slice(0, 300);
  });
}

/** Daily bridge volume — the last kind with history and no chart. */
export function loadBridgeChart(b, days) {
  return cache(`bchart:${b.bid}`, TTL, async () => {
    const j = await get(`${BRIDGES}/bridgevolume/all?id=${encodeURIComponent(b.bid)}`,
      { tries: 1, timeout: 25000 }).catch(() => null);
    const pts = (Array.isArray(j) ? j : [])
      .map(r => num(r.depositUSD) + num(r.withdrawUSD))
      .filter(v => v > 0);
    return pts.length > 1 ? { pts } : null;
  }).then(s => s ? { pts: s.pts.slice(-days), live: true }
    : { pts: [b.vol24, b.vol24], live: false });
}

/** The supported chains, carrying their live TVL. */
export function loadChains() {
  return cache('chains', TTL, async () => {
    const rows = await get(`${LLAMA}/v2/chains`).catch(() => []);
    const tvl = Object.fromEntries((rows || []).map(c => [c.name, num(c.tvl)]));
    return CHAINS.map(([id, name, color, llama]) => ({
      kind: 'chain', id: `c:${id}`, chain: id, name, color, llama,
      tvl: tvl[llama] || 0,
      key: `${name} ${llama} chain network l1 l2 blockchain`,
    })).sort((a, b) => b.tvl - a.tvl);
  });
}

/** Stablecoins: searchable in their own right, and a peg lookup for assets. */
export function loadStables() {
  return cache('stables', TTL, async () => {
    const j = await get(`${STABLE}/stablecoins?includePrices=true`).catch(() => null);
    const rows = (j?.peggedAssets || [])
      .map(s => {
        const sym = String(s.symbol || '?').toUpperCase();
        const chains = (s.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'stablecoin', id: `s:${s.id ?? sym}`, sid: s.id ?? '', sym, name: s.name || sym,
          circulating: num(s.circulating?.peggedUSD), price: num(s.price) || 1,
          peg: s.pegType || 'peggedUSD', mech: title(s.pegMechanism || ''),
          chains, chain: chains[0] || null, color: colorOf(sym),
          key: `${s.name || ''} ${sym} stablecoin peg ${s.pegMechanism || ''} ${(s.chains || []).join(' ')}`,
        };
      })
      .filter(s => s.circulating > 1e6)
      .sort((a, b) => b.circulating - a.circulating)
      .slice(0, 120);
    return { rows, bySym: Object.fromEntries(rows.map(s => [s.sym, s])) };
  });
}

/** Cross-chain bridges, by recent volume. */
export function loadBridges() {
  return cache('bridges', TTL, async () => {
    const j = await get(`${BRIDGES}/bridges?includeChains=true`).catch(() => null);
    return (j?.bridges || [])
      .map(b => {
        const chains = (b.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        const name = b.displayName || b.name || '?';
        return {
          kind: 'bridge', id: `b:${b.id ?? slugOf(name)}`, name, bid: b.id ?? '',
          vol24: num(b.lastDailyVolume ?? b.volumePrevDay), volPrev: num(b.volumePrev2Day),
          chains, chain: chains[0] || null, color: colorOf(name),
          key: `${name} bridge cross-chain transfer ${(b.chains || []).join(' ')}`,
        };
      })
      .filter(b => b.vol24 > 0)
      .sort((a, b) => b.vol24 - a.vol24)
      .slice(0, 120);
  });
}

/** Funding rounds. */
export function loadRaises() {
  return cache('raises', TTL, async () => {
    const j = await get(`${LLAMA}/raises`, { timeout: 45000 }).catch(() => null);
    return (j?.raises || [])
      .filter(r => num(r.amount) > 0 && r.name)
      .map(r => {
        const investors = [...(r.leadInvestors || []), ...(r.otherInvestors || [])];
        const chains = (r.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'raise', id: `f:${slugOf(r.name)}-${r.date}`, name: r.name,
          amount: num(r.amount) * 1e6, round: r.round || '', date: num(r.date) * 1000,
          sector: r.sector || r.category || '', investors,
          // amount comes in millions, valuation in whole dollars — accept either
          valuation: num(r.valuation) > 1e5 ? num(r.valuation) : num(r.valuation) * 1e6,
          source: safeUrl(r.source), chains, chain: chains[0] || null, color: colorOf(r.name),
          key: `${r.name} ${r.round || ''} ${r.sector || ''} funding raise round investors ${investors.join(' ')}`,
        };
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 600);
  });
}

/** Exploits and hacks. */
export function loadHacks() {
  return cache('hacks', TTL, async () => {
    const rows = await get(`${LLAMA}/hacks`, { timeout: 45000 }).catch(() => null);
    return (Array.isArray(rows) ? rows : [])
      .filter(h => num(h.amount) > 0 && h.name)
      .map(h => {
        const list = h.chains || (h.chain ? [h.chain] : []);
        const chains = list.map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'hack', id: `h:${slugOf(h.name)}-${h.date}`, name: h.name,
          amount: num(h.amount), date: num(h.date) * 1000,
          technique: h.technique || h.classification || 'Exploit',
          source: safeUrl(h.source), chains, chain: chains[0] || null, color: '#ff6b81',
          key: `${h.name} hack exploit ${h.technique || ''} ${h.classification || ''} ${list.join(' ')}`,
        };
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 400);
  });
}

/** Chain TVL history — the one kind whose sheet had no chart at all. */
export function loadChainChart(c, days) {
  return cache(`cchart:${c.chain}`, TTL, async () => {
    const name = CH[c.chain]?.llama || c.name;
    const j = await get(`${LLAMA}/v2/historicalChainTvl/${encodeURIComponent(name)}`, { timeout: 45000 })
      .catch(() => null);
    return (Array.isArray(j) ? j : []).map(p => num(p.tvl)).filter(v => v > 0);
  }).then(all => slice(all, days, c.tvl));
}

/** Stablecoin circulating supply history. */
export function loadStableChart(s, days) {
  return cache(`schart:${s.id}`, TTL, async () => {
    if (!s.sid) return [];
    const j = await get(`${STABLE}/stablecoincharts/all?stablecoin=${encodeURIComponent(s.sid)}`,
      { tries: 1, timeout: 30000 }).catch(() => null);
    return (Array.isArray(j) ? j : []).map(p => num(p.totalCirculating?.peggedUSD)).filter(v => v > 0);
  }).then(all => slice(all, days, s.circulating));
}

/** Protocol TVL history. */
export function loadProtocolChart(r, days) {
  return cache(`rchart:${r.slug}`, TTL, async () => {
    const j = await get(`${LLAMA}/protocol/${encodeURIComponent(r.slug)}`, { timeout: 45000 }).catch(() => null);
    return (j?.tvl || []).map(p => num(p.totalLiquidityUSD));
  }).then(all => slice(all, days, r.tvl));
}

/* ---------- DEX pairs ----------
   Long-tail tokens cannot be pre-indexed — there are millions of pairs and new
   ones every minute — so DexScreener is queried live per search and merged in.
   GeckoTerminal's trending pools give the same kind something to show before
   anyone types. */
const DEX_CHAIN = { solana: 'sol', ethereum: 'eth', base: 'base', arbitrum: 'arb',
  optimism: 'op', polygon: 'poly', bsc: 'bnb', avalanche: 'avax', sui: 'sui',
  aptos: 'apt', hyperliquid: 'hl' };

/* A pair keeps its network even when it is not one of the twelve we filter by —
   restricting the long tail to known chains was throwing away most of it. */
const netName = id => CH[DEX_CHAIN[id]]?.name || title(String(id || '').replace(/[-_]/g, ' '));

function pairOf(p) {
  const base = p.baseToken || {};
  const sym = String(base.symbol || '?').toUpperCase();
  const dex = title(p.dexId || 'DEX');
  return {
    kind: 'pair', id: `d:${p.pairAddress || base.address}`, sym,
    name: base.name || sym, addr: base.address || '', dex,
    chain: DEX_CHAIN[p.chainId] || null, net: netName(p.chainId),
    price: Number(p.priceUsd) || 0, chg: num(p.priceChange?.h24),
    liq: num(p.liquidity?.usd), vol24: num(p.volume?.h24), fdv: num(p.fdv),
    quote: String(p.quoteToken?.symbol || '').toUpperCase(),
    url: safeUrl(p.url), color: colorOf(sym),
    key: `${sym} ${base.name || ''} ${dex} ${netName(p.chainId)} dex pair token memecoin swap trade`,
  };
}

/** GeckoTerminal returns JSON:API pools; /search and /trending share this shape. */
function gtPool(row) {
  const a = row.attributes || {};
  const net = String(row.id || '').split('_')[0];
  const [baseSym, quoteSym] = String(a.name || '').split('/').map(s => s.trim().toUpperCase());
  const sym = baseSym || '?';
  return {
    kind: 'pair', id: `d:${a.address || row.id}`, sym, name: a.name || sym,
    addr: a.address || '', dex: 'DEX',
    chain: DEX_CHAIN[net] || null, net: netName(net),
    price: Number(a.base_token_price_usd) || 0,
    chg: Number(a.price_change_percentage?.h24) || 0,
    liq: Number(a.reserve_in_usd) || 0, vol24: Number(a.volume_usd?.h24) || 0,
    fdv: Number(a.fdv_usd) || 0, quote: quoteSym || '', url: '', color: colorOf(sym),
    key: `${sym} ${a.name || ''} ${netName(net)} dex pair token memecoin swap trade`,
  };
}

// A brand-new memecoin can have a few thousand dollars of liquidity. Only drop
// pairs with no measurable activity at all.
const okPair = p => p.liq >= 500 || p.vol24 >= 500;

function mergePairs(lists) {
  const seen = new Set(), out = [];
  for (const p of lists.flat()) {
    if (!p || !okPair(p) || seen.has(p.id)) continue;
    seen.add(p.id); out.push(p);
  }
  return out.sort((a, b) => (b.liq || b.vol24) - (a.liq || a.vol24)).slice(0, 30);
}

/** Live DEX search across two independent indexes, so one being unreachable
    does not take the long tail with it. Errors are reported, never swallowed. */
export function searchPairs(q) {
  const term = q.replace(/^\$+/, '').trim();          // people type $CASHCAT
  return cache(`pairs:${term.toLowerCase()}`, 60000, async () => {
    const [dx, gt] = await Promise.allSettled([
      get(`${DEXS}/latest/dex/search?q=${encodeURIComponent(term)}`, { tries: 1, timeout: 12000 }),
      get(`${GT}/search/pools?query=${encodeURIComponent(term)}&page=1`, { tries: 1, timeout: 12000 }),
    ]);
    const errors = [];
    let rows = [];
    if (dx.status === 'fulfilled') rows.push((dx.value?.pairs || []).map(pairOf));
    else errors.push(`DexScreener: ${dx.reason?.message || 'unreachable'}`);
    if (gt.status === 'fulfilled') rows.push((gt.value?.data || []).map(gtPool));
    else errors.push(`GeckoTerminal: ${gt.reason?.message || 'unreachable'}`);
    return { rows: mergePairs(rows), errors };
  });
}

/** Trending DEX pools, so the kind is populated before anyone searches. */
export function loadTrendingPairs() {
  return cache('trending', TTL, async () => {
    const j = await get(`${GT}/networks/trending_pools?page=1`, { tries: 1 }).catch(() => null);
    return mergePairs([(j?.data || []).map(gtPool)]).slice(0, 40);
  });
}

/* ---------- NFTs ----------
   Keyless, CORS-open NFT data is thin on the ground. DeFiLlama covers the EVM
   marketplaces broadly; Magic Eden adds Solana and Bitcoin Ordinals. Floors
   arrive in different units, so each collection carries a formatted label and
   the two sources are ranked separately rather than compared across units. */
const SOL_LAMPORTS = 1e9;
/* A floor is quoted in the chain's own gas token, not always ETH. Calling a
   Polygon floor "ETH" misprices it by ~1000x, so the unit follows the chain. */
const NFT_UNIT = { eth: 'ETH', base: 'ETH', arb: 'ETH', op: 'ETH', blast: 'ETH', linea: 'ETH',
  scrl: 'ETH', zks: 'ETH', poly: 'POL', bnb: 'BNB', avax: 'AVAX', sol: 'SOL', btc: 'BTC' };

function llamaNft(c) {
  const name = c.name || c.collectionId || '?';
  const floorUsd = num(c.floorPriceUSD ?? c.floorPrice1dUSD);
  const floor = num(c.floorPrice);
  const chain = BY_LLAMA[c.chain] || null;
  return {
    kind: 'nft', id: `n:${c.collectionId || slugOf(name)}`, cid: c.collectionId || '',
    name, sym: String(c.symbol || name).toUpperCase().slice(0, 8),
    img: c.image || c.logo || null, chain,
    // DeFiLlama aggregates every marketplace on a chain; naming one would be a lie
    net: c.chain || 'Ethereum', market: 'DeFiLlama',
    floorUsd, floor, unit: NFT_UNIT[chain] || 'ETH',
    chg1d: num(c.floorPricePctChange1Day), chg7d: num(c.floorPricePctChange7Day),
    volUsd: num(c.dailyVolumeUSD ?? c.totalVolumeUSD), supply: num(c.totalSupply),
    key: `${name} ${c.symbol || ''} nft collection ${c.chain || ''} pfp art collectible`,
  };
}

function meNft(c) {
  const name = c.name || c.symbol || '?';
  const sol = num(c.floorPrice) / SOL_LAMPORTS;
  return {
    kind: 'nft', id: `n:me-${c.symbol || slugOf(name)}`, cid: c.symbol || '',
    name, sym: String(c.symbol || name).toUpperCase().slice(0, 8),
    img: c.image || null, chain: 'sol', net: 'Solana', market: 'Magic Eden',
    floorUsd: 0, floor: sol, unit: 'SOL',
    chg1d: 0, chg7d: 0, volUsd: 0, volSol: num(c.volumeAll) / SOL_LAMPORTS,
    supply: 0,
    key: `${name} ${c.symbol || ''} nft collection solana magic eden pfp art collectible`,
  };
}

/** NFT collections. Two marketplaces, ranked within their own units. */
export function loadNFTs() {
  return cache('nfts', TTL, async () => {
    const [dl, me] = await Promise.allSettled([
      get(`${NFT}/collections`, { timeout: 45000 }),
      get(`${ME}/marketplace/popular_collections`, { tries: 1, timeout: 15000 }),
    ]);
    const a = dl.status === 'fulfilled' && Array.isArray(dl.value)
      ? dl.value.map(llamaNft).filter(n => n.floorUsd || n.floor)
        .sort((x, y) => (y.volUsd || y.floorUsd) - (x.volUsd || x.floorUsd)).slice(0, 300)
      : [];
    const b = me.status === 'fulfilled' && Array.isArray(me.value)
      ? me.value.map(meNft).filter(n => n.floor)
        .sort((x, y) => (y.volSol || 0) - (x.volSol || 0)).slice(0, 60)
      : [];
    if (!a.length && !b.length) throw dl.reason || me.reason || new ApiError('No NFT source answered.');
    return [...a, ...b];
  });
}

/* A collection's own floor history, then the floor moves it already reports.
   The chart endpoint answers for some collections and not others, and the row
   itself carries a 1d and a 7d change — three real observations, which is a
   thin chart but an honest one, and better than a flat line. */
function floorFromMoves(n) {
  const now = n.floorUsd || n.floor;
  if (!now || (!n.chg1d && !n.chg7d)) return null;
  const back = pct => pct ? now / (1 + pct / 100) : now;
  const pts = [back(n.chg7d), back(n.chg1d), now];
  return pts.every(v => Number.isFinite(v) && v > 0) ? pts : null;
}

/** Floor price history for a collection. */
export function loadNftChart(n, days) {
  return cache(`nchart:${n.id}`, TTL, async () => {
    if (!n.cid) return [];
    const j = await get(`${NFT}/chart/${encodeURIComponent(n.cid)}`, { tries: 1, timeout: 20000 })
      .catch(() => null);
    // seen as a bare array, as {data:[...]}, and as rows keyed a few ways
    const rows = Array.isArray(j) ? j : (j?.data || j?.chart || []);
    return rows.map(r => Array.isArray(r) ? num(r[1])
      : num(r.floorPriceUSD ?? r.floorPrice ?? r.floor ?? r.price ?? r.v))
      .filter(v => v > 0);
  }).then(all => {
    const s = slice(all, days, n.floorUsd || n.floor);
    if (s.live) return s;
    const moves = floorFromMoves(n);
    return moves ? { pts: moves, live: true, via: 'its reported 1d and 7d moves' } : s;
  });
}

/* An entity's own description, where its source publishes one. Assets and
   stocks come from CoinGecko, protocols from the payload the TVL chart already
   fetches. One request, cached, and only when a sheet is opened. */
const firstPara = s => {
  const t = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const cut = t.slice(0, 420);
  return (cut.length < t.length ? cut.replace(/\s+\S*$/, '') + '…' : cut);
};

export function loadAbout(it) {
  const cg = it.cg || (it.kind === 'stock' && it.id.slice(2));
  if ((it.kind === 'asset' || it.kind === 'stock') && cg) {
    return cache(`about:${it.id}`, 30 * TTL, async () => {
      const j = await get(`${CG}/coins/${encodeURIComponent(cg)}?localization=false&tickers=false` +
        `&market_data=false&community_data=false&developer_data=false&sparkline=false`,
        { tries: 1, timeout: 15000 }).catch(() => null);
      return firstPara(j?.description?.en);
    });
  }
  // a market is run by a protocol, and that protocol describes itself — one
  // cached request covers protocols and every pool and farm underneath them
  if (it.slug && ['protocol', 'pool', 'yield'].includes(it.kind)) {
    return cache(`about:proto:${it.slug}`, 30 * TTL, async () => {
      const j = await get(`${LLAMA}/protocol/${encodeURIComponent(it.slug)}`, { tries: 1, timeout: 30000 })
        .catch(() => null);
      return firstPara(j?.description);
    });
  }
  return Promise.resolve('');
}

export const links = {
  // a CoinPaprika-sourced asset has no CoinGecko id to link to
  asset: a => a.cg ? `https://www.coingecko.com/en/coins/${encodeURIComponent(a.cg)}`
    : `https://www.coingecko.com/en/search?query=${encodeURIComponent(a.sym)}`,
  stock: a => links.asset(a),
  pool: p => `https://defillama.com/yields/pool/${p.pool}`,
  protocol: r => safeUrl(r.url, `https://defillama.com/protocol/${encodeURIComponent(r.slug)}`),
  stablecoin: () => 'https://defillama.com/stablecoins',
  bridge: () => 'https://defillama.com/bridges',
  raise: r => safeUrl(r.source, 'https://defillama.com/raises'),
  hack: h => safeUrl(h.source, 'https://defillama.com/hacks'),
  yield: y => `https://defillama.com/yields/pool/${y.pool}`,
  nft: n => n.market === 'Magic Eden'
    ? `https://magiceden.io/marketplace/${encodeURIComponent(n.cid)}`
    : `https://defillama.com/nfts/collection/${encodeURIComponent(n.cid)}`,
  pair: p => safeUrl(p.url, `https://dexscreener.com/search?q=${encodeURIComponent(p.addr || p.sym)}`),
  chain: c => `https://defillama.com/chain/${encodeURIComponent(CH[c.chain]?.llama || c.name)}`,
};

/* ---------- where to act on it ----------
   Atlas indexes and explains; it never holds a key, a wallet or a quote. What it
   can do is hand you off to the venue that does, with the token already
   resolved — which is the whole value of having found it here. Every link below
   is a public URL with no account, no SDK and no embedded credential. */

// Matcha's own path segment per network
const MATCHA_NET = { eth: 'ethereum', base: 'base', arb: 'arbitrum', op: 'optimism',
  poly: 'polygon', bnb: 'bsc', avax: 'avalanche', linea: 'linea', scrl: 'scroll',
  blast: 'blast', mnt: 'mantle', uni: 'unichain' };
const netIdOf = i => i.chain
  || Object.entries(CH).find(([, c]) => c.name.toLowerCase() === String(i.net || '').toLowerCase())?.[0];

export function actions(i) {
  const out = [];
  const net = netIdOf(i);
  if ((i.kind === 'pair' || i.kind === 'asset') && i.addr) {
    if (net === 'sol') out.push(['Swap on Jupiter', `https://jup.ag/tokens/${encodeURIComponent(i.addr)}`]);
    else if (MATCHA_NET[net])
      out.push(['Trade on Matcha', `https://matcha.xyz/tokens/${MATCHA_NET[net]}/${encodeURIComponent(i.addr)}`]);
  }
  // MoonPay prices by ticker, and only for what it actually lists — offering it
  // on a long-tail token would send people to an error page
  if ((i.kind === 'asset' || i.kind === 'stock') && i.rank && i.rank <= 60)
    out.push(['Buy with MoonPay', `https://buy.moonpay.com?defaultCurrencyCode=${encodeURIComponent(String(i.sym).toLowerCase())}`]);
  if (i.kind === 'pool' || i.kind === 'yield')
    out.push([`Open ${i.proto}`, safeUrl(i.protocol?.url, `https://defillama.com/protocol/${encodeURIComponent(i.slug)}`)]);
  return out;
}
