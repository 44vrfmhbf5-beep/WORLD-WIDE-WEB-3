# Atlas — search everything onchain

One search bar for every chain. Assets and lending markets, indexed side by side,
with the cross-links between them: open an asset and see where to lend it, open a
market and see the collateral behind it.

Phantom-flavoured dark UI, Google-style omnibox, dApp-style detail sheets.

**This is the UI only.** All figures are illustrative mock data — no RPC, no
indexer, no wallet. `data → search → render` is deliberately thin so a real
backend can drop straight in.

## Run

No build step, no dependencies.

```
npx http-server -p 8080 .   # or: python3 -m http.server 8080
```

Then open http://localhost:8080

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Shell — header, hero, search bar, filters, results, detail sheet |
| `styles.css` | Design system, layout, motion, responsive + reduced-motion |
| `app.js` | Mock dataset, scoring search, renderers, keyboard nav |

## Interactions

- **`/` or `⌘K`** focus search · **`↑` `↓`** browse · **`↵`** open · **`esc`** back out
- Multi-token scoring — `usdc lending` ranks USDC markets above the USDC asset
- Filter by type (All / Assets / Lending) and by network
- Detail sheets cross-link both ways and keep a back stack
- Sparklines and charts are deterministic per ticker (seeded walk), so a symbol
  always draws the same line

## Wiring up real data

Replace the `ASSETS` and `POOLS` tuples at the top of `app.js` with a fetch. The
shapes the rest of the code expects:

```js
{ kind:'asset', sym, name, chain, price, chg, mcap, vol, cat, color }
{ kind:'pool',  proto, sym, chain, sup, bor, tvl, util, ltv }
```

Everything downstream — search keys, rows, sheets — is derived from those.

## Roadmap

Assets and lending first. The same index shape extends to airdrops, dApps,
protocols, and onchain businesses.
