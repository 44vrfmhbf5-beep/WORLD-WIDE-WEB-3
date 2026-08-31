/* wallet.js — Privy: log in, generate a wallet, sign with it, fund it.

   Loaded on demand and never before. Atlas is a search engine first; the whole
   of this file, and the 780KB SDK behind it, arrives only when someone asks for
   a wallet. Nothing here runs on first paint, and if it fails to load the app
   is exactly the app it was, with hand-off links instead of signing.

   The embedded wallet's keys live in an iframe Privy serves from its own
   origin, not in this page. That is the point of the design: this file can ask
   the iframe to sign and can read the result, and cannot read the key. The
   plumbing below is the message relay between the two, which the React SDK
   would otherwise do. */

import { config } from './config.js';

let client = null, ready = null, frame = null;

/* The SDK is imported dynamically, so a page that never asks for a wallet never
   pays for one. A single-file build has nothing to fetch, so it inlines the SDK
   and leaves it here instead — the wallet used to be the one thing a bundled
   build simply did not have, which made the published Atlas a search engine
   that could only hand you off somewhere else. */
const vendor = () => (typeof window !== 'undefined' && window.__ATLAS_VENDOR__)
  ? Promise.resolve(window.__ATLAS_VENDOR__) : import('./vendor/privy.mjs');

async function boot() {
  if (!config.privyAppId) throw new Error('No Privy app id configured — see config.js.');
  const { default: Privy, LocalStorage } = await vendor();
  const c = new Privy({ appId: config.privyAppId, storage: new LocalStorage() });

  /* Privy's key material lives in an iframe on Privy's origin. The SDK hands us
     a URL, we host it, and relay postMessage in both directions — the SDK never
     touches the DOM itself. */
  frame = document.createElement('iframe');
  frame.title = 'Privy secure wallet';
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden';
  frame.src = c.embeddedWallet.getURL();
  const origin = new URL(frame.src).origin;
  document.body.appendChild(frame);

  c.setMessagePoster({ postMessage: (d) => frame.contentWindow?.postMessage(d, origin) });
  addEventListener('message', e => {
    // only the frame we created, from the origin the SDK named
    if (e.source !== frame.contentWindow || e.origin !== origin) return;
    try { c.embeddedWallet.onMessage(e.data); } catch { /* not ours to parse */ }
  });

  /* An unreachable Privy leaves initialize() pending rather than rejecting, and
     a pending promise is a button that never comes back. Every entry point
     here waits on this one, so the deadline belongs here. */
  await Promise.race([
    c.initialize(),
    new Promise((_, no) => setTimeout(
      () => no(new Error('Privy did not respond. Check the app id in config.js, and that this domain is allowed in the Privy dashboard.')),
      BOOT_TIMEOUT)),
  ]);
  client = c;
  return c;
}

const BOOT_TIMEOUT = 20000;

/** One boot, shared by every caller, retried only after a failure. */
export function privy() {
  if (!ready) ready = boot().catch(e => {
    ready = null;
    // a half-built iframe from a failed boot must not linger into the retry
    frame?.remove(); frame = null;
    throw e;
  });
  return ready;
}

/* ---------- who is signed in ---------- */

const listeners = new Set();
export const onWallet = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const announce = () => { const s = state(); for (const fn of listeners) fn(s); };

let user = null;

/** The wallets on the current user, flattened to what the UI needs. */
export function state() {
  if (!user) return { signedIn: false, evm: null, sol: null, label: '' };
  const acct = t => (user.linked_accounts || []).find(a => a.type === t);
  const evm = acct('wallet');
  const sol = (user.linked_accounts || []).find(a => a.type === 'wallet' && a.chain_type === 'solana');
  const email = acct('email');
  return {
    signedIn: true,
    evm: evm && evm.chain_type !== 'solana' ? evm.address : null,
    sol: sol ? sol.address : null,
    label: email?.address || acct('phone')?.number || 'Signed in',
    embedded: !!(user.linked_accounts || []).some(a => a.wallet_client_type === 'privy'),
  };
}

const adopt = u => { user = u; announce(); return state(); };

/* ---------- getting in ---------- */

/** Email is the flow that needs no wallet to begin with, so it leads. */
export const sendEmailCode = async email => (await privy()).auth.email.sendCode(email);
export const loginWithEmailCode = async (email, code) =>
  adopt(await (await privy()).auth.email.loginWithCode(email, code));

/** Google, X, Apple and the rest, via a redirect back to this page. */
export async function loginWithOAuth(provider) {
  const c = await privy();
  const { url } = await c.auth.oauth.generateURL(provider, location.origin + location.pathname);
  location.href = url;
}

/** Finishes an OAuth redirect if this load is one. Safe to call every boot. */
export async function resumeOAuth() {
  const q = new URLSearchParams(location.search);
  const code = q.get('privy_oauth_code'), st = q.get('privy_oauth_state');
  if (!code || !st) return null;
  const c = await privy();
  const u = await c.auth.oauth.loginWithCode(code, st);
  // do not leave the one-time code in the address bar or in history
  ['privy_oauth_code', 'privy_oauth_state', 'privy_oauth_provider'].forEach(k => q.delete(k));
  history.replaceState(history.state, '', (q.toString() ? '?' + q : location.pathname) + location.hash);
  return adopt(u);
}

/* An external wallet signs a message to prove it holds the address — the
   same Sign-In With Ethereum flow every dapp uses, so MetaMask, Rabby and
   anything else injected connects without a per-wallet integration. */
