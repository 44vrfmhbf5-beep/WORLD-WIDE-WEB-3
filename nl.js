/* nl.js — reading a sentence as a query.

   "cat meme coin on base up 50% or more in the past 24 hours" names four things:
   a kind (memecoins are DEX pairs), a network, a threshold, and a word to
   search for. Atlas already has a control for each of them. The work is not
   inventing an answer, it is mapping a sentence onto controls that exist — so
   whatever comes out of here is something the user can see, adjust and undo in
   the UI, never a hidden ranking.

   This parser runs locally and always. An AI endpoint, if one is configured,
   runs after it and may override what it found — but it is never the only thing
   between a question and an answer, because a search box that stops working
   when a third party is down is not a search box. */

import { CHAINS } from './data.js';

/* Each entry is a category and the words that mean it. Longest match wins, so
   "meme coin" beats "coin": a memecoin is a DEX pair, not a listed asset, and
   that distinction is the whole difference between an empty result and the
   right one. */
const KINDWORDS = [
  ['dex', ['meme coin', 'memecoin', 'meme', 'shitcoin', 'dex pair', 'dex', 'pair', 'liquidity pool', 'trading pair']],
  ['nfts', ['nft', 'collection', 'pfp', 'jpeg', 'collectible']],
  ['lending', ['lending market', 'lending', 'borrow', 'collateral', 'ltv', 'money market']],
  ['yield', ['yield farm', 'farm', 'apy', 'staking', 'yield']],
  ['protocols', ['protocol', 'dapp', 'app', 'dex aggregator']],
  ['stables', ['stablecoin', 'stable coin', 'stable', 'peg', 'depeg']],
  ['bridges', ['bridge', 'cross-chain', 'crosschain']],
  ['raises', ['raise', 'funding', 'fundraise', 'round', 'seed', 'series a', 'series b', 'venture']],
  ['hacks', ['hack', 'exploit', 'rug', 'drain', 'stolen']],
  ['networks', ['network', 'chain', 'l1', 'l2', 'rollup', 'blockchain']],
  ['stocks', ['tokenized stock', 'tokenised stock', 'equity', 'equities', 'share', 'stock']],
  ['assets', ['token', 'coin', 'asset', 'cryptocurrency', 'crypto']],
];

/* Some of those words name a category; others are just what things are called.
   "usd coin" is the name of a stablecoin, not a request for the Assets tab, and
   reading it as one answers a question nobody asked. A generic word only counts
   when the sentence also names something specific — a network, a threshold, or
   a category word that means one thing. */
const GENERIC = new Set(['token', 'coin', 'asset', 'cryptocurrency', 'crypto',
  'share', 'stock', 'pair', 'app', 'chain', 'network']);

// which field a change refers to, by the window the sentence names
const WINDOWS = [
  [/\b(24\s*h(our)?s?|1d|day|today|past day)\b/, 'chg'],
  [/\b(7\s*d(ays)?|week|weekly|past week)\b/, 'chg7d'],
  [/\b(30\s*d(ays)?|month|monthly|past month)\b/, 'chg30d'],
  [/\b(year|1y|12\s*months?)\b/, 'chg1y'],
];

const SIZE = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
const money = (n, suf) => Number(n) * (SIZE[String(suf || '').toLowerCase()] || 1);

/** The size field that means "how big is this" for a category. */
const SIZE_FIELD = { assets: 'mcap', stocks: 'mcap', dex: 'liq', nfts: 'volUsd',
  lending: 'supplyUsd', yield: 'tvl', protocols: 'tvl', stables: 'circulating',
  bridges: 'vol24', networks: 'tvl', raises: 'amount', hacks: 'amount' };

