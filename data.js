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
const WIKI = 'https://en.wikipedia.org/api/rest_v1/page/summary';
/* GeckoTerminal versions its public API through the Accept header and is
   entitled to refuse a request that does not name a version. Sending it costs
   nothing and is what the docs ask for; without it the browser reports a bare
   network failure, which is indistinguishable from the host being down. */
const GT_ACCEPT = { accept: 'application/json;version=20230302' };
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

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- one host at a time ----------
   CoinGecko's free tier is a handful of calls a minute, and Atlas can ask it for
   the market list, two equity categories, a description and a price history in
   the same second — then get 429s for the next minute and look broken. Retrying
   into a rate limit makes it worse.

   A small queue per host: at most two requests in flight and a floor on the gap
   between them. It costs a few hundred milliseconds on a cold load and removes
   the failure entirely. Hosts that do not need it are not slowed: the gap is
   per host and defaults to nothing. */
const GAP = { 'api.coingecko.com': 1200, 'api.geckoterminal.com': 400, 'api.coinpaprika.com': 300 };
const lanes = new Map();
function lane(host) {
  if (!lanes.has(host)) lanes.set(host, { last: 0, q: [], busy: false });
  return lanes.get(host);
}
function pump(host) {
  const l = lane(host);
  if (l.busy || !l.q.length) return;
  l.busy = true;
  const job = l.q.shift();
  setTimeout(() => {
    l.last = Date.now();
    // one slow or failed request must not stall everything behind it
    Promise.resolve().then(job.run).then(job.res, job.rej)
      .finally(() => { l.busy = false; pump(host); });
  }, Math.max(0, GAP[host] - (Date.now() - l.last)));
}
/* Someone typing is waiting on the answer; an index warming itself up is not.
   Urgent work goes to the front of the lane, so a search never sits behind a
   dozen background requests nobody asked for. */
function queued(host, run, urgent) {
  if (!GAP[host]) return run();
  const l = lane(host);
  return new Promise((res, rej) => {
    const job = { run, res, rej };
    if (urgent) l.q.unshift(job); else l.q.push(job);
    pump(host);
  });
}

async function fetchJson(url, opts) {
  return queued(hostOf(url), () => fetchOnce(url, opts), opts?.urgent);
}

