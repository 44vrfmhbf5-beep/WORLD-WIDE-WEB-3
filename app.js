/* Atlas — search across chains. Live data via data.js; this file is UI only. */
import Fuse from './vendor/fuse.mjs';
import { CHAINS, CH, loadAssets, loadPools, loadProtocols, loadChains, loadStables,
  loadBridges, loadRaises, loadHacks, loadTrendingPairs, searchPairs,
  loadAssetChart, loadPoolChart, loadProtocolChart, links, flags } from './data.js';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const coarse = matchMedia('(hover:none)').matches;   // don't pop a mobile keyboard
// token names and pool metadata are partly user-supplied onchain strings
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const compact = n => !isFinite(n) || !n ? '0' : n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
const usd = n => !isFinite(n) ? '—' : n >= 1e4 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : n >= 1 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '$' + n.toPrecision(3);
const pct = n => (n > 0 ? '+' : '') + (n ?? 0).toFixed(2) + '%';
const apy = n => (n >= 1000 ? compact(n) : (n ?? 0).toFixed(2)) + '%';
const ago = t => { const m = (Date.now() - t) / 6e4; return m < 1 ? 'just now' : m < 60 ? `${m | 0}m ago` : `${m / 60 | 0}h ago`; };
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

/* ---------- state ---------- */
const S = {
  q: '', tab: 'all', chain: null, sel: 0, list: [],
  assets: [], pools: [], fuse: null,
  protocols: [], chainRows: [], yields: [], stables: [], bySym: {}, bridges: [], raises: [], hacks: [],
  pairs: [], remote: { q: '', rows: [], busy: false, errors: [] }, byProto: {},
  loading: true, err: null, warn: null, at: 0,
  watch: new Map(readWatch().map(i => [i.id, i])),
};
const el = {
  q: $('#q'), res: $('#results'), meta: $('#meta'), sheet: $('#sheet'), scrim: $('#scrim'),
  clear: $('#clear'), banner: $('#banner'),
};
const saveWatch = () => store.set('atlas:watch', JSON.stringify([...S.watch.values()]));

/* ---------- data ---------- */
async function load({ force } = {}) {
  if (force) { try { Object.keys(sessionStorage).forEach(k => k.startsWith('atlas:') && sessionStorage.removeItem(k)); } catch {} }
  S.loading = true; S.err = S.warn = null; render();
  const [a, p] = await Promise.allSettled([loadAssets(S.chain), loadPools()]);
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
    loadBridges(), loadRaises(), loadHacks(), loadTrendingPairs()]);
  const val = (i, d) => got[i].status === 'fulfilled' ? got[i].value : d;
  S.protocols = val(0, []);
  S.chainRows = val(1, []);
  const st = val(2, { rows: [], bySym: {} });
  S.stables = st.rows; S.bySym = st.bySym;
  S.bridges = val(3, []); S.raises = val(4, []); S.hacks = val(5, []); S.pairs = val(6, []);
  S.byProto = Object.fromEntries(S.protocols.map(p => [p.slug, p]));
  // a lending market now carries the protocol behind it
  for (const p of S.pools) p.protocol = S.byProto[p.slug] || null;
  nodes.clear(); reindex(); render();
}

const onChain = i => !S.chain || (i.chains ? i.chains.includes(S.chain) : i.chain === S.chain);
const pooled = () => S.pools.filter(onChain);
const everything = () => [...S.assets, ...S.pools, ...S.yields, ...S.protocols,
  ...S.stables, ...S.bridges, ...S.raises, ...S.hacks, ...S.pairs, ...S.chainRows];
function scope() {
  if (S.tab === 'saved') {
    const live = everything();
    return [...S.watch.values()].map(i => live.find(x => x.id === i.id) || i).filter(onChain);
  }
  if (S.tab === 'assets') return S.assets.filter(onChain);
  if (S.tab === 'lending') return pooled();
  if (S.tab === 'yield') return S.yields.filter(onChain);
  if (S.tab === 'protocols') return S.protocols.filter(onChain);
  return everything().filter(onChain);
}
function reindex() {
  S.fuse = new Fuse(scope(), {
    keys: [{ name: 'sym', weight: 3 }, { name: 'name', weight: 3 }, { name: 'proto', weight: 2 }, { name: 'key', weight: 1 }],
    threshold: 0.34, ignoreLocation: true, minMatchCharLength: 2, includeScore: true,
  });
}

const size = i => KIND[i.kind].size(i);

