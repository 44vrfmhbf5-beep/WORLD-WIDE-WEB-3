/* Atlas — search across chains. Live data via data.js; this file is UI only. */
import Fuse from './vendor/fuse.mjs';
import { CHAINS, CH, loadAssets, loadPools, loadProtocols, loadChains, loadStables,
  loadBridges, loadRaises, loadHacks, loadTrendingPairs, searchPairs,
  loadChainTokens, loadNFTs, loadNftChart, loadChainChart, loadStableChart, loadStocks, loadAbout,
  loadAssetChart, loadPairChart, loadPoolChart, loadProtocolChart,
  loadVerified, loadMorpho, loadBridgeChart, loadNftItems,
  links, actions, flags, clearCache } from './data.js';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const coarse = matchMedia('(hover:none)').matches;   // don't pop a mobile keyboard
// token names and pool metadata are partly user-supplied onchain strings
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = n => !isFinite(n) || !n ? '0' : n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
// toPrecision goes exponential below 1e-6, which is exactly where the DEX long
// tail lives — show the zeros instead, trimmed to the significant digits.
/* compact() is for money, where two significant figures is the point. A count
   is not money: "1K of 1K" hides the difference between 1,029 and 1,200, which
   is the whole thing the number is there to say. */
const count = n => n < 1e5 ? String(n | 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',') : compact(n);
const tiny = n => n.toFixed(Math.min(20, 3 - Math.floor(Math.log10(n)))).replace(/0+$/, '').replace(/\.$/, '');
const usd = n => !isFinite(n) ? '—' : n < 0 ? '-' + usd(-n)
  : n >= 1e4 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : n >= 1 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : n === 0 ? '$0.00' : '$' + tiny(n);
const pct = n => (n > 0 ? '+' : '') + (n ?? 0).toFixed(2) + '%';
// null is "we were not told"; 0 is "it did not move", and they read differently
const move = n => n == null ? '—' : pct(n);
const apy = n => (n >= 1000 ? compact(n) : (n ?? 0).toFixed(2)) + '%';
const ago = t => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'just now' : m < 60 ? `${m | 0}m ago` : `${m / 60 | 0}h ago`; };
const floorOf = i => i.floorUsd ? usd(i.floorUsd)
  : i.floor ? `${i.floor.toFixed(i.unit === 'SOL' ? 2 : 3)} ${i.unit}` : '—';
const when = t => { const d = (Date.now() - t) / 864e5;
  return !t ? '' : d < 1 ? 'today' : d < 30 ? `${d | 0}d ago` : d < 365 ? `${d / 30 | 0}mo ago` : `${(d / 365).toFixed(0)}y ago`; };

function path(pts, w, h, pad = 2) {
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)} ${(pad + (1 - (p - lo) / r) * (h - pad * 2)).toFixed(1)}`).join('');
}
const spark = (pts, up) => !pts?.length ? '<div class="spark"></div>'
  : `<svg class="spark" viewBox="0 0 62 26" fill="none"><path d="${path(pts, 62, 26)}" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- storage ----------
   Reading localStorage THROWS on an opaque origin (a page opened from file://),
   in Safari private mode, and wherever site data is blocked. This runs at module
   scope, so an unguarded read kills the whole app before any listener is bound:
   the static shell still renders and nothing responds. Degrade to memory. */
let memory = null;
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return memory; } },
  set(k, v) { memory = v; try { localStorage.setItem(k, v); } catch {} },
};
const readWatch = () => {
  try { return JSON.parse(store.get('atlas:watch') || '[]'); } catch { return []; }
};
const readSeen = () => {
  try { return JSON.parse(store.get('atlas:seen') || '[]'); } catch { return []; }
};

/* ---------- state ---------- */
const S = {
  q: '', tab: 'all', chain: null, sel: 0, list: [],
  assets: [], pools: [], fuse: null,
  protocols: [], chainRows: [], yields: [], stables: [], bySym: {}, bridges: [], raises: [], hacks: [],
  pairs: [], chainTokens: [], nfts: [], stockRows: [], remote: { q: '', rows: [], busy: false, errors: [] }, byProto: {},
  loading: true, err: null, warn: null, at: 0,
  verified: null, morpho: 0,
  // table vs cards, DefiLlama density vs Aave's, and the active column sort
  view: store.get('atlas:view') || 'auto', dense: store.get('atlas:dense') === '1',
  safe: store.get('atlas:safe') !== '0',
  sort: null, facets: new Set(), limit: 40,
  // what was typed, what it was read as, and the numeric constraints it named
  nl: null, where: [],
  watch: new Map(readWatch().map(i => [i.id, i])),
  seen: readSeen(),
};
const el = {
  q: $('#q'), res: $('#results'), meta: $('#meta'), sheet: $('#sheet'), scrim: $('#scrim'),
  clear: $('#clear'), banner: $('#banner'), stats: $('#statbar'), sortbar: $('#sortbar'),
  facetbar: $('#facetbar'),
};
const saveWatch = () => store.set('atlas:watch', JSON.stringify([...S.watch.values()]));

/* ---------- data ---------- */
async function load({ force } = {}) {
  if (force) clearCache();
  S.loading = true; S.err = S.warn = null; render();
  const [a, p] = await Promise.allSettled([loadAssets(), loadPools()]);
  S.assets = a.status === 'fulfilled' ? a.value : [];
  const m = p.status === 'fulfilled' ? p.value : { lending: [], yields: [] };
  S.pools = m.lending; S.yields = m.yields;
  enrich();                       // protocols, chains and stables land behind this
  if (a.status === 'rejected' && p.status === 'rejected') S.err = a.reason?.message || 'Could not reach the data sources.';
  else if (a.status === 'rejected') S.warn = 'Asset prices unavailable — ' + (a.reason?.message || 'CoinGecko is not responding.');
  else if (p.status === 'rejected') S.warn = 'Lending markets unavailable — ' + (p.reason?.message || 'DeFiLlama is not responding.');
  if (flags.sample) { S.err = null; S.warn = null; }   // sample data stood in
  S.loading = false; S.at = Date.now();
  nodes.clear(); reindex(); render();
}

/* Phase two. Protocols, chain TVL and stablecoin supply are large and not
   needed for first paint, so they load behind the first render and are merged
   in when they arrive. Failures here are silent: the page is already useful. */
let enriched = false;
async function enrich() {
  if (enriched) return; enriched = true;
  const got = await Promise.allSettled([loadProtocols(), loadChains(), loadStables(),
    loadBridges(), loadRaises(), loadHacks(), loadTrendingPairs(), loadNFTs(), loadStocks()]);
  const val = (i, d) => got[i].status === 'fulfilled' ? got[i].value : d;
  S.protocols = val(0, []);
  S.chainRows = val(1, []);
  const st = val(2, { rows: [], bySym: {} });
  S.stables = st.rows; S.bySym = st.bySym;
  S.bridges = val(3, []); S.raises = val(4, []); S.hacks = val(5, []);
  S.pairs = val(6, []); S.nfts = val(7, []); S.stockRows = val(8, []);
  S.byProto = Object.fromEntries(S.protocols.map(p => [p.slug, p]));
  joinLogos();
  nodes.clear(); reindex(); render();
  third();
}

/* Phase three. Two registries that say which token is the real one, and the
   isolated lending markets one protocol publishes and the aggregator only
   samples. Both are pure addition: if neither answers, nothing changes. */
let thirded = false;
async function third() {
  if (thirded) return; thirded = true;
  const [v, m] = await Promise.allSettled([loadVerified(), loadMorpho()]);
  if (v.status === 'fulfilled') S.verified = v.value;
  if (m.status === 'fulfilled' && m.value.length) {
    // DeFiLlama already carries the largest Morpho markets; keep one of each
    const have = new Set(S.pools.filter(p => /morpho/i.test(p.slug))
      .map(p => `${p.sym}@${p.chain}`));
    const add = m.value.filter(x => !have.has(`${x.sym}@${x.chain}`));
    for (const x of add) { x.protocol = S.byProto[x.slug] || null; x.img = x.protocol?.img || null; }
    S.pools = [...S.pools, ...add].sort((a, b) => b.supplyUsd - a.supplyUsd);
    S.morpho = add.length;
  }
  if (S.verified?.count || S.morpho) { nodes.clear(); reindex(); render(); }
}

/* Three kinds had a logo available and were drawing coloured initials instead.
   A market's tile stands for the protocol running it, and DeFiLlama returns that
   logo with the protocol; a stablecoin is nearly always also a top-100 asset,
   whose logo is already loaded. Neither costs a request. */
function joinLogos() {
  for (const p of S.pools) {
    p.protocol = S.byProto[p.slug] || null;
    p.img = p.protocol?.img || null;
  }
  for (const y of S.yields) y.img = S.byProto[y.slug]?.img || null;
  const bySym = new Map();
  for (const a of S.assets) if (a.img && !bySym.has(a.sym)) bySym.set(a.sym, a.img);
  for (const st of S.stables) st.img = st.img || bySym.get(st.sym) || null;
  /* A network's own token usually carries its name — Ethereum, Solana, Sui —
     and that token has a CoinGecko page describing the chain. Where the names
     line up the chain inherits it; where they do not it simply has none. */
  const byName = new Map(S.assets.filter(a => a.cg).map(a => [a.name.toLowerCase(), a]));
  for (const c of S.chainRows) {
    const a = byName.get(c.name.toLowerCase());
    if (a) { c.cg = a.cg; c.img = c.img || a.img || null; }
  }
}

/* The box holds a sentence; the index is searched with the words left after it
   has been read. Everywhere that used to mean "what was typed" now has to say
   which of the two it means. */
const term = () => (S.nl ? S.nl.text : S.q).trim();

/* A numeric constraint a sentence named: ["chg", ">=", 50]. Kept beside the
   facets rather than inside them, because a sentence can ask for a threshold no
   chip offers. */
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b };
const meets = i => S.where.every(([f, op, v]) => {
  const x = Number(i[f]);
  return Number.isFinite(x) && OPS[op](x, v);
});

const onChain = i => !S.chain || (i.chains ? i.chains.includes(S.chain) : i.chain === S.chain);

/* Where each kind's rows live. everything(), the category rail and the tab
   scopes all read this, so a new kind reaches all three at once. */
const SRC = {
  asset: () => S.assets, stock: () => S.stockRows, pool: () => S.pools, yield: () => S.yields,
  protocol: () => S.protocols, nft: () => S.nfts,
  pair: () => [...S.pairs, ...S.chainTokens],   // a chain's own tokens are pairs
  stablecoin: () => S.stables, bridge: () => S.bridges, raise: () => S.raises,
  hack: () => S.hacks, chain: () => S.chainRows,
};
// exactly one home per row: listing chain tokens under `asset` too counted them
// twice, inflating the totals and letting duplicates eat the per-kind slice
const everything = () => KINDS.flatMap(k => SRC[k]());

/** Rows behind a category. Assets borrows the chain's own traded tokens,
    because a global asset carries no chain and the filter would empty the tab. */
/* One filter, because dead and fake rows share their tells: nothing trades, or
   the row is a copy of something real. Each kind says what "trading" means for
   it; two more rules apply only to the DEX long tail, which is where fakes
   live — the curated sources (protocols, bridges, raises, chains) need none. */
/* A registry that names the token outright beats any heuristic about it. Where
   one answers, `isReal` is a fact; where none does, it is null and the rules
   below stand on their own exactly as they did. */
const NET_ID = Object.fromEntries(CHAINS.map(([id, name]) => [name.toLowerCase(), id]));
/* Where the row carries a contract address, only the address counts. Matching
   on the ticker would have handed every impersonator the thing it is imitating:
   a fake USDC on Ethereum satisfies "USDC@eth" exactly as well as the real one,
   and would have been waved past the rule that exists to catch it. The ticker is
   only consulted for rows that have no address to check. */
function isReal(i) {
  const v = S.verified;
  if (!v?.count) return null;
  const addr = i.addr && String(i.addr).toLowerCase();
  const chain = i.chain || NET_ID[String(i.net || '').toLowerCase()];
  for (const [name, set] of v.by) {
    if (addr) { if (set.addrs.has(addr)) return name; continue; }
    if (chain && set.syms.has(`${i.sym}@${chain}`)) return name;
  }
  return null;                                   // absence is not proof
}

/* A price is only a price if the other side of the pair holds still. CAT/SOL
   quotes a memecoin in a memecoin: the number moves when either leg moves, and
   two such pairs cannot be compared to each other at all. Quoting in something
   pegged to a dollar makes the column mean one thing.

   The peg list is the app's own stablecoin index rather than a hand-kept
   constant, so a new stablecoin is recognised the day it is indexed; the fiat
   codes and the wrapped forms of the same dollars are the part no index
   returns. */
const FIAT = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'BRL', 'TRY', 'SGD']);
const stableQuotes = () => {
  const set = new Set(FIAT);
  for (const st of S.stables) if (st.sym) set.add(st.sym.toUpperCase());
  // the same dollars under a bridged or wrapped ticker, which no list carries
  for (const x of ['USDC.E', 'USDBC', 'USDB', 'AXLUSDC', 'USDT.E', 'USDCE', 'WUSDC',
    'USD1', 'RLUSD', 'SUSD', 'CRVUSD', 'BUSD', 'TUSD', 'GUSD', 'LUSD', 'EURC', 'EURS'])
    set.add(x);
  return set;
};

function sift(rows) {
  if (!S.safe) return rows;
  const listed = new Set(S.assets.map(x => x.sym));
  const pegged = stableQuotes();
  const deepest = new Map();                 // ticker on one network -> real pool
  for (const i of rows) {
    if (i.kind !== 'pair') continue;
    const k = i.sym + '@' + i.net, b = deepest.get(k);
    if (!b || i.liq > b.liq) deepest.set(k, i);
  }
  return rows.filter(i => {
    const ok = KIND[i.kind].ok;
    if (ok && !ok(i)) return false;
    if (i.kind !== 'pair') return true;
    // priced against something that moves: the number is not comparable to any
    // other row, so it is not a price this table can show
    if (i.quote && !pegged.has(i.quote)) return false;
    // a registry naming this exact token settles it; the guesses below do not apply
    if (isReal(i)) return true;
    // A ticker repeated on one network is usually copies of one token — but two
    // indexes carrying the same real token look identical from here, so only
    // drop what is an order of magnitude shallower than the deepest pool.
    const best = deepest.get(i.sym + '@' + i.net);
    if (best !== i && i.liq < best.liq * 0.1) return false;
    // wearing a listed ticker without the liquidity to be it
    return !(listed.has(i.sym) && i.liq < 25e4);
  });
}

function rowsFor(tab) {
  if (tab === 'saved') {
    const live = everything();
    return [...S.watch.values()].map(i => live.find(x => x.id === i.id) || i);
  }
  const k = TAB_KIND[tab];
  if (!k) return everything();
  return k === 'asset' && S.chain ? [...S.chainTokens, ...S.assets] : SRC[k]();
}
const countOf = tab => sift(rowsFor(tab).filter(onChain)).length;
let hidden = 0, base = [];   // base: the category before its facets, for the chip counts
/* Facets narrow together: a row has to answer every question that is on. */
const facetPred = (skip) => {
  const on = facetsFor(S.tab).filter(f => f !== skip && facetOn(f));
  return on.length ? (i => on.every(f => f[2](i))) : null;
};
function scope() {
  const all = rowsFor(S.tab).filter(onChain);
  const keep = S.where.length ? sift(all).filter(meets) : sift(all);
  hidden = all.length - keep.length;         // never filter silently
  base = keep;
  const p = facetPred();
  return p ? keep.filter(p) : keep;
}
function reindex() {
  S.fuse = new Fuse(scope(), {
    keys: [{ name: 'sym', weight: 3 }, { name: 'name', weight: 3 }, { name: 'proto', weight: 2 }, { name: 'key', weight: 1 }],
    threshold: 0.34, ignoreLocation: true, minMatchCharLength: 2, includeScore: true,
  });
}

