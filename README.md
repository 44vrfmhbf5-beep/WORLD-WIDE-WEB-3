# Atlas — search everything onchain

One search bar for every chain. Live assets and lending markets, indexed side by
side, with the cross-links between them: open an asset and see where to lend it,
open a market and see the collateral behind it.

Phantom-flavoured dark UI, Google-style omnibox, dApp-style detail sheets.

## Demo

**`demo.html` is the whole app in one file** — everything inlined except the
webfont, which falls back to system fonts if it can't load.

A `file://` document has an opaque origin, which has two consequences. Storage
access throws there, so anything reading `localStorage` at module scope kills
the app before it binds a listener — the static shell renders and nothing
responds. That is guarded now, and `test/e2e.mjs` holds a regression test that
makes the accessor throw.

The second consequence is not up to the page: the browser sends `Origin: null`
on every request, and whether CoinGecko and DeFiLlama accept that is their call.
If the app loads but says it can't reach a host, that is what happened — serve
it over http instead:

```
node serve.mjs        # zero dependencies, http://localhost:8080
```

Over http the origin is a normal one and the APIs behave predictably.

Rebuild it after changing any source file:

```
npm run build
```

The build parses the bundle it emits and refuses to write one that isn't valid
JavaScript.

## Hosted demo

A deploy workflow (`.github/workflows/pages.yml`) publishes the site to GitHub
Pages on every push to the default branch. It sits dormant — passing, deploying
nothing — until Pages is switched on once by hand in **Settings → Pages → Build
and deployment → Source: GitHub Actions**. A workflow token is not allowed to
create the Pages site itself, which is why that step stays manual.

The hosted build serves the multi-file app plus `demo.html`.

This repository is currently **private**, which matters for what happens next:

- **Make it public** → Pages works on any plan and the demo is a public URL.
- **Keep it private** → Pages needs GitHub Pro or Team, and the demo is only
  reachable by people with access to the repo.

Either way the URL will be
`https://44vrfmhbf5-beep.github.io/WORLD-WIDE-WEB-3/`, and the next push
deploys to it automatically.

## Run it locally

No build step, no dependencies. The app is ES modules, so it has to be served
over HTTP — `file://` cannot load them.

```
node serve.mjs               # http://localhost:8080
```

## Data

Live, keyless, straight from the browser — no backend, no wallet.

| Host | Used for | Endpoints |
| --- | --- | --- |
| `api.coingecko.com` | assets, logos, sparklines, price history | `/coins/markets`, `/coins/{id}/market_chart` |
| `api.coinpaprika.com` | assets and 24h/7d/30d/1y moves when CoinGecko refuses the origin | `/tickers` |
| `api.binance.com` | price history when neither of the above answers | `/klines` |
| `yields.llama.fi` | lending markets and yield farms, APY history | `/pools`, `/lendBorrow`, `/chart/{pool}` |
| `api.llama.fi` | protocols, TVL history, DEX / perps / options volume, fees and revenue, per-chain TVL and its history, funding rounds, exploits | `/protocols`, `/protocol/{slug}`, `/overview/{dexs,fees,derivatives,options}`, `/v2/chains`, `/v2/historicalChainTvl/{chain}`, `/raises`, `/hacks` |
| `stablecoins.llama.fi` | stablecoin supply, peg and mechanism, supply history | `/stablecoins`, `/stablecoincharts/all` |
| `bridges.llama.fi` | cross-chain bridge volume | `/bridges` |
| `api.dexscreener.com` | live DEX pair search — the long tail | `/latest/dex/search` |
| `nft.llama.fi` | NFT collections, floor price and floor history | `/collections`, `/chart/{collectionId}` |
| `api-mainnet.magiceden.dev` | Solana and Ordinals collections | `/v2/marketplace/popular_collections` |
| `api.geckoterminal.com` | trending pools, per-chain tokens, pair OHLCV, second DEX search | `/networks/trending_pools`, `/networks/{net}/pools`, `/networks/{net}/pools/{addr}/ohlcv/{tf}`, `/search/pools` |
| `tokens.uniswap.org` | which EVM tokens are real | the Uniswap Labs default token list |
| `lite-api.jup.ag` | which Solana tokens are real | `/tokens/v2/tag?query=verified` |
| `api.morpho.org` | isolated lending markets the aggregator only samples | `/graphql` |

Thirty-four endpoints across fourteen hosts, all keyless and CORS-open.

## A wallet, without becoming a wallet app

Atlas is a search engine that can hold a wallet, not a wallet that can search.
That ordering decides the architecture: **nothing about the wallet loads until
somebody asks for one.** The module, the 900KB Privy SDK behind it and the
iframe it needs are all fetched on the first click of *Connect*. A session that
only searches never fetches a byte of it, and there is a test that fails if it
ever does.

Put a Privy app id in `config.js` and this switches on:

| | |
| --- | --- |
| **Sign in** | Email code, Google, Apple, or an existing browser wallet over SIWE |
| **Generate a wallet** | Ethereum and Solana, created on first sign-in |
| **Fund it** | MoonPay, opened against *this* wallet — see below |
| **Sign** | Messages and EVM transactions, through the embedded wallet |
| **Buy an NFT** | Crossmint checkout, delivered to the wallet address |

With the file empty — which is how it ships — *Connect* says so plainly instead
of showing a form that cannot work, and everything else in Atlas is untouched.

### What a single-file build can and cannot carry

`demo.html` and the artifact are one file with no siblings, so a dynamic
`import('./x.js')` has nothing to fetch. Two of those modules had no reason to
be separate — `config.js` is a literal and the query reader only needs the chain
table — so the bundler inlines them and hands them to the app the same way it
hands it Fuse. **Until it did, natural-language search was silently dead in
every published build**, which is a worse bug than the error that led me to it.

The wallet genuinely cannot come along: 900KB of SDK, and an iframe served from
Privy's own origin that a page like this is not allowed to reach. So *Connect*
in a single-file build says exactly that and links to the source. Reporting a
failed module fetch as "could not reach Privy" sent people to check an app id
that was never the problem — a module that will not load and a host that will
not answer are different failures wearing the same browser wording.

