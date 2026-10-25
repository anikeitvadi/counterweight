# Changelog

## 0.2.0 — 2026-10-24

- **Renamed to Counterweight.** The app watches gold as well as crypto, and its one idea is that the thin side of
  positioning is the weight against the crowd. Desktop builds, the app id and the tray now carry the new name.

- **Design system.** One typeface family (Geist, Geist Mono for figures, self-hosted), near-black surfaces,
  hairline borders, 20px cards, pill controls, uppercase eyebrow headers, and no accent hue: colour means
  direction and nothing else. The hero is a number, a direction word, the Read, and a split bar; the gauge,
  sparkline and per-expiry rows moved to the table view. Charts and the heatmap share the palette.
- **Conviction ratio.** The put/call hero is now written with the smaller side as 1 (`1 : 2.3`), ordered
  `puts : calls` or `calls : puts`, and coloured by the contrarian lean: red when puts are the thin side,
  green when calls are. The classic put/call figure stays beside it; the snapshot tile, per-expiry rows,
  trend colours and the tab title follow the same convention.
- **Delta by default.** New installs open on Delta Exchange's chain so the numbers match Delta's app;
  Deribit remains one click away for BTC and ETH.
- **D1 by default.** The expiry scope is remembered as Delta's code (D1, W1, M2…) rather than a date, so it
  carries across assets and venues and every session opens on the nearest daily expiry.
- **Multi-asset widget.** The widget can show BTC, ETH and gold at once, stacked in a column (portrait) or side
  by side (landscape); the asset buttons toggle membership and both choices are remembered.
- **Cleaner liquidation heatmap.** Three leverage tiers (25×, 50×, 100×) instead of six, bands a fixed ~0.1% of
  price tall, open interest settled as ~48 net entries per window rather than one per tick, a linear colour ramp
  from a flat field, and a tighter price axis. The default window is now 1D.
- Windows build is pinned to x64 (`electron-builder --win zip --x64`); the host's arm64 was leaking in.
- Repository: MIT licence, CI, architecture notes, screenshots.

## 0.1.0 — 2026-10-24

- First release: put/call ratio, liquidation heatmap, open interest by strike, gamma exposure, IV smile and
  term structure, options flow, alerts, widget mode; web app on Vercel and an Electron desktop app for
  Windows and macOS.
