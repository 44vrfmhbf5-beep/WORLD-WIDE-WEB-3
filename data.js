/* data.js — live data, no API keys and no backend: every source below allows
   direct browser calls.

     api.coingecko.com      assets, prices, price history
     yields.llama.fi        lending markets, borrow side, market APY history
     api.llama.fi           protocols, TVL history, DEX volume, fees & revenue,
                            per-chain TVL
     stablecoins.llama.fi   stablecoin circulating supply

   They are joined into one index: a lending market carries the protocol behind
   it, a protocol carries the chains it runs on, and every chain knows its own
   assets, markets and protocols. */

const CG = 'https://api.coingecko.com/api/v3';
const YIELDS = 'https://yields.llama.fi';
const LLAMA = 'https://api.llama.fi';
const STABLE = 'https://stablecoins.llama.fi';

// id, label, colour, CoinGecko category slug, DeFiLlama chain name
export const CHAINS = [
  ['sol',  'Solana',      '#14f195', 'solana-ecosystem',    'Solana'],
  ['eth',  'Ethereum',    '#7b8cf5', 'ethereum-ecosystem',  'Ethereum'],
  ['base', 'Base',        '#3b7cff', 'base-ecosystem',      'Base'],
  ['arb',  'Arbitrum',    '#28a0f0', 'arbitrum-ecosystem',  'Arbitrum'],
  ['op',   'Optimism',    '#ff5c6c', 'optimism-ecosystem',  'Optimism'],
  ['poly', 'Polygon',     '#a06bf0', 'polygon-ecosystem',   'Polygon'],
  ['bnb',  'BNB Chain',   '#f0b90b', 'binance-smart-chain', 'BSC'],
  ['avax', 'Avalanche',   '#e84142', 'avalanche-ecosystem', 'Avalanche'],
  ['sui',  'Sui',         '#4da2ff', 'sui-ecosystem',       'Sui'],
  ['apt',  'Aptos',       '#2ed3b7', 'aptos-ecosystem',     'Aptos'],
  ['btc',  'Bitcoin',     '#f7931a', 'bitcoin-ecosystem',   'Bitcoin'],
  ['hl',   'Hyperliquid', '#97fce4', 'hyperliquid-ecosystem', 'Hyperliquid'],
];
export const CH = Object.fromEntries(CHAINS.map(([id, name, color, cg, llama]) =>
  [id, { id, name, color, cg, llama }]));
const BY_LLAMA = Object.fromEntries(CHAINS.map(c => [c[4], c[0]]));

/* ---------- plumbing ---------- */
export class ApiError extends Error {
  constructor(msg, { rateLimited = false } = {}) { super(msg); this.rateLimited = rateLimited; }
}

const hostOf = u => { try { return new URL(u).host; } catch { return String(u); } };
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
  if (u.pathname.includes('/chart/')) return { data: S.apySeries(u.pathname.split('/').pop(), 180) };
  if (u.pathname.endsWith('/protocols')) return S.protocols;
  if (u.pathname.includes('/overview/dexs')) return { protocols: S.dexs };
  if (u.pathname.includes('/overview/fees')) return { protocols: S.fees };
  if (u.pathname.endsWith('/v2/chains')) return S.chains;
  if (u.pathname.includes('/protocol/'))
    return { tvl: S.tvlSeries(u.pathname.split('/').pop()).map((v, i) => ({ date: i, totalLiquidityUSD: v })) };
  if (u.pathname.endsWith('/stablecoins')) return { peggedAssets: S.stables };
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

