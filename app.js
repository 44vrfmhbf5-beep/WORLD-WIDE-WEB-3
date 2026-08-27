/* Atlas — onchain search. UI only: all figures are illustrative mock data. */

// id, name, color
const CHAINS = [
  ['sol','Solana','#14f195'], ['eth','Ethereum','#7b8cf5'], ['base','Base','#3b7cff'],
  ['arb','Arbitrum','#28a0f0'], ['op','Optimism','#ff5c6c'], ['poly','Polygon','#a06bf0'],
  ['bnb','BNB Chain','#f0b90b'], ['avax','Avalanche','#e84142'], ['sui','Sui','#4da2ff'],
  ['apt','Aptos','#2ed3b7'], ['btc','Bitcoin','#f7931a'], ['hl','Hyperliquid','#97fce4'],
];
const CH = Object.fromEntries(CHAINS.map(c => [c[0], { id: c[0], name: c[1], color: c[2] }]));

// symbol, name, chain, price, chg24, mcap, vol24, category, color
const ASSETS = [
  ['SOL','Solana','sol',186.42,4.21,89.6e9,3.9e9,'Layer 1','#14f195'],
  ['ETH','Ethereum','eth',3412.80,-1.14,411e9,14.2e9,'Layer 1','#7b8cf5'],
  ['BTC','Bitcoin','btc',96240.00,1.86,1.9e12,28.4e9,'Layer 1','#f7931a'],
  ['USDC','USD Coin','sol',1.0001,0.01,41.2e9,7.1e9,'Stablecoin','#2775ca'],
  ['USDT','Tether','eth',0.9998,-0.02,118e9,42e9,'Stablecoin','#26a17b'],
  ['JITOSOL','Jito Staked SOL','sol',212.06,4.36,2.6e9,84e6,'LST','#38d39f'],
  ['JUP','Jupiter','sol',0.94,7.62,2.8e9,318e6,'DEX','#c7f284'],
  ['JTO','Jito','sol',2.61,3.04,880e6,61e6,'Staking','#5fd4c0'],
  ['PYTH','Pyth Network','sol',0.31,-2.41,1.1e9,44e6,'Oracle','#9d7bf5'],
  ['BONK','Bonk','sol',0.0000241,12.84,1.9e9,240e6,'Memecoin','#f5a524'],
  ['WIF','dogwifhat','sol',1.72,-5.30,1.7e9,190e6,'Memecoin','#ffb4c0'],
  ['WBTC','Wrapped Bitcoin','eth',96180.00,1.79,13.4e9,410e6,'Wrapped','#f0932b'],
  ['WSTETH','Wrapped stETH','eth',4041.20,-1.02,18.9e9,120e6,'LST','#8fb5ff'],
  ['WEETH','Ether.fi Staked ETH','eth',3588.40,-0.94,6.2e9,72e6,'LRT','#6fd3f5'],
  ['LINK','Chainlink','eth',22.14,2.35,13.8e9,540e6,'Oracle','#5a8dfa'],
  ['UNI','Uniswap','eth',12.06,-0.78,7.2e9,290e6,'DEX','#ff6fb0'],
  ['AAVE','Aave','eth',321.40,5.12,4.8e9,320e6,'Lending','#b06ff0'],
  ['ENA','Ethena','eth',0.68,-3.44,2.1e9,180e6,'Synthetic','#dfe3ea'],
  ['MORPHO','Morpho','base',1.84,6.02,940e6,42e6,'Lending','#5b7cf7'],
  ['CBBTC','Coinbase BTC','base',96210.00,1.81,3.1e9,96e6,'Wrapped','#3b7cff'],
  ['AERO','Aerodrome','base',1.12,9.41,940e6,88e6,'DEX','#4fc3f7'],
  ['ARB','Arbitrum','arb',0.79,-2.11,3.4e9,210e6,'Layer 2','#28a0f0'],
  ['GMX','GMX','arb',24.60,3.18,240e6,31e6,'Perps','#4fa8ff'],
  ['OP','Optimism','op',1.64,-1.55,2.7e9,140e6,'Layer 2','#ff5c6c'],
  ['VELO','Velodrome','op',0.084,4.72,190e6,12e6,'DEX','#ff8a5c'],
  ['POL','Polygon','poly',0.42,-0.63,3.9e9,160e6,'Layer 2','#a06bf0'],
  ['BNB','BNB','bnb',712.30,0.94,102e9,1.8e9,'Layer 1','#f0b90b'],
  ['CAKE','PancakeSwap','bnb',2.41,-1.92,720e6,64e6,'DEX','#f5c76a'],
  ['AVAX','Avalanche','avax',41.20,2.66,17.1e9,620e6,'Layer 1','#e84142'],
  ['SUI','Sui','sui',3.86,6.14,12.4e9,1.1e9,'Layer 1','#4da2ff'],
  ['DEEP','DeepBook','sui',0.14,11.20,410e6,38e6,'DEX','#7fc4ff'],
  ['APT','Aptos','apt',9.34,-1.28,5.8e9,240e6,'Layer 1','#2ed3b7'],
  ['HYPE','Hyperliquid','hl',34.80,8.05,11.6e9,780e6,'Perps','#97fce4'],
];