async function fetchOnce(url, { tries = 2, timeout = 25000, post = null, headers = null } = {}) {
  // one source speaks GraphQL; everything else is a plain GET
  const init = post
    ? { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(post) }
    : (headers ? { headers } : {});
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
/* A batched read caches per item rather than per request, so the two share the
   store but not the shape: peek says what is already known, put records one
   answer. Undefined means "never asked" — null is a real answer meaning "asked
   and nothing came back", and the two must not collapse into each other. */
function peek(key, ttl = TTL) {
  let hit = mem.get(key) || null;
  if (!hit) try { hit = JSON.parse(sessionStorage.getItem('atlas:' + key) || 'null'); } catch {}
  return hit && Date.now() - hit.t < ttl ? hit.v : undefined;
}
function put(key, v) {
  const rec = { t: Date.now(), v };
  mem.set(key, rec);
  try { sessionStorage.setItem('atlas:' + key, JSON.stringify(rec)); } catch {}
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
/* num() folds a missing field to 0, which is right for a quantity — no volume
   and zero volume are the same thing. It is wrong for a change: a token that
   moved 0.00% this week is not a token whose week is unknown, and rendering
   both as an em dash claimed data was missing when it was not. */
const numN = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; };
// every row's fallback tile colour, so a row built outside this file matches
export const colorOf = s => `hsl(${hue(s)} 72% 62%)`;
const title = s => s.replace(/-/g, ' ').replace(/\b\w/g, m => m.toUpperCase()).replace(/\bV(\d)/g, 'v$1');

/* The markets call already asks for 7d, 30d and 1y moves and returns supply and
   all-time-high alongside them. All of it was being dropped on the floor; the
   request is unchanged, the row now carries what it paid for. */
function asset(c, chain) {
  const sym = (c.symbol || '?').toUpperCase();
  const spark = c.sparkline_in_7d?.price || [];
  const price = c.current_price ?? 0;
  return {
    kind: 'asset', id: `a:${c.id}`, cg: c.id, sym, name: c.name || sym, img: safeUrl(c.image) || null,
    chain, price, chg: c.price_change_percentage_24h ?? 0,
    chg7d: numN(c.price_change_percentage_7d_in_currency),
    chg30d: numN(c.price_change_percentage_30d_in_currency),
    chg1y: numN(c.price_change_percentage_1y_in_currency),
    mcap: c.market_cap ?? 0, vol: c.total_volume ?? 0, rank: c.market_cap_rank,
    fdv: num(c.fully_diluted_valuation), supply: num(c.circulating_supply),
    maxSupply: num(c.max_supply), high24: num(c.high_24h), low24: num(c.low_24h),
    ath: num(c.ath), athChg: numN(c.ath_change_percentage),
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
    /* Borrow rate is net of borrow-side incentives, which can legitimately make
       it negative — being paid to borrow is a real thing. But a market with no
       borrow side at all has no rate, and subtracting rewards from a missing
       base was printing "-0.90% borrow" on a pool nobody can borrow from. */
    bor: lb.borrowable === false || (!lb.apyBaseBorrow && !lb.totalBorrowUsd)
      ? null : (lb.apyBaseBorrow ?? 0) - (lb.apyRewardBorrow ?? 0),
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
    chg7d: numN(q.percent_change_7d), chg30d: numN(q.percent_change_30d),
    chg1y: numN(q.percent_change_1y), ath: num(q.ath_price),
    athChg: numN(q.percent_from_price_ath), supply: num(p.circulating_supply),
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
/* Every issuer names its tokens differently, and the app only recognised one of
   them. Backed suffixes an x (TSLAx), Dinari prefixes a d (dTSLA), Robinhood
   and Coinbase issue under their own names, and Ondo, Swarm and Securitize each
   do something else again. Recognising the issuer is what makes the rest of the
   row honest: a share tokenized by Robinhood and one tokenized by Backed are
   different instruments with different redemption, and the sheet should say
   which one it is holding rather than calling both "tokenized". */
/* Each slug is a separate request against a rate-limited host, so the list is
   the ones most likely to exist rather than every name an issuer might use. A
   slug that has been retired returns nothing and costs one request. */
const STOCK_CATS = ['tokenized-stock', 'xstocks-ecosystem', 'tokenized-equity',
  'robinhood-chain-ecosystem', 'coinbase-tokenized-equities'];

const ISSUERS = [
  [/backed|xstock/i, 'Backed'],
  [/robinhood/i, 'Robinhood'],
  [/coinbase/i, 'Coinbase'],
  [/kraken/i, 'Kraken'],
  [/dinari|dshare/i, 'Dinari'],
  [/\bondo\b/i, 'Ondo'],
  [/swarm/i, 'Swarm'],
  [/securitize/i, 'Securitize'],
  [/sologenic/i, 'Sologenic'],
];
const issuerOf = name => (ISSUERS.find(([re]) => re.test(name || '')) || [, ''])[1];

// enough of a signal to say this is an equity and not a coin that shares a name
const EQUITYISH = /x ?stock|tokenized|token[iy]sed|equit|\bshare|\bstock\b|dshare|backed|robinhood|coinbase|dinari|ondo|swarm|securitize/i;

/* Casting wider for issuers also catches what those issuers tokenize that is
   not a share. Ondo's name matches on every one of its products, and OUSG is
   short-term treasuries — a fund, priced daily, redeemed differently, and not a
   stock however it is wrapped. */
const NOT_EQUITY = /treasur|t-bill|\bbill\b|\bbond|\bgold\b|\bsilver\b|money market|\bfund\b|\bnote\b|reserve|yield|staked|savings/i;

/** The ticker a token tracks. Every rule below is a naming convention an issuer
    actually publishes; anything else returns null rather than inventing one. */
function underlying(sym, name) {
  if (!EQUITYISH.test(name || '') || NOT_EQUITY.test(name || '')) return null;
  const S = String(sym || '').toUpperCase();
  // Backed and Kraken: TSLAX -> TSLA
  let m = /^([A-Z0-9]{1,5})X$/.exec(S);
  if (m) return m[1];
  // Dinari: DTSLA or TSLA.D -> TSLA
  m = /^D([A-Z]{1,5})$/.exec(S) || /^([A-Z0-9]{1,5})\.D$/.exec(S);
  if (m) return m[1];
  // Robinhood, Coinbase and the rest issue under the plain ticker
  return /^[A-Z0-9]{1,5}$/.test(S) ? S : null;
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
        // a broader net catches more issuers and also more things that are not
        // equities at all — treasuries, gold, a fund. Keep only what names one.
        const under = underlying(a.sym, a.name);
        if (!under) continue;
        const issuer = issuerOf(a.name);
        seen.add(c.id);
        out.push({ ...a, kind: 'stock', id: `t:${c.id}`, under, issuer,
          key: `${a.sym} ${a.name} ${under} ${issuer} tokenized stock equity share rwa` });
      }
    }
    return out.sort((x, y) => y.mcap - x.mcap);
  });
}

/* The same networks under three names: ours, DexScreener's `chainId` and
   GeckoTerminal's network slug. One table, because two separate ones drifted:
   the DEX mapping covered eleven chains and GeckoTerminal's covered twenty-eight,
   so a Berachain pair from either index resolved to no chain at all — no network
   badge, and invisible to every network filter. */
const NET_ALIAS = {
  eth:   ['ethereum',    'eth'],
  sol:   ['solana',      'solana'],
  base:  ['base',        'base'],
  arb:   ['arbitrum',    'arbitrum'],
  bnb:   ['bsc',         'bsc'],
  hl:    ['hyperliquid', 'hyperliquid'],
  op:    ['optimism',    'optimism'],
  poly:  ['polygon',     'polygon_pos'],
  avax:  ['avalanche',   'avax'],
  sui:   ['sui',         'sui-network'],
  apt:   ['aptos',       'aptos'],
  tron:  ['tron',        'tron'],
  ton:   ['ton',         'ton'],
  btc:   ['bitcoin',     ''],
  bera:  ['berachain',   'berachain'],
  sonic: ['sonic',       'sonic'],
  mnt:   ['mantle',      'mantle'],
  blast: ['blast',       'blast'],
  scrl:  ['scroll',      'scroll'],
  linea: ['linea',       'linea'],
  zks:   ['zksync',      'zksync'],
  sei:   ['sei',         'sei-evm'],
  uni:   ['unichain',    'unichain'],
  ink:   ['ink',         'ink'],
  abs:   ['abstract',    'abstract'],
  plume: ['plume',       'plume'],
  story: ['story',       'story'],
  monad: ['monad',       'monad'],
  celo:  ['celo',        'celo'],
  rhc:   ['robinhood',   ''],
};
// derived, so adding a chain above reaches every index at once
const GT_NET = Object.fromEntries(Object.entries(NET_ALIAS).filter(([, a]) => a[1]).map(([id, a]) => [id, a[1]]));
const DEX_CHAIN = Object.fromEntries(Object.entries(NET_ALIAS).map(([id, a]) => [a[0], id]));
const GT_CHAIN = Object.fromEntries(Object.entries(GT_NET).map(([id, slug]) => [slug, id]));

