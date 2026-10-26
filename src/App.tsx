import { useEffect, useMemo, useRef, useState } from 'react';
import { ASSETS, type Asset } from './api/delta';
import { AlertsPanel, Toasts } from './components/AlertsPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Panel } from './components/Panel';
import { FlowPanel } from './components/FlowPanel';
import { GexChart } from './components/GexChart';
import { IvSmile } from './components/IvSmile';
import { LiqHeatmap } from './components/LiqHeatmap';
import { OiByStrike } from './components/OiByStrike';
import { RatioPanel } from './components/RatioPanel';
import { StatTiles } from './components/StatTiles';
import { ASSET_NAME, LiveWidgetCard, UNIT, WidgetCard } from './components/WidgetCard';
import { LeanStrip } from './components/LeanStrip';
import { useChainLeans } from './hooks/useChainLeans';
import { leanTone } from './components/RatioPanel';
import { TermStructure } from './components/TermStructure';
import { useAlerts } from './hooks/useAlerts';
import { useHeatmap } from './hooks/useHeatmap';
import { useLocalStorage } from './hooks/useLocalStorage';
import { RANGES, useMarketData, type Health, type RangeKey, type VenuePref } from './hooks/useMarketData';
import { DEFAULT_RULES, type AlertInput, type AlertRules } from './lib/alerts';
import { fmtDateShort, fmtPrice } from './lib/format';
import { GLOSSARY } from './lib/glossary';
import type { Palette } from './lib/heatmapSeries';
import { ivRank } from './lib/ivrank';
import { currentClusters, type LiqModel, type LiqSide } from './lib/liquidation';
import {
  atmIv, expectedMove, expiryCodes, fmtLean, gammaExposure, groupByExpiry, lean, maxPain, oiByStrike, putCallRatio, realizedVol, resolveExpiry, skew25, smile, termStructure,
  type ExpirySel,
} from './lib/options';

type PanelKey = 'tiles' | 'ratio' | 'heatmap' | 'oi' | 'gex' | 'smile' | 'term' | 'flow' | 'alerts';
const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: 'tiles', label: 'Market snapshot' },
  { key: 'ratio', label: 'Put / call ratio' },
  { key: 'heatmap', label: 'Liquidation heatmap' },
  { key: 'oi', label: 'Open interest by strike + max pain' },
  { key: 'gex', label: 'Gamma exposure' },
  { key: 'smile', label: 'IV smile / skew' },
  { key: 'term', label: 'Volatility term structure' },
  { key: 'flow', label: 'Options flow' },
  { key: 'alerts', label: 'Alert settings panel' },
];
const ALL_ON: Record<PanelKey, boolean> = { tiles: true, ratio: true, heatmap: true, oi: true, gex: true, smile: true, term: true, flow: true, alerts: false };
const DEFAULT_ORDER: PanelKey[] = ['ratio', 'tiles', 'heatmap', 'oi', 'gex', 'smile', 'term', 'flow', 'alerts'];
const hashWidget = () => typeof location !== 'undefined' && location.hash.replace('#', '') === 'widget';
// Candle/series colours as hex: the canvas chart cannot resolve CSS variables.
const SERIES = { dark: { up: '#089981', down: '#f23645' }, light: { up: '#089981', down: '#f23645' } };
const HEALTH_LABEL: Record<Health, string> = { live: 'Live', polling: 'Polling', stale: 'Stale', offline: 'Offline', error: 'Error' };
const RANGE_KEYS = Object.keys(RANGES) as RangeKey[];

