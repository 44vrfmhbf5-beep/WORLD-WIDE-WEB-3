/* Atlas — search across chains. Live data via data.js; this file is UI only. */
import Fuse from './vendor/fuse.mjs';
import { CHAINS, CH, loadAssets, loadPools, loadAssetChart, loadPoolChart, links } from './data.js';

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

function path(pts, w, h, pad = 2) {
  if (pts.length < 2) return '';
  const lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)} ${(pad + (1 - (p - lo) / r) * (h - pad * 2)).toFixed(1)}`).join('');
}
const spark = (pts, up) => !pts?.length ? '<div class="spark"></div>'
  : `<svg class="spark" viewBox="0 0 62 26" fill="none"><path d="${path(pts, 62, 26)}" stroke="${up ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/* ---------- state ---------- */
const S = {
  q: '', tab: 'all', chain: null, sel: 0, list: [],
  assets: [], pools: [], fuse: null,
  loading: true, err: null, warn: null, at: 0,
  watch: new Map(JSON.parse(localStorage.getItem('atlas:watch') || '[]').map(i => [i.id, i])),
};
const el = {
  q: $('#q'), res: $('#results'), meta: $('#meta'), sheet: $('#sheet'), scrim: $('#scrim'),
  clear: $('#clear'), banner: $('#banner'),
};
const saveWatch = () => localStorage.setItem('atlas:watch', JSON.stringify([...S.watch.values()]));

/* ---------- data ---------- */
async function load({ force } = {}) {
  if (force) { try { Object.keys(sessionStorage).forEach(k => k.startsWith('atlas:') && sessionStorage.removeItem(k)); } catch {} }
  S.loading = true; S.err = S.warn = null; render();
  const [a, p] = await Promise.allSettled([loadAssets(S.chain), loadPools()]);
  S.assets = a.status === 'fulfilled' ? a.value : [];
  S.pools = p.status === 'fulfilled' ? p.value : [];
  if (a.status === 'rejected' && p.status === 'rejected') S.err = a.reason?.message || 'Could not reach the data sources.';
  else if (a.status === 'rejected') S.warn = 'Asset prices unavailable — ' + (a.reason?.message || 'CoinGecko is not responding.');
  else if (p.status === 'rejected') S.warn = 'Lending markets unavailable — ' + (p.reason?.message || 'DeFiLlama is not responding.');
  S.loading = false; S.at = Date.now();
  nodes.clear(); reindex(); render();
}

const pooled = () => S.chain ? S.pools.filter(p => p.chain === S.chain) : S.pools;
function scope() {
  if (S.tab === 'saved') return [...S.watch.values()].map(i => S.assets.find(x => x.id === i.id) || S.pools.find(x => x.id === i.id) || i)
    .filter(i => !S.chain || i.chain === S.chain);
  const a = S.tab === 'lending' ? [] : S.assets;
  const p = S.tab === 'assets' ? [] : pooled();
  return [...a, ...p];
}
function reindex() {
  S.fuse = new Fuse(scope(), {
    keys: [{ name: 'sym', weight: 3 }, { name: 'name', weight: 2 }, { name: 'proto', weight: 2 }, { name: 'key', weight: 1 }],
    threshold: 0.34, ignoreLocation: true, minMatchCharLength: 2, includeScore: true,
  });
}

const size = i => i.kind === 'asset' ? i.mcap : i.supplyUsd;
function compute() {
  const q = S.q.trim();
  if (!q) return scope().sort((a, b) => size(b) - size(a)).slice(0, 40);
  if (!S.fuse) return [];
  const t = q.toLowerCase();
  const hits = S.fuse.search(q, { limit: 300 }).map(r => {
    const i = r.item; let s = 1 - (r.score ?? 1);
    const sym = (i.sym || '').toLowerCase(), nm = (i.name || '').toLowerCase(), pr = (i.proto || '').toLowerCase();
    if (sym === t) s += 3; else if (sym.startsWith(t)) s += 1.5;
    if (pr.startsWith(t)) s += 1; if (nm.startsWith(t)) s += 0.6;
    return [i, s];
  }).sort((a, b) => b[1] - a[1] || size(b[0]) - size(a[0]));
  const g = k => hits.filter(x => x[0].kind === k);
  const [A, P] = [g('asset'), g('pool')];
  const top = x => x.length ? x[0][1] : -1;
  return (top(A) >= top(P) ? [...A, ...P] : [...P, ...A]).map(x => x[0]).slice(0, 60);
}