/* With no query the two kinds are ranked separately. Market cap and supplied-USD
   are not the same scale — real assets reach $2T where the largest lending market
   is a few $B — so one combined sort buries every market under the assets. */
function trending() {
  const all = scope();
  if (S.tab !== 'all') return all.sort((x, y) => size(y) - size(x)).slice(0, 40);
  const per = { asset: 12, pool: 10, yield: 10, protocol: 10, stablecoin: 8, bridge: 6, raise: 8, hack: 6, chain: 12 };
  return KINDS.flatMap(k => all.filter(i => i.kind === k)
    .sort((x, y) => size(y) - size(x)).slice(0, per[k] || 6));
}

function compute() {
  const q = S.q.trim();
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
  return groups.flat().map(x => x[0]).slice(0, 60);
}

/* ---------- rows ---------- */
const tok = (it, sq) => {
  const label = KIND[it.kind].label(it);
  const c = CH[it.chain];
  return `<div class="tok${sq ? ' sq' : ''}${label.length > 3 ? ' t4' : ''}" style="--c:${it.color}${c ? ';--c2:' + c.color : ''}">${esc(label)}` +
    (it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onload="this.style.opacity=1" onerror="this.remove()">` : '') +
    (c ? '<span class="badge"></span>' : '') + `</div>`;
};
const star = it => `<button class="star${S.watch.has(it.id) ? ' on' : ''}" data-star="${esc(it.id)}" aria-label="Save to watchlist" aria-pressed="${S.watch.has(it.id)}">
  <svg viewBox="0 0 24 24" class="i"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg></button>`;

const optId = it => 'o-' + it.id.replace(/[^\w:.-]/g, '_');
// volatile fields only: a row is reused across renders unless its numbers moved
const sigOf = it => `${size(it)}|${it.chg ?? it.chg1d ?? it.apy ?? it.sup ?? 0}|${!!it.protocol}`;

/* One descriptor per kind drives the rows, the group headings and the search
   scope. Adding a kind is a table entry, not another branch through render. */
const KIND = {
  asset: { group: 'Assets', size: i => i.mcap, spark: true,
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: i => i.rank ? '#' + i.rank : '',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.mcap)} cap`,
    n1: i => usd(i.price), n2: i => pct(i.chg), cls: i => i.chg >= 0 ? 'up' : 'down' },

  pool: { group: 'Lending markets', size: i => i.supplyUsd, sq: true,
    label: i => (i.proto || '?').slice(0, 2).toUpperCase(),
    title: i => i.proto, sub: i => i.sym, tag: () => 'Lending',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.supplyUsd)} supplied`,
    n1: i => apy(i.sup), n1cls: 'up', n2: i => `${apy(i.bor)} borrow`, cls: () => 'mute' },

  yield: { group: 'Yield', size: i => i.tvl, sq: true,
    label: i => (i.proto || '?').slice(0, 2).toUpperCase(),
    title: i => i.proto, sub: i => i.sym, tag: i => i.stable ? 'Stable yield' : 'Yield',
    meta: i => CH[i.chain]?.name || '', tail: i => `$${compact(i.tvl)} TVL`,
    n1: i => apy(i.apy), n1cls: 'up',
    n2: i => i.apyReward ? `${apy(i.apyBase)} + rewards` : 'APY', cls: () => 'mute' },

  protocol: { group: 'Protocols', size: i => i.tvl, sq: true,
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: i => i.cat,
    meta: i => `${i.chains.length} chain${i.chains.length === 1 ? '' : 's'}`,
    tail: i => i.vol24 ? `$${compact(i.vol24)} 24h volume` : `$${compact(i.tvl)} TVL`,
    n1: i => '$' + compact(i.tvl), n2: i => pct(i.chg1d), cls: i => i.chg1d >= 0 ? 'up' : 'down' },

  stablecoin: { group: 'Stablecoins', size: i => i.circulating,
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: () => 'Stablecoin',
    meta: i => i.mech || 'Pegged', tail: i => `$${compact(i.circulating)} circulating`,
    n1: i => usd(i.price), n2: i => 'peg', cls: () => 'mute' },

  bridge: { group: 'Bridges', size: i => i.vol24, sq: true,
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: () => 'Bridge',
    meta: i => `${i.chains.length} chain${i.chains.length === 1 ? '' : 's'}`,
    tail: i => `$${compact(i.vol24)} 24h volume`,
    n1: i => '$' + compact(i.vol24),
    n2: i => i.volPrev ? pct((i.vol24 - i.volPrev) / i.volPrev * 100) : '24h',
    cls: i => i.volPrev && i.vol24 >= i.volPrev ? 'up' : i.volPrev ? 'down' : 'mute' },

  raise: { group: 'Funding rounds', size: i => i.amount, sq: true,
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: i => i.round || 'Raise',
    meta: i => i.sector || 'Funding',
    tail: i => i.investors.length ? `${i.investors.length} investors` : when(i.date),
    n1: i => '$' + compact(i.amount), n2: i => when(i.date), cls: () => 'mute' },

  hack: { group: 'Exploits', size: i => i.amount, sq: true,
    label: () => '!!', title: i => i.name, tag: () => 'Exploit',
    meta: i => i.technique, tail: i => when(i.date),
    n1: i => '$' + compact(i.amount), n1cls: 'down', n2: () => 'lost', cls: () => 'mute' },

  pair: { group: 'DEX pairs', size: i => i.liq,
    label: i => i.sym.length <= 4 ? i.sym : i.sym.slice(0, 3),
    title: i => i.name, sub: i => i.sym, tag: i => i.dex,
    meta: i => i.net || CH[i.chain]?.name || '',
    tail: i => i.liq ? `$${compact(i.liq)} liquidity` : `$${compact(i.vol24)} 24h volume`,
    n1: i => i.price ? usd(i.price) : '—',
    n2: i => i.chg ? pct(i.chg) : `$${compact(i.vol24)} 24h`,
    cls: i => i.chg ? (i.chg >= 0 ? 'up' : 'down') : 'mute' },

  chain: { group: 'Networks', size: i => i.tvl, sq: true,
    label: i => (i.name || '?').slice(0, 2).toUpperCase(),
    title: i => i.name, tag: () => 'Network',
    meta: i => `${S.protocols.filter(r => r.chains.includes(i.chain)).length} protocols`,
    tail: i => `${S.pools.filter(p => p.chain === i.chain).length} lending markets`,
    n1: i => '$' + compact(i.tvl), n2: () => 'TVL', cls: () => 'mute' },
};
const KINDS = Object.keys(KIND);

function rowHTML(it) {
  const k = KIND[it.kind];
  const sub = k.sub?.(it), tag = k.tag?.(it), meta = k.meta?.(it), tail = k.tail?.(it);
  return `<div class="row" role="option" aria-selected="false" id="${optId(it)}" data-id="${esc(it.id)}">
    ${tok(it, k.sq)}
    <div class="body">
      <div class="t1">${esc(k.title(it))}${sub ? ` <span class="sym">${esc(sub)}</span>` : ''}</div>
      <div class="t2">${tag ? `<span class="tag">${esc(tag)}</span> ` : ''}${esc(meta || '')}
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

