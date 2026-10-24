# CryptoDesk

Web: https://cryptodesk-anakeet.vercel.app · Desktop builds: GitHub Releases · Source: https://github.com/anikeitvadi/cryptodesk

A small, single-page trading companion: options analytics and an estimated
liquidation heatmap for BTC, ETH and gold. Options come from Delta Exchange's
public API, perp price / open interest / funding from OKX's. No backend, no API keys.

## Indicators

- **Put / call ratio** — the hero: ratio by contracts or by $ notional (toggle), puts and calls OI, by-volume ratio,
  a gauge against 1.0, 24h/7d change and a trend sparkline (recorded on-device every 5 min while the desk is open),
  and a per-expiry breakdown. **Widget mode** (`w`, the ⊞ button, or open `/#widget`) shows just this plus six key
  numbers (price, funding, max pain, IV rank, nearest liquidation cluster above/below) and alerts — sized for a
  ~420px side window; the tab title carries price and ratio.

- **Summary tiles** — perp price/24h, funding (8h + annualised), perp OI and 6h change, 24h volume,
  put/call ratio (OI and volume), options OI, ATM IV vs 7-day realised vol, 25Δ skew,
  max pain and 1σ expected move for the front expiry.
- **Liquidation heatmap** — price × time map of estimated liquidation levels, computed in a Web Worker from
  open-interest changes on the perp (new OI at each bar is spread over 10×–100× leverage tiers,
  mapped to liquidation prices, cleared when price trades through, scaled down when OI falls).
  Rendered with TradingView's lightweight-charts: candlesticks on top, drag to pan, click then wheel to
  zoom, crosshair with a readout. Overlays: **actual liquidations** from OKX's feed as dots (green = longs
  liquidated, red = shorts), and optional **option walls** (OI by strike on the same price axis with max pain
  and the gamma flip). Longs / shorts / both; two models; 12H–30D windows; threshold slider; viridis or
  single-hue palette; a list of the largest live clusters; table view.
- **Open interest by strike** (or 24h **volume** by strike) with max pain and spot markers; coin or $ units; the subtitle carries calls/puts totals and the PCR for the chosen scope.
- **Gamma exposure** by strike with the gamma-flip level (dealers long calls / short puts).
- **IV smile** (calls vs puts) with 25Δ skew.
- **Volatility term structure** (ATM IV by expiry) against realised vol.
- **Options flow** — most traded strikes (24h premium) and where open interest moved since a snapshot this
  desk took ~24h earlier (needs a day of being open to fill).
- **Alerts** — price near a big liquidation cluster, crossing max pain or the gamma flip, extreme funding,
  single large liquidation; sound + desktop notification; thresholds editable; log of recent alerts.
  Only while the tab is open.
- **IV rank** tile from Deribit's DVOL (1y rank and percentile).

Calls, longs and positive gamma are green; puts, shorts and negative gamma are red (TradingView's pair). Every chart
has a table view and an ⓘ that explains what it shows and how to read it. Panels can be switched on/off and dragged
into any order; the layout, asset, window, venue and theme are remembered. Keyboard: `1 2 3` assets, `[ ]` window,
`t` theme, `c` compact, `w` widget, `?` help.

**Options venue and matching Delta's page.** BTC and ETH default to Deribit (the deepest chain, so max pain / skew /
GEX reflect the market); switch the header toggle to **Delta** to analyse Delta's own chain. Delta's analytics page is
*per expiry* (its dropdown defaults to D1, the nearest daily), so pick the same expiry in the header — the options are
labelled with Delta's codes (D1…, W1–W3, M2…) — and every number lines up: on 24 Oct 2026, D1 showed calls $190.2M,
puts $81.4M, PCR 0.43, max pain 80,200 on both. With "All expiries" the desk aggregates the whole chain, which is why
the headline ratio (1.09 that day) differs from Delta's single-expiry 0.43. Gold is always Delta (XAUT options).

## Tests

```bash
npm test          # vitest: estimator, options maths, Black-Scholes, Deribit mapping, IV rank, alert rules
npm run test:e2e  # Playwright smoke against the live APIs: each asset loads, panels toggle, widget mode, relay
npm run check     # typecheck + unit tests + build
```

## Run

```bash
cd cryptodesk
npm install
npm run dev        # http://localhost:5180
npm run build      # static site in dist/ (also works opened straight from disk)
```

## Desktop app (what to give him)

