/* mcp.js — the search bar asking CoinGecko a question directly.

   Atlas indexes the top few hundred assets. CoinGecko knows about seventeen
   thousand, and publishes an MCP server over them: a JSON-RPC endpoint with a
   handful of tools — search, market data, a coin's own page. This file is a
   client for exactly that, in about a hundred lines, because MCP over HTTP is
   three methods and a session header.

   Two rules, and they are the same two the AI parser follows:

     1. It never gates the search box. The local index answers first, always,
        and whatever comes back from here is added to that answer rather than
        replacing it. A search engine that stops working when somebody else's
        server is down is not a search engine.
     2. What it returns is rows, in the same shape as every other row, so they
        sort, filter, open and star like anything else. Nothing arrives as an
        opaque answer nobody can check.

   Whether a browser may call it at all is CORS, which is their decision and
   not visible from here. One attempt, a short timeout, and the app carries on. */

import { config } from './config.js';

let session = null, ready = null, tools = null, dead = false;

const endpoint = () => String(config.mcp?.endpoint || '').replace(/\/$/, '');
export const mcpReady = () => !!endpoint() && !dead;

/* Streamable HTTP: POST JSON-RPC, accept either JSON or an SSE frame back, and
   carry the session id the server hands out on initialize. */
async function rpc(method, params) {
  const url = endpoint();
  if (!url) throw new Error('No MCP endpoint configured.');
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
      ...(config.mcp?.apiKey ? { 'x-cg-pro-api-key': config.mcp.apiKey } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
    signal: AbortSignal.timeout(config.mcp?.timeout || 15000),
  });
  const sid = r.headers.get('mcp-session-id');
  if (sid) session = sid;
  if (!r.ok) throw new Error(`MCP returned HTTP ${r.status}`);
  const text = await r.text();
  // an SSE reply is one or more `data:` lines; the last one carries the result
  const body = text.startsWith('data:')
    ? text.split('\n').filter(l => l.startsWith('data:')).pop().slice(5).trim()
    : text;
  const j = JSON.parse(body);
  if (j.error) throw new Error(j.error.message || 'MCP error');
  return j.result;
}

async function handshake() {
  await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'atlas', version: '1' },
  });
  const list = await rpc('tools/list', {});
  tools = (list?.tools || []).map(t => t.name);
  return tools;
}

/** The tool list, fetched once. Null when the server cannot be reached. */
export function mcpTools() {
  if (!mcpReady()) return Promise.resolve(null);
  ready ||= handshake().catch(e => { dead = true; throw e; });
  return ready.catch(() => null);
}

/* Tool names are the server's to change, so they are matched rather than
   hard-coded: whichever tool has "search" in its name is the search tool. */
const pick = (names, ...want) =>
  names.find(n => want.every(w => n.toLowerCase().includes(w))) || null;

/** Calls a tool and unwraps whatever it wrapped its JSON in. */
export async function mcpCall(name, args) {
  const r = await rpc('tools/call', { name, arguments: args });
  const parts = r?.content || [];
  for (const c of parts) {
    if (c?.type !== 'text' || !c.text) continue;
    try { return JSON.parse(c.text); } catch { return c.text; }
  }
  return r?.structuredContent ?? null;
}

/* ---------- what the app asks for ---------- */

/** Coins matching a query, straight from CoinGecko's own index. */
export async function mcpSearch(q) {
  const names = await mcpTools();
  if (!names?.length) return [];
  const tool = pick(names, 'search');
  if (!tool) return [];
  const r = await mcpCall(tool, { query: String(q).slice(0, 60) }).catch(() => null);
  const coins = r?.coins || r?.data?.coins || (Array.isArray(r) ? r : []);
  return (coins || []).slice(0, 12).map(c => ({
    id: c.id || c.api_symbol || '', sym: String(c.symbol || '').toUpperCase(),
    name: c.name || c.id || '', img: c.large || c.thumb || c.image || null,
    rank: Number(c.market_cap_rank) || 0,
  })).filter(c => c.id && c.sym);
}

/** Live market rows for ids the search returned, so a row has numbers on it. */
export async function mcpMarkets(ids) {
  const names = await mcpTools();
  if (!names?.length || !ids.length) return [];
  const tool = pick(names, 'markets') || pick(names, 'coins', 'market');
  if (!tool) return [];
  const r = await mcpCall(tool, {
    vs_currency: 'usd', ids: ids.join(','), per_page: ids.length, page: 1,
  }).catch(() => null);
  const rows = Array.isArray(r) ? r : r?.data || [];
  return rows.filter(x => x && (x.id || x.symbol));
}

/** Everything CoinGecko's own page says about one coin, for the asset sheet. */
export async function mcpCoin(id) {
  const names = await mcpTools();
  if (!names?.length || !id) return null;
  const tool = pick(names, 'coin', 'data') || pick(names, 'id', 'coins');
  if (!tool) return null;
  const r = await mcpCall(tool, { id }).catch(() => null);
  const c = Array.isArray(r) ? r[0] : r;
  if (!c) return null;
  return {
    categories: (c.categories || []).filter(Boolean).slice(0, 6),
    homepage: (c.links?.homepage || []).filter(Boolean)[0] || '',
    sentiment: Number(c.sentiment_votes_up_percentage) || null,
    watchlist: Number(c.watchlist_portfolio_users) || null,
    rank: Number(c.market_cap_rank) || null,
    genesis: c.genesis_date || '',
  };
}
