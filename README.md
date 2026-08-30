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

### Where the venues are, and where they are not

Atlas indexes and explains. It holds no key, no wallet and no quote, and it is
not going to start. What it can do is hand you off with the token already
resolved, which is most of the value of having found it here — so a sheet
carries the venue that can act on it: **Jupiter** for a Solana token,
**Matcha** for an EVM one, **MoonPay** for a listed asset. All three are public
URLs with no account, no SDK and no embedded credential.

Two more were asked for and are not wired, for the same reason each way:

- **Privy** is wallet authentication. It needs an app id and a signed-in user,
  and this app is deliberately wallet-free — there is nothing here to log into.
- **Crossmint** checkout needs a collection id issued from their console. There
  is no way to derive one from a floor price, so a "buy this NFT" button would
  be a link to an error page.

**0x / Matcha's Swap API** needs an `0x-api-key` header, so quotes are out; the
token deep link does not, so that is what is used.

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

### No single source can empty the app

CoinGecko refuses some browser origins, which used to take the whole asset layer
down. Assets are now requested from CoinGecko and CoinPaprika together and the
first to answer wins. Charts try CoinGecko, then Binance klines, then the 7-day
sparkline, and finally draw a flat line at the current value labelled as having
no history — a chart never renders as an empty box.

### Tokenized stocks

Equities issued onchain — Backed's xStocks, Ondo, Dinari — as their own kind
with their own switch. They price like an asset and reuse that normaliser, but
they are not crypto, so they get their own category, their own columns, and a
row that says what it tracks: `TSLAx · tracks TSLA`.

Two stock-specific CoinGecko categories are merged and deduped
(`tokenized-stock`, `xstocks-ecosystem`). If one slug drifts the other still
answers. Neither is the wider RWA bucket — that holds treasuries and gold,
which are not stocks, and folding them in would mislabel them.

The underlying ticker is derived conservatively: strip a trailing `x`, and only
when what remains still looks like a ticker and the name says it is tokenized.
Guessing harder than that invents provenance, so anything else shows plain.

The **Stocks** switch shows equities only, from wherever you are, and pressing
it again puts you back. That view is one the rail already has, so the switch
holds no state of its own — it reports whether that category is on screen, the
rail highlight follows it, and leaving by the rail turns it off. Being a view
rather than a flag, it is already in the URL as `?tab=stocks`.

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
| Yield farm | at least $1M TVL, an APY above 0 but not above 1000%, not flagged an outlier by the source, and not paying more than 5× its own 30-day mean |
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
| `tools/` | Three audits that print what renders, so it can be looked at |

Fuse.js is the only dependency, vendored as a single 19KB ES module so there is
still nothing to install or build. It gives typo tolerance — `kamnio` finds
Kamino — and its scores are re-ranked afterwards so an exact ticker always wins.

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

**`tools/`** is not a suite — it is three scripts that print what actually
renders, because the bugs that survive longest are the ones nothing asserts.
`audit-entities.mjs` walks every kind and dumps its columns, facets, headline,
stats and About line. `audit-filters.mjs` turns every chip on in turn and
reports how much it leaves, which is how five filters that could only ever match
everything were found. `audit-artifact.mjs` serves the built artifact with every
host blocked. What each one surfaced is now an assertion in the suites above —
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