/** Bring the results back into view when the query or a filter changes. */
function scrollToResults() {
  const y = el.res.getBoundingClientRect().top + scrollY - 150;
  if (scrollY > y) scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

const skeleton = n => Array.from({ length: n }, (_, i) => `<div class="row sk" style="animation-delay:${i * 60}ms"><div class="tok"></div><div class="body"><div class="ln w40"></div><div class="ln w25"></div></div><div class="ln w15"></div></div>`).join('');

function render() {
  document.body.classList.toggle('searching', !!S.q);
  el.clear.hidden = !S.q;

  const dexErr = S.remote.q === S.q.trim() && S.remote.errors?.length ? S.remote.errors : null;
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
  S.sel = Math.max(0, Math.min(S.sel, list.length - 1));
  const where = S.chain ? CH[S.chain].name : `${CHAINS.length} networks`;
  el.meta.innerHTML = !list.length ? '' : S.q
    ? `${list.length} result${list.length > 1 ? 's' : ''} for “${esc(S.q.trim())}” · ${esc(where)}`
    : S.tab === 'saved' ? `${list.length} saved` : `Top of ${esc(where)} · updated ${ago(S.at)} · ↑↓ to browse, ↵ to open`;
  if (S.q && S.remote.busy) el.meta.innerHTML += ' <span class="pulse">· searching DEXs…</span>';

  if (!list.length && S.remote.busy) {
    el.res.innerHTML = skeleton(3);
    return;
  }
  if (!list.length) {
    el.res.innerHTML =
      S.tab === 'saved' && !S.q
        ? `<div class="empty"><b>Nothing saved yet</b>Tap the star on any asset or market to pin it here. Saved items persist in this browser.</div>`
      : !S.q && S.chain && !S.assets.length
        ? `<div class="empty"><b>No assets indexed for ${esc(CH[S.chain].name)}</b>CoinGecko returned nothing for the “${esc(CH[S.chain].cg)}” category. Slugs get renamed occasionally — the mapping is the CHAINS table in data.js.</div>`
      : `<div class="empty"><b>Nothing matched “${esc(S.q.trim())}”</b>Try a ticker like SOL, a protocol like Aave, or “usdc lending”.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  let last = null;
  list.forEach((it, i) => {
    if (S.tab === 'all' || S.tab === 'saved') {
      if (it.kind !== last) {
      const h = document.createElement('div');
      h.className = 'gtitle'; h.setAttribute('role', 'presentation');
      h.textContent = KIND[it.kind].group;
      frag.appendChild(h); last = it.kind;
      }
    }
    frag.appendChild(nodeFor(it, i));
  });
  el.res.replaceChildren(frag);
  paintSel();
}

/** Fold live DEX results into the local list, next to any pairs already there
    so the group heading is never emitted twice. */
function withRemote(list) {
  if (!S.remote.q || S.remote.q !== S.q.trim()) return list;
  const have = new Set(list.map(i => i.id));
  const extra = S.remote.rows.filter(r => !have.has(r.id));
  if (!extra.length) return list;
  const at = list.map(i => i.kind).lastIndexOf('pair');
  return at === -1 ? [...list, ...extra]
    : [...list.slice(0, at + 1), ...extra, ...list.slice(at + 1)];
}

/* ---------- detail sheet ---------- */
let depth = 0;                       // sheet entries pushed since the sheet opened
// remote DEX results are transient — they live in S.list, not the prefetched index
const find = id => everything().find(x => x.id === id)
  || S.list.find(x => x.id === id) || S.remote.rows.find(x => x.id === id) || S.watch.get(id);
const stat = (k, v, extra = '') => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${extra}</div>`;

function sheetHTML(it) {
  const c = CH[it.chain];
  const back = depth > 1 ? `<button class="x" data-back aria-label="Back"><svg viewBox="0 0 24 24" class="i"><path d="M15 5l-7 7 7 7"/></svg></button>` : '';
  const head = (t, sub) => `<div class="sheet-top">
    <div class="ident">${tok(it, it.kind === 'pool')}<div><h2>${esc(t)}</h2><div class="hsub">${esc(sub)}</div></div></div>
    <div class="acts">${star(it)}${back}<button class="x" data-close aria-label="Close"><svg viewBox="0 0 24 24" class="i"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>`;
  const ranges = (days, opts) => `<div class="rangebar">${opts.map(([d, l]) =>
    `<span class="${d === days ? 'on' : ''}" data-days="${d}" role="button" tabindex="0">${l}</span>`).join('')}</div>`;
  const chartBox = (days, opts) => `<div class="chart"><div class="chart-svg"><div class="cload"></div></div>${ranges(days, opts)}</div>`;

  if (it.kind === 'asset') {
    const markets = S.pools.filter(p => p.sym === it.sym).sort((a, b) => b.supplyUsd - a.supplyUsd).slice(0, 6);
    return `<div class="sheet-in" data-kind="asset" data-cg="${esc(it.cg)}" data-up="${it.chg >= 0}">
      ${head(it.name, [it.sym, c?.name, it.rank ? '#' + it.rank : ''].filter(Boolean).join(' · '))}
      <div class="big">${usd(it.price)}</div>
      <div class="chgline"><span class="${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</span><span class="mute">past 24 hours</span></div>
      ${chartBox(1, [[1, '1D'], [7, '1W'], [30, '1M'], [365, '1Y']])}
      <div class="stats">
        ${stat('Market cap', '$' + compact(it.mcap))}
        ${stat('24h volume', '$' + compact(it.vol))}
        ${c ? stat('Network', esc(c.name)) : stat('Lending markets', String(markets.length))}
        ${stat('Rank', it.rank ? '#' + it.rank : '—')}
      </div>
      <div class="sec"><h3>Lend or borrow ${esc(it.sym)}</h3>
        ${markets.length ? markets.map(miniHTML).join('')
        : `<div class="note l">${S.pools.length ? 'No lending market indexed for this asset.' : 'Lending data unavailable right now.'}</div>`}
      </div>
      <div class="cta"><a class="p" href="${esc(links.asset(it))}" target="_blank" rel="noopener noreferrer">View on CoinGecko ↗</a></div>
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live prices from CoinGecko.'} Not financial advice.</div>
    </div>`;
  }

  const g = SHEET[it.kind];
  if (g) {
    const s = g(it);
    const nets = (it.chains || []).map(c => S.chainRows.find(x => x.chain === c)).filter(Boolean).slice(0, 6);
    return `<div class="sheet-in" data-kind="${esc(it.kind)}">
      ${head(s.head || KIND[it.kind].title(it), s.sub)}
      <div class="big ${s.cls || ''}">${esc(s.big)}</div>
      <div class="chgline"><span class="mute">${esc(s.caption)}</span></div>
      <div class="stats">${s.stats.filter(Boolean).map(([k, v]) => stat(k, esc(v))).join('')}</div>
      ${s.body ? `<div class="sec"><h3>${esc(s.body[0])}</h3><div class="note l">${esc(s.body[1])}</div></div>` : ''}
      ${s.related?.length ? `<div class="sec"><h3>${esc(s.relatedTitle)}</h3>${s.related.map(miniHTML).join('')}</div>` : ''}
      ${nets.length ? `<div class="sec"><h3>Networks</h3>${nets.map(miniHTML).join('')}</div>` : ''}
      <div class="cta"><a class="p" href="${esc(s.link[1])}" target="_blank" rel="noopener noreferrer">${esc(s.link[0])} ↗</a></div>
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live data from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  if (it.kind === 'protocol') {
    const markets = S.pools.filter(p => p.slug === it.slug).sort((x, y) => y.supplyUsd - x.supplyUsd).slice(0, 6);
    const nets = S.chainRows.filter(c => it.chains.includes(c.chain)).slice(0, 6);
    return `<div class="sheet-in" data-kind="protocol" data-slug="${esc(it.slug)}" data-up="${it.chg1d >= 0}">
      ${head(it.name, [it.cat, it.chains.length + ' chain' + (it.chains.length === 1 ? '' : 's')].join(' · '))}
      <div class="big">$${compact(it.tvl)}</div>
      <div class="chgline"><span class="${it.chg1d >= 0 ? 'up' : 'down'}">${pct(it.chg1d)}</span><span class="mute">total value locked, past 24 hours</span></div>
      ${chartBox(90, [[30, '1M'], [90, '3M'], [365, '1Y'], [3650, 'All']])}
      <div class="stats">
        ${stat('Category', esc(it.cat))}
        ${stat('7d change', pct(it.chg7d))}
        ${it.vol24 ? stat('24h DEX volume', '$' + compact(it.vol24)) : stat('Networks', String(it.chains.length))}
        ${it.fees24 ? stat('24h fees', '$' + compact(it.fees24)) : stat('TVL', '$' + compact(it.tvl))}
        ${it.rev24 ? `<div class="stat wide"><div class="k">24h revenue</div><div class="v">$${compact(it.rev24)}</div></div>` : ''}
      </div>
      ${markets.length ? `<div class="sec"><h3>Lending markets</h3>${markets.map(miniHTML).join('')}</div>` : ''}
      ${nets.length ? `<div class="sec"><h3>Runs on</h3>${nets.map(miniHTML).join('')}</div>` : ''}
      <div class="cta"><a class="p" href="${esc(links.protocol(it))}" target="_blank" rel="noopener noreferrer">Open ${esc(it.name)} ↗</a></div>
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live TVL, volume and fees from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  if (it.kind === 'chain') {
    const prots = S.protocols.filter(r => r.chains.includes(it.chain)).slice(0, 6);
    const markets = S.pools.filter(p => p.chain === it.chain).sort((x, y) => y.supplyUsd - x.supplyUsd).slice(0, 5);
    return `<div class="sheet-in" data-kind="chain">
      ${head(it.name, 'Network')}
      <div class="big">$${compact(it.tvl)}</div>
      <div class="chgline"><span class="mute">total value locked across ${prots.length ? S.protocols.filter(r => r.chains.includes(it.chain)).length : 0} indexed protocols</span></div>
      <div class="stats">
        ${stat('Protocols', String(S.protocols.filter(r => r.chains.includes(it.chain)).length))}
        ${stat('Lending markets', String(S.pools.filter(p => p.chain === it.chain).length))}
        <div class="stat wide"><div class="k">Explore</div><div class="v" style="font-size:13.5px;font-weight:500;color:var(--dim)">
          Filter the whole index to ${esc(it.name)} with the chip above the results.</div></div>
      </div>
      ${prots.length ? `<div class="sec"><h3>Top protocols</h3>${prots.map(miniHTML).join('')}</div>` : ''}
      ${markets.length ? `<div class="sec"><h3>Largest lending markets</h3>${markets.map(miniHTML).join('')}</div>` : ''}
      <div class="cta"><a class="p" href="${esc(links.chain(it))}" target="_blank" rel="noopener noreferrer">Open on DeFiLlama ↗</a></div>
      <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live chain TVL from DeFiLlama.'} Not financial advice.</div>
    </div>`;
  }

  const a = S.assets.find(x => x.sym === it.sym);
  const others = S.pools.filter(p => p.sym === it.sym && p.id !== it.id).sort((x, y) => y.sup - x.sup).slice(0, 4);
  return `<div class="sheet-in" data-kind="pool" data-pool="${esc(it.pool)}" data-up="true">
    ${head(it.proto, `${it.sym}${it.meta ? ' · ' + it.meta : ''} · ${c?.name || ''}`)}
    <div class="big up">${apy(it.sup)}</div>
    <div class="chgline"><span class="mute">supply APY${it.supReward ? ` · ${apy(it.supBase)} base + ${apy(it.supReward)} rewards` : ''}</span></div>
    ${chartBox(30, [[7, '1W'], [30, '1M'], [90, '3M'], [365, 'All']])}
    <div class="stats">
      ${stat('Total supplied', '$' + compact(it.supplyUsd))}
      ${stat('Total borrowed', '$' + compact(it.borrowUsd))}
      ${stat('Borrow APY', apy(it.bor))}
      ${stat('Max LTV', it.ltv ? (it.ltv * 100).toFixed(0) + '%' : '—')}
      <div class="stat wide"><div class="k">Utilization</div><div class="v">${it.util.toFixed(0)}%</div>
        <div class="util"><i style="width:${it.util.toFixed(0)}%"></i></div></div>
    </div>
    ${a ? `<div class="sec"><h3>Collateral asset</h3>${miniHTML(a)}</div>` : ''}
    ${it.protocol ? `<div class="sec"><h3>Protocol</h3>${miniHTML(it.protocol)}</div>` : ''}
    ${others.length ? `<div class="sec"><h3>Other ${esc(it.sym)} markets</h3>${others.map(miniHTML).join('')}</div>` : ''}
    <div class="cta"><a class="p" href="${esc(links.pool(it))}" target="_blank" rel="noopener noreferrer">Open on DeFiLlama ↗</a></div>
    <div class="note">${flags.sample ? 'Sample data — illustrative only.' : 'Live yields from DeFiLlama.'} Not financial advice.</div>
  </div>`;
}

const SHEET = {
  yield: it => ({ big: apy(it.apy), cls: 'up', caption: 'annual percentage yield',
    sub: [it.sym, CH[it.chain]?.name, it.meta].filter(Boolean).join(' · '),
    stats: [['Protocol', it.proto], ['Asset', it.sym], ['TVL', '$' + compact(it.tvl)],
      ['Network', CH[it.chain]?.name || '—'],
      it.apyReward ? ['Base APY', apy(it.apyBase)] : null,
      it.apyReward ? ['Rewards', apy(it.apyReward)] : null,
      it.risk ? ['IL risk', title2(it.risk)] : null],
    related: S.pools.filter(p => p.sym === it.sym).slice(0, 3), relatedTitle: `Lend ${it.sym} instead`,
    link: ['Open on DeFiLlama', links.yield(it)] }),

  stablecoin: it => ({ big: usd(it.price), caption: `peg — ${it.circulating ? '$' + compact(it.circulating) + ' circulating' : ''}`,
    sub: [it.sym, it.mech, `${it.chains.length} chains`].filter(Boolean).join(' · '),
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
      ['Valuation', it.valuation ? '$' + compact(it.valuation * 1e6) : '—']],
    body: it.investors.length ? ['Investors', it.investors.join(', ')] : null,
    link: [it.source ? 'Read the announcement' : 'Raises on DeFiLlama', links.raise(it)] }),

  pair: it => ({ big: it.price ? usd(it.price) : '—',
    cls: it.chg >= 0 ? 'up' : 'down',
    caption: it.chg ? `${pct(it.chg)} in 24 hours` : 'traded on a DEX',
    sub: [it.sym, it.quote ? `paired with ${it.quote}` : '', it.dex, it.net].filter(Boolean).join(' · '),
    stats: [['Liquidity', '$' + compact(it.liq)], ['24h volume', '$' + compact(it.vol24)],
      ['FDV', it.fdv ? '$' + compact(it.fdv) : '—'], ['Network', it.net || '—'],
      it.addr ? ['Token address', it.addr.slice(0, 10) + '…' + it.addr.slice(-6)] : null],
    link: ['Open on DexScreener', links.pair(it)] }),

  hack: it => ({ big: '$' + compact(it.amount), cls: 'down', caption: `lost · ${when(it.date)}`,
    sub: it.technique,
    stats: [['Amount lost', '$' + compact(it.amount)], ['Technique', it.technique],
      ['When', new Date(it.date).toISOString().slice(0, 10)],
      ['Networks', it.chains.length ? it.chains.map(c => CH[c]?.name).join(', ') : '—']],
    link: [it.source ? 'Read the post-mortem' : 'Hacks on DeFiLlama', links.hack(it)] }),
};
const title2 = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);

function miniHTML(it) {
  const c = CH[it.chain];
  const k = KIND[it.kind];
  return `<div class="mini" data-id="${esc(it.id)}" role="button" tabindex="0">${tok(it, k.sq)}
      <div class="body"><div class="t1">${esc(k.title(it))}</div>
        <div class="t2">${esc([k.sub?.(it), k.meta?.(it) || c?.name].filter(Boolean).join(' · '))}</div></div>
      <div class="num"><div class="n1 ${k.n1cls || ''}">${esc(k.n1(it))}</div>
        <div class="n2 ${k.cls ? k.cls(it) : 'mute'}">${esc(k.n2(it))}</div></div></div>`;
}

async function drawChart(days) {
  const box = el.sheet.querySelector('.sheet-in'); if (!box) return;
  const host = box.querySelector('.chart-svg');
  const token = host.dataset.token = String(Date.now());
  host.innerHTML = '<div class="cload"></div>';
  let pts = [];
  try {
    pts = box.dataset.kind === 'asset' ? await loadAssetChart(box.dataset.cg, days)
      : box.dataset.kind === 'protocol' ? await loadProtocolChart(box.dataset.slug, days)
      : await loadPoolChart(box.dataset.pool, days);
  } catch { /* fall through to the empty state */ }
  if (host.dataset.token !== token) return;              // a newer range won
  if (pts.length < 2) { host.innerHTML = '<div class="cload err">No history available</div>'; return; }
  const stroke = box.dataset.up === 'true' ? 'var(--up)' : 'var(--down)';
  const d = path(pts, 300, 96, 6);
  host.innerHTML = `<svg viewBox="0 0 300 108" preserveAspectRatio="none">
    <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${stroke}" stop-opacity=".28"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L300 108L0 108Z" fill="url(#cg)"/>
    <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

function open(id, { push = true } = {}) {
  const it = find(id); if (!it) return;
  const hash = '#' + id.replace(':', '/');
  if (push) history.pushState({ id, depth: ++depth }, '', hash);
  else depth = history.state?.depth ?? 0;
  el.sheet.innerHTML = sheetHTML(it);
  el.sheet.classList.add('open'); el.sheet.setAttribute('aria-hidden', 'false');
  el.scrim.classList.add('on'); el.sheet.scrollTop = 0; el.sheet.focus();
  if (it.kind === 'asset') drawChart(1);
  else if (it.kind === 'protocol') drawChart(90);
  else if (it.kind === 'pool') drawChart(30);
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
  const q = S.q.trim();
  if (q.length < 2) { S.remote = { q: '', rows: [], busy: false, errors: [] }; return; }
  if (S.remote.q === q) return;
  dexT = setTimeout(async () => {
    const seq = ++dexSeq;
    S.remote = { q, rows: S.remote.q === q ? S.remote.rows : [], busy: true, errors: [] };
    render();
    let res = { rows: [], errors: [] };
    try { res = await searchPairs(q); }
    catch (e) { res = { rows: [], errors: [e.message || 'DEX search failed'] }; }
    if (seq !== dexSeq || S.q.trim() !== q) return;      // a newer query won
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
    history.replaceState(history.state, '', (p.toString() ? '?' + p : location.pathname) + location.hash);
  };
  now ? write() : (urlT = setTimeout(write, 350));
}
function fromUrl() {
  const p = new URLSearchParams(location.search);
  S.q = el.q.value = p.get('q') || '';
  S.chain = CH[p.get('chain')] ? p.get('chain') : null;
  S.tab = ['assets', 'lending', 'yield', 'protocols', 'saved'].includes(p.get('tab')) ? p.get('tab') : 'all';
  paintFilters();
}

/* ---------- chrome ---------- */
const TABS = [['all', 'All'], ['assets', 'Assets'], ['lending', 'Lending'], ['yield', 'Yield'], ['protocols', 'Protocols'], ['saved', 'Saved']];
$('#tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="false">${l}</button>`).join('');
$('#chains').innerHTML = `<button class="chip all" data-chain="" aria-pressed="true"><span class="dot"></span>All chains</button>` +
  CHAINS.map(([id, name, color]) => `<button class="chip" data-chain="${id}" aria-pressed="false" style="--c:${color}"><span class="dot"></span>${name}</button>`).join('');
$('#netCount').textContent = `${CHAINS.length} networks`;
$('#chainWord').textContent = `${CHAINS.length} networks`;
function paintFilters() {
  document.querySelectorAll('[data-tab]').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === S.tab));
  document.querySelectorAll('[data-chain]').forEach(t => t.setAttribute('aria-pressed', (t.dataset.chain || null) === S.chain));
}