const size = i => KIND[i.kind].size(i);

/* A category holds far more than fits on a screen, so it is cut to a page.
   The cut has to be the LAST thing that happens: sorting the page instead of
   the category answered a different question than the one asked — "highest APY"
   meant "highest APY among the forty biggest". `matched` is the size before the
   cut, so the list can say what it is showing and offer the rest. */
const PAGE = 60;
let shown = 0, matched = 0;
const order = l => S.sort ? applySort(l) : [...l].sort((x, y) => size(y) - size(x));
function cap(list) {
  matched = list.length;
  const out = list.slice(0, S.limit);
  shown = out.length;
  return out;
}

/* With no query the two kinds are ranked separately. Market cap and supplied-USD
   are not the same scale — real assets reach $2T where the largest lending market
   is a few $B — so one combined sort buries every market under the assets. */
function trending() {
  const all = scope();
  if (S.tab !== 'all') return cap(order(all));
  // All is a tour of every kind rather than a list of one, so it is balanced
  // per kind and has no more to show
  const per = { asset: 12, pool: 10, yield: 10, protocol: 10, nft: 10, stablecoin: 8, bridge: 6, raise: 8, hack: 6, chain: 12 };
  const out = KINDS.flatMap(k => order(all.filter(i => i.kind === k)).slice(0, per[k] || 6));
  matched = shown = out.length;
  return out;
}

function compute() {
  const q = term();
  if (!q) return trending();
  if (!S.fuse) return [];
  const t = q.toLowerCase().replace(/^\$+/, '');       // people type $CASHCAT
  const toks = t.split(/\s+/).filter(Boolean);

  // Fuse matches a query as one contiguous pattern, so "usdc lending" scores
  // "Hyperlend" on the second word alone. Run each word separately and keep
  // what every word matched — that is what a two-word query actually means.
  const run = w => new Map(S.fuse.search(w, { limit: 400 })
    .map(r => [r.item.id, [r.item, 1 - (r.score ?? 1)]]));

  let hits;
  if (toks.length === 1) {
    hits = [...run(toks[0]).values()];
  } else {
    const sets = toks.map(run);
    const all = [];
    for (const [id, [item, score]] of sets[0]) {
      let total = score;
      const every = sets.slice(1).every(s => {
        const h = s.get(id); if (!h) return false;
        total += h[1]; return true;
      });
      if (every) all.push([item, total / toks.length + 0.5]);
    }
    hits = all.length ? all : [...run(t).values()];   // nothing matched all words
  }

  for (const h of hits) {
    const i = h[0];
    const sym = (i.sym || '').toLowerCase(), nm = (i.name || '').toLowerCase(), pr = (i.proto || '').toLowerCase();
    if (sym === t || sym === toks[0]) h[1] += 3;
    else if (sym.startsWith(toks[0])) h[1] += 1.5;
    if (pr.startsWith(toks[0])) h[1] += 1;
    if (nm.startsWith(toks[0])) h[1] += 0.6;
    // a protocol's own name should outrank its individual markets
    if (i.kind === 'protocol' && (nm === t || nm.startsWith(toks[0]))) h[1] += 0.9;
  }
  hits.sort((x, y) => y[1] - x[1] || size(y[0]) - size(x[0]));

  // Keep every kind, grouped, with the group holding the strongest hit first.
  // (Listing kinds explicitly here once dropped protocols and networks from
  // every search, while browsing still showed them.)
  const groups = KINDS.map(k => hits.filter(x => x[0].kind === k)).filter(g => g.length);
  groups.sort((x, y) => y[0][1] - x[0][1]);
  const found = groups.flat().map(x => x[0]);
  // an explicit column sort outranks relevance, and must see every match
  return cap(S.sort ? applySort(found) : found);
}

/* ---------- rows ---------- */
const tok = (it, sq) => {
  const label = KIND[it.kind].label(it);
  const c = CH[it.chain];
  return `<div class="tok${sq ? ' sq' : ''}${label.length > 3 ? ' t4' : ''}" style="--c:${it.color}${c ? ';--c2:' + c.color : ''}">${esc(label)}` +
    (it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" referrerpolicy="no-referrer" onload="this.style.opacity=1" onerror="this.remove()">` : '') +
    (c ? '<span class="badge"></span>' : '') + `</div>`;
};
const star = it => `<button class="star${S.watch.has(it.id) ? ' on' : ''}" data-star="${esc(it.id)}" aria-label="Save to watchlist" aria-pressed="${S.watch.has(it.id)}">
  <svg viewBox="0 0 24 24" class="i"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg></button>`;

const optId = it => 'o-' + it.id.replace(/[^\w:.-]/g, '_');
// volatile fields only: a row is reused across renders unless its numbers moved
let mode = '';   // '' = cards, else the kind whose columns are on screen
const sigOf = it => `${mode}|${size(it)}|${it.chg ?? it.chg1d ?? it.apy ?? it.sup ?? 0}|${!!it.protocol}`;

/* Ranges a sheet offers, and how its chart reads a value back. */
const R = { price: [[1, '1D'], [7, '1W'], [30, '1M'], [365, '1Y']],
  mid: [[7, '1W'], [30, '1M'], [90, '3M'], [365, '1Y']],
  long: [[30, '1M'], [90, '3M'], [365, '1Y'], [3650, 'All']] };
const money = v => '$' + compact(v);
const nftValue = (v, i) => i.floorUsd ? usd(v) : `${v.toFixed(i.unit === 'SOL' ? 2 : 3)} ${i.unit}`;

/* One descriptor per kind drives the rows, the group headings, the search
   scope and the sheet's chart — [loader, default range, ranges, readout].
   Adding a kind is a table entry, not another branch through render. */
const KIND = {
  asset: { group: 'Assets', size: i => i.mcap, spark: true, chart: [loadAssetChart, 1, R.price, usd],
    // nothing traded, nothing priced, or a market cap so thin the price is
    // whatever the last trade said it was
    ok: i => i.vol > 0 && i.price > 0 && i.mcap >= 1e6,
    cols: [['Price', i => usd(i.price), 'price'], ['24h', i => pct(i.chg), 'chg', 'sgn'],
      ['7d', i => move(i.chg7d), 'chg7d', 'sgn'], ['30d', i => move(i.chg30d), 'chg30d', 'sgn'],
      ['Market cap', i => money(i.mcap), 'mcap'], ['Volume 24h', i => money(i.vol), 'vol']],
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: i => i.rank ? '#' + i.rank : '',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.mcap)} cap`,
    n1: i => usd(i.price), n2: i => pct(i.chg), cls: i => i.chg >= 0 ? 'up' : 'down' },

  stock: { group: 'Tokenized stocks', size: i => i.mcap, spark: true, sq: true,
    chart: [loadAssetChart, 1, R.price, usd],
    ok: i => i.vol > 0 && i.price > 0,
    cols: [['Price', i => usd(i.price), 'price'], ['24h', i => pct(i.chg), 'chg', 'sgn'],
      ['7d', i => move(i.chg7d), 'chg7d', 'sgn'],
      ['Market cap', i => money(i.mcap), 'mcap'], ['Volume 24h', i => money(i.vol), 'vol']],
    label: i => (i.under || i.sym).slice(0, 4),
    title: i => i.name, sub: i => i.sym, tag: i => i.issuer || 'Equity',
    meta: i => `tracks ${i.under}${i.issuer ? ` · issued by ${i.issuer}` : ''}`,
    tail: i => `$${compact(i.mcap)} cap`,
    n1: i => usd(i.price), n2: i => pct(i.chg), cls: i => i.chg >= 0 ? 'up' : 'down' },

  pool: { group: 'Lending markets', size: i => i.supplyUsd, sq: true, chart: [loadPoolChart, 30, R.mid, apy],
    ok: i => i.supplyUsd >= 1e6 && i.sup >= 0,
    cols: [['Supply APY', i => apy(i.sup), 'sup', 'up'],
      ['Borrow APY', i => i.bor == null ? '—' : apy(i.bor), 'bor'],
      ['Supplied', i => money(i.supplyUsd), 'supplyUsd'], ['Borrowed', i => money(i.borrowUsd), 'borrowUsd'],
      ['Available', i => money(i.free), 'free'], ['Util', i => i.util.toFixed(0) + '%', 'util']],
    label: i => (i.proto || '?').slice(0, 2).toUpperCase(),
    title: i => i.proto, sub: i => i.sym, tag: () => 'Lending',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.supplyUsd)} supplied`,
    n1: i => apy(i.sup), n1cls: 'up',
    n2: i => i.bor == null ? 'supply only' : `${apy(i.bor)} borrow`, cls: () => 'mute' },

  yield: { group: 'Yield', size: i => i.tvl, sq: true, chart: [loadPoolChart, 30, R.mid, apy],
    // four-figure APY on a small pool is the oldest farm scam there is, and a
    // rate five times its own 30-day mean is the same trick told quietly
    ok: i => i.tvl >= 1e6 && i.apy > 0 && i.apy <= 1000 && !i.outlier && i.spike <= 5,
    cols: [['APY', i => apy(i.apy), 'apy', 'up'], ['Base', i => apy(i.apyBase), 'apyBase'],
      ['Rewards', i => i.apyReward ? apy(i.apyReward) : '—', 'apyReward'],
      ['30d avg', i => i.mean30 ? apy(i.mean30) : '—', 'mean30'],
      ['Trend', i => i.outlook ? title2(i.outlook) : '—', null, 'txt'], ['TVL', i => money(i.tvl), 'tvl']],
    label: i => (i.proto || '?').slice(0, 2).toUpperCase(),
    title: i => i.proto, sub: i => i.sym, tag: i => i.stable ? 'Stable yield' : 'Yield',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.tvl)} TVL`,
    n1: i => apy(i.apy), n1cls: 'up',
    n2: i => i.apyReward ? `${apy(i.apyBase)} + rewards` : 'APY', cls: () => 'mute' },

  protocol: { group: 'Protocols', size: i => i.tvl, sq: true, chart: [loadProtocolChart, 90, R.long, money],
    // a protocol with no TVL and no volume is a listing, not a business
    ok: i => i.tvl >= 1e6 || i.vol24 > 0 || i.fees24 > 0,
    cols: [['TVL', i => money(i.tvl), 'tvl'], ['1d', i => move(i.chg1d), 'chg1d', 'sgn'],
      ['7d', i => move(i.chg7d), 'chg7d', 'sgn'], ['Volume 24h', i => i.vol24 ? money(i.vol24) : '—', 'vol24'],
      ['Fees 24h', i => i.fees24 ? money(i.fees24) : '—', 'fees24'],
      ['Revenue 24h', i => i.rev24 ? money(i.rev24) : '—', 'rev24']],
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: i => i.cat,
    meta: i => `${i.chains.length} chain${i.chains.length === 1 ? '' : 's'}`,
    tail: i => i.vol24 ? `$${compact(i.vol24)} 24h volume` : `$${compact(i.tvl)} TVL`,
    n1: i => '$' + compact(i.tvl), n2: i => move(i.chg1d),
    cls: i => i.chg1d == null ? 'mute' : i.chg1d >= 0 ? 'up' : 'down' },

  nft: { group: 'NFT collections', size: i => i.volUsd || i.floorUsd || i.floor,
    // a collection with no floor and no trading is a name in a list. An unknown
    // supply is not the same as a supply of zero: Magic Eden's index does not
    // report one, and dropping every Solana collection over that is the rule
    // punishing the source rather than the row.
    ok: i => (i.volUsd > 0 || i.volSol > 0 || i.floor > 0) && i.supply !== 0,
    cols: [['Floor', floorOf, 'floorUsd'], ['24h', i => move(i.chg1d), 'chg1d', 'sgn'],
      ['7d', i => move(i.chg7d), 'chg7d', 'sgn'],
      ['Volume', i => i.volUsd ? money(i.volUsd) : '—', 'volUsd'],
      ['Items', i => i.supply ? compact(i.supply) : '—', 'supply']],
    chart: [loadNftChart, 30, R.mid, nftValue],
    label: i => (i.name || '?').slice(0, 2).toUpperCase(), sq: true,
    title: i => i.name, tag: i => i.market,
    meta: i => i.net || '',
    tail: i => i.supply ? `${compact(i.supply)} items` : 'collection',
    n1: i => floorOf(i), n2: i => i.chg1d == null ? 'floor' : pct(i.chg1d),
    cls: i => i.chg1d == null ? 'mute' : i.chg1d >= 0 ? 'up' : 'down' },

  pair: { group: 'DEX pairs', size: i => i.liq, chart: [loadPairChart, 7, R.price, usd],
    ok: i => i.vol24 >= 1000 && i.liq >= 5000,
    cols: [['Price', i => i.price ? usd(i.price) : '—', 'price'], ['24h', i => pct(i.chg), 'chg', 'sgn'],
      ['Liquidity', i => money(i.liq), 'liq'], ['Volume 24h', i => money(i.vol24), 'vol24'],
      ['FDV', i => i.fdv ? money(i.fdv) : '—', 'fdv']],
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: i => i.dex,
    meta: i => i.net || CH[i.chain]?.name || '',
    tail: i => i.liq ? `$${compact(i.liq)} liquidity` : `$${compact(i.vol24)} 24h volume`,
    n1: i => i.price ? usd(i.price) : '—',
    n2: i => i.chg ? pct(i.chg) : `$${compact(i.vol24)} 24h`,
    cls: i => i.chg ? (i.chg >= 0 ? 'up' : 'down') : 'mute' },

  stablecoin: { group: 'Stablecoins', size: i => i.circulating, chart: [loadStableChart, 90, R.long, money],
    // a coin claiming a dollar peg while trading at 40 cents is not a stablecoin
    // any more, and one nobody holds was never one
    ok: i => i.circulating >= 1e6 && i.price > 0.5 && i.price < 1.8,
    cols: [['Circulating', i => money(i.circulating), 'circulating'], ['Peg', i => usd(i.price), 'price'],
      ['Mechanism', i => i.mech || '—', null, 'txt'], ['Chains', i => String(i.chains.length), null]],
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: () => 'Stablecoin',
    meta: i => i.mech || 'Pegged', tail: i => `${usd(i.price)} against its peg`,
    n1: i => '$' + compact(i.circulating), n2: i => 'circulating', cls: () => 'mute' },

  bridge: { group: 'Bridges', size: i => i.vol24, sq: true,
    chart: [loadBridgeChart, 90, R.long, money],
    ok: i => i.vol24 > 0,
    cols: [['Volume 24h', i => money(i.vol24), 'vol24'],
      ['Previous day', i => i.volPrev ? money(i.volPrev) : '—', 'volPrev'],
      ['Change', i => i.volPrev ? pct((i.vol24 - i.volPrev) / i.volPrev * 100) : '—', null, 'sgn'],
      ['Chains', i => String(i.chains.length), null]],
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: () => 'Bridge',
    meta: i => `${i.chains.length} chain${i.chains.length === 1 ? '' : 's'}`,
    tail: i => `$${compact(i.vol24)} 24h volume`,
    n1: i => '$' + compact(i.vol24),
    n2: i => i.volPrev ? pct((i.vol24 - i.volPrev) / i.volPrev * 100) : '24h',
    cls: i => i.volPrev && i.vol24 >= i.volPrev ? 'up' : i.volPrev ? 'down' : 'mute' },

  raise: { group: 'Funding rounds', size: i => i.amount, sq: true,
    // an undated or unpriced round is a row with nothing in it
    ok: i => i.amount > 0 && i.date > 0,
    cols: [['Raised', i => money(i.amount), 'amount'], ['Round', i => i.round || '—', null, 'txt'],
      ['Valuation', i => i.valuation ? money(i.valuation) : '—', 'valuation'],
      ['Date', i => when(i.date), 'date', 'txt']],
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: i => i.round || 'Raise',
    meta: i => i.sector || 'Funding',
    tail: i => i.investors.length ? `${i.investors.length} investors` : when(i.date),
    n1: i => '$' + compact(i.amount), n2: i => when(i.date), cls: () => 'mute' },

  hack: { group: 'Exploits', size: i => i.amount, sq: true,
    ok: i => i.amount > 0 && i.date > 0,
    cols: [['Lost', i => money(i.amount), 'amount', 'down'], ['Technique', i => i.technique, null, 'txt'],
      ['Date', i => when(i.date), 'date', 'txt']],
    label: () => '!!', title: i => i.name, tag: () => 'Exploit',
    meta: i => i.technique, tail: i => when(i.date),
    n1: i => '$' + compact(i.amount), n1cls: 'down', n2: () => 'lost', cls: () => 'mute' },

  chain: { group: 'Networks', size: i => i.tvl, sq: true, chart: [loadChainChart, 90, R.long, money],
    // a network with nothing indexed on it is a name, not a destination
    ok: i => i.tvl > 0 || S.protocols.some(r => r.chains.includes(i.chain)),
    cols: [['TVL', i => money(i.tvl), 'tvl'],
      ['Protocols', i => String(S.protocols.filter(r => r.chains.includes(i.chain)).length), null],
      ['Lending markets', i => String(S.pools.filter(p => p.chain === i.chain).length), null]],
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: () => 'Network',
    meta: i => `${S.protocols.filter(r => r.chains.includes(i.chain)).length} protocols`,
    tail: i => `${S.pools.filter(p => p.chain === i.chain).length} lending markets`,
    n1: i => '$' + compact(i.tvl), n2: () => 'TVL', cls: () => 'mute' },
};
const KINDS = Object.keys(KIND);

/* Within a category the useful next cut is rarely another sort — it is a
   question. Which of these can I borrow against, which rates are holding, which
   stablecoin has come off its peg. Each kind names its own; they narrow together
   and every chip carries how much it would leave. */
const FACET = {
  asset: [['up', 'Gainers', i => i.chg > 0], ['down', 'Losers', i => i.chg < 0],
    ['big', 'Large cap', i => i.mcap >= 1e10],
    ['busy', 'Heavily traded', i => i.turn >= 10],
    ['dip', 'Far off high', i => i.athChg <= -50]],
  stock: [['up', 'Gainers', i => i.chg > 0], ['down', 'Losers', i => i.chg < 0],
    ['big', '$500M+', i => i.mcap >= 5e8],
    ['backed', 'Backed', i => i.issuer === 'Backed'],
    ['other', 'Other issuers', i => !!i.issuer && i.issuer !== 'Backed']],
  pool: [['borrow', 'Borrowable', i => i.bor != null && i.free > 0],
    ['stable', 'Stablecoin', i => i.stable],
    ['deep', '$100M+', i => i.supplyUsd >= 1e8],
    ['ltv', 'High LTV', i => i.ltv >= 0.75],
    ['room', 'Room to borrow', i => i.util < 70]],
  yield: [['stable', 'Stablecoin', i => i.stable],
    ['noil', 'No IL risk', i => i.risk === 'no' || i.exposure === 'single'],
    ['ten', '10%+ APY', i => i.apy >= 10],
    ['holding', 'Rate not falling', i => i.outlook === 'holding' || i.outlook === 'rising'],
    ['deep', '$10M+', i => i.tvl >= 1e7]],
  protocol: [['fees', 'Earning fees', i => i.fees24 > 0],
    ['dex', 'DEXs', i => i.vol24 > 0],
    ['perps', 'Perps', i => i.perps24 > 0],
    ['big', '$1B+ TVL', i => i.tvl >= 1e9],
    ['up', 'Growing', i => i.chg7d > 0]],
  nft: [['up', 'Floor up', i => i.chg1d > 0], ['down', 'Floor down', i => i.chg1d < 0],
    ['blue', '$1M+ volume', i => i.volUsd >= 1e6],
    ['big', '10k+ items', i => i.supply >= 10000]],
  pair: [['real', 'Verified token', i => !!isReal(i)],
    ['deep', '$1M+ liquidity', i => i.liq >= 1e6],
    ['up', 'Gainers', i => i.chg > 0],
    ['busy', 'Turning over daily', i => i.liq > 0 && i.vol24 > i.liq]],
  stablecoin: [['peg', 'On peg', i => Math.abs(i.price - 1) <= 0.01],
    ['off', 'Off peg', i => Math.abs(i.price - 1) > 0.01],
    ['big', '$1B+', i => i.circulating >= 1e9]],
  bridge: [['up', 'Busier than yesterday', i => i.volPrev > 0 && i.vol24 > i.volPrev],
    ['big', '$10M+ a day', i => i.vol24 >= 1e7]],
  raise: [['year', 'Past year', i => Date.now() - i.date < 365 * 864e5],
    ['big', '$50M+', i => i.amount >= 5e7],
    ['valued', 'Valuation disclosed', i => i.valuation > 0]],
  hack: [['year', 'Past year', i => Date.now() - i.date < 365 * 864e5],
    ['big', '$50M+ lost', i => i.amount >= 5e7]],
  chain: [['big', '$1B+ TVL', i => i.tvl >= 1e9],
    ['live', 'Has lending', i => S.pools.some(p => p.chain === i.chain)]],
};
const facetsFor = tab => FACET[TAB_KIND[tab]] || [];
const facetOn = f => S.facets.has(f[0]);
// only keys a column actually declares can be sorted from the URL
const SORTABLE = new Set(KINDS.flatMap(k => (KIND[k].cols || []).map(c => c[2]).filter(Boolean)));
/* Category rail: every kind that has rows of its own gets a destination, which
   is how DefiLlama makes a large index navigable without a search term. */
const TAB_KIND = { assets: 'asset', stocks: 'stock', lending: 'pool', yield: 'yield', protocols: 'protocol',
  nfts: 'nft', dex: 'pair', stables: 'stablecoin', bridges: 'bridge', raises: 'raise',
  hacks: 'hack', networks: 'chain' };

/* A homogeneous list can be a table; a mixed one cannot, so search results and
   the All tab stay cards. That rule needs no special cases — it reads the list. */
const narrow = matchMedia('(max-width:900px)');
function tableKind(list) {
  // A phone has no room for five numeric columns.
  if (narrow.matches || S.view === 'cards' || !list.length) return null;
  // The tab has to pin the kind. On All and Saved the list is a ranked mix
  // where the group heading is what separates an asset from a DEX pair of the
  // same ticker — columns cannot say that, so those stay cards. Within one
  // category the heading says nothing the tab does not, and the columns earn
  // their place. `every` still guards it: live DEX results merge into any tab.
  const k = TAB_KIND[S.tab];
  return k && KIND[k].cols && list.every(i => i.kind === k) ? k : null;
}
const gridFor = cols => `minmax(180px,2.2fr) repeat(${cols.length},minmax(76px,1fr)) 40px`;
const cellCls = (cls, v) => cls !== 'sgn' ? (cls || '')
  : v.startsWith('-') ? 'down' : v.startsWith('+') ? 'up' : 'mute';

function theadHTML(kind) {
  const cols = KIND[kind].cols;
  const head = ([label, , key]) => key
    ? `<button data-sort="${esc(key)}"${S.sort?.key === key
        ? ` aria-sort="${S.sort.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${esc(label)}</button>`
    : `<span>${esc(label)}</span>`;
  return `<div class="thead" style="--cols:${gridFor(cols)}" role="presentation">
    <span class="name">${esc(KIND[kind].group)}</span>${cols.map(head).join('')}<span></span></div>`;
}

