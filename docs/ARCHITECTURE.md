# Architecture

One React code base, three delivery targets: a static web app with a single relay function (Vercel), an
Electron desktop shell that needs no server at all, and a PWA install from the browser.

## Layout

```
src/
  api/          exchange clients: deribit.ts, delta.ts (options), okx.ts (perp REST + websocket)
  hooks/        useMarketData (all polling, websocket, caching), useHeatmap (worker bridge), useAlerts
  lib/          pure maths and models: options.ts, bs.ts, liquidation.ts, alerts.ts, ivrank.ts, format.ts
                heatmapSeries.ts / chartPrimitives.ts: lightweight-charts primitives
  components/   one file per panel; Panel.tsx is the shared frame (title, ⓘ glossary, table view, drag)
  App.tsx       layout, header, settings, keyboard, widget composition
api/            Vercel functions: okx-relay.ts (CORS relay for one OKX prefix), health.ts (cron liveness)
electron/       main.cjs (custom cryptodesk:// scheme, CORS injection, tray, always-on-top), preload.cjs
e2e/            Playwright smoke tests against the live APIs
```

## Data flow

`useMarketData(asset, range, venue)` owns every network interaction for one asset and returns a single
`MarketData` object:

- **Options chain** from Deribit (`get_book_summary_by_currency` + `get_index_price`; greeks via Black-Scholes from mark IV) or Delta
  (`/v2/tickers`), normalised to `OptionTicker` so every panel is venue-agnostic. Refreshed every 30 s.
- **Perp** price, open interest and funding streamed from OKX's public websocket; REST fallback every 60 s.
  Candles and OI history are paged incrementally (only the newest page is fetched, older pages are pulled
  until they meet the cache).
- **Liquidations** from OKX's `liquidation-orders` channel, kept as a rolling tape.
- **DVOL** from Deribit for the IV-rank tile.

All OKX REST calls go through one serialised queue with rate-limit back-off and in-flight de-duplication.
The last good `MarketData` per asset/window is written to IndexedDB (`lib/store.ts`) and painted immediately
on the next open, marked "cached · refreshing". Put/call samples are recorded on-device every five minutes
to drive the 24h/7d change and the trend sparkline.

### The OKX relay

OKX's statistics endpoints (`/api/v5/rubik/stat/...`, used for OI history) answer without CORS headers, so
the browser cannot call them directly. The app always requests `/api/okx/<path>` on its own origin and three
environments satisfy it:

| Environment | What answers `/api/okx/*` |
| --- | --- |
| `npm run dev` | Vite dev-server proxy (`vite.config.ts`) |
| Vercel | `api/okx-relay.ts` behind a rewrite in `vercel.json`; only the `rubik/stat/` prefix is forwarded |
| Electron | the `cryptodesk://` protocol handler in `electron/main.cjs` |

If the relay is unreachable (for example the built `dist/` opened from disk) the heatmap falls back to
Delta's perp OI and says so in its subtitle.

## Options maths (`lib/options.ts`)

Pure functions over `OptionTicker[]`: grouping by expiry, open interest and volume by strike, max pain,
put/call ratio, the **conviction ratio** (`lean`: smaller side normalised to 1, the thin side named), ATM IV,
25Δ skew, IV smile, term structure, gamma exposure with the flip level, expected move, realised volatility,
Black-Scholes greeks (`lib/bs.ts`) for venues that do not publish them, and Delta-style expiry codes
(`D1…`, `W1–W3`, `M2…`) so a scope such as "D1" resolves per chain.

## Liquidation heatmap (`lib/liquidation.ts`, `lib/heatmap.worker.ts`)

An estimate, not a feed: each bar's change in perp open interest is spread over leverage tiers (10×–100×),
mapped to the liquidation prices those entries imply, cleared when price trades through them and scaled
down when open interest falls. The estimator runs in a Web Worker; `useHeatmap` posts candles and OI in and
receives a price × time grid. Rendering uses TradingView's lightweight-charts with two custom pieces:

- `heatmapSeries.ts` draws the grid as a **series primitive at the bottom z-order**. A custom series was
  tried first; the chart redraws the hovered series last, which painted the field over the candles.
- `chartPrimitives.ts` draws actual liquidations as dots and, optionally, option walls (OI by strike on the
  price axis with max pain and the gamma flip). Fractional bar positions must be computed as
  integer-bar coordinate + fraction × bar width, because `logicalToCoordinate` returns 0 for non-integers.

Zoom is deliberate: the chart fits only when the asset or window changes, never on a data refresh, and the
mouse wheel zooms only after a click on the chart (⌘/Ctrl + wheel always works).

## Widget mode

`#widget` (or `w`) renders one `WidgetCard` per selected asset: the ratio hero plus six tiles (perp price,
funding, max pain, IV rank, nearest liquidation cluster above and below). The primary asset reuses the app's
data feed; each extra asset mounts a `LiveWidgetCard` with its own `useMarketData`. Alerts and the tab title
follow the primary asset.

## Desktop shell (`electron/main.cjs`)

Serves `dist/` over a privileged `cryptodesk://` scheme so fetch, service workers and storage behave as on a
website, proxies `/api/okx/*` in-process, and injects CORS headers for the three exchange hosts with
`onHeadersReceived`. Tray icon, always-on-top toggle, widget/desk views, window state persisted in
`userData/window.json`. Setting `CRYPTODESK_SHOT=<file.png>` captures a screenshot and quits, which is how
the shell is verified headlessly. Electron 37 is pinned because newer majors require Node ≥ 22 to install.

## Conventions

- Green `#089981` is calls / longs / positive; red `#f23645` is puts / shorts / negative. Blue is only an accent.
- Every chart has a table twin and a glossary entry (`lib/glossary.ts`).
- Every data failure must be visible: health pill, banner, per-panel error boundaries, subtitle notes.
- Nothing is sent anywhere; there are no keys, no accounts and no analytics.