/* ---------- events ---------- */
el.q.addEventListener('input', e => { S.q = e.target.value; S.sel = 0; render(); askDex(); scrollToResults(); syncUrl(); });
el.clear.addEventListener('click', () => { S.q = el.q.value = ''; S.sel = 0; render(); syncUrl(true); el.q.focus(); });
$('#topSearch').addEventListener('click', () => el.q.focus());
$('#refresh').addEventListener('click', () => load({ force: true }));

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; S.sel = 0; paintFilters(); reindex(); render(); scrollToResults(); syncUrl(true);
});
let chainSeq = 0;
$('#chains').addEventListener('click', async e => {
  const b = e.target.closest('[data-chain]'); if (!b) return;
  const seq = ++chainSeq;
  S.chain = b.dataset.chain || null; S.sel = 0; paintFilters();
  S.loading = true; el.res.classList.add('stale'); render();
  let assets = null, err = null;
  try { assets = await loadAssets(S.chain); } catch (e2) { err = e2; }
  if (seq !== chainSeq) return;                 // a newer chain click won the race
  S.assets = assets || [];
  S.warn = err ? 'Asset prices unavailable — ' + err.message : null;
  S.loading = false; el.res.classList.remove('stale');
  nodes.clear(); reindex(); render(); scrollToResults(); syncUrl(true);
});

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
  if (e.target.closest('[data-retry]')) return load({ force: true });
  const s = e.target.closest('[data-star]'); if (s) return toggleStar(s.dataset.star);
  const r = e.target.closest('.row:not(.sk)'); if (r) open(r.dataset.id);
});
el.banner.addEventListener('click', e => e.target.closest('[data-retry]') && load({ force: true }));

