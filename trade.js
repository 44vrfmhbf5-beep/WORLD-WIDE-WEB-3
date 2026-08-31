/* trade.js — the venue's API, the user's wallet, and nothing in between.

   Atlas used to hand off: a link to Uniswap, a link to Matcha, a link to
   Hyperliquid, with the token pre-filled. That is a search engine admitting it
   cannot do the thing it just described. This file does the thing.

   The shape is the same for every venue. A quote is a read, so it is fetched
   and shown before anyone commits. The transaction is built by whoever knows
   how — the venue's own API, or the on-chain router itself — and signed by the
   Privy wallet the app already holds. Two rules hold everywhere:

     1. Nothing is sent that was not quoted first. A quote that fails is a
        route that does not exist, and a route that does not exist is not
        something to send money into.
     2. Nothing is sent to an address with no code at it, and approvals are for
        the exact amount of the trade rather than unlimited.

   What is still not here is acting on Hyperliquid. Its exchange endpoint signs
   over a msgpack encoding of the action, and hand-rolling that encoding plus
   keccak in a file that has never executed against the live venue would be the
   one bug in this codebase that costs money rather than showing an em dash.
   Mids and positions are read and shown; the rest says so plainly instead of
   pretending, and does not become a link to somewhere that can. */

import { config } from './config.js';
import { state, sendEvm, callEvm, codeAt, sendSolana } from './wallet.js';

const JUP = 'https://lite-api.jup.ag';
const HL = 'https://api.hyperliquid.xyz';
const ZEROEX = 'https://api.0x.org';