/** Column sort. Text columns have no key, so only comparable fields sort. */
function applySort(list) {
  if (!S.sort) return list;
  const { key, dir } = S.sort;
  return [...list].sort((a, b) => dir * ((+a[key] || 0) - (+b[key] || 0)));
}

function rowHTML(it) {
  const k = KIND[it.kind];
  if (mode) {
    const cells = k.cols.map(([, fn, , cls]) => {
      const v = String(fn(it) ?? '');
      return `<div class="cell ${cellCls(cls, v)}">${esc(v)}</div>`;
    }).join('');
    return `<div class="row" role="option" aria-selected="false" id="${optId(it)}" data-id="${esc(it.id)}"
      style="--cols:${gridFor(k.cols)}">
      <div class="name">${tok(it, k.sq)}<div class="body">
        <div class="t1">${esc(k.title(it))}${k.sub?.(it) ? ` <span class="sym">${esc(k.sub(it))}</span>` : ''}</div>
        <div class="t2">${esc(k.meta?.(it) || '')}</div></div></div>
      ${cells}${star(it)}</div>`;
  }
  const sub = k.sub?.(it), tag = k.tag?.(it), meta = k.meta?.(it), tail = k.tail?.(it);
  return `<div class="row" role="option" aria-selected="false" id="${optId(it)}" data-id="${esc(it.id)}">
    ${tok(it, k.sq)}
    <div class="body">
      <div class="t1">${esc(k.title(it))}${sub ? ` <span class="sym">${esc(sub)}</span>` : ''}</div>
      <div class="t2">${tag ? `<span class="tag">${esc(tag)}</span> ` : ''}${meta ? `<span class="mi">${esc(meta)}</span>` : ''}
        ${tail ? `<span class="tail">${meta ? '<span class="sep">·</span> ' : ''}${esc(tail)}</span>` : ''}</div>
    </div>
    ${k.spark ? spark(it.spark, it.chg >= 0) : ''}
    <div class="num"><div class="n1 ${k.n1cls || ''}">${esc(k.n1(it))}</div>
      <div class="n2 ${k.cls ? k.cls(it) : 'mute'}">${esc(k.n2(it))}</div></div>
    ${star(it)}</div>`;
}

/* ---------- render ----------
   Rows are cached by id and moved rather than rebuilt, so typing reorders the
   list without re-creating <img> elements or replaying entry animations. */
const nodes = new Map();
function nodeFor(it, i) {
  const sig = sigOf(it);
  const cached = nodes.get(it.id);
  if (cached && cached.dataset.sig === sig) return cached;
  const t = document.createElement('template');
  t.innerHTML = rowHTML(it).trim();
  const n = t.content.firstElementChild;
  n.dataset.sig = sig;
  const delay = Math.min(i, 12) * 18;
  n.classList.add('in');                       // entry animation, new nodes only
  n.style.animationDelay = delay + 'ms';
  // a timer, not animationend: a row re-rendered mid-animation is detached and
  // would never fire the event, leaving .in stuck and replaying on every render
  setTimeout(() => { n.classList.remove('in'); n.style.animationDelay = ''; }, delay + 340);
  nodes.set(it.id, n);
  if (nodes.size > 600) for (const k of nodes.keys()) { if (nodes.size <= 400) break; nodes.delete(k); }
  return n;
}

function paintSel(scroll) {
  const rows = el.res.querySelectorAll('.row');
  if (!rows.length) return el.q.removeAttribute('aria-activedescendant');
  rows.forEach((n, i) => {
    const on = i === S.sel;
    n.classList.toggle('sel', on);
    n.setAttribute('aria-selected', on);
    if (on) {
      el.q.setAttribute('aria-activedescendant', n.id);
      if (scroll) n.scrollIntoView({ block: 'nearest' });
    }
  });
}

/* The totals DefiLlama leads with, summed from data already in memory — no
   extra request, and they move with the chain filter like everything else. */
function paintStats() {
  if (S.loading || S.err) return el.stats.replaceChildren();
  const sum = (a, f) => a.filter(onChain).reduce((t, i) => t + (f(i) || 0), 0);
  // a source that has not answered totals zero; say so rather than claiming $0
  const cash = n => n ? money(n) : '—';
  const rows = [
    ['Total TVL', cash(sum(S.chainRows, i => i.tvl))],
    ['Supplied', cash(sum(S.pools, i => i.supplyUsd))],
    ['DEX volume 24h', cash(sum(S.protocols, i => i.vol24))],
    ['Stablecoins', cash(sum(S.stables, i => i.circulating))],
    ['Indexed', compact(everything().filter(onChain).length)],
  ];
  el.stats.innerHTML = rows.map(([k, v]) =>
    `<div class="s"><div class="sk">${k}</div><div class="sv">${esc(v)}</div></div>`).join('');
}

/* The column headers are the sort control, and a phone has no room for them.
   Same descriptor, rendered as chips, so sorting is not desktop-only. */
function paintSort() {
  const k = TAB_KIND[S.tab];
  const cols = k && KIND[k].cols?.filter(c => c[2]);
  if (!cols?.length) return el.sortbar.replaceChildren();
  const chip = ([label, , key]) => `<button data-sort="${esc(key)}"${S.sort?.key === key
    ? ` class="on" aria-pressed="true"` : ' aria-pressed="false"'}>${esc(label)}${
    S.sort?.key === key ? (S.sort.dir > 0 ? ' \u2191' : ' \u2193') : ''}</button>`;
  el.sortbar.innerHTML = `<span class="sk">Sort</span>${cols.map(chip).join('')}`;
}

/* Each chip says how much it would leave, counted against the other chips that
   are already on — so the row never offers a filter that empties the screen. */
/* On All and Saved there are no per-kind questions to ask, but a mixed result
   set has a shape worth showing: how much of it is which kind, and one click to
   see only that. Same row, so there is one place that says how to narrow. */
function readingHTML() {
  if (!S.nl) return '';
  const bits = [
    S.nl.tab && TABS.find(([t]) => t === S.nl.tab)?.[1],
    S.nl.chain && CH[S.nl.chain]?.name,
    ...(S.nl.where || []).map(whereWord),
    S.nl.text && `matching “${S.nl.text}”`,
  ].filter(Boolean);
  return `<span class="sk">Reading</span>` +
    bits.map(b => `<span class="rd">${esc(b)}</span>`).join('') +
    `<button class="clr" data-unread title="${esc(S.nl.via)}">Undo</button>`;
}

function paintKinds() {
  if (S.nl) return void (el.facetbar.innerHTML = readingHTML());
  if (!S.q.trim()) return el.facetbar.replaceChildren();
  const counts = new Map();
  for (const i of S.list) counts.set(i.kind, (counts.get(i.kind) || 0) + 1);
  if (counts.size < 2) return el.facetbar.replaceChildren();
  el.facetbar.innerHTML = `<span class="sk">In</span>` + [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `<button data-jump="${esc(k)}">${esc(KIND[k].group)}<span class="fn">${count(n)}</span></button>`)
    .join('');
}