function ageText(ms: number | null, now: number): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function App() {
  const [asset, setAsset] = useLocalStorage<Asset>('cd.asset', 'BTC');
  const [range, setRange] = useLocalStorage<RangeKey>('cd.range', '1D');
  const [storedPanels, setPanels] = useLocalStorage<Partial<Record<PanelKey, boolean>>>('cd.panels', ALL_ON);
  const panels: Record<PanelKey, boolean> = { ...ALL_ON, ...storedPanels };
  const [storedOrder, setOrder] = useLocalStorage<PanelKey[]>('cd.order', DEFAULT_ORDER);
  const order = useMemo(() => [...storedOrder.filter((k) => DEFAULT_ORDER.includes(k)), ...DEFAULT_ORDER.filter((k) => !storedOrder.includes(k))], [storedOrder]);
  const [theme, setTheme] = useLocalStorage<'dark' | 'light'>('cd.theme', 'dark');
  const [compact, setCompact] = useLocalStorage<boolean>('cd.compact', false);
  const [storedWidget, setWidget] = useLocalStorage<boolean>('cd.widget', false);
  const [widget, setWidgetNow] = useState<boolean>(() => hashWidget() || storedWidget);
  // Delta by default so the numbers match Delta's own app; Deribit is the deeper market, one click away.
  const [venuePref, setVenuePref] = useLocalStorage<VenuePref>('cd.venue', 'delta');
  // Extra assets the widget shows beside the primary one.
  const [extraAssets, setExtraAssets] = useLocalStorage<Asset[]>('cd.widgetAssets', []);
  // Several widget assets stacked (portrait, a side column) or side by side (landscape, a strip above the charts).
  const [widgetLayout, setWidgetLayout] = useLocalStorage<'portrait' | 'landscape'>('cd.widgetLayout', 'portrait');
  // Assets shown in the header strip (ratio · direction · max pain), independent of which one the desk is on.
  const [stripAssets, setStripAssets] = useLocalStorage<Asset[]>('cd.strip', ASSETS);
  const [side, setSide] = useLocalStorage<LiqSide>('cd.side', 'all');
  const [model, setModel] = useLocalStorage<LiqModel>('cd.model', 'balanced');
  const [palette, setPalette] = useLocalStorage<Palette>('cd.palette', 'viridis');
  const [threshold, setThreshold] = useLocalStorage<number>('cd.threshold2', 0.05);
  const [showLiq, setShowLiq] = useLocalStorage<boolean>('cd.showLiq', true);
  const [showWalls, setShowWalls] = useLocalStorage<boolean>('cd.showWalls', false);
  const [oiUsd, setOiUsd] = useLocalStorage<boolean>('cd.oiUsd', true);
  const [oiMetric, setOiMetric] = useLocalStorage<'oi' | 'vol'>('cd.oiMetric', 'oi');
  const [rules, setRules] = useLocalStorage<AlertRules>('cd.alerts.rules', DEFAULT_RULES);
  // Expiry scope as Delta's code, so D1 stays D1 across assets and venues; every session opens on the front daily.
  const [expirySel, setExpirySel] = useState<ExpirySel>('D1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [dragId, setDragId] = useState<PanelKey | null>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [popPos, setPopPos] = useState({ top: 0, left: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0d0d0d' : '#f9f9f7');
  }, [theme]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close popovers on outside click / Escape.
  useEffect(() => {
    if (!settingsOpen && !helpOpen) return;
    const onDown = (e: PointerEvent) => {
      if (popRef.current?.contains(e.target as Node) || gearRef.current?.contains(e.target as Node)) return;
      setSettingsOpen(false);
      setHelpOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSettingsOpen(false);
        setHelpOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [settingsOpen, helpOpen]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '1' || e.key === '2' || e.key === '3') {
        pickAsset(ASSETS[parseInt(e.key, 10) - 1]);
      } else if (e.key === '[' || e.key === ']') {
        setRange((r) => {
          const i = RANGE_KEYS.indexOf(r);
          return RANGE_KEYS[Math.max(0, Math.min(RANGE_KEYS.length - 1, i + (e.key === ']' ? 1 : -1)))];
        });
      } else if (e.key === 't') setTheme((v) => (v === 'dark' ? 'light' : 'dark'));
      else if (e.key === 'c') setCompact((v) => !v);
      else if (e.key === 'w') toggleWidget();
      else if (e.key === 'l') setWidgetLayout((v) => (v === 'portrait' ? 'landscape' : 'portrait'));
      else if (e.key === '?') setHelpOpen((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setAsset, setRange, setTheme, setCompact, setWidgetLayout, widget, asset, extraAssets]);

  // Follow the URL hash too, so /#widget works on an already-open page and the back button restores the desk.
  useEffect(() => {
    const onHash = () => setWidgetNow(hashWidget());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Widget: the assets shown are the primary plus any extras; clicking toggles membership and the
  // primary (alerts, tab title) hands over to the first remaining asset. Desk: plain single select.
  const shownAssets = ASSETS.filter((a) => a === asset || extraAssets.includes(a));
  const pickAsset = (a: Asset) => {
    if (!widget) return setAsset(a);
    if (a === asset) {
      const rest = ASSETS.filter((x) => x !== a && extraAssets.includes(x));
      if (rest.length === 0) return;
      setAsset(rest[0]);
      setExtraAssets(rest.slice(1));
    } else if (extraAssets.includes(a)) setExtraAssets(extraAssets.filter((x) => x !== a));
    else setExtraAssets(ASSETS.filter((x) => x !== asset && (x === a || extraAssets.includes(x))));
  };

  const toggleWidget = () => {
    setWidgetNow((v) => {
      const next = !v;
      setWidget(next);
      history.replaceState(null, '', next ? '#widget' : location.pathname + location.search);
      return next;
    });
  };

  const openSettings = () => {
    const r = gearRef.current?.getBoundingClientRect();
    if (r) {
      const width = 270;
      setPopPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8)) });
    }
    setHelpOpen(false);
    setSettingsOpen((v) => !v);
  };

  const data = useMarketData(asset, range, venuePref);
  // Options maths uses the options venue's index; the perp tile shows OKX.
  const spot = data.options[0]?.spot || data.perp?.last || 0;
  const perpPrice = data.perp?.last || spot;

  const groups = useMemo(() => groupByExpiry(data.options), [data.options]);
  const codes = useMemo(() => expiryCodes(groups.map((g) => g.expiryMs)), [groups]);
  const selected = resolveExpiry(groups, codes, expirySel);
  const front = groups[0] ?? null;
  const smileGroup = selected ?? front;
  const scoped = useMemo(() => (selected ? [...selected.calls, ...selected.puts] : data.options), [selected, data.options]);
  const scopeLabel = selected ? `${codes.get(selected.expiryMs) ?? ''} · ${fmtDateShort(selected.expiryMs)} expiry` : 'all expiries';

  const oiRows = useMemo(() => oiByStrike(scoped), [scoped]);
  const mp = useMemo(() => maxPain(scoped), [scoped]);
  // The tile follows the header scope, so with an expiry selected it reads exactly like Delta's page.
  const pcr = useMemo(() => (scoped.length ? putCallRatio(scoped) : null), [scoped]);
  const term = useMemo(() => termStructure(groups, spot), [groups, spot]);
  const smilePts = useMemo(() => (smileGroup ? smile(smileGroup) : []), [smileGroup]);
  const skew = useMemo(() => (smileGroup ? skew25(smileGroup) : null), [smileGroup]);
  const frontSkew = useMemo(() => (front ? skew25(front) : null), [front]);
  const frontMaxPain = useMemo(() => (front ? maxPain([...front.calls, ...front.puts]) : null), [front]);
  const gex = useMemo(() => gammaExposure(scoped, spot), [scoped, spot]);
  const frontIv = useMemo(() => (front ? atmIv(front, spot) : null), [front, spot]);
  const rank = useMemo(() => ivRank(data.dvol), [data.dvol]);
  const realized = useMemo(() => {
    const perDay = 86_400 / data.secPerBar;
    const closes = data.price.slice(-Math.floor(perDay * 7)).map((c) => c.c);
    return realizedVol(closes, perDay * 365);
  }, [data.price, data.secPerBar]);
  const { heatmap, computing } = useHeatmap(data.price, data.oi, model);
  const walls = useMemo(
    () => ({
      rows: oiRows.filter((r) => r.callOi + r.putOi > 0).map((r) => (oiUsd ? { ...r, callOi: r.callOiUsd, putOi: r.putOiUsd } : r)),
      maxPain: mp,
      flip: gex.flip,
      unit: oiUsd ? '$' : UNIT[asset],
    }),
    [oiRows, mp, gex.flip, asset, oiUsd],
  );

  // Alerts watch the live perp price against clusters, max pain, the flip, funding and the liquidation tape.
  const alertInput = useMemo<AlertInput | null>(() => {
    if (!(perpPrice > 0)) return null;
    return {
      asset: ASSET_NAME[asset],
      spot: perpPrice,
      clusters: heatmap ? currentClusters(heatmap, perpPrice, 6) : [],
      maxPain: frontMaxPain,
      flip: gex.flip,
      fundingPct: data.perp ? data.perp.fundingRate * 100 : null,
      liquidations: data.liquidations.slice(-200),
      now: Date.now(),
    };
  }, [asset, perpPrice, heatmap, frontMaxPain, gex.flip, data.perp, data.liquidations]);
  const alerts = useAlerts(rules, alertInput);
  // Header strip: the desk's own asset comes from the live feed; the others poll just their chain.
  const stripOthers = widget ? [] : ASSETS.filter((a) => a !== asset && stripAssets.includes(a));
  const otherLeans = useChainLeans(stripOthers, venuePref, expirySel);
  const primaryLean = pcr ? lean(pcr.putOiUsd, pcr.callOiUsd) : null;
  const stripItems = ASSETS.filter((a) => stripAssets.includes(a)).map((a) => ({
    asset: a,
    read: a === asset
      ? { lean: primaryLean, tone: leanTone(primaryLean), maxPain: mp, expiry: selected ? codes.get(selected.expiryMs) ?? 'all' : 'all', updatedAt: Date.now() }
      : otherLeans[a],
  }));
  const nearest = heatmap && perpPrice > 0 ? currentClusters(heatmap, perpPrice, 1) : [];
  const readContext = useMemo(() => ({
    asset: ASSET_NAME[asset], spot, maxPain: frontMaxPain,
    above: nearest.find((c) => c.side === 'short') ?? null, below: nearest.find((c) => c.side === 'long') ?? null,
    fundingPct: data.perp ? data.perp.fundingRate * 100 : null,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [asset, spot, frontMaxPain, heatmap, perpPrice, data.perp]);

  useEffect(() => {
    const l = pcr ? lean(pcr.putOiUsd, pcr.callOiUsd) : null;
    document.title = l && perpPrice > 0 ? `${ASSET_NAME[asset]} ${fmtPrice(perpPrice)} · ${l.fewer === 'calls' ? 'C:P' : 'P:C'} ${fmtLean(l, 1)} — Counterweight` : 'Counterweight';
  }, [asset, pcr, perpPrice]);

  const lastGood = Math.max(data.updatedAt ?? 0, data.tickAt ?? 0) || null;
  const statusTitle = data.error ? `Last error: ${data.error}` : data.health === 'live' ? 'Streaming OKX perp over websocket; options and candles refresh every 30–60s' : 'Refreshing over REST every 30–60s';

  const dragProps = (id: PanelKey) => ({
    id,
    dragging: dragId === id,
    onDragStart: (k: string) => setDragId(k as PanelKey),
    onDrop: (target: string) => {
      if (!dragId || dragId === target) return setDragId(null);
      const next = order.filter((k) => k !== dragId);
      next.splice(next.indexOf(target as PanelKey), 0, dragId);
      setOrder(next);
      setDragId(null);
    },
  });

  const panelFor = (key: PanelKey) => {
    if (!panels[key]) return null;
    switch (key) {
      case 'tiles':
        return (
          <ErrorBoundary key={key} title="Market snapshot">
            <Panel title="Market snapshot" sub={`${data.optionsVenue} options · OKX perp`} info={GLOSSARY.tiles} drag={dragProps(key)}>
              <StatTiles
                show
                perp={data.perp}
                venue="OKX"
                oiChange6hUsd={data.oiChange6hUsd}
                spot={spot}
                price={data.price}
                secPerBar={data.secPerBar}
                pcr={pcr}
                frontLabel={front ? fmtDateShort(front.expiryMs) : null}
                pcrScope={selected ? `${codes.get(selected.expiryMs) ?? ''} ${fmtDateShort(selected.expiryMs)}` : 'all expiries'}
                atmIv={frontIv}
                realized={realized}
                skew={frontSkew}
                maxPain={frontMaxPain}
                expectedMove={front && frontIv !== null && spot > 0 ? expectedMove(frontIv, front.dte, spot) : null}
                ivRank={rank}
                hasDvol={asset !== 'XAUT'}
                optionsVenue={data.optionsVenue}
              />
            </Panel>
          </ErrorBoundary>
        );
      case 'ratio':
        return (
          <ErrorBoundary key={key} title="Put / call ratio">
            <RatioPanel options={data.options} history={data.pcrHistory} venue={data.optionsVenue} unit={UNIT[asset]} loading={data.loading} compact={widget} selectedExpiryMs={selected ? selected.expiryMs : null} codes={codes} context={readContext} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      case 'heatmap':
        return (
          <ErrorBoundary key={key} title="Liquidation heatmap">
            <LiqHeatmap
              heatmap={heatmap} computing={computing} spot={perpPrice} venue={data.oiSource === 'okx' ? 'OKX' : 'Delta (fallback)'}
              side={side} onSide={setSide} model={model} onModel={setModel} palette={palette} threshold={threshold} onThreshold={setThreshold}
              theme={theme} up={SERIES[theme].up} down={SERIES[theme].down} loading={data.loading}
              error={data.price.length === 0 && data.error ? data.error : null} onRetry={data.refresh}
              liquidations={data.liquidations} showLiquidations={showLiq} onShowLiquidations={setShowLiq}
              walls={walls} showWalls={showWalls} onShowWalls={setShowWalls} windowKey={`${asset}:${range}`} drag={dragProps(key)}
            />
          </ErrorBoundary>
        );
      case 'oi':
        return (
          <ErrorBoundary key={key} title="Open interest by strike">
            <OiByStrike rows={oiRows} spot={spot} maxPain={mp} unit={UNIT[asset]} usd={oiUsd} onUsd={setOiUsd} metric={oiMetric} onMetric={setOiMetric} sub={`${data.optionsVenue} · ${scopeLabel}`} loading={data.loading} info={GLOSSARY.oi} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      case 'gex':
        return (
          <ErrorBoundary key={key} title="Gamma exposure">
            <GexChart points={gex.points} total={gex.total} flip={gex.flip} spot={spot} sub={`${data.optionsVenue} · ${scopeLabel}`} loading={data.loading} info={GLOSSARY.gex} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      case 'smile':
        return smileGroup ? (
          <ErrorBoundary key={key} title="IV smile">
            <IvSmile points={smilePts} spot={spot} skew={skew} sub={`${data.optionsVenue} · ${fmtDateShort(smileGroup.expiryMs)}${selected ? '' : ' (front)'}`} loading={data.loading} info={GLOSSARY.smile} drag={dragProps(key)} />
          </ErrorBoundary>
        ) : null;
      case 'term':
        return (
          <ErrorBoundary key={key} title="Volatility term structure">
            <TermStructure points={term} realized={realized} loading={data.loading} info={GLOSSARY.term} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      case 'flow':
        return (
          <ErrorBoundary key={key} title="Options flow">
            <FlowPanel options={data.options} snapshot={data.oiSnapshot} spot={spot} unit={UNIT[asset]} venue={data.optionsVenue} loading={data.loading} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      case 'alerts':
        return (
          <ErrorBoundary key={key} title="Alerts">
            <AlertsPanel rules={rules} onRules={setRules} log={alerts.log} permission={alerts.permission} onRequestPermission={alerts.requestPermission} onClear={alerts.clearLog} onTest={alerts.test} unit={UNIT[asset]} drag={dragProps(key)} />
          </ErrorBoundary>
        );
      default:
        return null;
    }
  };

  return (
    <div className={`app${compact ? ' compact' : ''}${widget ? ` widget ${widgetLayout}` : ''}`}>
      <header className="hdr">
        <span className="brand">Counterweight</span>
        <span className={`pill ${data.health}`} title={statusTitle} aria-live="polite">
          <i className="dot" />
          {HEALTH_LABEL[data.health]}
          {lastGood && <span className="age"> · {ageText(lastGood, now)}</span>}
        </span>
        {!widget && <LeanStrip items={stripItems} active={asset} onPick={(a) => setAsset(a)} />}
        {widget ? (
          <div className="seg" role="group" aria-label="Assets shown" title="Show several assets at once; the first one drives alerts and the tab title">
            {ASSETS.map((a) => (
              <button key={a} aria-pressed={shownAssets.includes(a)} className={shownAssets.includes(a) ? 'on' : ''} onClick={() => pickAsset(a)}>
                {ASSET_NAME[a]}
              </button>
            ))}
          </div>
        ) : (
          <div className="seg" role="tablist" aria-label="Asset">
            {ASSETS.map((a) => (
              <button key={a} role="tab" aria-selected={asset === a} className={asset === a ? 'on' : ''} onClick={() => pickAsset(a)}>
                {ASSET_NAME[a]}
              </button>
            ))}
          </div>
        )}
        {widget && shownAssets.length > 1 && (
          <div className="seg" role="group" aria-label="Widget layout" title="Stack the assets (portrait) or lay them side by side (landscape) · l">
            <button aria-pressed={widgetLayout === 'portrait'} className={widgetLayout === 'portrait' ? 'on' : ''} onClick={() => setWidgetLayout('portrait')} aria-label="Portrait">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="7" y="3" width="10" height="18" rx="1.5" /><path d="M7 12h10" /></svg>
            </button>
            <button aria-pressed={widgetLayout === 'landscape'} className={widgetLayout === 'landscape' ? 'on' : ''} onClick={() => setWidgetLayout('landscape')} aria-label="Landscape">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="7" width="18" height="10" rx="1.5" /><path d="M12 7v10" /></svg>
            </button>
          </div>
        )}
        <select className="sel" value={selected ? codes.get(selected.expiryMs) ?? 'all' : 'all'} onChange={(e) => setExpirySel(e.target.value)} aria-label="Expiry" title="Expiry scope for the ratio and the strike charts. D1 = nearest daily, W = weekly, M = monthly (Delta's codes)">
          <option value="all">All expiries</option>
          {groups.map((g) => (
            <option key={g.expiryMs} value={codes.get(g.expiryMs)}>
              {codes.get(g.expiryMs)} · {fmtDateShort(g.expiryMs)} · {g.dte < 1 ? `${Math.round(g.dte * 24)}h` : `${Math.round(g.dte)}d`}
            </option>
          ))}
        </select>
        {asset !== 'XAUT' && (
          <div className="seg" role="group" aria-label="Options venue" title="Which exchange's option chain to analyse. Delta matches the numbers in Delta's own app; Deribit is the deepest market.">
            {(['delta', 'deribit'] as VenuePref[]).map((v) => (
              <button key={v} className={venuePref === v ? 'on' : ''} onClick={() => setVenuePref(v)}>{v === 'deribit' ? 'Deribit' : 'Delta'}</button>
            ))}
          </div>
        )}
        {!widget && <div className="seg" role="group" aria-label="Heatmap window">
          {RANGE_KEYS.map((r) => (
            <button key={r} className={range === r ? 'on' : ''} onClick={() => setRange(r)}>{r}</button>
          ))}
        </div>}
        {data.fromCache && <span className="cache-note" title="Painted from the last session's data; refreshing now">cached · refreshing…</span>}
        <span className="spacer" />
        <div className="actions">
          <button className="icon-btn" title="Refresh now" aria-label="Refresh now" onClick={data.refresh}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v6h-6" /></svg>
          </button>
          <button className={`icon-btn${widget ? ' on' : ''}`} title="Widget: ratio + key numbers only (w)" aria-label="Toggle widget mode" aria-pressed={widget} onClick={toggleWidget}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><path d="M17 14v6M14 17h6" /></svg>
          </button>
          <button className={`icon-btn${compact ? ' on' : ''}`} title="Compact side-window layout (c)" aria-label="Toggle compact layout" aria-pressed={compact} onClick={() => setCompact(!compact)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M4 9h16M4 15h16" /></svg>
          </button>
          <button className="icon-btn" title="Toggle theme (t)" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
            )}
          </button>
          <button className="icon-btn" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" aria-expanded={helpOpen} onClick={() => { setSettingsOpen(false); setHelpOpen((v) => !v); }}>?</button>
          <button ref={gearRef} className="icon-btn" title="Indicators & display" aria-label="Indicators and display settings" aria-expanded={settingsOpen} onClick={openSettings}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--surface)" /><circle cx="15" cy="12" r="2" fill="var(--surface)" /><circle cx="7" cy="18" r="2" fill="var(--surface)" /></svg>
          </button>
        </div>
        {settingsOpen && (
          <div ref={popRef} className="pop" role="dialog" aria-label="Indicators" style={{ top: popPos.top, left: popPos.left }}>
            <h4>Indicators</h4>
            {PANELS.map((p) => (
              <label key={p.key}>
                <input type="checkbox" checked={panels[p.key]} onChange={(e) => setPanels({ ...panels, [p.key]: e.target.checked })} />
                {p.label}
              </label>
            ))}
            <hr />
            <h4>Alerts</h4>
            <label>
              <input type="checkbox" checked={rules.enabled} onChange={(e) => setRules({ ...rules, enabled: e.target.checked })} />
              Watch for clusters, max pain, flip, funding, big liquidations
            </label>
            <p className="note">Thresholds and the alert log are in the "Alert settings panel" above.</p>
            <hr />
            <h4>Header strip</h4>
            <div className="seg small" role="group" aria-label="Assets in the header strip">
              {ASSETS.map((a) => (
                <button key={a} aria-pressed={stripAssets.includes(a)} className={stripAssets.includes(a) ? 'on' : ''} onClick={() => setStripAssets(stripAssets.includes(a) ? stripAssets.filter((x) => x !== a) : ASSETS.filter((x) => x === a || stripAssets.includes(x)))}>
                  {ASSET_NAME[a]}
                </button>
              ))}
            </div>
            <p className="note">Ratio, direction and max pain for each, scoped to the header expiry. Click one to open it.</p>
            <hr />
            <h4>Heatmap colours</h4>
            <div className="seg small" role="group" aria-label="Palette">
              <button className={palette === 'viridis' ? 'on' : ''} onClick={() => setPalette('viridis')}>Viridis</button>
              <button className={palette === 'mono' ? 'on' : ''} onClick={() => setPalette('mono')}>Blue</button>
            </div>
            <hr />
            <div className="row">
              <button className="link" onClick={() => { setPanels(ALL_ON); setOrder(DEFAULT_ORDER); }}>Reset layout</button>
              <button className="link" onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
          </div>
        )}
        {helpOpen && (
          <div ref={popRef} className="pop" role="dialog" aria-label="Keyboard shortcuts" style={{ top: 44, right: 10, left: 'auto' }}>
            <h4>Keyboard</h4>
            <ul className="help-list">
              <li><span>BTC / ETH / Gold (widget: show / hide)</span><span><span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span></span></li>
              <li><span>Shorter / longer window</span><span><span className="kbd">[</span> <span className="kbd">]</span></span></li>
              <li><span>Theme</span><span className="kbd">t</span></li>
              <li><span>Compact layout</span><span className="kbd">c</span></li>
              <li><span>Widget mode</span><span className="kbd">w</span></li>
              <li><span>Widget: portrait / landscape</span><span className="kbd">l</span></li>
              <li><span>This help</span><span className="kbd">?</span></li>
            </ul>
            <p className="note">Drag the ⋮⋮ grip on any panel to reorder. Each panel's ⓘ explains what it shows and how to read it.</p>
          </div>
        )}
      </header>

      {(data.health === 'offline' || (data.error && data.errorAt && now - data.errorAt < 90_000)) && (
        <div className="banner" role="alert">
          {data.health === 'offline' ? 'You are offline — showing the last data received.' : `Data problem: ${data.error}. Retrying automatically.`}
          <button className="link" onClick={data.refresh}>Retry now</button>
        </div>
      )}

      {widget ? (
        <div className={`wgrid ${widgetLayout}`} style={{ '--n': shownAssets.length } as React.CSSProperties}>
          {shownAssets.map((a) =>
            a === asset ? (
              <WidgetCard key={a} asset={a} data={data} expirySel={expirySel} model={model} />
            ) : (
              <LiveWidgetCard key={a} asset={a} range={range} venuePref={venuePref} expirySel={expirySel} model={model} />
            ),
          )}
        </div>
      ) : (
        <div className="grid">{order.map(panelFor)}</div>
      )}

      <Toasts toasts={alerts.toasts} onDismiss={alerts.dismiss} />

      <p className="footer">
        Data: options chain from <a href="https://www.delta.exchange" target="_blank" rel="noreferrer">Delta Exchange</a> (default; gold is Delta only) or{' '}
        <a href="https://www.deribit.com" target="_blank" rel="noreferrer">Deribit</a> (BTC, ETH, header toggle); perp price, open interest, funding and liquidations from{' '}
        <a href="https://www.okx.com" target="_blank" rel="noreferrer">OKX</a> (streamed over websocket; candles and OI history refreshed every 60s); IV rank from Deribit's DVOL.
        Liquidation levels are estimates derived from open-interest changes and assumed leverage tiers (25×, 50×, 100×), not confirmed positions. Gamma exposure assumes dealers are long calls and short puts.
      </p>
    </div>
  );
}
