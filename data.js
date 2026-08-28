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
const BRIDGES = 'https://bridges.llama.fi';
const DEXS = 'https://api.dexscreener.com';
const GT = 'https://api.geckoterminal.com/api/v2';

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
  if (u.pathname.endsWith('/bridges')) return { bridges: S.bridges };
  if (u.pathname.endsWith('/raises')) return { raises: S.raises };
  if (u.pathname.endsWith('/hacks')) return S.hacks;
  if (u.pathname.includes('/dex/search')) return { pairs: S.pairs(u.searchParams.get('q') || '') };
  if (u.pathname.includes('/search/pools')) return { data: S.gtSearch(u.searchParams.get('query') || '') };
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
function farm(p) {
  const sym = (p.symbol || '?').toUpperCase();
  const proto = title(p.project || '');
  const chain = BY_LLAMA[p.chain];
  return {
    kind: 'yield', id: `y:${p.pool}`, pool: p.pool, proto, slug: p.project || '', sym, chain,
    apy: num(p.apy ?? p.apyBase), apyBase: num(p.apyBase), apyReward: num(p.apyReward),
    tvl: num(p.tvlUsd), meta: p.poolMeta || '', stable: !!p.stablecoin,
    risk: p.ilRisk || '', color: colorOf(sym),
    key: `${proto} ${sym} ${CH[chain]?.name || ''} ${p.poolMeta || ''} yield farm pool apy earn staking liquidity`,
  };
}

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

function protocol(p, dex, fee, perp, opt) {
  const chains = (p.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
  const name = p.name || p.slug || '?';
  return {
    kind: 'protocol', id: `r:${p.slug || slugOf(name)}`, slug: p.slug || slugOf(name),
    name, cat: p.category || 'DeFi', chains, chain: chains[0] || null,
    tvl: num(p.tvl), chg1d: num(p.change_1d), chg7d: num(p.change_7d),
    url: p.url || '', img: p.logo || null, color: colorOf(name),
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

/** Stablecoins: searchable in their own right, and a peg lookup for assets. */
export function loadStables() {
  return cache('stables', TTL, async () => {
    const j = await get(`${STABLE}/stablecoins?includePrices=true`).catch(() => null);
    const rows = (j?.peggedAssets || [])
      .map(s => {
        const sym = String(s.symbol || '?').toUpperCase();
        const chains = (s.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'stablecoin', id: `s:${s.id ?? sym}`, sym, name: s.name || sym,
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
          kind: 'bridge', id: `b:${b.id ?? slugOf(name)}`, name,
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
          sector: r.sector || r.category || '', investors, valuation: num(r.valuation),
          source: r.source || '', chains, chain: chains[0] || null, color: colorOf(r.name),
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
          source: h.source || '', chains, chain: chains[0] || null, color: '#ff6b81',
          key: `${h.name} hack exploit ${h.technique || ''} ${h.classification || ''} ${list.join(' ')}`,
        };
      })
      .sort((a, b) => b.date - a.date)
      .slice(0, 400);
  });
}

/** Protocol TVL history. */
export function loadProtocolChart(slug, days) {
  return cache(`rchart:${slug}`, TTL, async () => {
    const j = await get(`${LLAMA}/protocol/${encodeURIComponent(slug)}`, { timeout: 45000 });
    return (j?.tvl || []).map(p => num(p.totalLiquidityUSD));
  }).then(all => days >= 3650 ? all : all.slice(-days));
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
    url: p.url || '', color: colorOf(sym),
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

export const links = {
  asset: a => `https://www.coingecko.com/en/coins/${a.cg}`,
  pool: p => `https://defillama.com/yields/pool/${p.pool}`,
  protocol: r => r.url || `https://defillama.com/protocol/${r.slug}`,
  stablecoin: () => 'https://defillama.com/stablecoins',
  bridge: () => 'https://defillama.com/bridges',
  raise: r => r.source || 'https://defillama.com/raises',
  hack: h => h.source || 'https://defillama.com/hacks',
  yield: y => `https://defillama.com/yields/pool/${y.pool}`,
  pair: p => p.url || `https://dexscreener.com/${Object.keys(DEX_CHAIN).find(k => DEX_CHAIN[k] === p.chain) || 'solana'}/${p.addr}`,
  chain: c => `https://defillama.com/chain/${encodeURIComponent(CH[c.chain]?.llama || c.name)}`,
};