function paintFacets() {
  if (S.nl) return void (el.facetbar.innerHTML = readingHTML());
  const fs = facetsFor(S.tab);
  if (!fs.length) return paintKinds();
  const chip = f => {
    const others = facetPred(f);
    const pool = others ? base.filter(others) : base;
    let n = 0; for (const i of pool) if (f[2](i)) n++;
    const on = facetOn(f);
    return `<button data-facet="${esc(f[0])}" class="${on ? 'on' : ''}" aria-pressed="${on}"${
      n || on ? '' : ' disabled'}>${esc(f[1])}<span class="fn">${count(n)}</span></button>`;
  };
  el.facetbar.innerHTML = `<span class="sk">Filter</span>${fs.map(chip).join('')}${
    S.facets.size ? `<button class="clr" data-facet="">Clear ${S.facets.size}</button>` : ''}`;
}

/** The last dozen things opened, as far as they are still in the index. */
const recent = () => S.seen.map(id => everything().find(x => x.id === id)).filter(Boolean).slice(0, 6);

/** Bring the results back into view when the query or a filter changes. */
function scrollToResults() {
  const y = el.res.getBoundingClientRect().top + scrollY - 150;
  if (scrollY > y) scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

const skeleton = n => Array.from({ length: n }, (_, i) => `<div class="row sk" style="animation-delay:${i * 60}ms"><div class="tok"></div><div class="body"><div class="ln w40"></div><div class="ln w25"></div></div><div class="ln w15"></div></div>`).join('');

function render() {
  document.body.classList.toggle('searching', !!S.q);
  el.q.classList.toggle('read', !!S.nl);
  document.body.classList.toggle('browsing', S.tab !== 'all');
  el.clear.hidden = !S.q;

  const dexErr = S.remote.q === term() && S.remote.errors?.length ? S.remote.errors : null;
  el.banner.innerHTML = flags.sample
    ? `<div class="sample"><b>Sample data.</b> This page can't reach CoinGecko or DeFiLlama, so every
        figure below is illustrative — explore the interface, don't trade on it.</div>`
    : S.warn && !S.err
    ? `<div class="warn">${esc(S.warn)} <button data-retry>Retry</button></div>`
    : dexErr
    ? `<div class="warn">DEX search unavailable — ${esc(dexErr.join(' · '))}</div>` : '';

  if (S.loading && !S.assets.length && !S.pools.length) {
    el.meta.textContent = 'Loading live markets…';
    el.res.innerHTML = skeleton(6);
    return;
  }
  if (S.err) {
    el.meta.textContent = '';
    el.res.innerHTML = `<div class="empty"><b>Can't reach the data sources</b>${esc(S.err)}<div class="cta one"><button class="p" data-retry>Try again</button></div></div>`;
    return;
  }

  const list = S.list = withRemote(compute());
  mode = tableKind(list) || '';
  paintStats(); paintCounts(); paintFacets();
  S.sel = Math.max(0, Math.min(S.sel, list.length - 1));
  const where = S.chain ? CH[S.chain].name : `${CHAINS.length} networks`;
  const metaText = !list.length ? '' : S.q
    ? `${matched > shown ? `${shown} of ${count(matched)}` : list.length} result${
        matched === 1 ? '' : 's'} for “${esc(S.q.trim())}”<span class="mnet"> · ${esc(where)}</span>`
    // the keyboard hint is meaningless on a phone, and the line is a whole row there
    : S.tab === 'saved' ? `${list.length} saved`
    : `${matched > shown ? `${shown} of ${count(matched)}` : 'Top of'}<span class="mnet"> ${
        matched > shown ? 'in ' : ''}${esc(where)}</span> · updated ${ago(S.at)}<span class="kbd-hint"> · ↑↓ browse · ↵ open · [ ] category</span>`;
  el.meta.innerHTML = metaText ? `<span class="mtext">${metaText}</span>` : '';
  if (hidden && S.safe && list.length)
    el.meta.innerHTML += `<button class="link" data-unsafe>${hidden} hidden</button>`;
  if (S.q && S.remote.busy) el.meta.innerHTML += ' <span class="pulse">· searching DEXs…</span>';

  if (!list.length && S.remote.busy) {
    el.res.innerHTML = skeleton(3);
    return;
  }
  if (!list.length) {
    const cat = TAB_KIND[S.tab] && KIND[TAB_KIND[S.tab]].group.toLowerCase();
    el.res.innerHTML =
      S.facets.size
        ? `<div class="empty"><b>Nothing matches those filters</b>${esc(
            facetsFor(S.tab).filter(facetOn).map(f => f[1]).join(' + '))} leaves no ${esc(cat || 'results')}${
            S.q ? ` matching “${esc(S.q.trim())}”` : ''}.<div class="cta one"><button class="p" data-facet="">Clear filters</button></div></div>`
      : S.tab === 'saved' && !S.q
        ? `<div class="empty"><b>Nothing saved yet</b>Tap the star on any asset or market to pin it here. Saved items persist in this browser.${
            recent().length ? `<div class="seen"><h3>Recently viewed</h3>${recent().map(miniHTML).join('')}</div>` : ''}</div>`
      : !S.q && S.chain
        ? `<div class="empty"><b>No ${esc(cat || 'results')} on ${esc(CH[S.chain].name)}</b>Nothing is indexed for this network yet. Newer chains often appear here before the aggregators cover them.<div class="cta one"><button class="p" data-allchains>Show all chains</button></div></div>`
      : !S.q
        // an empty category with no filter means the source did not answer
        ? `<div class="empty"><b>No ${esc(cat || 'results')} right now</b>That source did not return anything. It loads behind the first paint, so it may still be on its way.<div class="cta one"><button class="p" data-retry>Reload</button></div></div>`
      : `<div class="empty"><b>Nothing matched “${esc(S.q.trim())}”</b>Try a ticker like SOL, a protocol like Aave, or “usdc lending”.</div>`;
    return;
  }
  paintSort();
  el.res.classList.toggle('table', !!mode);
  el.res.classList.toggle('compact', S.dense);
  const frag = document.createDocumentFragment();
  if (mode) {
    const h = document.createElement('template');
    h.innerHTML = theadHTML(mode).trim();
    frag.appendChild(h.content.firstElementChild);
  }
  let last = null;
  list.forEach((it, i) => {
    if (!mode && (S.tab === 'all' || S.tab === 'saved')) {
      if (it.kind !== last) {
      const h = document.createElement('div');
      h.className = 'gtitle'; h.setAttribute('role', 'presentation');
      h.textContent = KIND[it.kind].group;
      frag.appendChild(h); last = it.kind;
      }
    }
    frag.appendChild(nodeFor(it, i));
  });
  if (matched > shown) {
    const b = document.createElement('button');
    b.className = 'more'; b.dataset.more = '1';
    b.textContent = `Show ${Math.min(PAGE, matched - shown)} more · ${count(matched - shown)} left`;
    frag.appendChild(b);
  }
  el.res.replaceChildren(frag);
  paintSel();
}

/** Fold live DEX results into the local list, next to any pairs already there
    so the group heading is never emitted twice. A category that pins a different
    kind does not take them: searching on Exploits should not return memecoins. */
function withRemote(list) {
  if (!S.remote.q || S.remote.q !== term()) return list;
  const k = TAB_KIND[S.tab];
  if (k && k !== 'pair') return list;
  const have = new Set(list.map(i => i.id));
  const extra = sift(S.remote.rows.filter(r => !have.has(r.id)));
  if (!extra.length) return list;
  const at = list.map(i => i.kind).lastIndexOf('pair');
  return at === -1 ? [...list, ...extra]
    : [...list.slice(0, at + 1), ...extra, ...list.slice(at + 1)];
}

/* Every entity says what it is. The composed line is always available and
   needs no request; where a source publishes its own description, that arrives
   after and takes over. */
const netsOf = i => (i.chains || []).map(c => CH[c]?.name).filter(Boolean);
const listOf = (a, n = 3) => a.slice(0, n).join(', ') + (a.length > n ? ` and ${a.length - n} more` : '');

/* What this row is, in a sentence, from what it already carries. Every kind
   names something concrete — the networks, the investors, the terms — rather
   than restating its own category. */
const ABOUT = {
  asset: i => `${i.name} trades as ${i.sym}${i.rank ? `, the #${i.rank} crypto asset by market cap` : ''}`
    + `, at ${usd(i.price)} with $${compact(i.vol)} traded in the last day`
    + `${i.chg7d ? `, ${pct(i.chg7d)} over the week` : ''}`
    + `${i.athChg ? `. It sits ${Math.abs(i.athChg).toFixed(0)}% below its ${usd(i.ath)} high` : ''}.`,
  stock: i => `${i.name} is ${i.under} issued onchain${i.issuer ? ` by ${i.issuer}` : ''}`
    + `, so the share can be held and traded in a wallet like any token.`
    + ` It last changed hands at ${usd(i.price)}${i.chg7d == null ? '' : `, ${pct(i.chg7d)} over the week`}.`
    + `${i.issuer ? ` Redemption and custody are ${i.issuer}'s, not the exchange's.` : ''}`,
  pool: i => `Supply ${i.sym} to ${i.proto}${CH[i.chain] ? ` on ${CH[i.chain].name}` : ''} and earn ${apy(i.sup)}`
    + `${i.bor == null ? '' : `, or post it as collateral and borrow at ${apy(i.bor)}`
      + `${i.ltv ? `, up to ${(i.ltv * 100).toFixed(0)}% of its value` : ''}`}. `
    + `$${compact(i.supplyUsd)} is supplied here, ${i.util.toFixed(0)}% of it lent out.`,
  yield: i => `A ${i.stable ? 'stablecoin ' : ''}farm on ${i.proto}${CH[i.chain] ? ` on ${CH[i.chain].name}` : ''}`
    + ` paying ${apy(i.apy)} on ${i.sym}${i.apyReward ? `, of which ${apy(i.apyReward)} is incentives` : ''}`
    + `, with $${compact(i.tvl)} deposited${i.risk === 'yes' ? '. Two-sided, so impermanent loss applies' : ''}.`
    // a rate is only worth what it keeps paying, so say what it has been paying
    + `${i.mean30 ? ` It has averaged ${apy(i.mean30)} over the past month and the rate is ${i.outlook || 'unrated'}.` : ''}`,
  protocol: i => `${i.name} is a ${String(i.cat).toLowerCase()} protocol holding $${compact(i.tvl)}`
    + `${netsOf(i).length ? ` across ${listOf(netsOf(i))}` : ''}`
    + `${i.vol24 ? `, and turned over $${compact(i.vol24)} in the last day` : ''}.`,
  nft: i => `${i.name} is a collection on ${i.net}${i.supply ? ` of ${compact(i.supply)} items` : ''}`
    + `, with a floor of ${floorOf(i)}${i.chg1d ? `, ${pct(i.chg1d)} in a day` : ''}. Floor data via ${i.market}.`,
  pair: i => `${i.sym} trades on ${i.dex}${i.net ? ` on ${i.net}` : ''}${i.quote ? ` against ${i.quote}` : ''}`
    + `, with $${compact(i.liq)} of liquidity behind it and $${compact(i.vol24)} of volume in a day.`,
  stablecoin: i => `${i.name} is a ${String(i.mech || 'pegged').toLowerCase()} stablecoin with `
    + `$${compact(i.circulating)} in circulation across ${i.chains.length} network${i.chains.length === 1 ? '' : 's'}`
    + `, currently at ${usd(i.price)} against its peg.`,
  bridge: i => `${i.name} moves value between ${netsOf(i).length ? listOf(netsOf(i)) : 'chains'}`
    + `, carrying $${compact(i.vol24)} in the last day`
    + `${i.volPrev ? ` against $${compact(i.volPrev)} the day before` : ''}.`,
  raise: i => `${i.name} raised $${compact(i.amount)}${i.round ? ` in a ${i.round}` : ''} ${when(i.date)}`
    + `${i.investors.length ? `, led by ${listOf(i.investors, 2)}` : ''}`
    + `${i.valuation ? `, at a $${compact(i.valuation)} valuation` : ''}.`,
  hack: i => `${i.name} lost $${compact(i.amount)} ${when(i.date)} to ${String(i.technique).toLowerCase()}`
    + `${netsOf(i).length ? `, on ${listOf(netsOf(i))}` : ''}.`,
  chain: i => {
    const top = S.protocols.filter(r => r.chains.includes(i.chain));
    return `${i.name} holds $${compact(i.tvl)} across ${top.length} protocol${top.length === 1 ? '' : 's'} indexed here`
      + `${top[0] ? `, the largest being ${top[0].name}` : ''}`
      + `, with ${S.pools.filter(p => p.chain === i.chain).length} lending markets on it.`;
  },
};
const aboutBox = it => `<div class="sec about"><h3>About</h3>
  <div class="note l" data-about>${esc((ABOUT[it.kind] || (() => ''))(it))}</div>
  <div class="note l src" data-src hidden></div></div>`;

/* The composed line says what this row is; where the thing behind it publishes
   its own description, that is added under it rather than replacing it — for a
   lending market the two say different things, and both are worth having. */
async function fillAbout(box, it) {
  const el = box.querySelector('[data-src]'); if (!el) return;
  const text = await loadAbout(it).catch(() => '');
  if (!text || !box.isConnected) return;
  el.textContent = it.kind === 'pool' || it.kind === 'yield' ? `${it.proto}: ${text}` : text;
  el.hidden = false;
}

/* ---------- detail sheet ---------- */
/* A collection's floor is one number about hundreds of things. This is the
   things. */
const itemsBox = it => it.kind !== 'nft' ? '' :
  `<div class="sec items" data-items="${esc(it.id)}"><h3>In this collection</h3>
    <div class="note l" data-iwhy>Loading listings…</div>
    <div class="grid" data-igrid hidden></div></div>`;

async function fillItems(box, it) {
  const host = box.querySelector('[data-items]'); if (!host) return;
  const why = host.querySelector('[data-iwhy]'), grid = host.querySelector('[data-igrid]');
  let key = '';
  try { key = (await loadModule('config', './config.js')).config.venues?.opensea?.apiKey || ''; } catch {}
  const { items, why: reason } = await loadNftItems(it, { openseaKey: key })
    .catch(() => ({ items: [], why: 'listings unavailable' }));
  if (!host.isConnected) return;
  if (!items.length) {
    why.textContent = reason === 'needs an OpenSea key'
      ? 'Individual items for this marketplace need an OpenSea key in config.js. Magic Eden collections list theirs without one.'
      : `No individual items to show — ${reason || 'none returned'}.`;
    return;
  }
  why.hidden = true;
  grid.innerHTML = items.map(x => `<a class="item" href="${esc(x.url)}" target="_blank"
    rel="noopener noreferrer" title="${esc(x.name)}">
    <div class="ph">${x.img ? `<img src="${esc(x.img)}" alt="" loading="lazy"
      referrerpolicy="no-referrer" onload="this.style.opacity=1" onerror="this.remove()">` : ''}</div>
    <div class="in"><div class="t">${esc(x.name)}</div>
      ${x.price ? `<div class="p">${esc(x.price.toFixed(2))} ${esc(x.unit)}</div>` : ''}</div>
    ${x.traits.length ? `<div class="tr">${esc(x.traits[0])}</div>` : ''}</a>`).join('');
  grid.hidden = false;
}

function chartBox(it) {
  const c = KIND[it.kind].chart;
  if (!c) return '';
  const tabs = c[2].map(([d, l]) =>
    `<span class="${d === c[1] ? 'on' : ''}" data-days="${d}" role="button" tabindex="0">${l}</span>`).join('');
  return `<div class="chart"><div class="chart-svg" tabindex="0" role="img"
    aria-label="History. Arrow keys read out each point."><div class="cload"></div></div>
    <div class="rangebar">${tabs}</div></div>`;
}
let depth = 0;                       // sheet entries pushed since the sheet opened
// remote DEX results are transient — they live in S.list, not the prefetched index
const find = id => everything().find(x => x.id === id)
  || S.list.find(x => x.id === id) || S.remote.rows.find(x => x.id === id) || S.watch.get(id);
/* One primary way out, plus the venues that can act on this row. Atlas holds no
   wallet and quotes no price; handing off with the token already resolved is
   the point of having found it here. */
const ctaHTML = (it, label, href) => `<div class="cta">
  <a class="p" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)} \u2197</a>
  ${actions(it).map(([l, u]) => `<a class="s" href="${esc(u)}"
    target="_blank" rel="noopener noreferrer">${esc(l)} \u2197</a>`).join('')}</div>`;

const stat = (k, v, extra = '', cls = '') =>
  `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div>${extra}</div>`;

function sheetHTML(it) {
  const c = CH[it.chain];
  const back = depth > 1 ? `<button class="x" data-back aria-label="Back"><svg viewBox="0 0 24 24" class="i"><path d="M15 5l-7 7 7 7"/></svg></button>` : '';
  const head = (t, sub) => `<div class="grab" aria-hidden="true"></div><div class="sheet-top">
    <div class="ident">${tok(it, it.kind === 'pool')}<div><h2>${esc(t)}</h2><div class="hsub">${esc(sub)}</div></div></div>
    <div class="acts">${star(it)}${back}<button class="x" data-close aria-label="Close"><svg viewBox="0 0 24 24" class="i"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`;

  if (it.kind === 'asset') {
    const markets = S.pools.filter(p => p.sym === it.sym).sort((a, b) => b.supplyUsd - a.supplyUsd).slice(0, 6);
    return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="asset">
      ${head(it.name, [it.sym, c?.name, it.rank ? '#' + it.rank : ''].filter(Boolean).join(' · '))}
      <div class="big">${usd(it.price)}</div>
      <div class="chgline"><span class="${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</span><span class="mute">past 24 hours</span></div>
      ${chartBox(it)}
      <div class="stats">
        ${stat('Market cap', '$' + compact(it.mcap))}
        ${stat('24h volume', '$' + compact(it.vol))}
        ${stat('7d', pct(it.chg7d), '', it.chg7d >= 0 ? 'up' : 'down')}
        ${stat('30d', pct(it.chg30d), '', it.chg30d >= 0 ? 'up' : 'down')}
        ${stat('All-time high', usd(it.ath))}
        ${stat('Off its high', it.athChg ? pct(it.athChg) : '—')}
        ${it.high24 || it.low24 ? stat('24h range', `${usd(it.low24)} – ${usd(it.high24)}`) : stat('Rank', it.rank ? '#' + it.rank : '—')}
        ${it.turn ? stat('Turnover', it.turn.toFixed(1) + '% of cap') : stat('Lending markets', String(markets.length))}
      </div>
      ${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
      <div class="sec"><h3>Lend or borrow ${esc(it.sym)}</h3>
        ${markets.length ? markets.map(miniHTML).join('')
        : `<div class="note l">${S.pools.length ? 'No lending market indexed for this asset.' : 'Lending data unavailable right now.'}</div>`}
      </div>
      ${ctaHTML(it, 'View on CoinGecko', links.asset(it))}
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live prices from CoinGecko.'} Not financial advice.</div>
    </div>`;
  }

  const g = SHEET[it.kind];
  if (g) {
    const s = g(it);
    const nets = (it.chains || []).map(c => S.chainRows.find(x => x.chain === c)).filter(Boolean).slice(0, 6);
    return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="${esc(it.kind)}">
      ${head(s.head || KIND[it.kind].title(it), s.sub)}
      <div class="big ${s.cls || ''}">${esc(s.big)}</div>
      <div class="chgline"><span class="mute">${esc(s.caption)}</span></div>
      ${chartBox(it)}
      <div class="stats">${s.stats.filter(Boolean).map(([k, v]) => stat(k, esc(v))).join('')}</div>
      ${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
      ${s.body ? `<div class="sec"><h3>${esc(s.body[0])}</h3><div class="note l">${esc(s.body[1])}</div></div>` : ''}
      ${s.related?.length ? `<div class="sec"><h3>${esc(s.relatedTitle)}</h3>${s.related.map(miniHTML).join('')}</div>` : ''}
      ${nets.length ? `<div class="sec"><h3>Networks</h3>${nets.map(miniHTML).join('')}</div>` : ''}
      ${ctaHTML(it, s.link[0], s.link[1])}
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live data from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  if (it.kind === 'protocol') {
    const markets = S.pools.filter(p => p.slug === it.slug).sort((x, y) => y.supplyUsd - x.supplyUsd).slice(0, 6);
    const nets = S.chainRows.filter(c => it.chains.includes(c.chain)).slice(0, 6);
    return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="protocol">
      ${head(it.name, [it.cat, it.chains.length + ' chain' + (it.chains.length === 1 ? '' : 's')].join(' · '))}
      <div class="big">$${compact(it.tvl)}</div>
      <div class="chgline"><span class="${it.chg1d >= 0 ? 'up' : 'down'}">${pct(it.chg1d)}</span><span class="mute">total value locked, past 24 hours</span></div>
      ${chartBox(it)}
      <div class="stats">
        ${stat('Category', esc(it.cat))}
        ${stat('7d change', pct(it.chg7d))}
        ${it.vol24 ? stat('24h DEX volume', '$' + compact(it.vol24)) : stat('Networks', String(it.chains.length))}
        ${it.fees24 ? stat('24h fees', '$' + compact(it.fees24)) : stat('TVL', '$' + compact(it.tvl))}
        ${it.rev24 ? stat('24h revenue', '$' + compact(it.rev24)) : ''}
        ${it.perps24 ? stat('24h perps volume', '$' + compact(it.perps24)) : ''}
        ${it.opts24 ? stat('24h options volume', '$' + compact(it.opts24)) : ''}
      </div>
      ${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
      ${markets.length ? `<div class="sec"><h3>Lending markets</h3>${markets.map(miniHTML).join('')}</div>` : ''}
      ${nets.length ? `<div class="sec"><h3>Runs on</h3>${nets.map(miniHTML).join('')}</div>` : ''}
      ${ctaHTML(it, `Open ${it.name}`, links.protocol(it))}
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live TVL, volume and fees from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  if (it.kind === 'chain') {
    const prots = S.protocols.filter(r => r.chains.includes(it.chain)).slice(0, 6);
    const markets = S.pools.filter(p => p.chain === it.chain).sort((x, y) => y.supplyUsd - x.supplyUsd).slice(0, 5);
    return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="chain">
      ${head(it.name, 'Network')}
      <div class="big">$${compact(it.tvl)}</div>
      <div class="chgline"><span class="mute">total value locked</span></div>
      ${chartBox(it)}
      <div class="stats">
        ${stat('Protocols', String(S.protocols.filter(r => r.chains.includes(it.chain)).length))}
        ${stat('Lending markets', String(S.pools.filter(p => p.chain === it.chain).length))}
        <div class="stat wide"><div class="k">Explore</div><div class="v" style="font-size:13.5px;font-weight:500;color:var(--dim)">
          Filter the whole index to ${esc(it.name)} with the chip above the results.</div></div>
      </div>
      ${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
      ${prots.length ? `<div class="sec"><h3>Top protocols</h3>${prots.map(miniHTML).join('')}</div>` : ''}
      ${markets.length ? `<div class="sec"><h3>Largest lending markets</h3>${markets.map(miniHTML).join('')}</div>` : ''}
      ${ctaHTML(it, 'Open on DeFiLlama', links.chain(it))}
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live chain TVL from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  /* Anything without a sheet of its own gets one from its descriptor rather
     than falling through to the lending renderer, which read fields it does
     not have and threw before the sheet could open. */
  if (it.kind !== 'pool') {
    const k = KIND[it.kind];
    return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="${esc(it.kind)}">
      ${head(k.title(it), [k.sub?.(it), k.meta?.(it)].filter(Boolean).join(' · '))}
      <div class="big">${esc(k.n1(it))}</div>
      <div class="chgline"><span class="mute">${esc(k.tail?.(it) || '')}</span></div>
      ${chartBox(it)}${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
      ${ctaHTML(it, 'Open', (links[it.kind] || links.asset)(it))}
    </div>`;
  }

  const a = S.assets.find(x => x.sym === it.sym);
  const others = S.pools.filter(p => p.sym === it.sym && p.id !== it.id).sort((x, y) => y.sup - x.sup).slice(0, 4);
  return `<div class="sheet-in" data-id="${esc(it.id)}" data-kind="pool">
    ${head(it.proto, `${it.sym}${it.meta ? ' · ' + it.meta : ''} · ${c?.name || ''}`)}
    <div class="big up">${apy(it.sup)}</div>
    <div class="chgline"><span class="mute">supply APY${it.supReward ? ` · ${apy(it.supBase)} base + ${apy(it.supReward)} rewards` : ''}</span></div>
    ${chartBox(it)}
    <div class="stats">
      ${stat('Total supplied', '$' + compact(it.supplyUsd))}
      ${stat('Total borrowed', '$' + compact(it.borrowUsd))}
      ${stat('Borrow APY', it.bor == null ? 'not borrowable' : apy(it.bor))}
      ${stat('Available now', '$' + compact(it.free))}
      ${stat('Max LTV', it.ltv ? (it.ltv * 100).toFixed(0) + '%' : '—')}
      ${it.mean30 ? stat('30d average supply', apy(it.mean30)) : ''}
      <div class="stat wide"><div class="k">Utilization</div><div class="v">${it.util.toFixed(0)}%</div>
        <div class="util"><i style="width:${it.util.toFixed(0)}%"></i></div></div>
    </div>
    ${aboutBox(it)}${itemsBox(it)}${tradeBox(it)}
    ${a ? `<div class="sec"><h3>Collateral asset</h3>${miniHTML(a)}</div>` : ''}
    ${it.protocol ? `<div class="sec"><h3>Protocol</h3>${miniHTML(it.protocol)}</div>` : ''}
    ${others.length ? `<div class="sec"><h3>Other ${esc(it.sym)} markets</h3>${others.map(miniHTML).join('')}</div>` : ''}
    ${ctaHTML(it, 'Open on DeFiLlama', links.pool(it))}
    <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live yields from DeFiLlama.'} Not financial advice.</div>
  </div>`;
}

const SHEET = {
  yield: it => ({ big: apy(it.apy), cls: 'up', caption: 'annual percentage yield',
    sub: [it.sym, CH[it.chain]?.name, it.meta].filter(Boolean).join(' · '),
    stats: [['Protocol', it.proto], ['Asset', it.sym], ['TVL', '$' + compact(it.tvl)],
      ['Network', CH[it.chain]?.name || '—'],
      it.mean30 ? ['30d average', apy(it.mean30)] : null,
      it.outlook ? ['Outlook', `${title2(it.outlook)}${it.conf ? ` (${it.conf.toFixed(0)}%)` : ''}`] : null,
      it.apyReward ? ['Base APY', apy(it.apyBase)] : null,
      it.apyReward ? ['Rewards', apy(it.apyReward)] : null,
      it.exposure ? ['Exposure', title2(it.exposure)] : null,
      it.risk ? ['IL risk', title2(it.risk)] : null],
    related: S.pools.filter(p => p.sym === it.sym).slice(0, 3), relatedTitle: `Lend ${it.sym} instead`,
    link: ['Open on DeFiLlama', links.yield(it)] }),

  /* The chart plots circulating supply, and a chart owns the headline it sits
     under — so the headline is the supply too. The peg is a stat, where a
     four-decimal number belongs anyway. */
  stablecoin: it => ({ big: '$' + compact(it.circulating), caption: 'in circulation',
    sub: [it.sym, it.mech, `${usd(it.price)} peg`].filter(Boolean).join(' · '),
    stats: [['Circulating', '$' + compact(it.circulating)], ['Price', usd(it.price)],
      ['Mechanism', it.mech || '—'], ['Networks', String(it.chains.length)]],
    related: S.pools.filter(p => p.sym === it.sym).slice(0, 4), relatedTitle: `Lend or borrow ${it.sym}`,
    link: ['Stablecoins on DeFiLlama', links.stablecoin(it)] }),

  bridge: it => ({ big: '$' + compact(it.vol24), caption: 'volume, past 24 hours',
    sub: `Bridge · ${it.chains.length} networks`,
    stats: [['24h volume', '$' + compact(it.vol24)],
      ['Previous day', it.volPrev ? '$' + compact(it.volPrev) : '—'],
      ['Change', it.volPrev ? pct((it.vol24 - it.volPrev) / it.volPrev * 100) : '—'],
      ['Networks', String(it.chains.length)]],
    link: ['Bridges on DeFiLlama', links.bridge(it)] }),

  raise: it => ({ big: '$' + compact(it.amount), caption: `raised · ${when(it.date)}`,
    sub: [it.round, it.sector].filter(Boolean).join(' · '),
    stats: [['Round', it.round || '—'], ['Raised', '$' + compact(it.amount)],
      ['Sector', it.sector || '—'],
      ['Valuation', it.valuation ? '$' + compact(it.valuation) : '—']],
    body: it.investors.length ? ['Investors', it.investors.join(', ')] : null,
    link: [it.source ? 'Read the announcement' : 'Raises on DeFiLlama', links.raise(it)] }),

  nft: it => ({ big: floorOf(it), cls: it.chg1d >= 0 ? 'up' : 'down',
    caption: it.chg1d ? `${pct(it.chg1d)} floor, past 24 hours` : 'floor price',
    sub: [it.market, it.net, it.supply ? `${compact(it.supply)} items` : ''].filter(Boolean).join(' · '),
    stats: [['Floor', floorOf(it)], ['24h change', it.chg1d ? pct(it.chg1d) : '—'],
      ['7d change', it.chg7d ? pct(it.chg7d) : '—'],
      ['Volume', it.volUsd ? '$' + compact(it.volUsd) : it.volSol ? `${compact(it.volSol)} SOL` : '—'],
      it.supply ? ['Items', compact(it.supply)] : null,
      ['Source', it.market]],
    link: [`Open on ${it.market}`, links.nft(it)] }),

  stock: it => ({ big: usd(it.price), cls: it.chg >= 0 ? 'up' : 'down',
    caption: `${pct(it.chg)} in 24 hours`,
    sub: [it.sym, it.under ? `tracks ${it.under}` : 'tokenized equity'].join(' · '),
    // the equity request carries the same windows and high as any other asset
    stats: [['Price', usd(it.price)], ['24h', pct(it.chg)],
      it.chg7d == null ? null : ['7d', pct(it.chg7d)],
      ['Market cap', '$' + compact(it.mcap)], ['24h volume', '$' + compact(it.vol)],
      it.ath ? ['All-time high', usd(it.ath)] : null,
      it.athChg == null ? null : ['Off its high', pct(it.athChg)],
      it.supply ? ['Tokens issued', compact(it.supply)] : null,
      it.under ? ['Underlying', it.under] : null,
      it.issuer ? ['Issued by', it.issuer] : null],
    link: ['View on CoinGecko', links.stock(it)] }),

  pair: it => ({ big: it.price ? usd(it.price) : '—',
    cls: it.chg >= 0 ? 'up' : 'down',
    caption: it.chg ? `${pct(it.chg)} in 24 hours` : 'traded on a DEX',
    sub: [it.sym, it.quote ? `paired with ${it.quote}` : '', it.dex, it.net].filter(Boolean).join(' · '),
    stats: [['Liquidity', '$' + compact(it.liq)], ['24h volume', '$' + compact(it.vol24)],
      ['FDV', it.fdv ? '$' + compact(it.fdv) : '—'], ['Network', it.net || '—'],
      it.addr ? ['Token address', shortAddr(it.addr)] : null,
      isReal(it) ? ['Listed by', isReal(it)] : null],
    link: ['Open on DexScreener', links.pair(it)] }),

  hack: it => ({ big: '$' + compact(it.amount), cls: 'down', caption: `lost · ${when(it.date)}`,
    sub: it.technique,
    stats: [['Amount lost', '$' + compact(it.amount)], ['Technique', it.technique],
      ['When', it.date ? new Date(it.date).toISOString().slice(0, 10) : '—'],
      ['Networks', it.chains.length ? it.chains.map(c => CH[c]?.name).join(', ') : '—']],
    link: [it.source ? 'Read the post-mortem' : 'Hacks on DeFiLlama', links.hack(it)] }),
};
const title2 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
// 0x… + …0x is not an elision, it is the same six characters twice
const shortAddr = a => String(a).length > 20
  ? a.slice(0, 10) + '\u2026' + a.slice(-6) : String(a);

function miniHTML(it) {
  const c = CH[it.chain];
  const k = KIND[it.kind];
  return `<div class="mini" data-id="${esc(it.id)}" role="button" tabindex="0">${tok(it, k.sq)}
      <div class="body"><div class="t1">${esc(k.title(it))}</div>
        <div class="t2">${esc([k.sub?.(it), k.meta?.(it) || c?.name].filter(Boolean).join(' · '))}</div></div>
      <div class="num"><div class="n1 ${k.n1cls || ''}">${esc(k.n1(it))}</div>
        <div class="n2 ${k.cls ? k.cls(it) : 'mute'}">${esc(k.n2(it))}</div></div></div>`;
}

/* ---------- chart ----------
   One component for every kind. It animates in, follows the pointer, and always
   draws: when a source has no history the series is flat at the current value
   and the chart says so instead of showing an empty box. */
let chartSeq = 0;

const chartValue = (it, v) => (KIND[it.kind].chart?.[3] || usd)(v, it);
const RANGE_LABEL = { 1: 'past 24 hours', 7: 'past 7 days', 30: 'past 30 days',
  90: 'past 3 months', 365: 'past year', 3650: 'all time' };

async function drawChart(days) {
  const box = el.sheet.querySelector('.sheet-in'); if (!box) return;
  const it = find(box.dataset.id); if (!it) return;
  const host = box.querySelector('.chart-svg'); if (!host) return;
  const load = KIND[it.kind].chart?.[0]; if (!load) return;
  const token = host.dataset.token = String(++chartSeq);
  host.innerHTML = '<div class="cload"></div>';
  let res = { pts: [], live: false };
  try { res = await load(it, days); } catch { res = { pts: [], live: false }; }
  if (host.dataset.token !== token) return;               // a newer range won
  paintChart(box, it, res, days);
}

/* Geometry. Two stacked panels sharing one x-axis: price above, volume below.
   Never one plot with two y-scales — that invents a correlation the data does
   not have. All text is an HTML overlay, because preserveAspectRatio="none"
   stretches SVG text horizontally along with everything else. */
// the svg is the plot only; the time axis lives in a gutter beneath it, so
// labels never sit on top of the volume bars
const CW = 300, PH = 92, VH = 22, GAP = 6, CH2 = PH + GAP + VH, CPAD = 6;

/* Resolution follows the range. Month-and-day across a year prints "Aug 29" at
   both ends, a year apart, which reads as no span at all. */
const stamp = (d, days) => days <= 1
  // a bare clock time reads the same at both ends of a 24h span
  ? d.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  : days <= 90 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

function paintChart(box, it, s, days) {
  const host = box.querySelector('.chart-svg');
  const pts = s.pts?.length > 1 ? s.pts : [0, 0];
  const n = pts.length;
  const hi = s.hi?.length === n ? s.hi : null;
  const lo = s.lo?.length === n ? s.lo : null;
  const vol = s.vol?.length === n && s.vol.some(v => v > 0) ? s.vol : null;
  const live = s.live;

  const min = Math.min(...(lo || pts)), max = Math.max(...(hi || pts));
  const span = max - min || Math.abs(max) || 1;
  const first = pts[0], last = pts[n - 1];
  const move = first ? (last - first) / Math.abs(first) * 100 : 0;
  const up = move >= 0;
  const stroke = up ? 'var(--up)' : 'var(--down)';

  const X = i => (i / (n - 1)) * CW;
  const Y = v => CPAD + (1 - (v - min) / span) * (PH - CPAD * 2);
  const line = a => a.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join('');
  const d = line(pts);
  // the high/low envelope: down one edge and back along the other
  const band = hi && lo
    ? line(hi) + lo.map((v, i) => `L${X(n - 1 - i).toFixed(1)} ${Y(lo[n - 1 - i]).toFixed(1)}`).join('') + 'Z'
    : '';
  /* An hourly month is 720 bars in 370 pixels — sub-pixel marks that read as one
     solid block. Sum into buckets wide enough to be bars. The tooltip still
     reads the full-resolution series, so nothing is lost, only drawn coarser. */
  const buckets = (a, m) => {
    if (a.length <= m) return a;
    const out = [], step = a.length / m;
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step); j++) s += a[j];
      out.push(s);
    }
    return out;
  };
  /* The axis says what the high and the low were; it does not say when. Two
     marks on the line do. They are positioned in percentages rather than drawn
     into the svg, which is stretched by preserveAspectRatio="none" and would
     squash a circle into an ellipse. */
  const mark = (i, cls) => n < 4 || i < 0 ? ''
    : `<i class="pin ${cls}" style="left:${(i / (n - 1) * 100).toFixed(2)}%;` +
      `top:${(Y(pts[i]) / CH2 * 100).toFixed(2)}%;background:${stroke}"></i>`;
  const marks = max === min ? ''
    : mark(pts.indexOf(max), 'pk') + mark(pts.indexOf(min), 'tr');

  const vb = vol ? buckets(vol, 64) : null;
  const vmax = vb ? Math.max(...vb) || 1 : 1;
  const bw = vb ? Math.max(1.2, CW / vb.length - 1) : 0;
  const bars = vb ? vb.map((v, i) => {
    const h = (v / vmax) * VH;
    return `<rect x="${(i / vb.length * CW).toFixed(1)}" y="${(CH2 - h).toFixed(1)}"
       width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="0.5"/>`;
  }).join('') : '';

  host.innerHTML = `
    <svg viewBox="0 0 ${CW} ${CH2}" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="cgrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${stroke}" stop-opacity=".26"/>
        <stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
      ${band ? `<path class="band" d="${band}" fill="${stroke}" opacity=".14"/>` : ''}
      <path class="area" d="${d}L${CW} ${PH}L0 ${PH}Z" fill="url(#cgrad)"/>
      <line class="base" x1="0" y1="${Y(first).toFixed(1)}" x2="${CW}" y2="${Y(first).toFixed(1)}"
        vector-effect="non-scaling-stroke"/>
      <path class="line" d="${d}" fill="none" stroke="${stroke}" stroke-width="2"
        stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      ${bars ? `<g class="vol" fill="${stroke}" opacity=".34">${bars}</g>` : ''}
    </svg>
    ${marks}
    <i class="cx"></i><i class="cdot" style="background:${stroke}"></i>
    <div class="tip"><b></b><span></span></div>
    <div class="ax hi"></div><div class="ax lo"></div>
    <div class="ax t0"></div><div class="ax t1"></div>
    ${vol ? `<div class="ax vk">volume · peak ${esc(money(Math.max(...vol)))}</div>` : ''}
    ${live ? '' : '<div class="nohist">No history from any source — showing the current value</div>'}`;

  // scale read off the axis labels, so the tooltip is an enhancement not a gate
  const put = (sel, text) => { host.querySelector(sel).textContent = text; };
  const fmt = v => chartValue(it, v);
  put('.hi', fmt(max)); put('.lo', fmt(min));
  const when = i => new Date(Date.now() - (1 - i / (n - 1)) * days * 864e5);
  put('.t0', stamp(when(0), days)); put('.t1', stamp(when(n - 1), days));

  const head = box.querySelector('.chgline');
  const big = box.querySelector('.big');
  const baseBig = fmt(last);
  const source = !live ? ' · no history' : s.via ? ` · via ${s.via}` : '';
  const summary = `<span class="${up ? 'up' : 'down'}">${pct(move)}</span>
    <span class="mute">${esc(RANGE_LABEL[days] || '')}${esc(source)}</span>`;
  if (big) big.textContent = baseBig;
  if (head) head.innerHTML = summary;

  const cx = host.querySelector('.cx'), dot = host.querySelector('.cdot');
  const tip = host.querySelector('.tip');
  const tipV = tip.querySelector('b'), tipL = tip.querySelector('span');

  let cur = -1;
  const at = i => {
    cur = i;
    const v = pts[i], xp = i / (n - 1) * 100;
    cx.style.cssText = `left:${xp}%;opacity:1`;
    dot.style.cssText = `left:${xp}%;top:${Y(v) / CH2 * 100}%;background:${stroke};opacity:1`;
    tipV.textContent = fmt(v);                        // value leads
    tipL.textContent = stamp(when(i), days) + (vol ? ` · ${money(vol[i])} vol` : '');
    tip.style.cssText = `left:${xp}%;opacity:1`;
    if (big) big.textContent = fmt(v);
    if (head) head.innerHTML = `<span class="${v >= first ? 'up' : 'down'}">${
      pct(first ? (v - first) / Math.abs(first) * 100 : 0)}</span>
      <span class="mute">from the start of this range</span>`;
  };
  const clear = () => {
    cur = -1;
    cx.style.opacity = dot.style.opacity = tip.style.opacity = 0;
    if (big) big.textContent = baseBig;
    if (head) head.innerHTML = summary;
  };
  const nearest = clientX => {
    const r = host.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.round((clientX - r.left) / r.width * (n - 1))));
  };
  host.onpointermove = e => at(nearest(e.clientX));
  host.onpointerleave = clear;
  // the same readout on keyboard as on hover
  host.onfocus = () => at(n - 1);
  host.onblur = clear;
  // Escape is the sheet's, not the chart's — blurring is what clears the readout
  host.onkeydown = e => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    at(Math.max(0, Math.min(n - 1, (cur < 0 ? n - 1 : cur) + step)));
  };
}