export async function connectExternal() {
  const eth = window.ethereum;
  if (!eth) throw new Error('No browser wallet found. Install one, or sign in with email.');
  const c = await privy();
  const [address] = await eth.request({ method: 'eth_requestAccounts' });
  const { nonce } = await c.auth.siwe.init({ address });
  const message = c.auth.siwe.generateMessage
    ? c.auth.siwe.generateMessage({ address, nonce })
    : nonce;
  const signature = await eth.request({ method: 'personal_sign', params: [message, address] });
  return adopt(await c.auth.siwe.loginWithSiwe({ message, signature, chainId: 'eip155:1' }));
}

export async function logout() {
  if (client) await client.auth.logout().catch(() => {});
  user = null; announce();
}

/* ---------- the wallet itself ---------- */

/** Generates the embedded wallet, if this user has not got one yet. */
export async function createWallet() {
  const c = await privy();
  if (!state().embedded) user = await c.embeddedWallet.create({});
  // a Solana wallet is a separate account on the same user
  if (!state().sol) user = await c.embeddedWallet.createSolana().catch(() => user);
  announce();
  return state();
}

const evmAccount = () => (user?.linked_accounts || [])
  .find(a => a.type === 'wallet' && a.chain_type !== 'solana' && a.wallet_client_type === 'privy');
const solAccount = () => (user?.linked_accounts || [])
  .find(a => a.type === 'wallet' && a.chain_type === 'solana');

/** An EIP-1193 provider over the embedded wallet: eth_sendTransaction and friends. */
export async function evmProvider() {
  const c = await privy();
  const a = evmAccount();
  if (!a) throw new Error('No wallet yet.');
  return c.embeddedWallet.getEthereumProvider({ wallet: a });
}

export async function solProvider() {
  const c = await privy();
  const a = solAccount();
  if (!a) throw new Error('No Solana wallet yet.');
  return c.embeddedWallet.getSolanaProvider(a, a.id ?? a.address, async () => a.id ?? a.address);
}

/** Send one prepared EVM transaction. `tx` is {to, data, value, chainId}. */
export async function sendEvm(tx) {
  const p = await evmProvider();
  if (tx.chainId) await p.request({ method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x' + Number(tx.chainId).toString(16) }] }).catch(() => {});
  return p.request({ method: 'eth_sendTransaction', params: [tx] });
}

/* A read of the chain, through the same provider that would send to it. Using
   the wallet's own RPC rather than a public one means a quote is priced by the
   node that will see the transaction. */
export async function callEvm({ to, data, chainId }) {
  const p = await evmProvider();
  if (chainId) await p.request({ method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x' + Number(chainId).toString(16) }] }).catch(() => {});
  return p.request({ method: 'eth_call', params: [{ to, data }, 'latest'] });
}

/** Is there a contract at this address at all? A swap is not sent into a gap. */
export async function codeAt(address, chainId) {
  const p = await evmProvider();
  if (chainId) await p.request({ method: 'wallet_switchEthereumChain',
    params: [{ chainId: '0x' + Number(chainId).toString(16) }] }).catch(() => {});
  const code = await p.request({ method: 'eth_getCode', params: [address, 'latest'] });
  return typeof code === 'string' && code.length > 4;
}

/* Solana's side of the same idea: the venue builds and serialises the
   transaction, the wallet signs and broadcasts it. Privy's provider takes the
   serialised bytes, so nothing here has to construct a transaction. */
export async function sendSolana(base64Tx) {
  const p = await solProvider();
  const r = await p.request({ method: 'signAndSendTransaction',
    params: { transaction: base64Tx, encoding: 'base64' } });
  return r?.signature || r;
}

/* ---------- money in ---------- */

/* Privy signs the MoonPay URL server-side with the MoonPay key registered
   against the app, so the widget opens already bound to this wallet and no
   MoonPay secret is ever in this page. That signature is the whole difference
   between this and the link it replaces: a link cannot say where the money
   goes, and this cannot say anywhere else. */
export async function fundWithMoonpay({ address, chainId = 1, amount, currencyCode } = {}) {
  if (!config.moonpay?.enabled) throw new Error('MoonPay is off in config.js.');
  const c = await privy();
  const to = address || state().evm;
  if (!to) throw new Error('No wallet to fund.');
  const { url } = await c.funding.moonpay.sign({
    address: to,
    chain: chainId,
    quoteCurrencyCode: currencyCode,
    baseCurrencyAmount: amount,
    useSandbox: !!config.moonpay.sandbox,
  });
  return url;
}

/* Crossmint sells an NFT for a card payment and delivers it to an address, so
   the buyer needs no chain, no gas and no bridge. Its hosted checkout takes the
   recipient as a parameter, which is where the wallet comes in — the NFT lands
   in the wallet Atlas just generated rather than somewhere the buyer has to go
   and find. */
export function crossmintCheckout({ collectionId, recipient, quantity = 1 } = {}) {
  const { clientId, collectionId: fallback, environment } = config.crossmint || {};
  const id = collectionId || fallback;
  if (!clientId || !id) return null;
  const host = environment === 'staging'
    ? 'https://staging.crossmint.com' : 'https://www.crossmint.com';
  const to = recipient || state().evm;
  const p = new URLSearchParams({ clientId, collectionId: id, quantity: String(quantity) });
  if (to) p.set('mintTo', to);
  return `${host}/checkout?${p}`;
}