### The app id, and what "hidden" can honestly mean

The Privy app id is stored obfuscated rather than as plain text, and it is worth
being exact about what that buys.

**It is not encryption.** Anything this page can decode, a reader can decode —
the key is three lines above it in `config.js`, because the browser needs it.
What it buys is that the id is not a greppable string in a public repository, so
the automated scrapers that crawl GitHub for credentials do not find it. That is
real and it is the whole of it.

**It could not be a secret in any case.** Privy puts the app id in the URL of the
wallet iframe, so it is in the network tab of every person who ever clicks
Connect. *The thing that actually protects it is the allowed-origins list in the
Privy dashboard* — an app id used from a domain you have not listed does not
work, no matter who holds it. Set that list to your domains and the id being
public costs you nothing.

**To keep it out of the repository entirely**, leave `privyAppId` empty and set
`window.ATLAS_CONFIG = { privyAppId: '…' }` before `app.js` loads, from a deploy
step or a file you do not commit. Whatever is set there wins.

### The keys are not in this page

Privy's embedded wallet keeps its key material in an iframe served from Privy's
own origin. This app hosts that iframe and relays `postMessage` in both
directions; it can ask the iframe to sign and it cannot read the key. The relay
is what the React SDK would otherwise do, and it is about fifteen lines in
`wallet.js` — the only reason `@privy-io/react-auth` is not here is that it is
6.5MB and brings React with it, against a 19KB dependency budget.

The SDK is **vendored, pinned and rebuilt deliberately** rather than imported
from a CDN. This is signing authority: a compromised CDN response would be too.

> The first build of that vendored bundle was unusable and looked fine. The
> entry re-exported a namespace, which makes the default export the namespace
> itself and every named import off it `undefined` — invisible until something
> constructs it. Nothing catches that but running it, so a test now does.

### MoonPay through the wallet, not past it

A `buy.moonpay.com?currencyCode=btc` link cannot say where the money goes. It
opens a generic buy page and the buyer supplies an address by hand.

Privy signs the widget URL server-side with the MoonPay key registered against
the app, so the widget opens already bound to the wallet Atlas just generated:
the destination is fixed before the page loads and cannot be changed in the
browser. No MoonPay key reaches this page, and no MoonPay *secret* exists in the
repo at all. `privy.funding.moonpay.getTransactionStatus` tracks it afterwards.

Crossmint is the same idea for NFTs: its hosted checkout takes `mintTo`, so a
card payment lands the NFT in the wallet rather than somewhere the buyer has to
go and find.

### Trading: the line, and why it is there

**Quoting is wired.** Jupiter's quote endpoint is keyless and CORS-open, so a
Solana pair's sheet shows a live route — *1 SOL → 41.2M CASHCAT, 0.31% price
impact, via Orca and Meteora* — before anyone commits to anything. Decimals come
from Jupiter's token lookup rather than being assumed, because a route shown
without them is a number wrong by orders of magnitude sitting next to a price.
Hyperliquid's `/info` is keyless too, so a connected wallet can read its own
positions.

**Broadcasting is relayed, never constructed.** Where a venue's API returns
ready-to-sign calldata — Uniswap's Trading API, OpenSea's fulfilment endpoint —
`trade.js` passes it to the wallet and does nothing else. The venue built the
transaction and stands behind it. Both need that venue's key and are off until
one is set.

**What this build will not do is assemble swap calldata itself, or sign an
exchange action it put together by hand.** Not because it is hard — because
nothing here has executed once. This sandbox cannot reach a chain, an RPC, a
Privy app or a live venue. Everywhere else in Atlas an untested assumption shows
an em dash; on that path it spends money. So the last step stays with the venue,
whose code *has* run, and Atlas carries the wallet and the trade into it.

That is also why Jupiter's swap is quoted but not broadcast here: signing its
transaction needs `@solana/web3.js`, whose dependency tree pulls the lazy bundle
past a megabyte, to send something this build has never once seen succeed.

### The hand-off links, still the floor

Under everything above sits the link that needed no wallet at all, and it is
still what a sheet offers when nothing is configured: **Jupiter** for a Solana
token, **Matcha** or **Uniswap** for an EVM one, **OpenSea** for a collection,
**Hyperliquid** for a perp, **MoonPay** for a listed asset. All public URLs,
no account, no SDK, no credential — carrying the token already resolved, which
is most of the value of having found it here.

**0x / Matcha's Swap API** needs an `0x-api-key` header, so quotes through it
are out; the token deep link does not, so that is what is used.

### More from the same bytes

The cheapest new data is the data already downloaded and thrown away. Two
responses were being read for a quarter of what they carry:

- The CoinGecko markets call already asks for 7d, 30d and 1y moves, and returns
  all-time high, circulating and max supply, and the 24h range beside them.
  Every one of those was dropped in the normaliser. Assets now show their week
  and month as columns, and their high, range and turnover in the sheet.
- The ~10MB yields payload carries `apyMean30d`, `apyPct30D`, DeFiLlama's own
  `predictions` outlook, `sigma`, `exposure` and an `outlier` flag. A headline
  APY says nothing about whether the rate will still be there tomorrow; the
  30-day mean and the outlook are what separate a real yield from a rate that
  spiked this morning. Both are columns now, and the outlier flag and a rate
  five times its own mean are two new junk signals.
- Protocol revenue, perps volume and options volume were already being fetched
  and merged, and never rendered.

No new requests, no new hosts.

### One index failing is not the feature being down

Two DEX indexes are queried precisely so that one of them can fail — and then
`DEX search unavailable — GeckoTerminal: could not reach…` was being shown while
the other index was answering perfectly well, describing a situation that was
not happening.

GeckoTerminal versions its public API through the `Accept` header and is
entitled to refuse a request that does not name a version; it also allows thirty
calls a minute, and Atlas queries it on trending, on every chain switch and on
search. Both are ordinary reasons for one index to say no. The header is now
sent, and the banner only appears when **nothing** answered — with a Retry on
it, since by then there is something to retry.

### No single source can empty the app