function showSheet(html) {
  el.sheet.style.transform = '';
  el.sheet.innerHTML = html;
  el.sheet.classList.add('open'); el.sheet.setAttribute('aria-hidden', 'false');
  el.scrim.classList.add('on'); el.sheet.scrollTop = 0; el.sheet.focus();
}
function open(id, { push = true } = {}) {
  const it = find(id); if (!it) return;
  const hash = '#' + id.replace(':', '/');
  if (push) history.pushState({ id, depth: ++depth }, '', hash);
  else depth = history.state?.depth ?? 0;
  S.seen = [it.id, ...S.seen.filter(x => x !== it.id)].slice(0, 12);
  store.set('atlas:seen', JSON.stringify(S.seen));
  showSheet(sheetHTML(it));
  fillAbout(el.sheet, it);
  fillTrade(el.sheet, it);
  fillItems(el.sheet, it);
  const c = KIND[it.kind].chart;
  if (c) drawChart(c[1]);
}

/* Thirty networks in a horizontal scroller is a bad way to find one on a
   phone. Same chips, laid out as a grid you can see at once. */
function openPicker() {
  history.pushState({ picker: true, depth: ++depth }, '', location.href);
  showSheet(`<div class="grab" aria-hidden="true"></div><div class="sheet-in picker" role="dialog" aria-label="Choose a network">
    <div class="sheet-top"><div class="ident"><div><h2>Network</h2>
      <div class="hsub">Filter everything to one chain</div></div></div>
      <div class="acts"><button class="x" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" class="i"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
    <div class="pickgrid">${$('#chains').innerHTML}</div></div>`);
}
function hide() {
  depth = 0;
  el.sheet.classList.remove('open'); el.sheet.setAttribute('aria-hidden', 'true');
  el.scrim.classList.remove('on'); if (!coarse) el.q.focus();
}
/** Close = rewind past every sheet entry, so browser back never re-opens it. */
function close() {
  if (depth > 0) return history.go(-depth);          // popstate hides it
  history.replaceState(null, '', location.pathname + location.search);
  hide();
}

