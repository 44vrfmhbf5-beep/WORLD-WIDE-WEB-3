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
| `api.coingecko.com` | prices, market caps, volume, logos, sparklines, price history | `/coins/markets`, `/coins/{id}/market_chart` |
| `yields.llama.fi` | lending markets: supply/borrow APY, TVL, utilization, LTV, APY history | `/pools`, `/lendBorrow`, `/chart/{pool}` |
| `api.llama.fi` | protocols, TVL history, DEX volume, fees and revenue, per-chain TVL | `/protocols`, `/protocol/{slug}`, `/overview/dexs`, `/overview/fees`, `/v2/chains` |
| `stablecoins.llama.fi` | stablecoin circulating supply | `/stablecoins` |

Eleven endpoints across four hosts, all keyless and CORS-open, called straight
from the browser.

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

Responses are cached in `sessionStorage` for 5 minutes, and a stale entry is
served if a refetch fails, so a rate limit degrades instead of blanking the page.

### Rate limits, and the one thing to watch

CoinGecko's keyless tier allows roughly 5–15 calls/minute. Normal browsing stays
well inside that; hammering the chain chips will trip it, which surfaces as a
"rate limited" notice rather than an error. Adding a demo key (`x-cg-demo-api-key`)
in `data.js` raises it substantially.

Per-chain asset lists use CoinGecko *category* slugs, mapped in the `CHAINS`
table at the top of `data.js`. If a chain tab comes up empty, that slug is the
thing to check — CoinGecko renames them occasionally, and the whole mapping is
one table.

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
