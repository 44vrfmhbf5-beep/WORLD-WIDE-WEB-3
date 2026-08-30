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

/* Obfuscation, not encryption — see the note on privyAppId below. */
const CLOAK = 'atlas-privy-v1';
const reveal = b64 => {
  try {
    const raw = atob(b64);
    let out = '';
    for (let i = 0; i < raw.length; i++)
      out += String.fromCharCode(raw.charCodeAt(i) ^ CLOAK.charCodeAt(i % CLOAK.length));
    return out;
  } catch { return ''; }
};

export const config = {
  /* Privy — wallet generation, login, and signing.
     https://dashboard.privy.io → App settings → App ID.

     This one is stored obfuscated rather than as plain text. Be clear about
     what that is and is not:

     It is NOT encryption. Anything this page can decode, a reader can decode —
     the key is three lines below, because the browser needs it. What it buys is
     that the id is not a greppable string in a public repository, so the
     automated scrapers that crawl GitHub for credentials do not find it. That
     is worth having and it is the whole of it.

     It could not be a secret in any case. Privy puts the app id in the URL of
     the wallet iframe, so it is visible in the network tab of every person who
     ever clicks Connect. **The thing that actually protects it is the allowed-
     origins list in the Privy dashboard**: an app id used from a domain you have
     not listed does not work, no matter who has it. Set that list to your
     domains and the id being public costs you nothing.

     To keep it out of the repository altogether, leave `privyAppId` empty and
     set `window.ATLAS_CONFIG = { privyAppId: '…' }` before app.js loads — from
     a deploy step, a server template, or a file you do not commit. */
  privyAppId: reveal('AhkYBhdEBhAFRkgeGgECGF0HGhwVGQdPHQ=='),

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

  /* An OpenAI-compatible chat endpoint, which is what every open-source runner
     speaks: Ollama (http://localhost:11434/v1), llama.cpp, LM Studio, vLLM, and
     the hosted gateways too. It reads a question like "cat meme coin on base up
     50% in 24h" into the same controls the local parser sets, so its answer is
     always visible in the UI and always undoable.

     Leave the endpoint empty and the local parser does the whole job — it needs
     no network, no key and no model, and it is what runs first either way. */
  ai: { endpoint: '', model: 'llama3.1', apiKey: '', timeout: 12000 },

  /* Solana RPC used to broadcast a signed swap. The public endpoint is heavily
     rate-limited — put your own (Helius, Triton, QuickNode) here for anything
     real. */
  solanaRpc: 'https://api.mainnet-beta.solana.com',
};

/* A deploy step, a server template or an uncommitted file can supply any of
   this without it ever entering the repository. Whatever is set here wins. */
if (typeof window !== 'undefined' && window.ATLAS_CONFIG)
  Object.assign(config, window.ATLAS_CONFIG);

/** True when the wallet layer has enough to start at all. */
export const walletReady = () => !!config.privyAppId;