// protocol, asset, chain, supplyAPY, borrowAPY, tvl, utilization, ltv
const POOLS = [
  ['Kamino','SOL','sol',6.42,8.91,842e6,72,0.75],
  ['Kamino','USDC','sol',9.18,12.40,1.24e9,86,0.80],
  ['Kamino','JITOSOL','sol',5.10,7.62,410e6,64,0.70],
  ['MarginFi','SOL','sol',5.84,8.20,318e6,68,0.72],
  ['MarginFi','USDC','sol',8.46,11.70,402e6,81,0.80],
  ['Save','USDT','sol',7.92,10.85,164e6,78,0.78],
  ['Drift','SOL','sol',6.05,9.40,228e6,70,0.74],
  ['Drift','USDC','sol',8.90,12.10,296e6,83,0.80],
  ['Aave v3','ETH','eth',2.14,3.02,4.8e9,58,0.83],
  ['Aave v3','USDC','eth',6.72,8.44,2.9e9,84,0.87],
  ['Aave v3','WBTC','eth',0.42,1.86,1.6e9,22,0.73],
  ['Aave v3','WSTETH','eth',0.18,1.24,3.4e9,12,0.79],
  ['Morpho Blue','WEETH','eth',3.16,4.60,940e6,66,0.86],
  ['Morpho Blue','USDC','eth',7.40,9.12,1.8e9,88,0.86],
  ['Spark','USDT','eth',6.88,8.05,1.1e9,80,0.83],
  ['Compound v3','USDC','eth',6.10,7.92,1.4e9,79,0.82],
  ['Euler v2','ETH','eth',2.46,3.68,620e6,61,0.80],
  ['Moonwell','CBBTC','base',0.88,2.44,388e6,34,0.78],
  ['Moonwell','USDC','base',7.26,9.60,512e6,82,0.84],
  ['Morpho Blue','CBBTC','base',1.02,2.90,724e6,38,0.86],
  ['Aave v3','ETH','base',2.02,2.94,1.1e9,56,0.82],
  ['Fluid','ETH','arb',2.58,3.90,286e6,63,0.85],
  ['Aave v3','ARB','arb',1.34,3.86,142e6,42,0.66],
  ['Radiant','USDC','arb',7.04,9.88,96e6,76,0.80],
  ['Silo','GMX','arb',2.20,6.10,44e6,48,0.60],
  ['Aave v3','OP','op',1.12,3.44,88e6,39,0.65],
  ['Aave v3','POL','poly',1.86,4.20,124e6,46,0.68],
  ['Venus','BNB','bnb',2.94,5.10,680e6,59,0.75],
  ['Venus','USDT','bnb',6.40,8.72,940e6,77,0.80],
  ['Benqi','AVAX','avax',2.66,5.34,214e6,54,0.72],
  ['Suilend','SUI','sui',4.88,7.90,342e6,67,0.70],
  ['NAVI','USDC','sui',9.60,13.20,188e6,85,0.78],
  ['Aries','APT','apt',3.42,6.28,96e6,57,0.70],
  ['HyperLend','HYPE','hl',7.15,11.04,264e6,73,0.65],
];