/* ---------- federated DEX search ----------
   The long tail lives on DexScreener, not in the local index. Ask it as the
   user types, and append whatever it returns under its own heading — local
   results never wait on the network. */
let dexT, dexSeq = 0;
function askDex() {
  clearTimeout(dexT);
  const q = term();
  if (q.length < 2) { S.remote = { q: '', rows: [], busy: false, errors: [] }; return; }
  if (S.remote.q === q) return;
  dexT = setTimeout(async () => {
    const seq = ++dexSeq;
    S.remote = { q, rows: S.remote.q === q ? S.remote.rows : [], busy: true, errors: [] };
    render();
    let res = { rows: [], errors: [] };
    try { res = await searchPairs(q); }
    catch (e) { res = { rows: [], errors: [e.message || 'DEX search failed'] }; }
    if (seq !== dexSeq || term() !== q) return;          // a newer query won
    const known = new Set(S.list.map(i => i.id));
    S.remote = { q, rows: res.rows.filter(r => !known.has(r.id)), busy: false, errors: res.errors };
    render();
  }, 300);
}

/* ---------- url state ---------- */
let urlT;
function syncUrl(now) {
  clearTimeout(urlT);
  const write = () => {
    const p = new URLSearchParams();
    if (S.q.trim()) p.set('q', S.q.trim());
    if (S.chain) p.set('chain', S.chain);
    if (S.tab !== 'all') p.set('tab', S.tab);
    if (S.sort) p.set('sort', (S.sort.dir > 0 ? '' : '-') + S.sort.key);
    if (S.facets.size) p.set('f', [...S.facets].join(','));
    if (S.view === 'cards') p.set('view', 'cards');
    if (S.dense) p.set('dense', '1');
    if (!S.safe) p.set('all', '1');
    history.replaceState(history.state, '', (p.toString() ? '?' + p : location.pathname) + location.hash);
  };
  now ? write() : (urlT = setTimeout(write, 350));
}
function fromUrl() {
  const p = new URLSearchParams(location.search);
  S.q = el.q.value = p.get('q') || '';
  S.chain = CH[p.get('chain')] ? p.get('chain') : null;
  S.tab = TABS.some(([t]) => t === p.get('tab')) ? p.get('tab') : 'all';
  const sort = p.get('sort') || '';
  const key = sort.replace(/^-/, '');
  S.sort = key && SORTABLE.has(key) ? { key, dir: sort[0] === '-' ? -1 : 1 } : null;
  const known = new Set(facetsFor(S.tab).map(f => f[0]));
  S.facets = new Set((p.get('f') || '').split(',').filter(x => known.has(x)));
  if (p.get('view')) S.view = p.get('view') === 'cards' ? 'cards' : 'auto';
  if (p.get('dense')) S.dense = p.get('dense') === '1';
  if (p.get('all')) S.safe = p.get('all') !== '1';
  paintFilters(); paintTools();
}

