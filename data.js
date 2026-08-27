/* data.js — live data. CoinGecko for assets, DeFiLlama for lending markets.
   No API keys, no backend: both allow direct browser calls. */

const CG = 'https://api.coingecko.com/api/v3';
const YIELDS = 'https://yields.llama.fi';

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

async function get(url, tries = 2) {
  for (let i = 0; ; i++) {
    let r;
    try {
      r = await fetch(url, { signal: AbortSignal.timeout(25000) });
    } catch {
      if (i >= tries - 1) throw new ApiError('Network unreachable — check your connection.');
      await sleep(600 * 2 ** i); continue;
    }
    if (r.status === 429) {
      if (i >= tries - 1) throw new ApiError('Rate limited by CoinGecko. Give it a minute.', { rateLimited: true });
      await sleep(2500 * 2 ** i); continue;
    }
    if (!r.ok) {
      if (i >= tries - 1) throw new ApiError(`Upstream returned ${r.status}.`);
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
    kind: 'pool', id: `p:${p.pool}`, pool: p.pool, proto, sym, chain,
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

/** Every lending market DeFiLlama tracks, above a size floor. */
export function loadPools() {
  return cache('pools', TTL, async () => {
    const [pools, lend] = await Promise.all([
      get(`${YIELDS}/pools`),
      get(`${YIELDS}/lendBorrow`),
    ]);
    const lb = Object.fromEntries((lend || []).map(x => [x.pool, x]));
    return (pools?.data || [])
      .filter(p => lb[p.pool] && BY_LLAMA[p.chain] && (lb[p.pool].totalSupplyUsd || 0) > 5e5)
      .map(p => pool(p, lb[p.pool]))
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

export const links = {
  asset: a => `https://www.coingecko.com/en/coins/${a.cg}`,
  pool: p => `https://defillama.com/yields/pool/${p.pool}`,
};
