# Changelog

## 0.3.0 — 2026-10-26

- **Heatmap labels.** The strongest bands carry their size and level, and dashed leader lines run from the price to
  the nearest cluster above and below with the distance, so the map answers "how far to the pain" without the axis.
- **Side profile.** Live liquidation notional by price at the right edge, with totals above and below the price.
- **Sweeps.** When price trades through an estimated band it flashes for a few seconds and, with alerts on, logs
  "$4.0M of shorts cleared at 82,085". New rule with its own minimum size.
- **Desktop updates.** The Windows build is now a one-click installer that updates itself from GitHub Releases;
  Help → Check for updates… does it on demand. Releases are built by CI on tag push; signing switches on when the
  certificate secrets exist (see docs/RELEASING.md).
- New icon: the hero's split bar on the near-black surface.

- The tab title carries ratio, direction and max pain for every asset in the strip, active asset first.
- The refresh button now restarts every feed on screen (desk, extra widget cards, header strip), not just the desk's.

- **Header strip.** Every chosen asset's ratio, direction and max pain in the header, scoped to the header expiry;
  click one to open it. Which assets appear is set in the settings popover. Non-active assets poll only their options
  chain once a minute.
- The asset leads each card header in white so cards read at a glance.

- Fix: Delta gold options settle at 16:00 UTC, not 12:00, so the front gold expiry vanished from the desk every
  afternoon while Delta still listed it. Expiries now come from Delta's per-contract settlement time (cached an hour),
  with a per-asset hour as fallback.

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
