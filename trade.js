/* trade.js — quotes that are real, and hand-offs that carry the wallet.

   A deliberate line runs through this file.

   Above it: quoting. Jupiter's quote endpoint is keyless and CORS-open, so a
   sheet can show a live route and a real price impact before anyone commits to
   anything. Hyperliquid's /info is the same, so a connected wallet can see its
   own positions. Reading is safe, so reading is wired.

   Below it: broadcasting. Where a venue's own API returns ready-to-sign
   calldata, this file relays it to the wallet and nothing more — the venue
   built the transaction and stands behind it. Those paths need that venue's
   key and are off until one is set.

   What this file will not do is construct swap calldata itself, or sign an
   exchange action it has assembled by hand. This build has never reached a
   chain, an RPC or a live venue; nothing in it has executed once. A display bug
   in the rest of Atlas shows an em dash. The same bug here spends money. So the
   last step stays with the venue, whose code has executed, and Atlas carries
   the wallet address into it rather than guessing on the user's behalf. */

import { config } from './config.js';
import { state, sendEvm } from './wallet.js';

const JUP = 'https://lite-api.jup.ag';
const HL = 'https://api.hyperliquid.xyz';

const json = async (url, init) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000), ...init });
  if (!r.ok) throw new Error(`${new URL(url).host} returned HTTP ${r.status}`);
  return r.json();
};
const post = (url, body) => json(url, { method: 'POST',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/* ---------- quotes ---------- */

// the mints every Solana quote is priced against
export const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL = 'So11111111111111111111111111111111111111112';

/* Quotes come back in the token's smallest unit, so a route cannot be shown as
   a number without knowing its decimals. Guessing them would put a figure that
   is wrong by orders of magnitude next to a price — one keyless lookup, cached
   for the session, instead. */
const decimals = new Map([[WSOL, 9], [USDC_SOL, 6]]);
export async function tokenDecimals(mint) {
  if (decimals.has(mint)) return decimals.get(mint);
  const r = await json(`${JUP}/tokens/v2/search?query=${encodeURIComponent(mint)}`)
    .catch(() => null);
  const hit = (Array.isArray(r) ? r : r?.tokens || []).find(t => (t.id || t.address) === mint);
  const d = Number.isFinite(hit?.decimals) ? hit.decimals : null;
  if (d != null) decimals.set(mint, d);
  return d;
}

/** A live Jupiter route. `amount` is in the input token's smallest unit. */
export async function jupiterQuote({ inputMint, outputMint, amount, slippageBps }) {
  const p = new URLSearchParams({
    inputMint, outputMint, amount: String(Math.round(amount)),
    slippageBps: String(slippageBps ?? config.venues.jupiter.slippageBps ?? 50),
  });
  const q = await json(`${JUP}/swap/v1/quote?${p}`);
  const hops = (q.routePlan || []).map(r => r.swapInfo?.label).filter(Boolean);
  return {
    in: Number(q.inAmount), out: Number(q.outAmount),
    // the API reports impact as a fraction string
    impact: Number(q.priceImpactPct) * 100,
    minOut: Number(q.otherAmountThreshold),
    via: hops, raw: q,
  };
}

/** What the connected wallet holds on Hyperliquid. Keyless, read-only. */
export async function hyperliquidState(address) {
  if (!config.venues.hyperliquid?.read) return null;
  const a = address || state().evm;
  if (!a) return null;
  const s = await post(`${HL}/info`, { type: 'clearinghouseState', user: a });
  const pos = (s?.assetPositions || []).map(x => x.position).filter(Boolean);
  return {
    value: Number(s?.marginSummary?.accountValue) || 0,
    withdrawable: Number(s?.withdrawable) || 0,
    positions: pos.map(x => ({
      coin: x.coin, size: Number(x.szi) || 0,
      entry: Number(x.entryPx) || 0, pnl: Number(x.unrealizedPnl) || 0,
    })).filter(x => x.size !== 0),
  };
}

/** Every perp mid price, keyless — useful whether or not anyone is signed in. */
export const hyperliquidMids = () => post(`${HL}/info`, { type: 'allMids' });

/* ---------- execution ----------
   One shape for every venue: something that describes the trade, and either a
   transaction the venue built or a URL that carries the wallet into it. */

/** Relays calldata the venue produced. Never calldata this file assembled. */
async function relay(tx, venue) {
  if (!tx?.to || !tx?.data) throw new Error(`${venue} did not return a transaction to send.`);
  return sendEvm({ to: tx.to, data: tx.data, value: tx.value || '0x0', chainId: tx.chainId });
}

/* Uniswap's Trading API returns a populated transaction for a quote. With a key
   this signs and sends that transaction; without one it is a link, as before. */
export async function uniswapSwap({ chainId, tokenIn, tokenOut, amount }) {
  const key = config.venues.uniswap?.apiKey;
  const from = state().evm;
  if (!key || !from) return { link: uniswapLink({ chainId, tokenIn, tokenOut }) };
  const quote = await json('https://trade-api.gateway.uniswap.org/v1/quote', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ type: 'EXACT_INPUT', tokenInChainId: chainId, tokenOutChainId: chainId,
      tokenIn, tokenOut, amount: String(amount), swapper: from }),
  });
  const built = await json('https://trade-api.gateway.uniswap.org/v1/swap', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ quote: quote.quote }),
  });
  return { hash: await relay({ ...built.swap, chainId }, 'Uniswap'), quote };
}

/* OpenSea's fulfilment endpoint returns the transaction for an order. Same
   shape: the marketplace builds it, the wallet signs it. */
export async function openseaBuy({ orderHash, chain = 'ethereum', protocolAddress }) {
  const key = config.venues.opensea?.apiKey;
  const from = state().evm;
  if (!key || !from || !orderHash) return { link: null };
  const built = await json('https://api.opensea.io/api/v2/listings/fulfillment_data', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ listing: { hash: orderHash, chain, protocol_address: protocolAddress },
      fulfiller: { address: from } }),
  });
  const tx = built?.fulfillment_data?.transaction;
  return { hash: await relay({ to: tx?.to, data: tx?.input_data, value: tx?.value }, 'OpenSea') };
}

/* ---------- hand-offs ----------
   The floor under everything above: a link that already knows the token, the
   pair and, where the venue accepts one, the wallet. */

const CHAIN_SLUG = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum', 10: 'optimism',
  137: 'polygon', 56: 'bnb', 43114: 'avalanche' };

export const uniswapLink = ({ chainId = 1, tokenIn = 'ETH', tokenOut }) =>
  `https://app.uniswap.org/swap?chain=${CHAIN_SLUG[chainId] || 'ethereum'}` +
  `&inputCurrency=${encodeURIComponent(tokenIn)}` +
  (tokenOut ? `&outputCurrency=${encodeURIComponent(tokenOut)}` : '');

export const jupiterLink = (mint, from = 'SOL') =>
  `https://jup.ag/swap/${encodeURIComponent(from)}-${encodeURIComponent(mint)}`;

export const openseaLink = (contract, chain = 'ethereum') =>
  `https://opensea.io/assets/${encodeURIComponent(chain)}/${encodeURIComponent(contract)}`;

export const hyperliquidLink = coin =>
  `https://app.hyperliquid.xyz/trade/${encodeURIComponent(String(coin || '').toUpperCase())}`;