CoinGecko refuses some browser origins, which used to take the whole asset layer
down. Assets are now requested from CoinGecko and CoinPaprika together and the
first to answer wins. Charts try CoinGecko, then Binance klines, then the 7-day
sparkline, and finally draw a flat line at the current value labelled as having
no history — a chart never renders as an empty box.

### Inside a collection

A collection's floor is one number about hundreds of things, and it was the only
thing a collection sheet had. It now lists what is **actually for sale** — the
item, its price, its traits — because that is the question anyone opening one is
asking.

Magic Eden answers it without a key, so Solana collections list their real
listings. OpenSea's item endpoint needs one, so EVM collections list theirs only
where a key is configured, and say so plainly where it is not.

Fixing that surfaced a chart bug of the worst kind. `loadNftChart` was asking
DeFiLlama for a **Magic Eden symbol** — different id spaces, and the mismatch
does not fail loudly. It either returns nothing or, where the strings collide,
returns somebody else's history; and DeFiLlama's series is in dollars while a
Magic Eden row prices in SOL, so a wrong answer arrived wearing the right row's
unit: a 120 SOL floor under a **90,000 SOL** headline. A chart source has to
match the row's source.

`tools/audit-charts.mjs` now opens every chart at every range and checks the
things a chart gets wrong without throwing — a headline that disagrees with its
row, a series in one unit under a label in another, two axis ends printing the
same value, a NaN in the path.

### Tokenized stocks

Equities issued onchain — Backed's xStocks, Ondo, Dinari — as their own kind
with their own switch. They price like an asset and reuse that normaliser, but
they are not crypto, so they get their own category, their own columns, and a
row that says what it tracks: `TSLAx · tracks TSLA`.

Every issuer names its tokens differently, and only one convention was
recognised, so only one issuer's tokens appeared:

| Issuer | Looks like |
| --- | --- |
| Backed / Kraken | `TSLAx` — a trailing x |
| Dinari | `dTSLA` or `TSLA.d` |
| Robinhood, Coinbase, Swarm, Securitize | the plain ticker, named in the title |

Seven CoinGecko category slugs are merged and deduped; a slug that does not
exist returns nothing and costs nothing. **Which issuer** is now on the row, in
the sheet and in the About line, because a share tokenized by Robinhood and one
tokenized by Backed are different instruments with different redemption, and
calling both "tokenized" hides the only thing that separates them.

Casting wider for issuers also catches what those issuers tokenize that is *not*
a share. Ondo's name matches on every one of its products, and OUSG is
short-term treasuries — a fund, redeemed differently, and not a stock however it
is wrapped. Anything naming a treasury, bill, bond, gold, fund or note is
dropped, and a token whose name gives no equity signal at all never enters.

### Asking in a sentence

"cat meme coin on base up 50% or more in the past 24 hours" names four things
Atlas already has a control for: a category, a network, a threshold and a word.
Reading the sentence means **setting those controls**, visibly — the chips above
the results say what was understood, and *Undo* puts everything back. The answer
is never a hidden ranking.

A memecoin is a DEX pair, not a listed asset, and that one mapping is the
difference between an empty result and the right one.

The parser is local, needs no key and always runs first. An **OpenAI-compatible
endpoint** — which is what every open-source runner speaks: Ollama, llama.cpp,
LM Studio, vLLM — can be pointed at in `config.js`, runs after it, and may
disagree. Anything it returns that does not map onto a control that exists is
dropped. A search box that stops working when a third party is down is not a
search box.

**A short query is a name, not a sentence.** `bitcoin` is a thing to find, not a
request for the Bitcoin network with nothing to search for; `usd coin` is a
stablecoin, not a request for the Assets tab. So a reading only applies when the
sentence says something a search box cannot — a threshold, a network *with*
something to filter, or a category word that means exactly one thing. A bare
"coin" or "token" is what things are called.

### The contract, read before anyone trades on it

Liquidity, volume and a price are what a market looks like from outside. A
token can look perfectly healthy on every number Atlas shows and still be a
contract that will not let you sell. So where a row carries an address, the
address is read.