const json = async (url, init) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), ...init });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`${new URL(url).host} returned HTTP ${r.status}${
      body ? ` — ${body.slice(0, 140)}` : ''}`);
  }
  return r.json();
};
const post = (url, body, headers) => json(url, { method: 'POST',
  headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

/* ---------- a very small ABI codec ----------
   Four selectors and two argument types is the whole surface this file needs.
   The selectors are constants rather than something computed: there is no
   keccak in this build, and a wrong one reverts the call rather than sending
   anything anywhere. */
const SEL = {
  approve: '095ea7b3',                 // approve(address,uint256)
  allowance: 'dd62ed3e',               // allowance(address,address)
  balanceOf: '70a08231',               // balanceOf(address)
  decimals: '313ce567',                // decimals()
  quoteExactInputSingle: 'c6a5026a',   // QuoterV2, struct arg
  exactInputSingle: '04e45aaf',        // SwapRouter02, struct arg, no deadline
};
const word = v => BigInt(v).toString(16).padStart(64, '0');
const addrWord = a => String(a).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const enc = (sel, ...words) => '0x' + sel + words.join('');
const readUint = (hex, slot = 0) =>
  BigInt('0x' + String(hex || '0x').replace(/^0x/, '').slice(slot * 64, slot * 64 + 64) || '0');

/* ---------- Uniswap v3, on chain ----------
   No key, no gateway: the Quoter prices the route and the Router executes it.
   Deployment addresses are per chain and are checked for code before use — an
   address with nothing at it is a typo, and a typo here is somebody's money. */
const UNI_ROUTER = {
  1: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', 10: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  42161: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45', 137: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
  8453: '0x2626664c2603336E57B271c5C0b26F421741e481', 56: '0xB971eF87ede563556b2ED4b1C0b0019111Dd85d2',
};
const UNI_QUOTER = {
  1: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', 10: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', 137: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e',
  8453: '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', 56: '0x78D78E420Da98ad378D7799bE8f4AF69033EB077',
};
// the dollar leg of every quote, per chain
export const USD = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', 8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', 10: '0x0b2c639c533813f4aa9d7837caf62653d097ff85',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', 56: '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d',
};
const FEES = [500, 3000, 10000, 100];    // the tiers worth trying, busiest first

/** The best of Uniswap's fee tiers for this pair, priced by the chain itself. */
export async function uniswapQuote({ chainId, tokenIn, tokenOut, amount }) {
  const quoter = UNI_QUOTER[chainId];
  if (!quoter) throw new Error(`Uniswap v3 is not deployed on chain ${chainId} in this build.`);
  if (!await codeAt(quoter, chainId)) throw new Error('No Uniswap quoter at the expected address on this chain.');
  let best = null;
  for (const fee of FEES) {
    // quoteExactInputSingle((tokenIn,tokenOut,amountIn,fee,sqrtPriceLimitX96))
    const data = enc(SEL.quoteExactInputSingle, addrWord(tokenIn), addrWord(tokenOut),
      word(amount), word(fee), word(0));
    const r = await callEvm({ to: quoter, data, chainId }).catch(() => null);
    const out = r ? readUint(r, 0) : 0n;
    if (out > (best?.out ?? 0n)) best = { out, fee };
  }
  if (!best || best.out === 0n) throw new Error('No Uniswap route for this pair.');
  return { out: best.out, fee: best.fee, venue: 'Uniswap v3' };
}

/** Quote, approve exactly what is being spent, then swap. Every step is real. */
export async function uniswapSwap({ chainId, tokenIn, tokenOut, amount, slippageBps = 100 }) {
  const from = state().evm;
  if (!from) throw new Error('Connect a wallet first.');
  const router = UNI_ROUTER[chainId];
  if (!router) throw new Error(`Uniswap v3 is not deployed on chain ${chainId} in this build.`);
  if (!await codeAt(router, chainId)) throw new Error('No Uniswap router at the expected address on this chain.');

  const q = await uniswapQuote({ chainId, tokenIn, tokenOut, amount });
  const minOut = q.out - (q.out * BigInt(slippageBps)) / 10000n;

  // spend exactly what this trade spends, never an unlimited allowance
  const allow = readUint(await callEvm({ to: tokenIn, chainId,
    data: enc(SEL.allowance, addrWord(from), addrWord(router)) }).catch(() => '0x0'));
  if (allow < BigInt(amount))
    await sendEvm({ to: tokenIn, chainId, value: '0x0',
      data: enc(SEL.approve, addrWord(router), word(amount)) });

  // exactInputSingle((tokenIn,tokenOut,fee,recipient,amountIn,amountOutMinimum,sqrtPriceLimitX96))
  const data = enc(SEL.exactInputSingle, addrWord(tokenIn), addrWord(tokenOut), word(q.fee),
    addrWord(from), word(amount), word(minOut), word(0));
  const hash = await sendEvm({ to: router, data, value: '0x0', chainId });
  return { hash, quote: q, minOut, venue: 'Uniswap v3' };
}

/* ---------- Matcha (0x) ----------
   0x builds the transaction, including whatever allowance dance the token
   needs, and returns it ready to sign. Its v2 API is key-gated, so this path
   is off until one is set — and says so rather than falling back to a link. */
export const matchaReady = () => !!config.venues?.zeroex?.apiKey;
const zxHeaders = () => ({ '0x-api-key': config.venues.zeroex.apiKey, '0x-version': 'v2' });

export async function matchaQuote({ chainId, tokenIn, tokenOut, amount }) {
  if (!matchaReady()) throw new Error('Matcha needs a 0x API key in config.js.');
  const taker = state().evm;
  if (!taker) throw new Error('Connect a wallet first.');
  const p = new URLSearchParams({ chainId: String(chainId), sellToken: tokenIn,
    buyToken: tokenOut, sellAmount: String(amount), taker });
  const q = await json(`${ZEROEX}/swap/allowance-holder/quote?${p}`, { headers: zxHeaders() });
  return { out: BigInt(q.buyAmount || 0), minOut: BigInt(q.minBuyAmount || 0),
    tx: q.transaction, issues: q.issues, venue: 'Matcha', raw: q };
}

export async function matchaSwap(args) {
  const q = await matchaQuote(args);
  if (!q.tx?.to || !q.tx?.data) throw new Error('Matcha returned no transaction to send.');
  const hash = await sendEvm({ to: q.tx.to, data: q.tx.data,
    value: q.tx.value ? '0x' + BigInt(q.tx.value).toString(16) : '0x0', chainId: args.chainId });
  return { hash, quote: q, minOut: q.minOut, venue: 'Matcha' };
}

/* ---------- Jupiter ----------
   Keyless the whole way: the quote and the serialised transaction both come
   from Jupiter, and the wallet signs bytes it was handed rather than bytes
   this file assembled. */
export const USDC_SOL = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const WSOL = 'So11111111111111111111111111111111111111112';

const decimals = new Map([[WSOL, 9], [USDC_SOL, 6]]);
export async function tokenDecimals(mint) {
  if (decimals.has(mint)) return decimals.get(mint);
  const r = await json(`${JUP}/tokens/v2/search?query=${encodeURIComponent(mint)}`).catch(() => null);
  const hit = (Array.isArray(r) ? r : r?.tokens || []).find(t => (t.id || t.address) === mint);
  const d = Number.isFinite(hit?.decimals) ? hit.decimals : null;
  if (d != null) decimals.set(mint, d);
  return d;
}

export async function jupiterQuote({ inputMint, outputMint, amount, slippageBps }) {
  const p = new URLSearchParams({
    inputMint, outputMint, amount: String(Math.round(amount)),
    slippageBps: String(slippageBps ?? config.venues.jupiter.slippageBps ?? 50),
  });
  const q = await json(`${JUP}/swap/v1/quote?${p}`);
  const hops = (q.routePlan || []).map(r => r.swapInfo?.label).filter(Boolean);
  return { in: Number(q.inAmount), out: Number(q.outAmount),
    impact: Number(q.priceImpactPct) * 100, minOut: Number(q.otherAmountThreshold),
    via: hops, raw: q, venue: 'Jupiter' };
}

export async function jupiterSwap(args) {
  const from = state().sol;
  if (!from) throw new Error('Connect a Solana wallet first.');
  const q = args.quote || await jupiterQuote(args);
  const built = await post(`${JUP}/swap/v1/swap`, {
    quoteResponse: q.raw, userPublicKey: from, dynamicComputeUnitLimit: true,
  });
  if (!built?.swapTransaction) throw new Error('Jupiter returned no transaction to sign.');
  return { hash: await sendSolana(built.swapTransaction), quote: q, venue: 'Jupiter' };
}

/* ---------- Hyperliquid ----------
   Reads are keyless and complete. Actions a plain EIP-712 signature covers —
   moving USDC between the perp and spot balances, sending it out — go through
   the wallet directly. Order placement does not, and the reason is in the
   header of this file. */
export async function hyperliquidState(address) {
  if (!config.venues.hyperliquid?.read) return null;
  const a = address || state().evm;
  if (!a) return null;
  const s = await post(`${HL}/info`, { type: 'clearinghouseState', user: a });
  const pos = (s?.assetPositions || []).map(x => x.position).filter(Boolean);
  return {
    value: Number(s?.marginSummary?.accountValue) || 0,
    withdrawable: Number(s?.withdrawable) || 0,
    positions: pos.map(x => ({ coin: x.coin, size: Number(x.szi) || 0,
      entry: Number(x.entryPx) || 0, pnl: Number(x.unrealizedPnl) || 0 })).filter(x => x.size !== 0),
  };
}
export const hyperliquidMids = () => post(`${HL}/info`, { type: 'allMids' });
/* Acting on Hyperliquid is the one thing here that is not wired, and the
   reason is the same for an order as for a withdrawal: its exchange endpoint
   signs over a msgpack encoding of the action, and this build carries no
   msgpack and no keccak. Reads are complete; the rest says so. */
export const hyperliquidOrderSupported = () => false;
export const hyperliquidWhy = 'Placing an order signs over a msgpack encoding of the action, '
  + 'which this build does not carry — so it reads Hyperliquid rather than pretending to trade on it.';

/* ---------- OpenSea ----------
   The marketplace builds the fulfilment transaction; the wallet signs it. */
export async function openseaBuy({ orderHash, chain = 'ethereum', protocolAddress }) {
  const key = config.venues.opensea?.apiKey;
  const from = state().evm;
  if (!key) throw new Error('Buying on OpenSea needs an OpenSea API key in config.js.');
  if (!from) throw new Error('Connect a wallet first.');
  if (!orderHash) throw new Error('No listing to fulfil.');
  const built = await post('https://api.opensea.io/api/v2/listings/fulfillment_data',
    { listing: { hash: orderHash, chain, protocol_address: protocolAddress },
      fulfiller: { address: from } }, { 'x-api-key': key });
  const tx = built?.fulfillment_data?.transaction;
  if (!tx?.to) throw new Error('OpenSea returned no transaction to send.');
  return { hash: await sendEvm({ to: tx.to, data: tx.input_data, value: tx.value }), venue: 'OpenSea' };
}

/* ---------- one door ----------
   The sheet asks for a quote, then asks to execute it, and does not care which
   venue answered. Solana goes to Jupiter, EVM goes to Matcha when a key is set
   and to Uniswap otherwise — both of which end at the same wallet. */
export async function quote({ chain, chainId, tokenIn, tokenOut, amount }) {
  if (chain === 'sol') return jupiterQuote({ inputMint: tokenIn, outputMint: tokenOut, amount });
  if (matchaReady()) return matchaQuote({ chainId, tokenIn, tokenOut, amount });
  return uniswapQuote({ chainId, tokenIn, tokenOut, amount });
}
export async function swap({ chain, chainId, tokenIn, tokenOut, amount, quote: q }) {
  if (chain === 'sol') return jupiterSwap({ inputMint: tokenIn, outputMint: tokenOut, amount, quote: q });
  if (matchaReady()) return matchaSwap({ chainId, tokenIn, tokenOut, amount });
  return uniswapSwap({ chainId, tokenIn, tokenOut, amount });
}
