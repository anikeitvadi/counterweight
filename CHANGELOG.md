# Changelog

## 0.2.0 — 2026-10-24

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
- Windows build is pinned to x64 (`electron-builder --win zip --x64`); the host's arm64 was leaking in.
- Repository: MIT licence, CI, architecture notes, screenshots.

## 0.1.0 — 2026-10-24

- First release: put/call ratio, liquidation heatmap, open interest by strike, gamma exposure, IV smile and
  term structure, options flow, alerts, widget mode; web app on Vercel and an Electron desktop app for
  Windows and macOS.