/* ---------- model ---------- */
const assets = ASSETS.map(([sym, name, chain, price, chg, mcap, vol, cat, color]) =>
  ({ kind: 'asset', id: `a:${sym}:${chain}`, sym, name, chain, price, chg, mcap, vol, cat, color,
     key: `${sym} ${name} ${cat} ${CH[chain].name} token coin asset price` }));

const pools = POOLS.map(([proto, sym, chain, sup, bor, tvl, util, ltv], i) => {
  const a = assets.find(x => x.sym === sym) || {};
  return { kind: 'pool', id: `p:${i}`, proto, sym, chain, sup, bor, tvl, util, ltv,
    color: a.color || '#ab9ff2', name: a.name || sym,
    key: `${proto} ${sym} ${a.name || ''} ${CH[chain].name} lending lend borrow supply pool market yield apy earn` };
});

const ALL = [...assets, ...pools];

/* ---------- format ---------- */
const compact = n => n >= 1e12 ? (n / 1e12).toFixed(2) + 'T' : n >= 1e9 ? (n / 1e9).toFixed(2) + 'B'
  : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : n.toFixed(0);
const usd = n => n >= 1e4 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  : n >= 1 ? '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  : '$' + n.toPrecision(3);
const pct = n => (n > 0 ? '+' : '') + n.toFixed(2) + '%';

