/* config.js — the credentials Atlas needs to do more than read.

   Searching, charting and every link out of a sheet work with this file empty:
   that is the whole app as it was, and it stays keyless. What needs a key is
   holding a wallet and acting through one, because every provider below issues
   per-app credentials and none of them can be shared.

   Nothing here is a secret. These are all publishable, browser-side
   identifiers, scoped by the provider to the domains you list in their
   dashboard — that domain allowlist is what protects them, not obscurity. Never
   put a MoonPay *secret* key, an OpenSea secret, or a Crossmint server key in
   this file: they belong on a server you control, and a browser has no way to
   keep one.

   Every feature checks its own key and falls back to the link it used before,
   so a half-filled file degrades one feature at a time rather than breaking. */

export const config = {
  /* Privy — wallet generation, login, and signing.
     https://dashboard.privy.io → App settings → App ID (looks like clxxxx…).
     Add your domain under "Allowed origins" or the embedded wallet iframe is
     refused. Everything else in this file is optional; without this one there
     is no wallet and the hand-off links are all that is offered. */
  privyAppId: '',

  /* Which chains the embedded wallet may transact on. Ethereum and Base by
     default; the Solana wallet is created alongside and is not listed here. */
  chains: [1, 8453, 42161, 10],

  /* MoonPay — fiat on-ramp *into the wallet*, not a generic buy page.
     Privy signs the widget URL with the MoonPay key you register in the Privy
     dashboard (Funding → MoonPay), so no MoonPay key is needed here and no
     secret ever reaches the browser. Set this false to keep the deep link. */
  moonpay: { enabled: true, sandbox: false },

  /* Crossmint — buy an NFT with a card, delivered to the wallet.
     https://www.crossmint.com/console → API keys → client key (ck_…), and the
     collection id you are selling. Without both, an NFT sheet links to its
     marketplace as before. */
  crossmint: { clientId: '', collectionId: '', environment: 'production' },

  /* Trading venues. Jupiter needs no key and is wired end to end. The others
     quote through APIs that require one; without it each is a hand-off link,
     which is what they were. */
  venues: {
    jupiter: { enabled: true, slippageBps: 50 },
    // https://cloud.uniswap.org — Trading API key. Returns ready-to-sign
    // calldata, which is the only responsible way to build a swap here.
    uniswap: { apiKey: '' },
    // https://docs.opensea.io/reference/api-keys
    opensea: { apiKey: '' },
    // Hyperliquid needs no key to *read*. Placing an order is off by default:
    // it is an EIP-712 action this build cannot test against a live exchange.
    hyperliquid: { read: true, trade: false },
  },

  /* Solana RPC used to broadcast a signed swap. The public endpoint is heavily
     rate-limited — put your own (Helius, Triton, QuickNode) here for anything
     real. */
  solanaRpc: 'https://api.mainnet-beta.solana.com',
};

/** True when the wallet layer has enough to start at all. */
export const walletReady = () => !!config.privyAppId;
