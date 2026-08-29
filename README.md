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

Thirty endpoints across eleven hosts, all keyless and CORS-open.

### No single source can empty the app

CoinGecko refuses some browser origins, which used to take the whole asset layer
down. Assets are now requested from CoinGecko and CoinPaprika together and the
first to answer wins. Charts try CoinGecko, then Binance klines, then the 7-day
sparkline, and finally draw a flat line at the current value labelled as having
no history — a chart never renders as an empty box.

### One filter

A single toggle, on by default, for the two things that make a large onchain
index unusable: rows that no longer trade, and rows pretending to be something
else. They share their tells, so they share a control.

Each kind says what trading means for it, as one more field on the same `KIND`
descriptor:

| Kind | Kept when |
| --- | --- |
| Asset | it has 24h volume |
| Lending market | at least $1M supplied |
| Yield farm | at least $1M TVL, and an APY above 0 but not above 1000% |
| NFT collection | it has volume or a floor |
| DEX pair | at least $1k of 24h volume and $5k of liquidity |

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
navigable: a persistent category rail, aggregate totals across the top, and
dense sortable tables. Aave makes one decision easy: generous rows, a primary
number you can read across the room, and very little else competing with it.

Both are on screen at once, and one control slides between them:

| | DefiLlama | Aave | Here |
| --- | --- | --- | --- |
| Navigation | category rail | a few big tabs | rail, every kind a destination with its row count |
| Totals | aggregate header | per-market cards | aggregate bar, summed from data already loaded |
| Rows | dense sortable table | tall calm cards | table when browsing a category, cards when ranking a mix |
| Density | compact | comfortable | a toggle, remembered per browser |

The rule for which shape you get needs no special cases: **a tab that pins one
kind gets columns, a ranked mix of kinds gets cards.** On All and Saved the
group heading is what separates an asset from a DEX pair of the same ticker,
and columns cannot say that. Inside a category the heading says nothing the tab
does not, so the columns earn the space — including under a search. Narrow
viewports get cards regardless; five numeric columns do not fit on a phone.

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

### Eleven kinds, one index

Assets · lending markets · yield farms · protocols · NFT collections · DEX
pairs · stablecoins · bridges · funding rounds · exploits · networks.

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

CoinGecko's keyless tier allows roughly 5–15 calls/minute. Normal browsing stays
well inside that; hammering the chain chips will trip it, which surfaces as a
"rate limited" notice rather than an error. Adding a demo key (`x-cg-demo-api-key`)
in `data.js` raises it substantially.

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
| `test/` | Fixture server + end-to-end suite |

Fuse.js is the only dependency, vendored as a single 19KB ES module so there is
still nothing to install or build. It gives typo tolerance — `kamnio` finds
Kamino — and its scores are re-ranked afterwards so an exact ticker always wins.

## Interactions

- **`/` or `⌘K`** focus search · **`↑` `↓`** browse · **`↵`** open · **`esc`** back out
- Multi-token search — `usdc lending` ranks USDC markets above the USDC asset
- Filter by type (All / Assets / Lending / Saved) and by network
- Detail sheets cross-link both ways; charts are real history with working ranges
- **Saved** stars anything to `localStorage`, and survives a reload offline
- Query, filters and the open sheet all live in the URL, so views are shareable
  and the browser back button does what you expect

## Performance note

The webfont is loaded non-blocking. A render-blocking stylesheet holds up script
execution, so an unreachable font host left the shell rendered and the app inert
— measured at 12,642ms to the first API call versus 68ms once the link no longer
blocks. `test/e2e.mjs` hangs the font host and asserts the app still boots.

## Tests

```
npm install     # playwright, for the test run only
npm test
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

## Roadmap

Assets and lending first. The same index shape extends to airdrops, dApps,
protocols, and onchain businesses.