/* ---------- chrome ---------- */
/* Fourteen destinations in one flat column is a list you read rather than scan.
   They group into four questions people actually arrive with — what is it worth,
   what does it pay, what is running, what happened — and a heading over each
   makes the rail scannable at a glance. */
const tabOf = k => Object.keys(TAB_KIND).find(t => TAB_KIND[t] === k);
const NAV = [
  ['', ['all']],
  ['Markets', ['assets', 'stocks', 'dex', 'nfts']],
  ['Earn', ['lending', 'yield']],
  ['Onchain', ['protocols', 'stables', 'bridges', 'networks']],
  ['Activity', ['raises', 'hacks']],
  ['', ['saved']],
];
const LABEL = { all: 'All', saved: 'Saved',
  ...Object.fromEntries(KINDS.map(k => [tabOf(k), KIND[k].group])) };
// a kind added to the table but not to a group would otherwise vanish from the
// rail without anything failing — give it a home instead of losing it
const placed = new Set(NAV.flatMap(([, t]) => t));
const loose = KINDS.map(tabOf).filter(t => t && !placed.has(t));
if (loose.length) NAV.splice(NAV.length - 1, 0, ['More', loose]);

const TABS = NAV.flatMap(([, tabs]) => tabs.map(t => [t, LABEL[t]]));
$('#tabs').innerHTML = NAV.map(([head, tabs]) =>
  (head ? `<div class="railk nav" role="presentation">${esc(head)}</div>` : '') +
  tabs.map(t => `<button class="tab" role="tab" data-tab="${t}" aria-selected="false">${
    esc(LABEL[t])}<span class="ct"></span></button>`).join('')).join('');
$('#chains').innerHTML = `<button class="chip all" data-chain="" aria-pressed="true"><span class="dot"></span>All chains</button>` +
  CHAINS.map(([id, name, color]) => `<button class="chip" data-chain="${id}" aria-pressed="false" style="--c:${color}"><span class="dot"></span>${esc(name)}</button>`).join('');
$('#netCount').textContent = `${CHAINS.length} networks`;
$('#chainWord').textContent = `${CHAINS.length} networks`;
function paintFilters() {
  document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === S.tab));
  document.querySelectorAll('[data-chain]').forEach(t => t.setAttribute('aria-pressed', (t.dataset.chain || null) === S.chain));
  const btn = $('#chainbtn');
  btn.querySelector('.cn').textContent = S.chain ? CH[S.chain].name : 'All chains';
  btn.style.setProperty('--c', S.chain ? CH[S.chain].color : 'var(--accent)');
  btn.classList.toggle('on', !!S.chain);
}
/** How much sits behind each category, so the rail says what it holds. */
function paintCounts() {
  document.querySelectorAll('[data-tab] .ct').forEach(el => {
    const n = countOf(el.parentElement.dataset.tab);
    el.textContent = n ? count(n) : '';
  });
}
function paintTools() {
  $('#density span').textContent = S.dense ? 'Compact' : 'Comfortable';
  $('#density').setAttribute('aria-pressed', S.dense);
  $('#view span').textContent = S.view === 'cards' ? 'Cards' : 'Table';
  $('#safe').setAttribute('aria-pressed', S.safe);
  $('#stocks').setAttribute('aria-pressed', S.tab === 'stocks');
}

/* ---------- events ---------- */
let readT;
el.q.addEventListener('input', e => {
  S.q = e.target.value; S.sel = 0; S.limit = 40;
  // a reading is stale the moment the sentence changes, and so is everything
  // it set — otherwise deleting the words leaves their filters behind
  if (dropReading()) paintFilters();
  reindex(); render(); askDex(); scrollToResults(); syncUrl();
  clearTimeout(readT);
  readT = setTimeout(async () => {
    const q = S.q;
    const r = await readQuery(q).catch(() => null);
    if (q !== S.q || !r) return;                        // they kept typing
    applyReading(r);
    paintFilters(); reindex(); render(); askDex(); syncUrl(true);
  }, 420);
});
el.clear.addEventListener('click', () => {
  S.q = el.q.value = ''; S.sel = 0; dropReading();
  paintFilters(); reindex(); render(); syncUrl(true); el.q.focus();
});
$('#topSearch').addEventListener('click', () => el.q.focus());
$('#connect').addEventListener('click', openWallet);
$('#refresh').addEventListener('click', () => load({ force: true }));
narrow.addEventListener('change', () => { nodes.clear(); render(); });
function setSafe(on) {
  S.safe = on; store.set('atlas:safe', on ? '1' : '0');
  paintTools(); nodes.clear(); reindex(); render(); syncUrl(true);
}
$('#safe').addEventListener('click', () => setSafe(!S.safe));
/* Stocks-only is a view, and the rail already has it. The switch is a way in
   and back out from anywhere, so it holds no state of its own — it reports
   whether that category is the one on screen. */
let lastTab = 'all';
$('#stocks').addEventListener('click', () => {
  const on = S.tab === 'stocks';
  if (!on) lastTab = S.tab;
  S.tab = on ? (lastTab === 'stocks' ? 'all' : lastTab) : 'stocks';
  S.sel = 0; S.sort = null; S.facets.clear();
  paintFilters(); paintTools(); reindex(); render(); scrollToResults(); syncUrl(true);
});
el.meta.addEventListener('click', e => e.target.closest('[data-unsafe]') && setSafe(false));
$('#density').addEventListener('click', () => {
  S.dense = !S.dense; store.set('atlas:dense', S.dense ? '1' : '0');
  paintTools(); render(); syncUrl(true);
});
$('#view').addEventListener('click', () => {
  S.view = S.view === 'cards' ? 'auto' : 'cards';
  store.set('atlas:view', S.view); paintTools(); nodes.clear(); render(); syncUrl(true);
});
// sort: column headers on desktop, chips on a phone, same cycle either way
const onSort = e => {
  const b = e.target.closest('[data-sort]'); if (!b) return;
  const key = b.dataset.sort;
  S.sort = S.sort?.key === key && S.sort.dir < 0 ? { key, dir: 1 }
    : S.sort?.key === key ? null : { key, dir: -1 };
  S.sel = 0; render(); syncUrl(true);
};
el.res.addEventListener('click', onSort, true);
el.sortbar.addEventListener('click', onSort);

// facets: a chip is a question about the rows, and they narrow together
function onFacet(e) {
  if (e.target.closest('[data-unread]')) return clearReading();
  const j = e.target.closest('[data-jump]');
  if (j) return goTab(tabOf(j.dataset.jump));
  const b = e.target.closest('[data-facet]'); if (!b) return;
  const id = b.dataset.facet;
  if (!id) S.facets.clear();
  else S.facets.has(id) ? S.facets.delete(id) : S.facets.add(id);
  S.sel = 0; S.limit = 40; reindex(); render(); syncUrl(true);
}
el.facetbar.addEventListener('click', onFacet);
el.res.addEventListener('click', onFacet);

/* A bottom sheet you cannot swipe away feels stuck. Drag only from the grabber,
   so it never competes with scrolling the sheet's own content. */
let dragFrom = null;
el.sheet.addEventListener('pointerdown', e => {
  if (!e.target.closest('.grab')) return;
  dragFrom = e.clientY; el.sheet.style.transition = 'none';
  el.sheet.setPointerCapture(e.pointerId);
});
el.sheet.addEventListener('pointermove', e => {
  if (dragFrom === null) return;
  el.sheet.style.transform = `translateY(${Math.max(0, e.clientY - dragFrom)}px)`;
});
const endDrag = e => {
  if (dragFrom === null) return;
  const dy = Math.max(0, e.clientY - dragFrom);
  dragFrom = null; el.sheet.style.transition = ''; el.sheet.style.transform = '';
  if (dy > 110) close();
};
el.sheet.addEventListener('pointerup', endDrag);
el.sheet.addEventListener('pointercancel', endDrag);

function goTab(tab) {
  if (!tab || !TABS.some(([t]) => t === tab)) return;
  if (S.nl) { dropReading(); S.q = el.q.value = ''; }
  if (tab === S.tab) { paintFilters(); reindex(); render(); return; }
  if (S.tab !== 'stocks') lastTab = S.tab;
  S.tab = tab; S.sel = 0; S.sort = null; S.facets.clear(); S.limit = 40;
  paintFilters(); paintTools(); reindex(); render(); scrollToResults(); syncUrl(true);
}
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  goTab(b.dataset.tab);
});
let chainSeq = 0;
async function pickChain(id) {
  const seq = ++chainSeq;
  S.chain = id || null; S.sel = 0; S.limit = 40; paintFilters();
  reindex(); render(); scrollToResults(); syncUrl(true);
  if (!S.chain) { S.chainTokens = []; nodes.clear(); reindex(); render(); return; }
  el.res.classList.add('stale');
  let toks = [];
  try { toks = await loadChainTokens(S.chain); } catch { /* the chain still filters */ }
  if (seq !== chainSeq) return;                 // a newer chain click won the race
  S.chainTokens = toks;
  el.res.classList.remove('stale');
  nodes.clear(); reindex(); render();
}
const onChainClick = e => {
  const b = e.target.closest('[data-chain]'); if (!b) return;
  const id = b.dataset.chain;
  // Closing the picker rewinds history, and history.go is async: applying the
  // chain first meant the back navigation landed afterwards and overwrote the
  // url we had just written, losing ?chain=. Rewind first, then apply.
  if (el.sheet.classList.contains('open') && depth > 0) {
    addEventListener('popstate', () => pickChain(id), { once: true });
    return close();
  }
  pickChain(id);
};
$('#chains').addEventListener('click', onChainClick);
$('#chainbtn').addEventListener('click', openPicker);

function toggleStar(id) {
  const it = find(id); if (!it) return;
  S.watch.has(id) ? S.watch.delete(id) : S.watch.set(id, it);
  saveWatch();
  document.querySelectorAll(`[data-star="${CSS.escape(id)}"]`).forEach(b => {
    b.classList.toggle('on', S.watch.has(id)); b.setAttribute('aria-pressed', S.watch.has(id));
  });
  if (S.tab === 'saved') { reindex(); render(); }
}
el.res.addEventListener('click', e => {
  if (e.target.closest('[data-more]')) {
    S.limit += PAGE;
    const at = scrollY;
    render(); scrollTo({ top: at });        // the page grows, it does not jump
    return;
  }
  if (e.target.closest('[data-retry]')) return load({ force: true });
  if (e.target.closest('[data-allchains]')) return $('#chains .chip.all').click();
  const s = e.target.closest('[data-star]'); if (s) return toggleStar(s.dataset.star);
  const r = e.target.closest('.row:not(.sk)'); if (r) open(r.dataset.id);
});
el.banner.addEventListener('click', e => e.target.closest('[data-retry]') && load({ force: true }));

el.sheet.addEventListener('click', e => {
  if (e.target.closest('[data-wact], [data-wcopy]')) return onWalletAction(e);
  const s = e.target.closest('[data-star]'); if (s) return toggleStar(s.dataset.star);
  if (e.target.closest('[data-close]')) return close();
  if (e.target.closest('[data-chain]')) return onChainClick(e);
  if (e.target.closest('[data-back]')) return history.back();
  const d = e.target.closest('[data-days]');
  if (d) {
    el.sheet.querySelectorAll('[data-days]').forEach(x => x.classList.toggle('on', x === d));
    return drawChart(+d.dataset.days);
  }
  const m = e.target.closest('.mini'); if (m) open(m.dataset.id);
});
el.sheet.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-days],.mini')) {
    e.preventDefault(); e.target.closest('[data-days],.mini').click();
  }
});
el.scrim.addEventListener('click', () => close());

addEventListener('popstate', () => {
  const h = location.hash.slice(1), id = h && h.replace('/', ':');
  if (history.state?.wallet) return showSheet(walletHTML());
  if (id && find(id)) return open(id, { push: false });
  hide();
});

addEventListener('keydown', e => {
  if (e.key === 'Escape') { el.sheet.classList.contains('open') ? close() : (S.q = el.q.value = '', render(), syncUrl(true)); return; }
  if (el.sheet.classList.contains('open')) return;
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== el.q) {
    e.preventDefault(); el.q.focus(); el.q.select(); return;
  }
  // a bracket typed into the search box is a search, not a category change
  if ((e.key === '[' || e.key === ']') && document.activeElement !== el.q) {
    const i = TABS.findIndex(([t]) => t === S.tab);
    e.preventDefault();
    return goTab(TABS[(i + (e.key === ']' ? 1 : -1) + TABS.length) % TABS.length][0]);
  }
  if (!S.list.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    S.sel = (S.sel + (e.key === 'ArrowDown' ? 1 : -1) + S.list.length) % S.list.length;
    paintSel(true);
  } else if (e.key === 'Enter' && S.list[S.sel]) open(S.list[S.sel].id);
});

/* ---------- reading a sentence ----------
   A question names things Atlas already has controls for. Reading it means
   setting those controls — visibly, so the answer is never a hidden ranking and
   is always one click from being undone.

   The parser is local and always runs. An AI endpoint, where one is configured,
   runs after it and may disagree; anything it says that does not map onto a
   control that exists is dropped. */
/* The single-file build has no sibling files to fetch, so the bundler inlines
   what it can and leaves it here. Ask for that first; fall back to a real
   module only when it is a real page with real files next to it. */
const bundled = typeof window !== 'undefined' ? window.__ATLAS_MODULES__ : null;
const loadModule = (name, path) => bundled?.[name]
  ? Promise.resolve(bundled[name]) : import(path);

let NL = null;
const loadNL = () => (NL ||= loadModule('nl', './nl.js'));

/* A short query is a name, not a sentence. "bitcoin" is a thing to find, and
   reading it as "the Bitcoin network, nothing to search for" answers a question
   nobody asked; "usd coin" is a stablecoin, not a request for the Assets tab.

   So a reading only applies when the sentence says something a search box
   cannot: a threshold, a network, or a category word that means exactly one
   thing. A bare "coin" or "token" is what things are called, not a filter. */
const worthReading = r => !!(r && (
  r.where.length                        // a threshold: nothing else can express it
  || (r.tab && r.specific)              // a word that names exactly one category
  || (r.chain && (r.tab || r.text))));  // a network, plus something to filter