/* ---------- rows ---------- */
const tok = (it, sq) => {
  const label = it.kind === 'pool' ? (it.proto || '?').slice(0, 2).toUpperCase()
    : it.sym.length <= 4 ? it.sym : it.sym.slice(0, 3);
  const c = CH[it.chain];
  return `<div class="tok${sq ? ' sq' : ''}${label.length > 3 ? ' t4' : ''}" style="--c:${it.color}${c ? ';--c2:' + c.color : ''}">${esc(label)}` +
    (it.img ? `<img src="${esc(it.img)}" alt="" loading="lazy" onload="this.style.opacity=1" onerror="this.remove()">` : '') +
    (c ? '<span class="badge"></span>' : '') + `</div>`;
};
const star = it => `<button class="star${S.watch.has(it.id) ? ' on' : ''}" data-star="${esc(it.id)}" aria-label="Save to watchlist" aria-pressed="${S.watch.has(it.id)}">
  <svg viewBox="0 0 24 24" class="i"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg></button>`;

const optId = it => 'o-' + it.id.replace(/[^\w:.-]/g, '_');
// volatile fields only: a row is reused across renders unless its numbers moved
const sigOf = it => it.kind === 'asset' ? `${it.price}|${it.chg}|${it.mcap}` : `${it.sup}|${it.bor}|${it.supplyUsd}`;

function rowHTML(it) {
  const c = CH[it.chain];
  const head = `class="row" role="option" aria-selected="false" id="${optId(it)}" data-id="${esc(it.id)}"`;
  if (it.kind === 'asset') return `<div ${head}>
    ${tok(it)}
    <div class="body">
      <div class="t1">${esc(it.name)} <span class="sym">${esc(it.sym)}</span></div>
      <div class="t2">${it.rank ? `<span class="tag">#${it.rank}</span>` : ''}${c ? ' ' + esc(c.name) : ''} <span class="tail">${c ? '<span class="sep">·</span> ' : ''}$${compact(it.mcap)} cap</span></div>
    </div>
    ${spark(it.spark, it.chg >= 0)}
    <div class="num"><div class="n1">${usd(it.price)}</div><div class="n2 ${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</div></div>
    ${star(it)}</div>`;
  return `<div ${head}>
    ${tok(it, 1)}
    <div class="body">
      <div class="t1">${esc(it.proto)} <span class="sym">${esc(it.sym)}</span></div>
      <div class="t2"><span class="tag">Lending</span> ${esc(c?.name || '')} <span class="tail"><span class="sep">·</span> $${compact(it.supplyUsd)} supplied</span></div>
    </div>
    <div class="num"><div class="n1 up">${apy(it.sup)}</div><div class="n2 mute">${apy(it.bor)} borrow</div></div>
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

  el.banner.innerHTML = S.warn && !S.err
    ? `<div class="warn">${esc(S.warn)} <button data-retry>Retry</button></div>` : '';

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

  const list = S.list = compute();
  S.sel = Math.max(0, Math.min(S.sel, list.length - 1));
  const where = S.chain ? CH[S.chain].name : `${CHAINS.length} networks`;
  el.meta.innerHTML = !list.length ? '' : S.q
    ? `${list.length} result${list.length > 1 ? 's' : ''} for “${esc(S.q.trim())}” · ${esc(where)}`
    : S.tab === 'saved' ? `${list.length} saved` : `Top of ${esc(where)} · updated ${ago(S.at)} · ↑↓ to browse, ↵ to open`;

  if (!list.length) {
    el.res.innerHTML = S.tab === 'saved' && !S.q
      ? `<div class="empty"><b>Nothing saved yet</b>Tap the star on any asset or market to pin it here. Saved items persist in this browser.</div>`
      : `<div class="empty"><b>Nothing matched “${esc(S.q.trim())}”</b>Try a ticker like SOL, a protocol like Aave, or “usdc lending”.</div>`;
    return;
  }
  const frag = document.createDocumentFragment();
  let last = null;
  list.forEach((it, i) => {
    if (S.tab !== 'assets' && S.tab !== 'lending' && it.kind !== last) {
      const h = document.createElement('div');
      h.className = 'gtitle'; h.setAttribute('role', 'presentation');
      h.textContent = it.kind === 'asset' ? 'Assets' : 'Lending markets';
      frag.appendChild(h); last = it.kind;
    }
    frag.appendChild(nodeFor(it, i));
  });
  el.res.replaceChildren(frag);
  paintSel();
}