/** The tokens actually trading on one chain. */
export function loadChainTokens(chainId) {
  const net = GT_NET[chainId];
  if (!net) return Promise.resolve([]);
  return cache(`chaintok:${chainId}`, TTL, async () => {
    const j = await get(`${GT}/networks/${net}/pools?page=1&include=base_token`,
      { tries: 1, headers: GT_ACCEPT, urgent: true }).catch(() => null);
    const imgs = gtTokens(j);
    return mergePairs([(j?.data || []).map(r => gtPool(r, imgs))])
      .map(p => ({ ...p, chain: chainId })).slice(0, 40);
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
      /* Ingest keeps what protects the payload and nothing more. A value floor
         here decided the same question the junk rule decides, and decided it
         first — so a $220k market somebody is using was gone before anything
         could ask whether it was real. The cap stays; the floor does not. */
      .filter(([p, b]) => b && (b.totalSupplyUsd || p.tvlUsd || 0) > 0)
      .map(([p, b]) => pool(p, b))
      .sort((a, b) => b.supplyUsd - a.supplyUsd)
      .slice(0, 4000);
    const borrowed = new Set(lending.map(l => l.pool));
    const yields = rows
      .filter(p => !borrowed.has(p.pool) && num(p.tvlUsd) > 0 && num(p.apy ?? p.apyBase) > 0)
      .map(farm)
      .sort((a, b) => b.tvl - a.tvl)
      .slice(0, 4000);
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
    { tries: 1, timeout: 12000, headers: GT_ACCEPT });
  const rows = (j?.data?.attributes?.ohlcv_list || []).slice().reverse();
  return candles(rows, 2, 3, 4, 5);
}

/* Last resort before giving up on an asset: it is not on CoinGecko and not on
   Binance, but if anyone trades it at all there is a pool somewhere. Find the
   deepest one and chart that. */
async function poolChartFor(sym, days) {
  const j = await get(`${GT}/search/pools?query=${encodeURIComponent(sym)}&page=1`,
    { tries: 1, timeout: 12000, headers: GT_ACCEPT });
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
    tvl: num(p.tvl), chg1d: numN(p.change_1d), chg7d: numN(p.change_7d),
    url: safeUrl(p.url), img: safeUrl(p.logo) || null, color: colorOf(name),
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
      .filter(p => num(p.tvl) > 0 || num(dv[slugOf(p.name)]?.total24h) > 0)
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
  const out = { syms: new Set(), addrs: new Set(), at: new Map() };
  for (const t of j?.tokens || []) {
    const chain = EVM[t.chainId];
    if (chain) addSym(out.syms, t.symbol, chain);
    if (t.address) out.addrs.add(String(t.address).toLowerCase());
    /* The same list that says a token is real also says where it lives, which
       is what turns "trade BTC" into a route: an asset row carries a ticker
       and no address, and this is the only place the two are joined. */
    if (chain && t.symbol && t.address)
      out.at.set(`${String(t.symbol).toUpperCase()}@${chain}`, String(t.address).toLowerCase());
  }
  return out;
}

async function jupiterList() {
  const j = await get(`${JUP}/tokens/v2/tag?query=verified`, { tries: 1, timeout: 20000 })
    .catch(() => null);
  const out = { syms: new Set(), addrs: new Set(), at: new Map() };
  // the field carrying the mint has moved between versions; accept any of them
  for (const t of Array.isArray(j) ? j : j?.tokens || []) {
    addSym(out.syms, t.symbol, 'sol');
    const mint = t.id || t.address || t.mint;
    if (mint) out.addrs.add(String(mint).toLowerCase());
    if (t.symbol && mint) out.at.set(`${String(t.symbol).toUpperCase()}@sol`, String(mint));
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

/* DeFiLlama hands bridges, funding rounds and exploits no logo of their own,
   so three categories rendered as coloured initials. Most of them are
   protocols it already has an icon for, and the protocol index is cached by
   the time these load — one lookup by slug is the whole cost. */
async function protoIcons() {
  const rows = await loadProtocols().catch(() => []);
  const m = new Map();
  for (const r of rows) if (r.img) { m.set(r.slug, r.img); m.set(slugOf(r.name), r.img); }
  return m;
}
/* A bridge names its icon the way DeFiLlama writes it internally —
   "protocol:across" or "chain:ethereum" — rather than as a URL. */
const llamaIcon = (icon, byName) => {
  const [kind, slug] = String(icon || '').split(':');
  if (!slug) return byName || null;
  return kind === 'chain'
    ? `https://icons.llama.fi/chains/rsz_${encodeURIComponent(slug.toLowerCase())}.jpg`
    : `https://icons.llama.fi/${encodeURIComponent(slug.toLowerCase())}.png`;
};

/** Cross-chain bridges, by recent volume. */
export function loadBridges() {
  return cache('bridges', TTL, async () => {
    const [j, icons] = await Promise.all([
      get(`${BRIDGES}/bridges?includeChains=true`).catch(() => null), protoIcons()]);
    return (j?.bridges || [])
      .map(b => {
        const chains = (b.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        const name = b.displayName || b.name || '?';
        return {
          kind: 'bridge', id: `b:${b.id ?? slugOf(name)}`, name, bid: b.id ?? '',
          img: safeUrl(llamaIcon(b.icon, icons.get(slugOf(name)))) || null,
          vol24: num(b.lastDailyVolume ?? b.volumePrevDay), volPrev: num(b.volumePrev2Day),
          chains, chain: chains[0] || null, color: colorOf(name),
          key: `${name} bridge cross-chain transfer ${(b.chains || []).join(' ')}`,
        };
      })
      .filter(b => b.name && b.name !== '?')
      .sort((a, b) => b.vol24 - a.vol24)
      .slice(0, 120);
  });
}

/** Funding rounds. */
export function loadRaises() {
  return cache('raises', TTL, async () => {
    const [j, icons] = await Promise.all([
      get(`${LLAMA}/raises`, { timeout: 45000 }).catch(() => null), protoIcons()]);
    return (j?.raises || [])
      .filter(r => r.name)
      .map(r => {
        const investors = [...(r.leadInvestors || []), ...(r.otherInvestors || [])];
        const chains = (r.chains || []).map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'raise', id: `f:${slugOf(r.name)}-${r.date}`, name: r.name,
          img: icons.get(slugOf(r.name)) || null,
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
    const [rows, icons] = await Promise.all([
      get(`${LLAMA}/hacks`, { timeout: 45000 }).catch(() => null), protoIcons()]);
    return (Array.isArray(rows) ? rows : [])
      .filter(h => h.name)
      .map(h => {
        const list = h.chains || (h.chain ? [h.chain] : []);
        const chains = list.map(c => BY_LLAMA[c]).filter(Boolean);
        return {
          kind: 'hack', id: `h:${slugOf(h.name)}-${h.date}`, name: h.name,
          img: icons.get(slugOf(h.name)) || null,
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
/* A pair keeps its network even when it is not one we filter by — restricting
   the long tail to known chains was throwing away most of it. */
const netName = id => CH[DEX_CHAIN[id] || GT_CHAIN[id]]?.name
  || title(String(id || '').replace(/[-_]/g, ' '));

function pairOf(p) {
  const base = p.baseToken || {};
  const sym = String(base.symbol || '?').toUpperCase();
  const dex = title(p.dexId || 'DEX');
  return {
    kind: 'pair', id: `d:${p.pairAddress || base.address}`, sym,
    name: base.name || sym, addr: base.address || '', dex,
    img: safeUrl(p.info?.imageUrl) || null,
    chain: DEX_CHAIN[p.chainId] || null, net: netName(p.chainId),
    price: Number(p.priceUsd) || 0, chg: num(p.priceChange?.h24),
    liq: num(p.liquidity?.usd), vol24: num(p.volume?.h24), fdv: num(p.fdv),
    quote: String(p.quoteToken?.symbol || '').toUpperCase(),
    url: safeUrl(p.url), color: colorOf(sym),
    key: `${sym} ${base.name || ''} ${dex} ${netName(p.chainId)} dex pair token memecoin swap trade`,
  };
}

/* JSON:API keeps the token beside the pool rather than inside it. Asking for
   `include=base_token` costs nothing extra and is what carries the logo; when
   the parameter is ignored the `included` array is simply absent and the tile
   falls back to its coloured initials, as before. */
const gtTokens = j => Object.fromEntries((j?.included || [])
  .filter(x => x.type === 'token')
  .map(x => [x.id, safeUrl(x.attributes?.image_url) || null]));

/** GeckoTerminal returns JSON:API pools; /search and /trending share this shape. */
function gtPool(row, imgs) {
  const a = row.attributes || {};
  const net = String(row.id || '').split('_')[0];
  const [baseSym, quoteSym] = String(a.name || '').split('/').map(s => s.trim().toUpperCase());
  const sym = baseSym || '?';
  return {
    kind: 'pair', id: `d:${a.address || row.id}`, sym, name: a.name || sym,
    addr: a.address || '', dex: 'DEX',
    chain: GT_CHAIN[net] || DEX_CHAIN[net] || null, net: netName(net),
    price: Number(a.base_token_price_usd) || 0,
    chg: Number(a.price_change_percentage?.h24) || 0,
    liq: Number(a.reserve_in_usd) || 0, vol24: Number(a.volume_usd?.h24) || 0,
    fdv: Number(a.fdv_usd) || 0, quote: quoteSym || '', url: '', color: colorOf(sym),
    img: imgs?.[row.relationships?.base_token?.data?.id] || null,
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
      get(`${GT}/search/pools?query=${encodeURIComponent(term)}&page=1&include=base_token`,
        { tries: 1, timeout: 12000, headers: GT_ACCEPT, urgent: true }),
    ]);
    const errors = [];
    let rows = [];
    if (dx.status === 'fulfilled') rows.push((dx.value?.pairs || []).map(pairOf));
    else errors.push(`DexScreener: ${dx.reason?.message || 'unreachable'}`);
    if (gt.status === 'fulfilled') {
      const imgs = gtTokens(gt.value);
      rows.push((gt.value?.data || []).map(r => gtPool(r, imgs)));
    }
    else errors.push(`GeckoTerminal: ${gt.reason?.message || 'unreachable'}`);
    /* Two indexes are queried precisely so that one of them can fail. Reporting
       "DEX search unavailable" while the other index is answering describes a
       situation that is not happening, and a rate limit on one host — which is
       ordinary, they allow thirty calls a minute — should not raise an alarm
       across the whole feature. The failure is only worth saying out loud when
       nothing answered. */
    const merged = mergePairs(rows);
    return { rows: merged, errors: merged.length ? [] : errors, partial: errors };
  });
}

/** Trending DEX pools, so the kind is populated before anyone searches. */
export function loadTrendingPairs() {
  return cache('trending', TTL, async () => {
    /* One page of trending is twenty pools — a sample of the long tail, not the
       long tail. Three pages, and the top pools by volume alongside them, is
       what makes the category worth opening. Each is independent: a page that
       fails costs its own rows and nothing else. */
    const asks = [1, 2, 3].map(pg =>
      get(`${GT}/networks/trending_pools?page=${pg}&include=base_token`,
        { tries: 1, headers: GT_ACCEPT }).catch(() => null));
    asks.push(get(`${GT}/networks/trending_pools?page=1&include=base_token&duration=24h`,
      { tries: 1, headers: GT_ACCEPT }).catch(() => null));
    /* Trending is global, so it is dominated by whichever chain is busy today
       and a quiet chain can be absent from the category entirely. The busiest
       pools on each of the big networks are a different question with a
       different answer, and asking it is what makes every chain represented. */
    for (const id of ['eth', 'sol', 'base', 'arb', 'bnb', 'poly'])
      asks.push(get(`${GT}/networks/${GT_NET[id]}/pools?page=1&include=base_token`,
        { tries: 1, headers: GT_ACCEPT }).catch(() => null));
    const got = await Promise.all(asks);
    const lists = got.filter(Boolean).map(j => {
      const imgs = gtTokens(j);
      return (j?.data || []).map(r => gtPool(r, imgs));
    });
    return mergePairs(lists).slice(0, 300);
  });
}

/* ---------- what the contract itself says ----------
   Liquidity, volume and a listing are what a market looks like from the
   outside. The contract is the inside, and it holds the answers no price feed
   carries: whether more supply can be minted, whether an owner can move or
   freeze somebody's balance, whether an address can be blacklisted out of
   selling. A token can look perfectly healthy on every number Atlas shows and
   still be a contract that will not let you leave.

   GoPlus publishes exactly that, keyless and CORS-open, under two endpoints
   with two different vocabularies — one for EVM chains, one for Solana. Both
   are normalised into one list of flags here, so the sheet renders one thing
   and a new chain is a row in a table rather than a branch in the UI. */
const GOPLUS = 'https://api.gopluslabs.io/api/v1';
const GP_ID = Object.fromEntries(Object.entries(EVM).map(([id, c]) => [c, id]));

/* [field, severity, label, what it means to somebody about to trade]. `bad` is
   a reason not to; `warn` is a reason to look closer first. */
const GP_EVM = [
  ['is_honeypot', 'bad', 'Honeypot', 'This contract has been seen refusing to let holders sell.'],
  ['cannot_sell_all', 'bad', 'Cannot sell all', 'Holders are blocked from selling their whole balance.'],
  ['is_blacklisted', 'bad', 'Blacklist', 'The owner can block chosen addresses from trading.'],
  ['owner_change_balance', 'bad', 'Controllable supply', "The owner can change any holder's balance."],
  ['hidden_owner', 'bad', 'Hidden owner', 'Ownership is disguised inside the contract.'],
  ['can_take_back_ownership', 'bad', 'Ownership reclaimable', 'A renounced owner can take control back.'],
  ['selfdestruct', 'bad', 'Self-destruct', 'The contract can delete itself.'],
  ['is_whitelisted', 'warn', 'Whitelist', 'Only chosen addresses are allowed to trade.'],
  ['is_mintable', 'warn', 'Mintable', 'The supply is not fixed — more can be created.'],
  ['transfer_pausable', 'warn', 'Pausable', 'Transfers can be switched off.'],
  ['slippage_modifiable', 'warn', 'Changeable tax', 'The trading tax can be raised after you buy.'],
  ['trading_cooldown', 'warn', 'Trading cooldown', 'The contract enforces a wait between trades.'],
  ['is_anti_whale', 'warn', 'Max wallet', 'The contract caps how much one address may hold.'],
  ['is_proxy', 'warn', 'Upgradeable', 'The code behind this address can be replaced.'],
];
const GP_SOL = [
  ['freezable', 'bad', 'Freezable', 'The issuer can freeze your token account.'],
  ['closable', 'bad', 'Closable', 'The issuer can close your token account.'],
  ['balance_mutable_authority', 'bad', 'Controllable supply', "An authority can change any holder's balance."],
  ['non_transferable', 'bad', 'Non-transferable', 'The token cannot be sent anywhere.'],
  ['mintable', 'warn', 'Mintable', 'The supply is not fixed — more can be created.'],
  ['metadata_mutable', 'warn', 'Mutable metadata', 'The name, symbol and image can be changed later.'],
  ['transfer_hook', 'warn', 'Transfer hook', 'Custom code runs on every transfer.'],
  ['default_account_state_upgradable', 'warn', 'Account state changeable', 'New holders can be frozen by default.'],
];
/* Both endpoints answer "1"/"0" for EVM and {status:"1"} for Solana, and a
   missing field means "not checked" rather than "no" — which must not read as
   a clean bill of health. */
const gpOn = v => (v && typeof v === 'object' ? v.status : v) === '1';
const gpSaw = (o, f) => o[f] !== undefined && o[f] !== null;

function gpFlags(o, table) {
  const out = [];
  for (const [field, sev, label, why] of table)
    if (gpSaw(o, field) && gpOn(o[field])) out.push({ id: field, sev, label, why });
  return out;
}

/** Can this row be checked at all? */
export const scannable = it => !!(String(it?.addr || '').trim() &&
  (it.chain === 'sol' || GP_ID[it.chain]));

/* Both endpoints take a comma-separated list, which is what makes a warning on
   the row affordable: one request covers a page of them rather than one each. */
const SEC_BATCH = 25;
function gpUrl(chain, addrs) {
  const list = addrs.map(a => encodeURIComponent(a)).join(',');
  return chain === 'sol'
    ? `${GOPLUS}/solana/token_security?contract_addresses=${list}`
    : `${GOPLUS}/token_security/${GP_ID[chain]}?contract_addresses=${list}`;
}
/** Reads one batch and hands back a Map keyed by the address asked for. */
async function gpBatch(chain, addrs) {
  const sol = chain === 'sol';
  const out = new Map();
  const j = await get(gpUrl(chain, addrs), { tries: 1, timeout: 20000 }).catch(() => null);
  const res = j?.result || {};
  // the API answers in whichever case it prefers, so index both ways once
  const lower = new Map(Object.entries(res).map(([k, v]) => [k.toLowerCase(), v]));
  for (const a of addrs) {
    const row = res[a] || lower.get(a.toLowerCase());
    out.set(a, row ? readSecurity(row, sol) : null);
  }
  return out;
}

/** Contract risk for many rows at once, cached per address. */
export async function loadSecurityMany(chain, addrs) {
  const out = new Map(), miss = [];
  for (const a of addrs) {
    const hit = peek(`sec:${chain}:${a}`, 6 * TTL);
    if (hit !== undefined) out.set(a, hit); else miss.push(a);
  }
  for (let i = 0; i < miss.length; i += SEC_BATCH) {
    const slice = miss.slice(i, i + SEC_BATCH);
    const got = await gpBatch(chain, slice).catch(() => new Map());
    for (const a of slice) {
      const v = got.get(a) ?? null;
      put(`sec:${chain}:${a}`, v);
      out.set(a, v);
    }
  }
  return out;
}

function readSecurity(row, sol) {
  {
    const flags = gpFlags(row, sol ? GP_SOL : GP_EVM);
    if (!sol) {
      // open source is the one field where the *absence* of the property is
      // the finding, so it cannot go in the table above
      if (gpSaw(row, 'is_open_source') && !gpOn(row.is_open_source))
        flags.push({ id: 'closed', sev: 'bad', label: 'Unverified contract',
          why: 'The source code behind this address has never been published.' });
      const tax = Math.max(num(row.buy_tax) * 100, num(row.sell_tax) * 100);
      if (tax >= 10) flags.push({ id: 'tax', sev: tax >= 25 ? 'bad' : 'warn',
        label: `${tax.toFixed(0)}% trading tax`,
        why: 'That much of every trade is taken by the contract.' });
    }
    return {
      flags, checked: true, source: 'GoPlus',
      holders: num(row.holder_count), lp: num(row.lp_holder_count),
      // a token a registry vouches for is one GoPlus also knows by name
      trusted: gpOn(row.trust_list) || gpOn(row.trusted_token),
    };
  }
}

/** Every risk one contract carries. null when nothing can check it. */
export async function loadSecurity(it) {
  if (!scannable(it)) return null;
  const addr = String(it.addr).trim();
  return (await loadSecurityMany(it.chain, [addr]).catch(() => new Map())).get(addr) ?? null;
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

/* DeFiLlama's collection list is the widest one available without a key, and it
   is also the one most likely to hand back a row with no image and no history.
   Where it does, the collection is still real — so the gaps are filled from the
   marketplace that actually holds the collection rather than left blank.
   OpenSea has the image, under the collection slug, and there is no keyless
   path to it — a seadn.io URL is an opaque hash, not something a slug can be
   turned into. So this is a key-gated fill rather than a guess: with a key the
   blanks are filled, without one they stay blank and say why. */
export async function nftImages(rows, key) {
  if (!key) return new Map();
  const out = new Map();
  const want = rows.filter(n => !n.img && (n.cid || n.slug)).slice(0, 12);
  for (const n of want) {
    const slug = n.slug || n.cid;
    const hit = peek(`nftimg:${slug}`, 12 * TTL);
    if (hit !== undefined) { if (hit) out.set(n.id, hit); continue; }
    const j = await get(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(slug)}`,
      { tries: 1, timeout: 12000, headers: { 'x-api-key': key } }).catch(() => null);
    const img = safeUrl(j?.image_url || j?.banner_image_url) || '';
    put(`nftimg:${slug}`, img);
    if (img) out.set(n.id, img);
  }
  return out;
}

function llamaNft(c) {
  const name = c.name || c.collectionId || '?';
  const floorUsd = num(c.floorPriceUSD ?? c.floorPrice1dUSD);
  const floor = num(c.floorPrice);
  const chain = BY_LLAMA[c.chain] || null;
  return {
    kind: 'nft', id: `n:${c.collectionId || slugOf(name)}`, cid: c.collectionId || '',
    name, sym: String(c.symbol || name).toUpperCase().slice(0, 8),
    img: safeUrl(c.image || c.logo || c.imageUrl || c.logoUrl) || null,
    slug: c.slug || c.collectionSlug || '', chain,
    // DeFiLlama aggregates every marketplace on a chain; naming one would be a lie
    net: c.chain || 'Ethereum', market: 'DeFiLlama',
    floorUsd, floor, unit: NFT_UNIT[chain] || 'ETH',
    chg1d: numN(c.floorPricePctChange1Day), chg7d: numN(c.floorPricePctChange7Day),
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
    img: safeUrl(c.image) || null, chain: 'sol', net: 'Solana', market: 'Magic Eden',
    floorUsd: 0, floor: sol, unit: 'SOL',
    // Magic Eden's popular_collections carries neither a change nor a supply.
    // Zero is a claim; null is the truth, and the row reads as "—" instead of
    // "0.00%" and stays out of a filter that asks about movement.
    chg1d: null, chg7d: null, volUsd: 0, volSol: num(c.volumeAll) / SOL_LAMPORTS,
    supply: num(c.totalItems ?? c.supply) || null,
    key: `${name} ${c.symbol || ''} nft collection solana magic eden pfp art collectible`,
  };
}

/* ---------- inside a collection ----------
   A collection is a row with one number on it — the floor — and that is the
   least interesting thing about it. What is actually for sale, at what price,
   with what traits, is the question anyone opening one is asking.

   Magic Eden answers it without a key, so Solana collections list their real
   listings. OpenSea's item endpoint needs one, so EVM collections list theirs
   only where a key is configured, and say so plainly where it is not. */

function meItem(l) {
  const t = l.token || l;
  const price = num(l.price);      // already in SOL on this endpoint
  return {
    id: t.mintAddress || t.mint || l.tokenMint || '',
    name: t.name || '#?',
    img: safeUrl(t.image) || null,
    price, unit: 'SOL', order: '',
    traits: (t.attributes || []).slice(0, 3)
      .map(a => `${a.trait_type}: ${a.value}`).filter(x => !/undefined/.test(x)),
    url: t.mintAddress ? `https://magiceden.io/item-details/${encodeURIComponent(t.mintAddress)}` : '',
  };
}

/* A listing is an item plus the two things needed to buy it: what it costs and
   the hash of the order that sells it. */
function osListing(l, slug) {
  const t = l.protocol_data?.parameters?.offer?.[0] || {};
  const price = Number(l.price?.current?.value) || 0;
  const dec = Number(l.price?.current?.decimals) || 18;
  const id = String(t.identifierOrCriteria || '');
  return {
    id, name: `#${id}`, img: null,
    price: price / 10 ** dec, unit: l.price?.current?.currency || 'ETH',
    traits: [], order: l.order_hash || '', chain: l.chain || 'ethereum',
    protocol: l.protocol_address || '',
    url: `https://opensea.io/assets/${encodeURIComponent(l.chain || 'ethereum')}/${
      encodeURIComponent(t.token || slug)}/${encodeURIComponent(id)}`,
  };
}

function osItem(n, slug) {
  return {
    id: n.identifier || '',
    name: n.name || `#${n.identifier}`,
    img: safeUrl(n.display_image_url || n.image_url) || null,
    price: 0, unit: '', traits: [], order: '',
    url: safeUrl(n.opensea_url)
      || `https://opensea.io/assets/${encodeURIComponent(n.contract || slug)}/${encodeURIComponent(n.identifier || '')}`,
  };
}

/** The items actually listed in a collection. Empty is an answer, not a failure. */
/* A floor history from OpenSea, where DeFiLlama has none. Their stats endpoint
   needs a key; where one is configured this is the fallback, and where it is
   not the chart falls back to the reported moves as before. */
async function openseaFloor(n, key) {
  if (!key || !n.slug) return null;
  const j = await get(`https://api.opensea.io/api/v2/collections/${encodeURIComponent(n.slug)}/stats`,
    { tries: 1, timeout: 15000, headers: { 'x-api-key': key } }).catch(() => null);
  const iv = j?.intervals || [];
  const now = num(j?.total?.floor_price);
  if (!now) return null;
  // three points from three windows is not a series, but it is a shape
  const back = w => { const x = iv.find(v => v.interval === w);
    return x && x.average_price ? now / (1 + num(x.volume_change) / 100) : now; };
  const pts = [back('thirty_day'), back('seven_day'), now].filter(v => v > 0);
  return pts.length === 3 ? pts : null;
}

export function loadNftItems(n, { openseaKey } = {}) {
  if (!n?.cid) return Promise.resolve({ items: [], why: 'no collection id' });
  return cache(`nftitems:${n.id}`, TTL, async () => {
    if (n.market === 'Magic Eden') {
      const j = await get(`${ME}/collections/${encodeURIComponent(n.cid)}/listings?offset=0&limit=24`,
        { tries: 1, timeout: 15000 }).catch(() => null);
      const items = (Array.isArray(j) ? j : []).map(meItem).filter(x => x.id);
      return { items, why: items.length ? '' : 'nothing listed right now' };
    }
    if (!openseaKey) return { items: [], why: 'needs an OpenSea key' };
    /* The best listing per token rather than the token list: same request
       count, and it carries the price and the order hash — which is the
       difference between showing an item and being able to buy it. */
    const slug = n.slug || n.cid;
    const l = await get(`https://api.opensea.io/api/v2/listings/collection/${encodeURIComponent(slug)}/best?limit=24`,
      { tries: 1, timeout: 15000, headers: { 'x-api-key': openseaKey } }).catch(() => null);
    const listed = (l?.listings || []).map(x => osListing(x, slug)).filter(x => x.id);
    if (listed.length) return { items: listed, why: '' };
    const j = await get(`https://api.opensea.io/api/v2/collection/${encodeURIComponent(n.cid)}/nfts?limit=24`,
      { tries: 1, timeout: 15000, headers: { 'x-api-key': openseaKey } }).catch(() => null);
    const items = (j?.nfts || []).map(x => osItem(x, n.cid)).filter(x => x.id);
    return { items, why: items.length ? '' : 'no items returned' };
  });
}

/** NFT collections. Two marketplaces, ranked within their own units. */
export function loadNFTs() {
  return cache('nfts', TTL, async () => {
    const [dl, me] = await Promise.allSettled([
      get(`${NFT}/collections`, { timeout: 45000 }),
      get(`${ME}/marketplace/popular_collections`, { tries: 1, timeout: 15000 }),
    ]);
    const a = dl.status === 'fulfilled' && Array.isArray(dl.value)
      ? dl.value.map(llamaNft)
        .sort((x, y) => (y.volUsd || y.floorUsd) - (x.volUsd || x.floorUsd)).slice(0, 300)
      : [];
    const b = me.status === 'fulfilled' && Array.isArray(me.value)
      ? me.value.map(meNft)
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
/* Set once by the app from config, so the data layer does not import config and
   the two stay independently testable. */
let nftKey = '';
export const setOpenseaKey = k => { nftKey = k || ''; };

export function loadNftChart(n, days) {
  return cache(`nchart:${n.id}`, TTL, async () => {
    /* DeFiLlama's collection ids and Magic Eden's symbols are different id
       spaces, and asking one for the other's key does not fail loudly — it
       either returns nothing or, where the strings happen to collide, returns
       somebody else's history. Worse, DeFiLlama's series is in dollars while a
       Magic Eden row prices in SOL, so a wrong answer arrived wearing the right
       row's unit: a 120 SOL floor under a 90,000 SOL headline.
       A chart source has to match the row's source. */
    if (!n.cid || n.market === 'Magic Eden') return [];
    const j = await get(`${NFT}/chart/${encodeURIComponent(n.cid)}`, { tries: 1, timeout: 20000 })
      .catch(() => null);
    // seen as a bare array, as {data:[...]}, and as rows keyed a few ways
    const rows = Array.isArray(j) ? j : (j?.data || j?.chart || []);
    return rows.map(r => Array.isArray(r) ? num(r[1])
      : num(r.floorPriceUSD ?? r.floorPrice ?? r.floor ?? r.price ?? r.v))
      .filter(v => v > 0);
  }).then(async all => {
    const s = slice(all, days, n.floorUsd || n.floor);
    if (s.live) return s;
    const moves = floorFromMoves(n);
    if (moves) return { pts: moves, live: true, via: 'its reported 1d and 7d moves' };
    const os = await openseaFloor(n, nftKey).catch(() => null);
    return os ? { pts: os, live: true, via: 'OpenSea' } : s;
  });
}

/* An entity's own description, where its source publishes one. Assets and
   stocks come from CoinGecko, protocols from the payload the TVL chart already
   fetches. One request, cached, and only when a sheet is opened. */
/* The first paragraph, whole. It used to be cut at 420 characters, which lands
   mid-sentence on most of them and reads as a bug rather than as a summary.
   Sources write two or three sentences here; a generous cap catches the one
   that writes an essay, and it cuts at a sentence rather than a word. */
const firstPara = s => {
  const t = String(s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length <= 900) return t;
  const cut = t.slice(0, 900);
  const stop = cut.lastIndexOf('. ');
  return stop > 300 ? cut.slice(0, stop + 1) : cut.replace(/\s+\S*$/, '') + '\u2026';
};

/* A tokenized share's CoinGecko page describes the wrapper: who issued it, what
   it is redeemable for, which chain it sits on. That is on the row already. The
   thing a reader wants is the company — and Wikipedia's summary endpoint is
   keyless, CORS-open and exactly one paragraph long, which is the shape this
   slot wants. The company name is the token's name with the issuer's wrapping
   taken off: "Tesla xStock" is Tesla. */
const companyOf = name => String(name || '')
  .replace(/x ?stock|token[iy]zed|dshare|backed|robinhood|coinbase|kraken|dinari|ondo|swarm|securitize|sologenic/gi, '')
  .replace(/\b(inc|corp|corporation|co|plc|ltd|sa|nv|ag)\b\.?/gi, '')
  .replace(/[^\w\s&.-]/g, ' ').replace(/\s+/g, ' ').trim();

function wikiSummary(title) {
  return cache(`wiki:${title}`, 30 * TTL, async () => {
    const j = await get(`${WIKI}/${encodeURIComponent(title)}`,
      { tries: 1, timeout: 12000 }).catch(() => null);
    // a disambiguation page describes nothing; treat it as no answer
    return j && j.type === 'standard' ? firstPara(j.extract) : '';
  });
}

export function loadAbout(it) {
  if (it.kind === 'stock') {
    const name = companyOf(it.name);
    if (name) return wikiSummary(name).then(t => t || '');
  }
  const cg = it.cg || (it.kind === 'stock' && it.id.slice(2));
  // a network is described by the page of the token that secures it
  if ((it.kind === 'asset' || it.kind === 'stock' || it.kind === 'chain') && cg) {
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