CryptoDesk is also packaged as a desktop app with Electron: no server, no browser, no relay — the app talks to
Deribit, OKX and Delta directly (the main process adds the CORS headers those APIs lack and proxies OKX's
statistics endpoint itself). It opens in **widget view** in a ~520×860 window, remembers its size and position,
has a tray / menu-bar icon, and an **Always on top** toggle (View menu or ⌘T / Ctrl+T) so it can float over
a trading screen. ⌘1 / Ctrl+1 is the widget, ⌘2 / Ctrl+2 the full desk.

```bash
npm run app        # build the web app and launch the desktop shell
npm run dist:mac   # release/CryptoDesk-<version>-arm64.dmg and -x64.dmg
npm run dist:win   # release/CryptoDesk-<version>-win-x64.zip — unzip anywhere and run CryptoDesk.exe (an NSIS installer needs Rosetta or a Windows machine to build)
```

The builds are unsigned, so macOS will say the app is from an unidentified developer: right-click → Open the first
time (or `xattr -dr com.apple.quarantine /Applications/CryptoDesk.app`). Windows SmartScreen shows "More info →
Run anyway" once. Signing certificates would remove both prompts.

## Give it to someone as a "small window" (browser alternative)

1. Deploy with `npx vercel` from this folder (Vite is auto-detected; the `api/` folder becomes the OKX relay
   function). A purely static host works too, but the heatmap then runs on the Delta fallback.
2. In Chrome: open the URL → ⋮ menu → *Cast, save and share* → *Install page as app*.
   It then opens as its own small window with no browser chrome, and is resizable down to ~480px wide.
   Or launch directly: `chrome --app=https://your-url --window-size=520,1000`.

## How it stays live

- **Perp price, OI, funding**: streamed over OKX's public websocket (`tickers`, `open-interest`,
  `funding-rate` channels). The header pill shows **Live** with a pulsing dot while ticks arrive. The
  socket pings every 25s, reconnects with exponential backoff (1s → 30s) and is recycled after 60s of silence.
- **Options chain (Delta REST)**: every 30s. **Perp snapshot (OKX REST, fallback)**: every 60s.
  **Candles + OI history (OKX REST)**: every 60s, fetched incrementally — only the newest page is
  requested and older pages are pulled back until they meet what is already cached. All of them slow
  to 4× the interval in a background tab and refresh immediately when the tab becomes visible again.
  The refresh button forces a fetch.
- **Failure handling**: every request has a timeout and retries (OKX calls go through one serialized queue with
  rate-limit back-off); failures keep the last good data on screen and show a banner. The pill turns
  **Polling** (socket down, REST fine), **Stale** (nothing for 2 minutes), **Offline** or **Error** (no data yet).
  Each panel is wrapped in an error boundary so one broken chart cannot blank the page.
- **Instant paint**: the last good state per asset/window is cached in IndexedDB and shown immediately on the
  next open (marked "cached · refreshing") while the network catches up. The app shell is a PWA (installable,
  opens offline); market data is never cached by the service worker.

## Data

Delta Exchange (options):
- `GET /v2/tickers?contract_types=call_options,put_options&underlying_asset_symbols=BTC` — chain with mark IV, greeks, OI

OKX (perp):
- `GET /api/v5/market/ticker`, `/public/open-interest`, `/public/funding-rate` — snapshot (called directly; CORS is open)
- `GET /api/v5/market/candles` + `/market/history-candles` — OHLC, 300 per page
- `GET /api/v5/rubik/stat/contracts/open-interest-history` — OI in coin, 100 per page; OKX keeps
  ~3 days at 5m, ~14 days at 15m, ~30 days at 1H, which is why the window picks the bar (12H/1D/3D → 5m, 7D → 15m, 30D → 1H).
  **This endpoint answers without CORS headers, so browsers cannot call it directly.** It goes through a
  same-origin relay at `/api/okx/rubik/...`: Vite's dev proxy locally, `api/okx/[...path].ts` (a Vercel
  function that forwards only that prefix, cached 30s) in production. If the relay is unreachable — e.g.
  the built page opened from disk — the heatmap falls back to Delta's own perp OI and says so in its subtitle.
- `wss://ws.okx.com:8443/ws/v5/public` — live ticker / OI / funding

Gold is `XAUT` options on Delta and the `XAU-USDT-SWAP` perp on OKX.

## Caveats

Liquidation levels are estimates built on estimates (unknown leverage, unknown direction, no
confirmed positions); the heatmap shows where leverage *probably* sits, not where it is. The
heatmap is built from OKX's perp OI (a few $B on BTC), not the whole market; the shape is
indicative. GEX uses the common dealer-positioning convention and is a sign convention, not a fact.