el.sheet.addEventListener('click', e => {
  const s = e.target.closest('[data-star]'); if (s) return toggleStar(s.dataset.star);
  if (e.target.closest('[data-close]')) return close();
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
  if (id && find(id)) return open(id, { push: false });
  hide();
});

addEventListener('keydown', e => {
  if (e.key === 'Escape') { el.sheet.classList.contains('open') ? close() : (S.q = el.q.value = '', render(), syncUrl(true)); return; }
  if (el.sheet.classList.contains('open')) return;
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== el.q) {
    e.preventDefault(); el.q.focus(); el.q.select(); return;
  }
  if (!S.list.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    S.sel = (S.sel + (e.key === 'ArrowDown' ? 1 : -1) + S.list.length) % S.list.length;
    paintSel(true);
  } else if (e.key === 'Enter' && S.list[S.sel]) open(S.list[S.sel].id);
});

/* ---------- go ---------- */
// The shell is static HTML, so a boot failure would otherwise look like a page
// whose search box simply ignores you. Say what happened instead.
addEventListener('error', e => {
  if (S.assets.length || S.pools.length) return;
  el.res.innerHTML = `<div class="empty"><b>The app failed to start</b>${esc(e.message || 'Unknown error')}</div>`;
});

fromUrl();
if (S.q.trim().length >= 2) askDex();
load().then(() => {
  const id = location.hash.slice(1).replace('/', ':');
  if (id && find(id)) { history.replaceState({ id, depth: 0 }, '', location.href); open(id, { push: false }); }
});
if (!coarse) el.q.focus();