async function readQuery(q) {
  const words = q.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return null;
  const { parse, askAI, sanitise } = await loadNL();
  let r = parse(q);
  if (!worthReading(r)) return null;

  let via = 'read locally';
  try {
    const { config } = await loadModule('config', './config.js');
    if (config.ai?.endpoint) {
      const raw = await askAI(q, config.ai);
      const clean = sanitise(raw, {
        tabs: TABS.map(([t]) => t), chainIds: CHAINS.map(([id]) => id),
        fields: ['chg', 'chg7d', 'chg30d', 'chg1y', 'mcap', 'vol', 'liq', 'vol24', 'tvl',
          'apy', 'sup', 'supplyUsd', 'circulating', 'amount', 'volUsd', 'floorUsd', 'fdv'],
      });
      // the model only wins where it actually said something usable
      if (worthReading(clean)) {
        r = { ...clean, used: [...(clean.where || []).map(w => w.join(' ')), clean.tab, clean.chain].filter(Boolean) };
        via = `read by ${config.ai.model || 'the model'}`;
      }
    }
  } catch (e) { via = 'read locally — the AI endpoint did not answer'; }
  return { ...r, via, original: q };
}

/* Every reading starts from the state the box was in before any reading, not
   from the last one. Otherwise the network named in one sentence silently
   survives into the next, and the answer is filtered by a word the user has
   already deleted. */
let before = null;

function applyReading(r) {
  before ||= { tab: S.tab, chain: S.chain, sort: S.sort };
  S.tab = before.tab; S.chain = before.chain; S.sort = before.sort;
  S.nl = r;
  S.where = r?.where || [];
  if (r?.tab && TABS.some(([t]) => t === r.tab)) S.tab = r.tab;
  if (r?.chain && CH[r.chain]) S.chain = r.chain;
  if (r?.sort && SORTABLE.has(r.sort.key)) S.sort = r.sort;
}

/** Drops the reading and puts every control back where it was. */
function dropReading() {
  if (!S.nl && !before) return false;
  if (before) { S.tab = before.tab; S.chain = before.chain; S.sort = before.sort; before = null; }
  S.nl = null; S.where = [];
  return true;
}

function clearReading() {
  const text = S.nl?.text || '';
  if (!dropReading()) return;
  S.q = el.q.value = text;                    // keep the words, drop the reading
  S.limit = 40; S.sel = 0;
  paintFilters(); reindex(); render(); askDex(); syncUrl(true);
}

const OPWORD = { '>=': 'at least', '<=': 'at most', '>': 'over', '<': 'under' };
const FIELDWORD = { chg: '24h', chg7d: '7d', chg30d: '30d', chg1y: '1y', mcap: 'market cap',
  liq: 'liquidity', tvl: 'TVL', vol: 'volume', vol24: '24h volume', apy: 'APY',
  supplyUsd: 'supplied', circulating: 'circulating', amount: 'amount', volUsd: 'volume',
  floorUsd: 'floor', fdv: 'FDV', sup: 'supply APY' };
const isPct = f => /^chg/.test(f) || f === 'apy' || f === 'sup';
const whereWord = ([f, op, v]) =>
  `${FIELDWORD[f] || f} ${OPWORD[op]} ${isPct(f) ? pct(v) : '$' + compact(v)}`;

/* ---------- wallet ----------
   Atlas is a search engine that can hold a wallet, not a wallet that can
   search. Everything below arrives on demand: the module, the 780KB SDK behind
   it and the iframe it needs are all fetched the first time someone asks, and a
   session that only searches never pays for any of it. If the import fails —
   offline, blocked, or a bundled build with no module to fetch — the app is the
   app it was and every sheet still offers its hand-off links. */
let W = null, T = null, wallet = { signedIn: false }, configured = false, standalone = false;
const loadWallet = () => (W ||= import('./wallet.js').then(m => {
  m.onWallet(s => { wallet = s; paintConnect(); if (el.sheet.classList.contains('open')) reopen(); });
  return m;
}));
const loadTrade = () => (T ||= import('./trade.js'));
const reopen = () => { const id = el.sheet.querySelector('[data-id]')?.dataset.id; if (id) open(id, { push: false }); };

const short = a => !a ? '' : a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

function paintConnect() {
  const b = $('#connect'); if (!b) return;
  const addr = wallet.evm || wallet.sol;
  b.querySelector('span').textContent = wallet.signedIn ? (short(addr) || wallet.label) : 'Connect';
  b.classList.toggle('on', !!wallet.signedIn);
}

/** Every failure here is somebody's money, so none of them are swallowed. */
function walletErr(box, e, lead = '') {
  const n = box.querySelector('[data-werr]');
  if (!n) return;
  const m = e?.message || String(e);
  /* A module that would not load and a host that would not answer are different
     failures with the same browser wording, and calling the first one "could not
     reach Privy" sends people to check an app id that is not the problem. */
  n.textContent = /dynamically imported module|importing a module script/i.test(m)
    ? `${lead || 'A part of the app could not load.'} ${m}`
    : /failed to fetch|networkerror|load failed/i.test(m)
    ? `Could not reach Privy — ${m}. Check the app id in config.js and that this domain is allowed in the Privy dashboard.`
    : m;
  n.hidden = false;
}

/* Shipped with no keys, so say that plainly rather than presenting a form that
   cannot work. The rest of the app does not depend on any of this. */
const standaloneHTML = () => `<div class="wsec">
    <h3>Not in this build</h3>
    <p class="note l">This is the single-file build of Atlas — one HTML file, no
      server, nothing to install. The wallet is the one thing that cannot come
      with it: it needs a 900KB SDK and an iframe served from Privy's own origin,
      which a page like this is not allowed to reach.</p>
    <p class="note l">Everything else here is the whole app. Run it from the
      repository and <code>Connect</code> works.</p>
    <div class="wrow"><a class="s" href="https://github.com/44vrfmhbf5-beep/WORLD-WIDE-WEB-3"
      target="_blank" rel="noopener noreferrer">The source ↗</a></div>
  </div>`;

const setupHTML = () => `<div class="wsec">
    <h3>Not configured yet</h3>
    <p class="note l">Atlas ships without credentials. Put a Privy app id in
      <code>config.js</code> and sign-in, wallet generation, MoonPay funding and
      signing all switch on. Everything else — search, charts, and every link
      out of a sheet — already works without one.</p>
    <div class="wrow"><a class="s" href="https://dashboard.privy.io" target="_blank"
      rel="noopener noreferrer">Get an app id ↗</a></div>
  </div>`;

const authHTML = () => `<div class="wsec">
    <h3>Sign in</h3>
    <p class="note l">A wallet is created for you on first sign-in. Keys stay in
      Privy's secure iframe — this page can ask it to sign and cannot read them.</p>
    <div class="wrow"><input id="wemail" type="email" inputmode="email" autocomplete="email"
      placeholder="you@example.com" aria-label="Email address">
      <button class="p" data-wact="code">Email me a code</button></div>
    <div class="wrow" data-step="code" hidden>
      <input id="wcode" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code" aria-label="Login code">
      <button class="p" data-wact="verify">Sign in</button></div>
    <div class="wor">or</div>
    <div class="wrow">
      <button class="s" data-wact="oauth" data-p="google">Google</button>
      <button class="s" data-wact="oauth" data-p="apple">Apple</button>
      <button class="s" data-wact="external">Browser wallet</button></div>
  </div>`;

const accountHTML = () => `<div class="wsec">
    <h3>Wallet</h3>
    ${wallet.evm ? `<div class="waddr"><span class="k">Ethereum</span><code>${esc(wallet.evm)}</code>
      <button class="copy" data-wcopy="${esc(wallet.evm)}" aria-label="Copy address">Copy</button></div>` : ''}
    ${wallet.sol ? `<div class="waddr"><span class="k">Solana</span><code>${esc(wallet.sol)}</code>
      <button class="copy" data-wcopy="${esc(wallet.sol)}" aria-label="Copy address">Copy</button></div>` : ''}
    ${!wallet.evm && !wallet.sol ? `<p class="note l">No wallet on this account yet.</p>
      <div class="wrow"><button class="p" data-wact="create">Generate a wallet</button></div>` : ''}
  </div>
  ${wallet.evm ? `<div class="wsec"><h3>Add funds</h3>
    <p class="note l">MoonPay, opened against this wallet. Privy signs the widget
      URL with the key registered to the app, so the destination is fixed to the
      address above and cannot be changed in the page.</p>
    <div class="wrow"><button class="p" data-wact="fund">Buy with MoonPay</button></div></div>` : ''}
  <div class="wsec"><div class="wrow"><button class="s" data-wact="logout">Sign out</button></div></div>`;

function walletHTML() {
  return `<div class="grab" aria-hidden="true"></div><div class="sheet-in wallet" data-kind="wallet">
    <div class="sheet-top"><div class="ident"><div><h2>${wallet.signedIn ? 'Your wallet' : 'Connect'}</h2>
      <div class="hsub">${wallet.signedIn ? esc(wallet.label)
      : standalone ? 'The single-file build has no wallet'
      : configured ? 'Sign in to hold, fund and trade' : 'Wallet features need one credential'}</div></div></div>
      <div class="acts"><button class="x" data-close aria-label="Close">
        <svg viewBox="0 0 24 24" class="i"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
    <div class="note l err" data-werr hidden></div>
    ${standalone ? standaloneHTML()
      : !configured ? setupHTML() : wallet.signedIn ? accountHTML() : authHTML()}
    <div class="note">Atlas never holds your keys and never takes custody.</div>
  </div>`;
}

async function openWallet() {
  history.pushState({ wallet: true, depth: ++depth }, '', location.href);
  showSheet(walletHTML());
  /* The wallet is the one thing that cannot be inlined: 900KB of SDK, and an
     iframe from a host a bundled page is not allowed to reach anyway. So a
     single-file build has no wallet, and saying "failed to fetch a module" for
     that is both mystifying and wrong. */
  if (bundled) { standalone = true; return showSheet(walletHTML()); }
  try {
    const [{ walletReady }] = await Promise.all([loadModule('config', './config.js'), loadWallet()]);
    configured = walletReady();
    showSheet(walletHTML());
  } catch (e) {
    walletErr(el.sheet, e, 'The wallet could not load.');
  }
}

async function onWalletAction(e) {
  const b = e.target.closest('[data-wact], [data-wcopy]'); if (!b) return;
  const box = el.sheet;
  const copy = b.dataset.wcopy;
  if (copy) {
    navigator.clipboard?.writeText(copy).then(() => { b.textContent = 'Copied'; });
    return;
  }
  const act = b.dataset.wact;
  const busy = t => { b.disabled = true; b.dataset.was = b.textContent; b.textContent = t; };
  const done = () => { b.disabled = false; if (b.dataset.was) b.textContent = b.dataset.was; };
  try {
    const m = await loadWallet();
    if (act === 'code') {
      busy('Sending…');
      await m.sendEmailCode($('#wemail').value.trim());
      box.querySelector('[data-step=code]').hidden = false;
      $('#wcode')?.focus();
    } else if (act === 'verify') {
      busy('Checking…');
      await m.loginWithEmailCode($('#wemail').value.trim(), $('#wcode').value.trim());
      await m.createWallet();
      showSheet(walletHTML());
    } else if (act === 'oauth') { busy('Opening…'); await m.loginWithOAuth(b.dataset.p); }
    else if (act === 'external') { busy('Waiting…'); await m.connectExternal(); showSheet(walletHTML()); }
    else if (act === 'create') { busy('Generating…'); await m.createWallet(); showSheet(walletHTML()); }
    else if (act === 'fund') {
      busy('Opening…');
      const url = await m.fundWithMoonpay({ address: wallet.evm });
      open2(url);
    } else if (act === 'logout') { await m.logout(); showSheet(walletHTML()); }
  } catch (err) { walletErr(box, err); }
  finally { done(); }
}

// a popup that cannot reach back into this page
const open2 = url => { const w = window.open(url, '_blank', 'noopener,noreferrer'); if (!w) location.href = url; };

/* ---------- trade ----------
   A quote is a read, so it is fetched and shown. The send is the venue's, and
   the link carries the wallet into it. */
const TRADE = {
  pair: it => it.chain === 'sol'
    ? [['Swap on Jupiter', t => t.jupiterLink(it.addr)]]
    : [['Trade on Uniswap', t => t.uniswapLink({ chainId: EVM_ID[it.chain], tokenOut: it.addr })]],
  asset: it => [['Trade on Uniswap', t => t.uniswapLink({ tokenOut: it.sym })],
    ['Perps on Hyperliquid', t => t.hyperliquidLink(it.sym)]],
  nft: it => [['Buy on OpenSea', t => t.openseaLink(it.cid, it.net?.toLowerCase() || 'ethereum')]],
};
const EVM_ID = { eth: 1, base: 8453, arb: 42161, op: 10, poly: 137, bnb: 56, avax: 43114 };

function tradeBox(it) {
  if (!TRADE[it.kind]) return '';
  return `<div class="sec trade" data-trade="${esc(it.id)}"><h3>Trade</h3>
    <div class="quote" data-quote hidden></div>
    <div class="cta venues" data-venues></div></div>`;
}

async function fillTrade(box, it) {
  const host = box.querySelector('[data-trade]'); if (!host) return;
  let t; try { t = await loadTrade(); } catch { host.remove(); return; }
  const venues = host.querySelector('[data-venues]');
  venues.innerHTML = (TRADE[it.kind](it) || [])
    .map(([label, url]) => { const u = url(t); return u
      ? `<a class="s" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>` : ''; })
    .join('');
  if (wallet.evm || wallet.sol) {
    const who = document.createElement('div');
    who.className = 'note l';
    who.textContent = `Trades will be signed by ${short(it.chain === 'sol' ? wallet.sol : wallet.evm)}.`;
    host.appendChild(who);
  }
  // a live route, priced now, before anyone commits to anything
  if (it.kind === 'pair' && it.chain === 'sol' && it.addr && !flags.sample) {
    const q = host.querySelector('[data-quote]');
    try {
      const [r, dec] = await Promise.all([
        t.jupiterQuote({ inputMint: t.WSOL, outputMint: it.addr, amount: 1e9 }),
        t.tokenDecimals(it.addr),
      ]);
      // a route with no decimals is a number of unknown magnitude — say nothing
      if (!host.isConnected || dec == null) return;
      const out = r.out / 10 ** dec;
      q.innerHTML = `<div class="qline"><b>1 SOL</b> → <b>${esc(out >= 1 ? compact(out) : tiny(out))}</b> ${esc(it.sym)}</div>
        <div class="qmeta">${esc(r.impact.toFixed(2))}% price impact${
          r.via.length ? ` · via ${esc(listOf(r.via, 2))}` : ''} · live from Jupiter</div>`;
      q.hidden = false;
    } catch { /* a quote is an extra, never a gate */ }
  }
}

/* ---------- go ---------- */
// The shell is static HTML, so a boot failure would otherwise look like a page
// whose search box simply ignores you. Say what happened instead.
addEventListener('error', e => {
  if (S.assets.length || S.pools.length) return;
  el.res.innerHTML = `<div class="empty"><b>The app failed to start</b>${esc(e.message || 'Unknown error')}</div>`;
});

fromUrl();
paintConnect();
// an OAuth redirect lands back here with a one-time code in the query string
if (/privy_oauth_code/.test(location.search))
  loadWallet().then(m => m.resumeOAuth()).catch(() => {});
if (term().length >= 2) askDex();
load().then(() => {
  const id = location.hash.slice(1).replace('/', ':');
  if (id && find(id)) { history.replaceState({ id, depth: 0 }, '', location.href); open(id, { push: false }); }
});
if (!coarse) el.q.focus();