/* ---------- deterministic sparkline ---------- */
function series(seed, drift, n = 44) {
  let h = 0; for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out = []; let v = 100;
  for (let i = 0; i < n; i++) {
    h = (h * 1664525 + 1013904223) >>> 0;
    v += ((h / 4294967296) - 0.48) * 4.2 + drift / n * 1.6;
    out.push(v);
  }
  return out;
}
function path(pts, w, h, pad = 2) {
  const lo = Math.min(...pts), hi = Math.max(...pts), r = hi - lo || 1;
  return pts.map((p, i) => `${i ? 'L' : 'M'}${(i / (pts.length - 1) * w).toFixed(1)} ${(pad + (1 - (p - lo) / r) * (h - pad * 2)).toFixed(1)}`).join('');
}
const spark = (seed, chg) => {
  const d = path(series(seed, chg), 62, 26);
  return `<svg class="spark" viewBox="0 0 62 26" fill="none"><path d="${d}" stroke="${chg >= 0 ? 'var(--up)' : 'var(--down)'}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};

/* ---------- search ---------- */
function score(item, tokens) {
  const key = item.key.toLowerCase(), sym = (item.sym || '').toLowerCase(), nm = (item.name || '').toLowerCase();
  let total = 0;
  for (const t of tokens) {
    let s = 0;
    if (sym === t) s = 120;
    else if (sym.startsWith(t)) s = 90;
    else if (nm.startsWith(t)) s = 70;
    else if ((item.proto || '').toLowerCase().startsWith(t)) s = 80;
    else if (key.includes(t)) s = 40;
    if (!s) return 0;
    total += s;
  }
  return total;
}
const size = i => i.kind === 'asset' ? i.mcap : i.tvl;

/* ---------- state ---------- */
const S = { q: '', tab: 'all', chain: null, sel: 0, list: [] };
const $ = s => document.querySelector(s);
const el = { q: $('#q'), res: $('#results'), meta: $('#meta'), sheet: $('#sheet'), scrim: $('#scrim'), clear: $('#clear') };

/* ---------- rows ---------- */
const initials = s => s.length <= 4 ? s.toUpperCase() : s.slice(0, 3).toUpperCase();
const tok = (label, color, chain, sq) =>
  `<div class="tok${sq ? ' sq' : ''}${label.length > 3 ? ' t4' : ''}" style="--c:${color};--c2:${CH[chain].color}">${label}<span class="badge"></span></div>`;

function rowHTML(it, i) {
  const c = CH[it.chain];
  if (it.kind === 'asset') return `<button class="row${i === S.sel ? ' sel' : ''}" role="option" aria-selected="${i === S.sel}" data-id="${it.id}" style="animation-delay:${Math.min(i, 12) * 18}ms">
    ${tok(initials(it.sym), it.color, it.chain)}
    <div class="body">
      <div class="t1">${it.name} <span class="sym">${it.sym}</span></div>
      <div class="t2"><span class="tag">${it.cat}</span> ${c.name} <span class="tail"><span class="sep">·</span> $${compact(it.mcap)} cap</span></div>
    </div>
    ${spark(it.sym, it.chg)}
    <div class="num"><div class="n1">${usd(it.price)}</div><div class="n2 ${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</div></div>
  </button>`;
  return `<button class="row${i === S.sel ? ' sel' : ''}" role="option" aria-selected="${i === S.sel}" data-id="${it.id}" style="animation-delay:${Math.min(i, 12) * 18}ms">
    ${tok(it.proto.slice(0, 2).toUpperCase(), it.color, it.chain, 1)}
    <div class="body">
      <div class="t1">${it.proto} <span class="sym">${it.sym}</span></div>
      <div class="t2"><span class="tag">Lending</span> ${c.name} <span class="tail"><span class="sep">·</span> $${compact(it.tvl)} supplied</span></div>
    </div>
    <div class="num"><div class="n1 up">${it.sup.toFixed(2)}%</div><div class="n2 mute">${it.bor.toFixed(2)}% borrow</div></div>
  </button>`;
}

/* ---------- render ---------- */
function compute() {
  const q = S.q.trim().toLowerCase();
  let pool = ALL.filter(i => (S.tab === 'all' || (S.tab === 'assets') === (i.kind === 'asset')) &&
    (!S.chain || i.chain === S.chain));
  if (!q) return pool.sort((a, b) => size(b) - size(a)).slice(0, 24);
  const tokens = q.split(/\s+/);
  const hits = pool.map(i => [i, score(i, tokens)]).filter(x => x[1])
    .sort((a, b) => b[1] - a[1] || size(b[0]) - size(a[0]));
  const g = k => hits.filter(x => x[0].kind === k);
  const [A, P] = [g('asset'), g('pool')];
  const top = x => x.length ? x[0][1] : -1;
  return (top(A) >= top(P) ? [...A, ...P] : [...P, ...A]).map(x => x[0]).slice(0, 40);
}

function render() {
  const list = S.list = compute();
  S.sel = Math.min(S.sel, list.length - 1);
  document.body.classList.toggle('searching', !!S.q);
  el.clear.hidden = !S.q;

  const scope = S.chain ? CH[S.chain].name : `${CHAINS.length} networks`;
  el.meta.textContent = !list.length ? '' : S.q
    ? `${list.length} result${list.length > 1 ? 's' : ''} for “${S.q.trim()}” · ${scope}`
    : `Trending on ${scope} · ↑↓ to browse, ↵ to open`;

  if (!list.length) {
    el.res.innerHTML = `<div class="empty"><b>Nothing matched “${S.q.trim()}”</b>Try a ticker like SOL, a protocol like Kamino, or “usdc lending”.</div>`;
    return;
  }
  let html = '', last = null;
  list.forEach((it, i) => {
    if (S.tab === 'all' && it.kind !== last) { html += `<div class="gtitle">${it.kind === 'asset' ? 'Assets' : 'Lending markets'}</div>`; last = it.kind; }
    html += rowHTML(it, i);
  });
  el.res.innerHTML = html;
}

/* ---------- detail sheet ---------- */
const hist = [];
function statRow(k, v, extra = '') { return `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${extra}</div>`; }

function sheetHTML(it) {
  const c = CH[it.chain];
  const back = hist.length > 1 ? `<button class="x" data-back aria-label="Back"><svg viewBox="0 0 24 24" class="i"><path d="M15 5l-7 7 7 7"/></svg></button>` : '';
  const head = (title, sub, icon) => `<div class="sheet-top">
      <div style="display:flex;gap:12px;align-items:center">${icon}<div><h2>${title}</h2><div class="hsub">${sub}</div></div></div>
      <div style="display:flex;gap:6px">${back}<button class="x" data-close aria-label="Close"><svg viewBox="0 0 24 24" class="i"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    </div>`;

  if (it.kind === 'asset') {
    const pts = series(it.sym, it.chg, 60), d = path(pts, 300, 96, 6);
    const stroke = it.chg >= 0 ? 'var(--up)' : 'var(--down)';
    const markets = pools.filter(p => p.sym === it.sym).sort((a, b) => b.tvl - a.tvl);
    return `<div class="sheet-in">
      ${head(it.name, `${it.sym} · ${c.name} · ${it.cat}`, tok(initials(it.sym), it.color, it.chain))}
      <div class="big">${usd(it.price)}</div>
      <div class="chgline"><span class="${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</span><span class="mute">past 24 hours</span></div>
      <div class="chart">
        <svg viewBox="0 0 300 108" preserveAspectRatio="none">
          <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="${stroke}" stop-opacity=".28"/><stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${d}L300 108L0 108Z" fill="url(#g)"/>
          <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div class="rangebar"><span>1H</span><span class="on">1D</span><span>1W</span><span>1M</span><span>1Y</span></div>
      </div>
      <div class="stats">
        ${statRow('Market cap', '$' + compact(it.mcap))}
        ${statRow('24h volume', '$' + compact(it.vol))}
        ${statRow('Network', c.name)}
        ${statRow('Category', it.cat)}
      </div>
      ${markets.length ? `<div class="sec"><h3>Lend or borrow ${it.sym}</h3>${markets.map(miniHTML).join('')}</div>` : ''}
      <div class="cta"><button class="p">Swap</button><button class="s">Add to watchlist</button></div>
      <div class="note">Illustrative data — interface preview, not financial advice.</div>
    </div>`;
  }

  const a = assets.find(x => x.sym === it.sym);
  return `<div class="sheet-in">
    ${head(`${it.proto}`, `${it.sym} market · ${c.name}`, tok(it.proto.slice(0, 2).toUpperCase(), it.color, it.chain, 1))}
    <div class="big up">${it.sup.toFixed(2)}%</div>
    <div class="chgline"><span class="mute">supply APY · borrow at ${it.bor.toFixed(2)}%</span></div>
    <div class="stats">
      ${statRow('Total supplied', '$' + compact(it.tvl))}
      ${statRow('Available', '$' + compact(it.tvl * (1 - it.util / 100)))}
      ${statRow('Max LTV', (it.ltv * 100).toFixed(0) + '%')}
      ${statRow('Liq. threshold', (it.ltv * 100 + 5).toFixed(0) + '%')}
      <div class="stat wide"><div class="k">Utilization</div><div class="v">${it.util}%</div>
        <div class="util"><i style="width:${it.util}%"></i></div></div>
    </div>
    ${a ? `<div class="sec"><h3>Collateral asset</h3>${miniHTML(a)}</div>` : ''}
    <div class="sec"><h3>Other ${it.sym} markets</h3>
      ${pools.filter(p => p.sym === it.sym && p.id !== it.id).sort((x, y) => y.sup - x.sup).slice(0, 4).map(miniHTML).join('') || '<div class="note" style="text-align:left">No other markets indexed.</div>'}
    </div>
    <div class="cta"><button class="p">Supply</button><button class="s">Borrow</button></div>
    <div class="note">Illustrative data — interface preview, not financial advice.</div>
  </div>`;
}

function miniHTML(it) {
  const c = CH[it.chain];
  return it.kind === 'asset'
    ? `<button class="mini" data-id="${it.id}">${tok(initials(it.sym), it.color, it.chain)}
        <div class="body"><div class="t1">${it.name}</div><div class="t2">${it.sym} · ${c.name}</div></div>
        <div class="num"><div class="n1">${usd(it.price)}</div><div class="n2 ${it.chg >= 0 ? 'up' : 'down'}">${pct(it.chg)}</div></div></button>`
    : `<button class="mini" data-id="${it.id}">${tok(it.proto.slice(0, 2).toUpperCase(), it.color, it.chain, 1)}
        <div class="body"><div class="t1">${it.proto}</div><div class="t2">${c.name} · $${compact(it.tvl)} supplied</div></div>
        <div class="num"><div class="n1 up">${it.sup.toFixed(2)}%</div><div class="n2 mute">supply</div></div></button>`;
}

function open(id, push = true) {
  const it = ALL.find(x => x.id === id); if (!it) return;
  if (push) hist.push(id);
  el.sheet.innerHTML = sheetHTML(it);
  el.sheet.classList.add('open'); el.sheet.setAttribute('aria-hidden', 'false');
  el.scrim.hidden = false; el.sheet.scrollTop = 0; el.sheet.focus();
}
function close() {
  hist.length = 0;
  el.sheet.classList.remove('open'); el.sheet.setAttribute('aria-hidden', 'true');
  el.scrim.hidden = true; el.q.focus();
}

/* ---------- wiring ---------- */
$('#tabs').innerHTML = [['all', 'All'], ['assets', 'Assets'], ['lending', 'Lending']]
  .map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${k === 'all'}">${l}</button>`).join('');
$('#chains').innerHTML = `<button class="chip all" data-chain="" aria-pressed="true"><span class="dot"></span>All chains</button>` +
  CHAINS.map(([id, name, color]) => `<button class="chip" data-chain="${id}" aria-pressed="false" style="--c:${color}"><span class="dot"></span>${name}</button>`).join('');
$('#netCount').textContent = `${CHAINS.length} networks indexed`;
$('#chainWord').textContent = `${CHAINS.length} networks`;

el.q.addEventListener('input', e => { S.q = e.target.value; S.sel = 0; render(); });
el.clear.addEventListener('click', () => { S.q = el.q.value = ''; S.sel = 0; render(); el.q.focus(); });
$('#topSearch').addEventListener('click', () => el.q.focus());

$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('[data-tab]'); if (!b) return;
  S.tab = b.dataset.tab; S.sel = 0;
  [...e.currentTarget.children].forEach(t => t.setAttribute('aria-selected', t === b));
  render();
});
$('#chains').addEventListener('click', e => {
  const b = e.target.closest('[data-chain]'); if (!b) return;
  S.chain = b.dataset.chain || null; S.sel = 0;
  [...e.currentTarget.children].forEach(t => t.setAttribute('aria-pressed', t === b));
  render();
});
el.res.addEventListener('click', e => { const r = e.target.closest('.row'); if (r) open(r.dataset.id); });
el.sheet.addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return close();
  if (e.target.closest('[data-back]')) { hist.pop(); return open(hist[hist.length - 1], false); }
  const m = e.target.closest('.mini'); if (m) open(m.dataset.id);
});
el.scrim.addEventListener('click', close);

addEventListener('keydown', e => {
  if (e.key === 'Escape') { el.sheet.classList.contains('open') ? close() : (S.q = el.q.value = '', render()); return; }
  if (el.sheet.classList.contains('open')) return;
  if ((e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && document.activeElement !== el.q) {
    e.preventDefault(); el.q.focus(); el.q.select(); return;
  }
  if (!S.list.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    S.sel = (S.sel + (e.key === 'ArrowDown' ? 1 : -1) + S.list.length) % S.list.length;
    render();
    el.res.querySelector('.row.sel')?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && S.list[S.sel]) open(S.list[S.sel].id);
});

render();
el.q.focus();