[GoPlus](https://gopluslabs.io) publishes exactly that, keyless and CORS-open,
under two endpoints with two different vocabularies — one for EVM chains, one
for Solana. Both are normalised into one list of flags, so the sheet renders
one thing and a new chain is a row in a table rather than a branch in the UI:

- **Reasons not to trade** — honeypot, blacklist, an owner who can change any
  holder's balance, a hidden or reclaimable owner, a contract that can delete
  itself, a token you cannot sell all of.
- **Reasons to look closer** — mintable supply, a whitelist, pausable
  transfers, a tax that can be raised after you buy, a trading cooldown, a max
  wallet, an upgradeable proxy, an unverified contract, a tax over 10%.
- **From the row itself, with no request** — liquidity under $25k, volume that
  looks like a bot, a ticker borrowed from a listed asset.

Both endpoints take a comma-separated list, which is the whole reason a warning
can sit on the *row*: a page of rows costs one request per chain rather than
one per row. A warning nobody sees until they open the sheet is a warning that
arrives after the decision.

Three things this is careful about:

- **A missing field is not a "no".** `is_mintable` absent means nobody checked,
  and an unchecked contract reads as *not checked*, never as clean. The summary
  line says which findings came from the contract and which from the row.
- **"Nothing flagged" is not "safe"**, and says so in those words.
- **"Unlisted" is not a warning.** Most of the DEX long tail is in no registry;
  a mark on every row teaches people to ignore the mark. It appears in the
  sheet, where somebody is already reading, and nowhere else.

The fixture carries a token — deep pool, heavy volume, dollar quote — whose
contract is a honeypot. Nothing in the price data can catch it, which is the
point of reading the contract at all.

### A trade, rather than a link to one

The sheet used to end in a row of links: *Trade on Uniswap ↗*. A link is the
app saying it knows what you want and cannot do it. Now the panel asks how
much, quotes it, and signs it with the Privy wallet in the header.

| Venue | How |
| --- | --- |
| **Uniswap v3** | No key and no gateway: `QuoterV2` prices the route over `eth_call`, the best of four fee tiers wins, and `SwapRouter02` executes it. Router and quoter addresses are per chain and checked for code before use. |
| **Matcha (0x)** | With a key, 0x routes across every DEX rather than Uniswap's own pools and returns a ready-to-sign transaction. Without one, Uniswap direct is the route — never a link. |
| **Jupiter** | Keyless end to end: Jupiter quotes it and serialises the transaction, and the wallet signs bytes it was handed rather than bytes this app assembled. |
| **OpenSea** | The best listing per token carries the price *and* the order hash, so the marketplace builds the fulfilment transaction and the wallet signs it. |
| **Crossmint** | A hosted card checkout that delivers to the wallet — the one place a link *is* the integration. |
| **Hyperliquid** | Mids and positions are read and shown on the asset sheet. Acting is not wired, and says so. |

Two rules hold for all of them: **nothing is sent that was not quoted first** —
a quote that fails is a route that does not exist — and **nothing is sent to an
address with no code at it**, with approvals for the exact amount of the trade
rather than unlimited.

An asset row carries a ticker and no address, because BTC is not a contract.
The token registries the app already loads for the duplicate rule carry both,
so a listed ticker resolves to the chain and address it trades at; a ticker no
registry names says so rather than offering a button that cannot work.

**What is not wired, and why.** Hyperliquid signs orders over a msgpack
encoding of the action. Hand-rolling msgpack and keccak in a file that has
never executed against the live venue would be the one bug in this codebase
that costs money rather than showing an em dash. So it reads Hyperliquid and
says plainly that it does not trade on it — which is worth more than a link
dressed as a feature.

### Asking CoinGecko directly

Atlas indexes the top few hundred assets. CoinGecko knows about seventeen
thousand and publishes an [MCP server](https://docs.coingecko.com/reference/mcp-server)
over them, which is a JSON-RPC endpoint with `initialize`, `tools/list` and
`tools/call`. `mcp.js` is a client for exactly that in about a hundred lines.

It is used in two places: a search that found little locally is joined by coins
CoinGecko knows, folded in beside the assets as ordinary rows that sort, filter,
open and star like anything else; and an asset sheet asks what else its page
says — which sectors it is counted in, how many watchlists it is on, when it
started.

Tool names are matched rather than hard-coded (whichever tool has "search" in
its name is the search tool), so the server renaming one costs nothing. It runs
*after* the local answer is already on screen and failing costs nothing, which
is the same rule the AI parser follows: a search box that stops working when
somebody else's server is down is not a search box. Whether a browser may call
it at all is a CORS decision on their side.

### Every control against every category

The filters were built one at a time, each correct on the tab it was written
for. `tools/audit-controls.mjs` asks whether they *compose* — it walks all
fourteen categories against the network chip, sorting, facets, paging and the
table/cards switch, and reports the combinations that do nothing or do the
wrong thing. Two real ones came out:

- **A network chip emptied Tokenized stocks.** CoinGecko's markets call returns
  no platform for an equity, so Atlas does not know which chain one is issued
  on. Filtering by chain anyway left the category blank, which reads as a broken
  tab. A kind that carries no network is now exempt from the chip, and the
  results line says `not network-specific` rather than showing nothing.
- **The view switch did nothing on an empty category.** The class was set after
  the empty-state returned, so toggling it on a category with no rows had no
  effect until you left it.

The audit also caught itself twice, which is the more useful lesson: it first
counted the rows *on screen*, which is one page of a category and says "40"
either way, hiding every filter that narrowed 1,224 to 300; and it tested
sorting by clicking the column a list was already sorted by, which is a no-op by
design. It now reads what matched, and compares the two sort directions against
each other.

### Junk is four things, and size is not one of them

Two things make a large onchain index unusable: rows that no longer trade, and
rows pretending to be something else. They share their tells, so they share one
rule — and the rule is not a toggle. Nobody opens a search engine wanting the
dead listings, and a switch that says "show me the junk" is a question with one
sensible answer, asked of every visitor forever. It is applied, always, and the
app does not report a tally of what it withheld.

What the rule hides is exactly four things:

| | Hidden because |
| --- | --- |
| **Duplicates** | The same ticker twice on one network is copies of one token. The deepest pool survives; anything an order of magnitude shallower does not — unless a registry names its contract, which settles it. |
| **Scams** | A ticker borrowed from a listed asset without the liquidity to be it. A four-figure APY on a small pool. A "stablecoin" trading at 40 cents. |
| **Nothing at all** | A zero where the activity goes: no volume *and* no price, no supply, no floor and no trades, a protocol with no TVL, no volume and no fees. |
| **Bots** | Volume many times the pool that produced it. A pool turning over forty times its own depth in a day is the same coins going round, and the price it prints is not one anybody paid. |

**Size was in that list and should not have been.** Every kind carried a floor —
$1M of market cap, $1M supplied, $5k of liquidity — and a floor is the app
deciding that somebody searching for a $220k market did not mean it. The floors
are gone from the rule *and* from ingest, where a second copy of the same
decision was quietly pre-empting the first. What is left of ingest is a cap on
how many rows are kept, which is a different thing: it never removes a row that
would otherwise have been the answer to a search.

Each kind says what trading means for it, as one more field on the same `KIND`
descriptor. All twelve now do, and the fixture carries a specimen that violates
each rule — a rule with nothing to catch cannot be seen working or seen
breaking. Before that, the rule demonstrably changed four categories out of
fourteen: six — protocols, stablecoins, bridges, funding rounds, exploits and
networks — had no rule at all, so nothing in them could be junk.

Four more had their rule pre-empted by an **ingest floor**, which decided the
same question twice: rows were dropped before anything could judge them. Ingest
now keeps only what protects the payload, and the visible boundary is the
rule's.

`window.__ATLAS_RAWCOUNTS__()` reports what each category holds before the rule
runs. With no toggle left to flip, comparing those two counts is how the tests
check the rule still reaches every kind.

| Kind | Kept when |
| --- | --- |
| Asset | it has 24h volume, a price, and at least $1M of market cap |
| Lending market | at least $1M supplied |
| Yield farm | at least $1M TVL, an APY above 0 but not above 1000%, not flagged an outlier by the source, and not paying more than 5× its own 30-day mean |
| NFT collection | it has volume or a floor |
| DEX pair | at least $1k of 24h volume, $5k of liquidity, **and a quote in something pegged to a dollar** |
| Protocol | $1M of TVL, or it earns volume or fees |
| Stablecoin | $1M in circulation, and still within a third of its peg |
| Network | it has TVL, or a protocol indexed on it |
| Funding round, exploit | an amount and a date |

**A price is only a price if the other side holds still.** `CAT/SOL` quotes a
memecoin in a memecoin: the number moves when either leg moves, and two such
pairs cannot be compared to each other at all. Only pairs quoted in a stablecoin
or a fiat currency are kept, so the price column means one thing. The peg list is
Atlas's own stablecoin index rather than a hand-kept constant — a new stablecoin
is recognised the day it is indexed — plus the fiat codes and the wrapped forms
of the same dollars, which no index returns.

This cuts hard: most long-tail liquidity is quoted in the chain's own token.
Turning the filter off shows all of it.

Two more rules apply only to the DEX long tail, which is where the fakes are.
A pair wearing a **listed ticker** it cannot back — under $250k of liquidity
while sharing a symbol with a top-100 asset — is an impersonator. And a ticker
repeated on one network is usually one token plus a stack of copies, so only
the deepest pool survives.

That last rule needed care. Two indexes carrying the *same real token* look
identical from here — DexScreener and GeckoTerminal both return CASHCAT on
Solana — so dropping every repeat would have deleted the federation's own
results. It only drops what is an order of magnitude shallower than the
deepest pool.

Protocols, chains, stablecoins, bridges, raises and exploits have no rule:
they come from curated sources that have already done this.

**It never filters silently.** The results line carries `N hidden`, and that
count is a button that turns the filter off. The choice is in the URL
(`?all=1`) and remembered per browser.

### Layout

Two references, and they want opposite things. DefiLlama makes a large index
navigable: a persistent category rail and dense sortable tables. Aave makes one
decision easy: generous rows, a primary number you can read across the room,
and very little else competing with it.

Both are on screen at once:

| | DefiLlama | Aave | Here |
| --- | --- | --- | --- |
| Navigation | category rail | a few big tabs | rail, every kind a destination with its row count |
| Landing | everything at once | one market | the categories themselves, with what each holds |
| Rows | dense sortable table | tall calm cards | table when browsing a category, cards when ranking a mix |

**All, with nothing typed, is the categories.** A ranked mix of twelve kinds is
what you get *after* asking something; before that it is a wall that answers a
question nobody put. The stat bar that used to sit under the search box is gone
for the same reason: four totals nobody came for, above the answer they did.

A grid of tiles is also a wall, just a shorter one. The categories are a column
of horizontal cards that cycles upward forever: the list is rendered twice and
the track travels exactly one copy, so the seam never lands on screen. It stops
the moment the pointer enters it — a target that moves out from under the
cursor is worse than no animation — the duplicate copy is hidden from assistive
tech and the tab order, and `prefers-reduced-motion` gets the plain list.

The rule for which shape you get needs no special cases: **a tab that pins one
kind gets columns, a ranked mix of kinds gets cards.** On All and Saved the
group heading is what separates an asset from a DEX pair of the same ticker,
and columns cannot say that. Inside a category the heading says nothing the tab
does not, so the columns earn the space — including under a search. Narrow
viewports get cards regardless; five numeric columns do not fit on a phone, and
the switch that offers them is not shown there — nor on the category home,
which is neither a table nor a list of cards.

Filter and sort stack, one strip per line, rather than sharing a row: they are
two different questions and reading them as one line asked people to parse
where one ended. On a phone each strip is a scroller pinned to a single line —
a wrapped filter row cost the first screen two rows of results.

Columns are four fields on the same `KIND` descriptor that already drives the
rows, headings and search scope, so a kind gets its table by describing it:

```js
cols: [['TVL', i => money(i.tvl), 'tvl'], ['1d', i => pct(i.chg1d), 'chg1d', 'sgn'], …]
//      heading  cell              sort key                                  colour by sign
```

The table is CSS grid over the same `.row` nodes the cards use, not `<table>`
markup — so the keyed reconciler, selection, starring and keyboard nav all work
in both views with no second code path.

### Charts

One component for every kind. The line animates in, the pointer reads out any
point, and the headline percentage is computed from the range on screen rather
than a fixed 24 hours — switch to 1Y and it reports the year.

**What it encodes.** Close price, its high/low envelope, and volume — on two
panels sharing one x-axis. Never one plot with two y-scales: that invents a
correlation the data does not have. The sources were already sending high, low
and volume in the same responses and we were keeping only the close, so this
cost no extra requests. Volume is summed into 64 buckets to draw; an hourly
month is 720 marks in 370 pixels, which reads as one solid block. The tooltip
still reads the full-resolution series.

**What it says without hovering.** The high and low of the range, both ends of
the time axis, and a hairline at the opening value so the move has something to
be measured against. Resolution follows the range — a bare clock time reads
identically at both ends of a 24-hour span, and month-and-day does the same
across a year.

**Reachable by keyboard.** The plot is focusable and arrow keys scrub it, with
the same readout hovering gives. Escape belongs to the sheet, not the chart.

### Every entity says what it is

Each row's sheet opens with an About line, composed from what the row already
carries — so it is always there and costs no request. Every kind names
something concrete rather than restating its own category:

> Supply USDC to Aave v3 on Ethereum and earn 2.50%, or post it as collateral
> and borrow at 1.10%, up to 87% of its value. $3.33B is supplied here, 20% of
> it lent out.

Where the thing behind the row publishes its own description, that is shown
**underneath** rather than replacing the line — for a market the two say
different things and both are worth having. Assets and equities come from
CoinGecko; protocols, and every pool and farm running on them, come from the
payload the TVL chart already fetches, so those are free. Source prose ships
with markup, which is stripped before it reaches the page.

### No chart is blank

Sources are tried in order of how much they know, and the last one is a search:

```
asset   CoinGecko /market_chart  ->  Binance klines  ->  the deepest DEX pool
                                     trading that ticker  ->  7d sparkline  ->  flat
pair    that pool's OHLCV        ->  the deepest pool for the ticker  ->  flat
nft     its floor history        ->  its reported 1d and 7d moves  ->  flat
```

The NFT floor endpoint answers for some collections and not others. When it
does not, the row still carries a 1d and a 7d change — three real observations,
which is a thin chart but an honest one, and the headline says where it came
from.

The pool search is the one that matters: a token on no price feed at all still
charts, because if anyone trades it there is a pool somewhere. The chart says
where the data came from (`via a DEX pool`) rather than passing it off as a
first-party price. Only when nothing trades does it fall back to a flat line,
and then it says so.

Which loader, which ranges and how a value reads back are four fields in the
`KIND` table, so every kind with a series over time has a chart: assets, DEX
pairs, lending markets, yield farms, protocols, NFT floors, stablecoin supply
and chain TVL. Funding rounds, exploits and bridges don't — they're events and
a daily total, not a series, and drawing one would be inventing it.

### 30 networks

Including Robinhood Chain, Berachain, Monad, Sonic, Blast, Scroll, Linea,
zkSync Era, Sei, Unichain, Ink, Abstract, Plume, Story, Mantle, TON, Tron and
Celo. Selecting a chain pulls that network's own traded tokens from
GeckoTerminal, so a chain is useful the day it launches rather than when an
aggregator gets round to it.

### Every kind is a destination

Stablecoins, bridges, funding rounds, exploits and networks used to be
reachable only by searching or by scrolling the All tab. Each is now a category
in the rail with its own columns and its own sort. One table maps a tab to a
kind and one maps a kind to its rows, so `everything()`, the rail, the counts
and the tab scopes cannot drift apart.

Fourteen destinations in one flat column is a list you read rather than scan, so
the rail groups them under **Markets**, **Earn**, **Onchain** and **Activity** —
four questions people actually arrive with. The grouping is one table; a kind
added to `KIND` but left out of a group would silently vanish from the rail, so
anything unplaced is collected into a **More** group rather than lost.

### A category is bigger than a screen

Browsing a category showed its top forty rows and offered no way past them.
Worse, the cut happened *before* the sort, so a column sort re-ranked the page
rather than the category: asking Lending for its highest supply APY answered
with the highest APY **among the forty largest markets** — 7.18%, when the
category held 11.46%. The cut is now the last thing that happens, the results
line says `40 of 1,224`, and the rest is one button away.

Counts are printed exactly rather than through the money formatter. `1K of 1K`
hid the difference between 1,029 and 1,224, which is the entire thing the
number was there to say.

### Logos, and the kinds that had one and were not using it

An asset drew its CoinGecko logo and everything else drew coloured initials —
including several kinds whose source already sends one, at no extra cost:

- **Protocols.** DeFiLlama returns `logo` with every protocol; it was being read
  and thrown away.
- **Lending markets and farms.** A market's tile stands for the protocol running
  it, and that protocol is already joined to the row.
- **DEX pairs.** DexScreener returns `info.imageUrl` with the pair. GeckoTerminal
  keeps the token beside the pool rather than inside it, so the request now says
  `include=base_token` — the same call, with the logo attached. Where the
  parameter is ignored the `included` array is simply absent and the tile falls
  back to initials.
- **Stablecoins.** A stablecoin is nearly always also a top-100 asset, whose logo
  is loaded already. No request at all.
- **Bridges, funding rounds and exploits.** DeFiLlama sends these no logo of
  their own, so three whole categories rendered as initials. Most of them *are*
  protocols it has an icon for, and the protocol index is already cached by the
  time they load — one lookup by slug, no request. A bridge additionally names
  its icon the way DeFiLlama writes it internally (`protocol:across`,
  `chain:ethereum`) rather than as a URL, so that shorthand is expanded.

A transparent logo used to sit on top of the initials it was meant to replace,
which read as a smudge. The tile drops its text the moment the image loads.

Every one of these is an upstream string reaching an `src`, so all of them go
through the same `safeUrl()` as the links do.

Networks keep their coloured dot on purpose: thirty chain icons at 20px are less
legible than thirty colours, and the dot doubles as the badge on every row that
belongs to one.

### A zero is not a gap

`num()` folds a missing field to `0`, which is right for a quantity — no volume
and zero volume are the same thing. It is wrong for a change. A token that moved
0.00% this week is not a token whose week is unknown, and both were rendering as
an em dash, claiming data was missing when it was not. Changes now carry `null`
for absent and `0` for flat, and read differently.

The same distinction fixed a borrow rate. It is reported net of borrow-side
incentives, so it can legitimately go negative — being paid to borrow is real.
But subtracting a reward from a *missing* base printed **"-0.90% borrow"** on a
market nobody can borrow from. A market with no borrow side now says so.

### One network under three names

DexScreener calls a chain `berachain`, GeckoTerminal calls it `berachain` but
calls Ethereum `eth`, and Atlas calls it `bera`. There were two separate tables:
the DEX one covered eleven chains and the GeckoTerminal one covered
twenty-eight, and neither was used by the other index. A pair on nineteen of the
thirty supported networks resolved to no chain at all — no network badge, and
invisible to every network filter.

One table now, keyed by the app's own id and carrying both aliases, so a chain
cannot be resolvable in one index and missing from the other. A pair on a chain
outside the set still keeps its own network name and stays in the index.

### Which token is the real one

Three rules used to guess: a ticker repeated on one network is probably copies,
a pair wearing a top-100 ticker without the liquidity to be it is an
impersonator, and anything with no volume is dead. Guesses are all they were.

Two registries answer it outright. The **Uniswap** token list is the curated EVM
set; **Jupiter** publishes a verified tag for Solana. Both are static, keyless
and CORS-open, and neither is required — where they do not answer, the
heuristics stand exactly as they did.

**Only the contract counts.** Matching on the ticker would have handed every
impersonator the reputation of the thing it imitates: a fake USDC on Ethereum
satisfies `USDC@eth` exactly as well as the real one. The ticker is consulted
only for rows that carry no address to check.

### Filters that ask a question

Sorting answers *which is biggest*. It does not answer *which of these can I
borrow against*, *which rates are holding*, or *which stablecoin has come off
its peg*. Each kind names three to five such questions on its own descriptor,
and they render as a row of chips above the results:

| Category | Asks |
| --- | --- |
| Assets | Gainers · Losers · Large cap · Heavily traded · Far off high |
| Lending | Borrowable · Stablecoin · $100M+ · High LTV · Room to borrow |
| Yield | Stablecoin · No IL risk · 10%+ APY · Rate not falling · $10M+ |
| Protocols | Earning fees · DEXs · Perps · $1B+ TVL · Growing |
| Stablecoins | On peg · Off peg · $1B+ |

Chips narrow **together** — a row has to answer every question that is on — and
each one carries the count it would leave, computed against the *other* active
chips, so a chip that would empty the screen is shown as unavailable rather than
as a trap. Filters live in the URL (`?f=stable,ten`), clear when you change
category, and an emptied list keeps the row on screen with a way back out.

### Twelve kinds, one index

Assets · tokenized stocks · lending markets · yield farms · protocols · NFT
collections · DEX pairs · stablecoins · bridges · funding rounds · exploits ·
networks.

NFT floors arrive in different units from different marketplaces — dollars from
the EVM marketplaces, SOL from Magic Eden — so each collection carries its own
unit and the two sources are ranked separately rather than compared against
each other. A floor is never relabelled as something it is not.

### The long tail is federated, not indexed

There are millions of DEX pairs and more every minute, so they are not
prefetched. Typing a query asks DexScreener directly and the answers are
appended under their own heading — the local index responds immediately and
never waits on that request. Searching `cashcat` finds a token no other source
here carries. GeckoTerminal's trending pools seed the same kind so it has
something to show before anyone types.

Trending on its own is whichever chain is loud today, which left quieter chains
absent from the category entirely. Seeding now also asks each of the six
busiest networks for *its* busiest pools — a different question with a different
answer — so every major chain is represented before a word is typed. Ten
requests, one lane, and the typed search still jumps ahead of all of them.

Results are filtered on the way in: pairs on unsupported chains and anything
under $5k liquidity are dropped, so the long tail does not drown the index.

Each is a row in one `KIND` table in `app.js` that drives its token, its
labels, its numbers, its group heading and its search scope. Adding a kind is a
table entry, not another branch through the renderer. The five simplest kinds
share one generic detail sheet described the same way.

Two of the nine cost no extra request: yield farms and lending markets come out
of the same `/pools` payload, split on whether a borrow side exists, and
stablecoins were already being fetched to price pegs.

### How they join up

The sources are one index, not four lists. A lending market carries the
protocol behind it (matched on DeFiLlama's project slug), a protocol carries the
chains it runs on, and every network knows its own assets, markets and
protocols. Searching a protocol name returns the protocol first and its markets
underneath; opening a market walks you to the protocol, its collateral asset, or
the rival markets for the same asset.

Assets and lending load first and render. Protocols, chain TVL and stablecoin
supply are larger and not needed for first paint, so they load behind that first
render and merge in when they arrive — a failure there is silent, because the
page is already useful.

Lending markets come from joining DeFiLlama's `pools` and `lendBorrow` feeds on
pool id, keeping only markets with a real borrow side and over $500k supplied.
Assets and markets are matched by ticker to produce the cross-links.

Responses are cached for 5 minutes in memory and, where they fit, in
`sessionStorage` — the pool payload alone is ~10MB and blows the storage quota,
so the memory tier is what actually holds it. A stale entry is served if a
refetch fails, so a rate limit degrades instead of blanking the page.

### Rate limits, and the one thing to watch

CoinGecko's keyless tier allows roughly 5–15 calls/minute, and Atlas can ask it
for the market list, several equity categories, a description and a price
history in the same second. Every request goes through a **per-host lane**: at
most one in flight, with a floor on the gap between them (1.2s for CoinGecko,
400ms for GeckoTerminal). That costs a few hundred milliseconds on a cold load
and removes the rate-limit failure entirely. Adding a demo key
(`x-cg-demo-api-key`) in `data.js` raises the ceiling substantially.

A lane is a queue, which is its own hazard: a person typing could end up tenth
in line behind an index warming itself up. So a lane has a front. A typed DEX
search and a picked chain pass `urgent: true` and go to the head of the queue;
background work waits. The live suite holds it to that — it aborts nothing,
simply counts how many requests were ahead of the search when its answer
arrived.

Per-chain token lists come from GeckoTerminal, whose network slugs are mapped
in `GT_NET` in `data.js`. If a chain chip comes up thin, that slug is the thing
to check — the whole mapping is one table, and a chain missing from it still
filters everything else correctly.

### URLs from upstream

A protocol's `url`, a raise's `source` and a hack's `source` are strings someone
else controls that end up in an `href`. Escaping stops attribute breakout but
not the scheme — `javascript:` still runs on click — so `safeUrl()` admits only
`http(s)` and otherwise falls back to the canonical DeFiLlama page. It's applied
both where the record is read and where the link is built.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Shell — header, hero, search bar, filters, results, detail sheet |
| `styles.css` | Design system, layout, motion, skeletons, responsive + reduced-motion |
| `data.js` | API clients, caching, retry/backoff, normalisation |
| `app.js` | Search index, renderers, detail sheets, keyboard nav, URL state |
| `vendor/fuse.mjs` | [Fuse.js](https://fusejs.io) 7.5.0, Apache-2.0 — fuzzy search |
| `config.js` | Every credential, empty by default. Publishable ids only |
| `nl.js` | Reads a question into the controls Atlas already has |
| `mcp.js` | CoinGecko's MCP server, in a hundred lines of JSON-RPC |
| `wallet.js` | Privy: sign in, generate, sign, fund. Loaded on demand |
| `trade.js` | Quotes and swaps: Uniswap v3 direct, 0x, Jupiter, OpenSea |
| `vendor/privy.mjs` | Privy JS SDK, pinned and bundled. Apache-2.0 |
| `test/` | Fixture server + end-to-end suite |
| `tools/` | Seven audits that print what renders, so it can be looked at |

Fuse.js is the only runtime dependency, vendored as a single 19KB ES module so
there is still nothing to install or build for the app itself. It gives typo
tolerance — `kamnio` finds Kamino — and its scores are re-ranked afterwards so
an exact ticker always wins. Two dev dependencies exist and never reach the
browser: Playwright, for the suites, and oxlint, which `npm run audit` runs over
every module.

## Interactions

- **`/` or `⌘K`** focus search · **`↑` `↓`** browse · **`↵`** open · **`esc`** back out
- **`[` `]`** walk the categories — unless you are typing, where a bracket is a bracket
- Multi-token search — `usdc lending` ranks USDC markets above the USDC asset
- Filter by category, by network, and by the chips each category defines
- Detail sheets cross-link both ways; charts are real history with working ranges
- A search across kinds says what it is made of, and one click narrows to any of them
- **Saved** stars anything to `localStorage`, survives a reload offline, and
  lists what you looked at most recently while it is empty
- Query, filters and the open sheet all live in the URL, so views are shareable
  and the browser back button does what you expect

## Performance note

The webfont is loaded non-blocking. A render-blocking stylesheet holds up script
execution, so an unreachable font host left the shell rendered and the app inert
— measured at 12,642ms to the first API call versus 68ms once the link no longer
blocks. `test/e2e.mjs` hangs the font host and asserts the app still boots.

## Tests

```
npm install     # playwright and oxlint, for the checks only
npm test        # the static audit, both builds, and every suite against all three
npm run audit   # just the static pass: imports, exports, bundle coverage, lint
```

Two suites, both offline:

**`test/e2e.mjs`** drives the UI against `test/serve.mjs`, which replays the
CoinGecko and DeFiLlama response shapes locally. It covers rendering, search
ranking, fuzzy matching, filters, sheet navigation and history, the watchlist,
row reuse under typing and arrow keys, keyboard access to the sheet controls,
and the degraded paths — one source down, both down, and HTTP 429.

**`test/live.mjs`** serves the app *unmodified*, so `data.js` keeps its
production URLs, and intercepts those exact URLs in the browser. It asserts the
real hosts, paths and query params — `/coins/markets` with its sparkline and
percentage params, `/coins/{id}/market_chart?days=N`, `/pools`, `/lendBorrow`,
`/chart/{poolId}`, and the per-chain `category=` slug — then feeds correctly
shaped payloads back and checks they render. It runs twice: once against the
source, once against the bundled `demo.html`.

Both suites run against the single-file builds too (`PAGE=demo.html`,
`PAGE=artifact.html`). Those builds differ in two ways the tests have to know
about: they inline `config.js` and `nl.js`, so a section that replaces one over
the wire is checking the served app rather than this one; and `artifact.html`
carries a sample dataset, so a source going down is a fallback there, not a
degraded state.

**`tools/`** is not a suite — it is seven scripts that print what actually
renders, because the bugs that survive longest are the ones nothing asserts.
`audit-code.mjs` is the one that never opens a browser: it reads the source and
asks whether every import resolves to an export, whether the bundler carries
every export the app lazily loads, and whether anything is exported that nothing
uses — then runs [oxlint](https://oxc.rs) over the lot. That last question is
the one that pays: it found `osImage`, a function written to fill missing NFT
images and never once called, and a whole Hyperliquid read layer wired to
nothing.
`audit-entities.mjs` walks every kind and dumps its columns, facets, headline,
stats and About line. `audit-filters.mjs` turns every chip on in turn and
reports how much it leaves, which is how five filters that could only ever match
everything were found. `audit-artifact.mjs` serves the built artifact with every
host blocked. `audit-charts.mjs` opens every chart at every range and holds each
headline to its row and each series to its unit. `audit-controls.mjs` walks every
control against every category and reports the combinations that do nothing.
`audit-images.mjs` counts, per category, how many rows carry the logo their
source sent and how many table cells are an em dash — which is how the kinds
discarding a logo, and a whole column of zeroes printed as missing data, were
found. What each one surfaced is now an assertion in the suites above —
including the one that holds every sheet's headline to the row it came from,
since the chart rewrites that headline with its own last point and a loader
keyed on the wrong entity would otherwise show one thing's price under another
thing's name without throwing.

It also asserts that a hostile token name from an API is rendered as text.
Onchain token names and symbols are attacker-controlled strings; every
interpolated value goes through `esc()` in `app.js`, and that fixture exists to
keep it that way.

## A caveat on verification

The sandbox this was built in cannot reach either API — an egress policy denies
`api.coingecko.com` and `yields.llama.fi` at the proxy — so no response here has
ever come from the real services.

What that does and does not leave unverified:

- **Verified.** The exact URLs the app requests, including query params, and
  that correctly shaped responses render. `test/live.mjs` intercepts the real
  production URLs rather than a rewritten base, so the request side is under
  test for real.
- **Not verified.** That the services still return those shapes. Field names and
  CoinGecko's category slugs come from the providers' public documentation. A
  renamed field or slug would surface on the first live run and nowhere else —
  which is why an empty chain tab names the slug it asked for, and why the
  borrow join accepts the fields from either `/pools` or `/lendBorrow`.
- **Least verified.** The three newest sources. The Uniswap token list follows
  the standard Token Lists schema and is the safest of them; Jupiter's verified
  tag and Morpho's GraphQL schema are written from their docs alone, and
  Jupiter has moved the field carrying the mint between versions — the loader
  accepts `id`, `address` or `mint` for that reason. All three are optional
  enrichment by construction: each is caught, each has a null result, and the
  app is the same app when none of them answers. Nothing about correctness rests
  on them being right, only coverage.

A recurring lesson, and the reason `tools/` exists: **a mock always answers.**
Every feature here has at some point passed its tests while doing nothing,
because the fixture agreed with the code instead of testing it. Fixtures now
carry deliberate junk, deliberate variation, and history that lands on the value
the row shows — the last of which is what makes a chart keyed on the wrong
entity fail rather than merely look volatile.

## Roadmap

Assets and lending first. The same index shape extends to airdrops, dApps,
protocols, and onchain businesses.