/* ---------- detail sheet ---------- */
let depth = 0;                       // sheet entries pushed since the sheet opened
const find = id => S.assets.find(x => x.id === id) || S.pools.find(x => x.id === id) || S.watch.get(id);
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
      <div class="note">Live prices from CoinGecko. Not financial advice.</div>
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
    ${others.length ? `<div class="sec"><h3>Other ${esc(it.sym)} markets</h3>${others.map(miniHTML).join('')}</div>` : ''}
    <div class="cta"><a class="p" href="${esc(links.pool(it))}" target="_blank" rel="noopener noreferrer">Open on DeFiLlama ↗</a></div>
    <div class="note">Live yields from DeFiLlama. Not financial advice.</div>
  </div>`;
}

function miniHTML(it) {
  const c = CH[it.chain];
  return it.kind === 'asset'
    ? `<div class="mini" data-id="${esc(it.id)}" role="button" tabindex="0">${tok(it)}
        <div class="body"><div class="t1">${esc(it.name)}</div><div class="t2">${[esc(it.sym), esc(c?.name || '')].filter(Boolean).join(' · ')}</div></div>
        <div class="num"><div class="n1">${usd(it.price)}</div><div class="n2 ${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</div></div></div>`
    : `<div class="mini" data-id="${esc(it.id)}" role="button" tabindex="0">${tok(it, 1)}
        <div class="body"><div class="t1">${esc(it.proto)}</div><div class="t2">${[esc(c?.name || ''), esc(it.meta), '$' + compact(it.supplyUsd) + ' supplied'].filter(Boolean).join(' · ')}</div></div>
        <div class="num"><div class="n1 up">${apy(it.sup)}</div><div class="n2 mute">supply</div></div></div>`;
}

async function drawChart(days) {
  const box = el.sheet.querySelector('.sheet-in'); if (!box) return;
  const host = box.querySelector('.chart-svg');
  const token = host.dataset.token = String(Date.now());
  host.innerHTML = '<div class="cload"></div>';
  let pts = [];
  try {
    pts = box.dataset.kind === 'asset'
      ? await loadAssetChart(box.dataset.cg, days)
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
  drawChart(it.kind === 'asset' ? 1 : 30);
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
  S.tab = ['assets', 'lending', 'saved'].includes(p.get('tab')) ? p.get('tab') : 'all';
  paintFilters();
}

/* ---------- chrome ---------- */
const TABS = [['all', 'All'], ['assets', 'Assets'], ['lending', 'Lending'], ['saved', 'Saved']];
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
el.q.addEventListener('input', e => { S.q = e.target.value; S.sel = 0; render(); scrollToResults(); syncUrl(); });
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
fromUrl();
load().then(() => {
  const id = location.hash.slice(1).replace('/', ':');
  if (id && find(id)) { history.replaceState({ id, depth: 0 }, '', location.href); open(id, { push: false }); }
});
if (!coarse) el.q.focus();