/** Reads a sentence into the controls Atlas already has. */
export function parse(q, { chains = CHAINS } = {}) {
  const raw = String(q || '');
  const t = ' ' + raw.toLowerCase().replace(/[,]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const out = { tab: null, chain: null, where: [], sort: null, text: raw.trim(), used: [], specific: false };
  let rest = t;
  const eat = (re) => { rest = rest.replace(re, ' '); };

  // network, by name or by the id in the URL
  for (const [id, name] of chains) {
    const re = new RegExp(`\\b${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(t) || new RegExp(`\\bon ${id}\\b`).test(t)) {
      out.chain = id; out.used.push(name); eat(re); break;
    }
  }

  // category
  for (const [tab, words] of KINDWORDS) {
    const hit = words.find(w => t.includes(' ' + w + ' ') || t.includes(' ' + w + 's '));
    if (hit) {
      out.tab = tab; out.specific = !GENERIC.has(hit); out.used.push(hit);
      eat(new RegExp(`\\b${hit}s?\\b`, 'g')); break;
    }
  }

  const field = (WINDOWS.find(([re]) => re.test(t)) || [, 'chg'])[1];

  /* "up 50% or more", "down more than 10%", "gained over 5%". The direction
     word decides the sign, and for a fall the threshold is a floor on the
     magnitude, not on the signed number. */
  let m = /\b(up|gain(?:ed|ing)?|rose|rising|pump(?:ed|ing)?)\b[^%]{0,24}?(\d+(?:\.\d+)?)\s*%/.exec(t)
       || /\b(\d+(?:\.\d+)?)\s*%\s*(?:or more|\+)/.exec(t) && null;
  if (m) { out.where.push([field, '>=', Number(m[2])]); out.used.push(`up ${m[2]}%`); }
  else {
    m = /\b(down|fell|falling|lost|dropp?(?:ed|ing)?|dump(?:ed|ing)?)\b[^%]{0,24}?(\d+(?:\.\d+)?)\s*%/.exec(t);
    if (m) { out.where.push([field, '<=', -Number(m[2])]); out.used.push(`down ${m[2]}%`); }
  }
  if (!out.where.length && /\b(gainers?|winners?|up)\b/.test(t)) {
    out.where.push([field, '>', 0]); out.used.push('gainers');
  } else if (!out.where.length && /\b(losers?|down)\b/.test(t)) {
    out.where.push([field, '<', 0]); out.used.push('losers');
  }
  eat(/\b(up|down|gain\w*|lost|fell|falling|rose|rising|dropp?\w*|pump\w*|dump\w*|or more|at least|over|more than|past|last|hours?|days?|weeks?|months?|year|24h|7d|30d|1y|\d+(\.\d+)?\s*%)\b/g);

  // "over $10m", "under 500k", "at least $1b"
  const sz = SIZE_FIELD[out.tab] || 'mcap';
  m = /\b(over|above|more than|at least|min(?:imum)?)\s*\$?\s*(\d+(?:\.\d+)?)\s*([kmbt])?\b/.exec(t);
  if (m) { out.where.push([sz, '>=', money(m[2], m[3])]); out.used.push(`${sz} over ${m[2]}${m[3] || ''}`); }
  m = /\b(under|below|less than|at most|max(?:imum)?)\s*\$?\s*(\d+(?:\.\d+)?)\s*([kmbt])?\b/.exec(t);
  if (m) { out.where.push([sz, '<=', money(m[2], m[3])]); out.used.push(`${sz} under ${m[2]}${m[3] || ''}`); }
  eat(/\b(over|above|under|below|more than|less than|at least|at most|min\w*|max\w*)\s*\$?\s*\d+(\.\d+)?\s*[kmbt]?\b/g);

  // "highest apy", "biggest", "newest"
  if (/\b(highest|best|top|biggest|largest|most)\b/.test(t)) out.sort = { key: sz, dir: -1 };
  if (/\b(lowest|smallest|cheapest)\b/.test(t)) out.sort = { key: sz, dir: 1 };

  /* What is left is what to actually search for — and it has to be only that.
     A stray "50" or "$10m" left in the text turns a fuzzy search loose on the
     numbers the sentence had already been read for, and buries the one word
     that mattered. */
  const STOP = /\b(show|find|list|get|give|me|my|the|a|an|of|in|on|at|with|and|or|that|those|this|these|their|its|there|which|who|what|are|is|was|were|be|been|to|for|by|from|all|any|some|please|i|want|need|looking|search|s)\b/g;
  const NOISE = /\b(highest|lowest|best|worst|top|biggest|largest|smallest|cheapest|most|least|new|newest|recent|recently|currently|now|right|good|great)\b/g;
  out.text = rest
    .replace(/\$?\s*\d+(?:[.,]\d+)?\s*(?:[kmbt]\b|%|x\b)?/g, ' ')   // every number was read above
    .replace(STOP, ' ').replace(NOISE, ' ')
    .replace(/[^\w\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  return out;
}

/* An OpenAI-compatible endpoint, which is what every open-source runner speaks:
   Ollama, llama.cpp, LM Studio, vLLM, and the hosted gateways too. It is handed
   the same vocabulary the parser uses and asked for the same shape, so its
   answer goes through exactly the same controls and can be read and undone in
   the UI. Anything it returns that is not in that vocabulary is dropped. */
const SYSTEM = `Turn a crypto search question into JSON. Reply with JSON only, no prose.
Shape: {"tab":string|null,"chain":string|null,"text":string,"where":[[field,op,number]],"sort":{"key":string,"dir":-1|1}|null}
tab is one of: assets, stocks, dex, nfts, lending, yield, protocols, stables, bridges, raises, hacks, networks.
A memecoin or a meme token is "dex", not "assets".
chain is a short id like eth, sol, base, arb, bnb, poly, op, avax.
field is one of: chg (24h % change), chg7d, chg30d, chg1y, mcap, vol, liq, tvl, apy, supplyUsd, circulating, amount, volUsd, floorUsd.
op is one of: >=, <=, >, <.
text is the words left over to search for, or "".`;

export async function askAI(q, ai) {
  if (!ai?.endpoint) return null;
  const r = await fetch(`${ai.endpoint.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
      ...(ai.apiKey ? { authorization: `Bearer ${ai.apiKey}` } : {}) },
    body: JSON.stringify({ model: ai.model || 'llama3.1',
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(q) }],
      temperature: 0, max_tokens: 300, stream: false }),
    signal: AbortSignal.timeout(ai.timeout || 12000),
  });
  if (!r.ok) throw new Error(`AI endpoint returned HTTP ${r.status}`);
  const j = await r.json();
  const text = j?.choices?.[0]?.message?.content || '';
  const m = text.match(/\{[\s\S]*\}/);          // models like to wrap JSON in prose
  if (!m) throw new Error('AI did not return JSON.');
  return JSON.parse(m[0]);
}

/** Keeps only what maps onto a control that exists. A model may say anything. */
export function sanitise(x, { tabs, chainIds, fields }) {
  const ops = new Set(['>=', '<=', '>', '<']);
  const out = { tab: null, chain: null, where: [], sort: null, text: '' };
  if (typeof x?.tab === 'string' && tabs.includes(x.tab)) out.tab = x.tab;
  if (typeof x?.chain === 'string' && chainIds.includes(x.chain)) out.chain = x.chain;
  if (typeof x?.text === 'string') out.text = x.text.slice(0, 80);
  for (const w of Array.isArray(x?.where) ? x.where.slice(0, 4) : []) {
    if (!Array.isArray(w) || w.length !== 3) continue;
    const [f, op, v] = w;
    if (fields.includes(f) && ops.has(op) && Number.isFinite(Number(v)))
      out.where.push([f, op, Number(v)]);
  }
  if (x?.sort && fields.includes(x.sort.key))
    out.sort = { key: x.sort.key, dir: x.sort.dir === 1 ? 1 : -1 };
  return out;
}