async function fetchJson(url, { tries = 2, timeout = 25000 } = {}) {
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
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

// session-scoped cache; stale entries are still served if a refetch fails
const TTL = 5 * 60 * 1000;
const inflight = new Map();
function cache(key, ttl, fn) {
  if (inflight.has(key)) return inflight.get(key);
  let hit = null;
  try { hit = JSON.parse(sessionStorage.getItem('atlas:' + key) || 'null'); } catch {}
  if (hit && Date.now() - hit.t < ttl) return Promise.resolve(hit.v);
  const p = fn().then(v => {
    try { sessionStorage.setItem('atlas:' + key, JSON.stringify({ t: Date.now(), v })); } catch {}
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

function asset(c, chain) {
  const sym = (c.symbol || '?').toUpperCase();
  const spark = c.sparkline_in_7d?.price || [];
  return {
    kind: 'asset', id: `a:${c.id}`, cg: c.id, sym, name: c.name || sym, img: c.image,
    chain, price: c.current_price ?? 0, chg: c.price_change_percentage_24h ?? 0,
    mcap: c.market_cap ?? 0, vol: c.total_volume ?? 0, rank: c.market_cap_rank,
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
    tvl: p.tvlUsd ?? 0, supplyUsd, borrowUsd,
    util: supplyUsd > 0 ? Math.min(100, borrowUsd / supplyUsd * 100) : 0,
    ltv: lb.ltv ?? 0, meta: p.poolMeta || '', color: colorOf(sym),
    key: `${proto} ${sym} ${CH[chain]?.name || ''} ${p.poolMeta || ''} lending lend borrow supply pool market yield apy earn`,
  };
}

/* ---------- public API ---------- */

/** Top assets. `chainId` null = global market leaders, else that chain's ecosystem. */
export function loadAssets(chainId) {
  const cat = chainId ? CH[chainId].cg : '';
  return cache(`assets:${chainId || 'all'}`, TTL, async () => {
    const q = `${CG}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1` +
      `&sparkline=true&price_change_percentage=24h${cat ? '&category=' + cat : ''}`;
    const rows = await get(q);
    // the global endpoint carries no chain — leave it unset rather than guessing one
    return (Array.isArray(rows) ? rows : []).map(c => asset(c, chainId || null));
  });
}

// Borrow-side fields live on the pool itself in some responses and only in
// /lendBorrow in others. Accept either, so neither shape breaks lending.
const borrowOf = p => p.totalSupplyUsd != null || p.apyBaseBorrow != null
  ? { apyBaseBorrow: p.apyBaseBorrow, apyRewardBorrow: p.apyRewardBorrow,
      totalSupplyUsd: p.totalSupplyUsd, totalBorrowUsd: p.totalBorrowUsd, ltv: p.ltv }
  : null;

/** Every lending market DeFiLlama tracks, above a size floor. */
export function loadPools() {
  return cache('pools', TTL, async () => {
    const [pools, lend] = await Promise.all([
      get(`${YIELDS}/pools`, { timeout: 60000 }),        // this payload is ~10MB
      get(`${YIELDS}/lendBorrow`).catch(() => null),     // enrichment, not required
    ]);
    const lb = Object.fromEntries((lend || []).map(x => [x.pool, x]));
    return (pools?.data || [])
      .map(p => [p, lb[p.pool] || borrowOf(p)])
      .filter(([p, b]) => b && BY_LLAMA[p.chain] && (b.totalSupplyUsd || p.tvlUsd || 0) > 5e5)
      .map(([p, b]) => pool(p, b))
      .sort((a, b) => b.supplyUsd - a.supplyUsd)
      .slice(0, 1200);
  });
}

/** Asset price history. days: 1 | 7 | 30 | 365 → [[ms, price], …] */
export function loadAssetChart(cgId, days) {
  return cache(`chart:${cgId}:${days}`, TTL, async () => {
    const j = await get(`${CG}/coins/${encodeURIComponent(cgId)}/market_chart?vs_currency=usd&days=${days}`);
    return (j?.prices || []).map(p => p[1]);
  });
}

/** Lending market APY history. Llama returns daily points; slice to the range. */
export function loadPoolChart(poolId, days) {
  return cache(`pchart:${poolId}`, TTL, async () => {
    const j = await get(`${YIELDS}/chart/${encodeURIComponent(poolId)}`);
    return (j?.data || []).map(d => d.apy ?? 0);
  }).then(all => days >= 365 ? all : all.slice(-days));
}

/* ---------- protocols, chains, stablecoins ---------- */
const slugOf = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);

function protocol(p, dex, fee) {
  const chains = (p.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
  const name = p.name || p.slug || '?';
  return {
    kind: 'protocol', id: `r:${p.slug || slugOf(name)}`, slug: p.slug || slugOf(name),
    name, cat: p.category || 'DeFi', chains, chain: chains[0] || null,
    tvl: num(p.tvl), chg1d: num(p.change_1d), chg7d: num(p.change_7d),
    url: p.url || '', img: p.logo || null, color: colorOf(name),
    vol24: num(dex?.total24h), fees24: num(fee?.total24h),
    rev24: num(fee?.revenue24h ?? fee?.dailyRevenue),
    key: `${name} ${p.category || ''} ${(p.chains || []).join(' ')} protocol dapp defi tvl`,
  };
}

/** Protocols, with DEX volume and fee/revenue folded in where they exist. */
export function loadProtocols() {
  return cache('protocols', TTL, async () => {
    const q = '?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true';
    const [ps, dex, fees] = await Promise.all([
      get(`${LLAMA}/protocols`, { timeout: 60000 }),
      get(`${LLAMA}/overview/dexs${q}`).catch(() => null),    // enrichment, optional
      get(`${LLAMA}/overview/fees${q}`).catch(() => null),
    ]);
    const index = l => Object.fromEntries((l?.protocols || []).map(x => [slugOf(x.name), x]));
    const dv = index(dex), fv = index(fees);
    return (Array.isArray(ps) ? ps : [])
      .filter(p => num(p.tvl) > 1e6)
      .map(p => protocol(p, dv[slugOf(p.name)], fv[slugOf(p.name)]))
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 500);
  });
}

/** The supported chains, carrying their live TVL. */
export function loadChains() {
  return cache('chains', TTL, async () => {
    const rows = await get(`${LLAMA}/v2/chains`).catch(() => []);
    const tvl = Object.fromEntries((rows || []).map(c => [c.name, num(c.tvl)]));
    return CHAINS.map(([id, name, color, , llama]) => ({
      kind: 'chain', id: `c:${id}`, chain: id, name, color,
      tvl: tvl[llama] || 0,
      key: `${name} ${llama} chain network l1 l2 blockchain`,
    })).sort((a, b) => b.tvl - a.tvl);
  });
}

/** Circulating supply per stablecoin, keyed by ticker. */
export function loadStables() {
  return cache('stables', TTL, async () => {
    const j = await get(`${STABLE}/stablecoins?includePrices=true`).catch(() => null);
    return Object.fromEntries((j?.peggedAssets || []).map(s => [
      String(s.symbol || '').toUpperCase(),
      { circulating: num(s.circulating?.peggedUSD), price: num(s.price) },
    ]));
  });
}

/** Protocol TVL history. */
export function loadProtocolChart(slug, days) {
  return cache(`rchart:${slug}`, TTL, async () => {
    const j = await get(`${LLAMA}/protocol/${encodeURIComponent(slug)}`, { timeout: 45000 });
    return (j?.tvl || []).map(p => num(p.totalLiquidityUSD));
  }).then(all => days >= 3650 ? all : all.slice(-days));
}

export const links = {
  asset: a => `https://www.coingecko.com/en/coins/${a.cg}`,
  pool: p => `https://defillama.com/yields/pool/${p.pool}`,
  protocol: r => r.url || `https://defillama.com/protocol/${r.slug}`,
  chain: c => `https://defillama.com/chain/${encodeURIComponent(CH[c.chain]?.llama || c.name)}`,
};
