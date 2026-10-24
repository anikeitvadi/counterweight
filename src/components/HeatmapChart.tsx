import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries, ColorType, CrosshairMode, LineSeries, LineStyle, createChart,
  type IChartApi, type IPriceLine, type ISeriesApi, type MouseEventParams, type UTCTimestamp,
} from 'lightweight-charts';
import type { Liquidation } from '../api/okx';
import { LiquidationDots, OptionsWalls } from '../lib/chartPrimitives';
import { fmtPrice, fmtUsd } from '../lib/format';
import { HeatmapPrimitive, type HeatmapGrid, type Palette } from '../lib/heatmapSeries';
import type { Heatmap, LiqSide } from '../lib/liquidation';
import type { StrikeOi } from '../lib/options';

export interface HoverInfo {
  x: number;
  y: number;
  timeSec: number;
  level: number;
  long: number;
  short: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

interface Props {
  heatmap: Heatmap | null;
  side: LiqSide;
  palette: Palette;
  threshold: number;
  theme: 'dark' | 'light';
  spot: number;
  height: number;
  /** Changes when the asset or window changes: the only time the view is re-fitted. */
  windowKey: string;
  /** Colours for candles (CSS hex, not var() — canvas can't resolve custom properties). */
  up: string;
  down: string;
  liquidations: Liquidation[];
  showLiquidations: boolean;
  walls: { rows: StrikeOi[]; maxPain: number | null; flip: number | null; unit: string } | null;
  showWalls: boolean;
}

const THEME = {
  dark: { bg: '#1a1a19', text: '#898781', border: '#383835', cross: '#c3c2b7', label: '#383835', now: '#ffffff', ring: 'rgba(0,0,0,0.65)', wallText: '#e6e6e0', line: 'rgba(255,255,255,0.55)' },
  light: { bg: '#fcfcfb', text: '#898781', border: '#c3c2b7', cross: '#52514e', label: '#e1e0d9', now: '#0b0b0b', ring: 'rgba(255,255,255,0.8)', wallText: '#0b0b0b', line: 'rgba(11,11,11,0.55)' },
};

/** Shift a UTC timestamp so lightweight-charts (which formats in UTC) displays local wall time. */
const toChartTime = (t: number): UTCTimestamp => (t - new Date(t * 1000).getTimezoneOffset() * 60) as UTCTimestamp;

function buildGrid(h: Heatmap, side: LiqSide): HeatmapGrid {
  const n = h.times.length * h.bins;
  const values = new Float32Array(n);
  if (side === 'long') values.set(h.long);
  else if (side === 'short') values.set(h.short);
  else for (let i = 0; i < n; i++) values[i] = h.long[i] + h.short[i];
  const lo = new Float32Array(h.times.length);
  const hi = new Float32Array(h.times.length);
  for (let c = 0; c < h.times.length; c++) {
    let first = -1;
    let last = -1;
    for (let b = 0; b < h.bins; b++) {
      if (values[c * h.bins + b] > 0) {
        if (first < 0) first = b;
        last = b;
      }
    }
    lo[c] = first < 0 ? 0 : h.priceMin + first * h.binSize;
    hi[c] = last < 0 ? 0 : h.priceMin + (last + 1) * h.binSize;
  }
  const cap = side === 'long' ? h.capLong : side === 'short' ? h.capShort : h.capAll;
  let tLo = Infinity;
  let tHi = -Infinity;
  for (const k of h.candles) {
    if (k.l < tLo) tLo = k.l;
    if (k.h > tHi) tHi = k.h;
  }
  // traded range + 6% each side: the 10×–25× clusters stay in view, candles fill the pane
  return { bins: h.bins, priceMin: h.priceMin, binSize: h.binSize, values, cap, lo, hi, viewLo: tLo * 0.94, viewHi: tHi * 1.06 };
}

export function HeatmapChart({ heatmap, side, palette, threshold, theme, spot, height, windowKey, up, down, liquidations, showLiquidations, walls, showWalls }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const closeLine = useRef<ISeriesApi<'Line'> | null>(null);
  const heat = useRef<HeatmapPrimitive | null>(null);
  const nowLine = useRef<IPriceLine | null>(null);
  const dots = useRef<LiquidationDots | null>(null);
  const wallsRef = useRef<OptionsWalls | null>(null);
  const fitted = useRef<string>('');
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [armed, setArmed] = useState(false);
  const hmRef = useRef<Heatmap | null>(null);
  hmRef.current = heatmap;

  const grid = useMemo(() => (heatmap ? buildGrid(heatmap, side) : null), [heatmap, side]);

  /** Scale the visible time range by `factor` around a pixel x (or the centre). */
  const zoomBy = (factor: number, aroundX?: number) => {
    const c = chart.current;
    if (!c) return;
    const ts = c.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const width = box.current?.clientWidth ?? 1;
    const pivotFrac = aroundX === undefined ? 0.5 : Math.max(0, Math.min(1, aroundX / width));
    const pivot = r.from + (r.to - r.from) * pivotFrac;
    const span = Math.max(10, (r.to - r.from) * factor);
    ts.setVisibleLogicalRange({ from: pivot - span * pivotFrac, to: pivot + span * (1 - pivotFrac) });
  };
  /** Show the most recent ~240 bars (about a day at 5m) so candles are legible; zoom out for the rest. */
  const resetView = () => {
    const c = chart.current;
    const n = hmRef.current?.times.length ?? 0;
    if (!c || n === 0) return;
    if (n <= 240) c.timeScale().fitContent();
    else c.timeScale().setVisibleLogicalRange({ from: n - 240, to: n + 3 });
    c.priceScale('right').applyOptions({ autoScale: true });
  };

  // Create the chart once.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const t = THEME[theme];
    const c = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text, fontSize: 10, fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', attributionLogo: false },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { borderColor: t.border, scaleMargins: { top: 0.02, bottom: 0.02 } },
      timeScale: { borderColor: t.border, timeVisible: true, secondsVisible: false, rightOffset: 3, minBarSpacing: 0.5 },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: t.cross, width: 1, style: LineStyle.Solid, labelBackgroundColor: t.label },
        horzLine: { color: t.cross, width: 1, style: LineStyle.Solid, labelBackgroundColor: t.label },
      },
      localization: { priceFormatter: (p: number) => fmtPrice(p) },
      // wheel is off until the chart is clicked, so scrolling the page past it never gets trapped
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true },
    });
    const arm = () => {
      c.applyOptions({ handleScroll: { mouseWheel: true }, handleScale: { mouseWheel: true } });
      setArmed(true);
    };
    const disarm = () => {
      c.applyOptions({ handleScroll: { mouseWheel: false }, handleScale: { mouseWheel: false } });
      setArmed(false);
    };
    const onDocDown = (e: PointerEvent) => {
      if (!el.contains(e.target as Node)) disarm();
    };
    // Ctrl/⌘ + wheel zooms even when not armed (and never scrolls the page)
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 0.8 : 1.25, e.offsetX);
    };
    el.addEventListener('pointerdown', arm);
    document.addEventListener('pointerdown', onDocDown);
    el.addEventListener('wheel', onWheel, { passive: false });
    // a thin close line under the candles keeps the path readable when candles are 1px wide
    const ln = c.addSeries(LineSeries, { color: THEME[theme].line, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const cs = c.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false,
      priceLineVisible: false, lastValueVisible: false,
    });
    closeLine.current = ln;
    const hp = new HeatmapPrimitive();
    hp.setOptions({ palette, theme, threshold, gamma: 1.5 });
    const d = new LiquidationDots();
    const w = new OptionsWalls();
    cs.attachPrimitive(hp);
    cs.attachPrimitive(d);
    cs.attachPrimitive(w);
    chart.current = c;
    heat.current = hp;
    candles.current = cs;
    dots.current = d;
    wallsRef.current = w;

    const onMove = (p: MouseEventParams) => {
      const hm = hmRef.current;
      if (!p.point || !p.time || !hm || !candles.current) return setHover(null);
      const price = candles.current.coordinateToPrice(p.point.y);
      if (price === null) return setHover(null);
      const local = p.time as number;
      const col = hm.times.findIndex((tt) => toChartTime(tt) === local);
      if (col < 0) return setHover(null);
      const bin = Math.floor((price - hm.priceMin) / hm.binSize);
      if (bin < 0 || bin >= hm.bins) return setHover(null);
      const idx = col * hm.bins + bin;
      const k = hm.candles[col];
      setHover({ x: p.point.x, y: p.point.y, timeSec: hm.times[col], level: hm.priceMin + (bin + 0.5) * hm.binSize, long: hm.long[idx], short: hm.short[idx], o: k.o, h: k.h, l: k.l, c: k.c });
    };
    c.subscribeCrosshairMove(onMove);
    return () => {
      el.removeEventListener('pointerdown', arm);
      document.removeEventListener('pointerdown', onDocDown);
      el.removeEventListener('wheel', onWheel);
      c.unsubscribeCrosshairMove(onMove);
      c.remove();
      chart.current = null;
      candles.current = null;
      heat.current = null;
      nowLine.current = null;
      closeLine.current = null;
      dots.current = null;
      wallsRef.current = null;
      fitted.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme + palette + threshold + colours.
  useEffect(() => {
    const c = chart.current;
    if (!c) return;
    const t = THEME[theme];
    c.applyOptions({
      layout: { background: { type: ColorType.Solid, color: t.bg }, textColor: t.text },
      rightPriceScale: { borderColor: t.border },
      timeScale: { borderColor: t.border },
      crosshair: { vertLine: { color: t.cross, labelBackgroundColor: t.label }, horzLine: { color: t.cross, labelBackgroundColor: t.label } },
    });
    heat.current?.setOptions({ palette, theme, threshold });
    candles.current?.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
    nowLine.current?.applyOptions({ color: t.now });
    closeLine.current?.applyOptions({ color: t.line });
    dots.current?.setOptions({ longColor: up, shortColor: down, ring: t.ring });
    wallsRef.current?.setOptions({ callColor: up, putColor: down, text: t.wallText, maxPainColor: t.cross, flipColor: t.text });
  }, [theme, palette, threshold, up, down]);

  // Heatmap + candles.
  useEffect(() => {
    const c = chart.current;
    const hp = heat.current;
    const cs = candles.current;
    if (!c || !hp || !cs) return;
    if (!heatmap || !grid) {
      hp.setGrid(null);
      cs.setData([]);
      closeLine.current?.setData([]);
      return;
    }
    cs.setData(heatmap.candles.map((k) => ({ time: toChartTime(k.t), open: k.o, high: k.h, low: k.l, close: k.c })));
    closeLine.current?.setData(heatmap.candles.map((k) => ({ time: toChartTime(k.t), value: k.c })));
    hp.setGrid(grid);
    // Fit only when the asset or window changes; refreshes must never reset the user's zoom.
    if (fitted.current !== windowKey) {
      resetView();
      fitted.current = windowKey;
    }
  }, [heatmap, grid, windowKey]);

  // Liquidation dots.
  useEffect(() => {
    const d = dots.current;
    if (!d) return;
    if (!showLiquidations || !heatmap || heatmap.times.length < 2) return d.setData([], () => NaN);
    const t0 = heatmap.times[0];
    const step = heatmap.times[1] - heatmap.times[0];
    d.setData(liquidations, (ts) => (ts - t0) / step);
  }, [liquidations, showLiquidations, heatmap]);

  // Options walls.
  useEffect(() => {
    const w = wallsRef.current;
    if (!w) return;
    if (!showWalls || !walls) return w.setData({ rows: [], maxPain: null, flip: null, unit: '' });
    w.setData(walls);
  }, [walls, showWalls]);

  // Current price line.
  useEffect(() => {
    const cs = candles.current;
    if (!cs || !(spot > 0)) return;
    if (!nowLine.current) {
      nowLine.current = cs.createPriceLine({ price: spot, color: THEME[theme].now, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' });
    } else {
      nowLine.current.applyOptions({ price: spot });
    }
  }, [spot, theme]);


  return (
    <div className={`lwc${armed ? ' armed' : ''}`} style={{ height }}>
      <div ref={box} style={{ position: 'absolute', inset: 0 }} />
      <div className="lwc-zoom" role="group" aria-label="Zoom">
        <button onClick={() => zoomBy(0.7)} title="Zoom in (or ⌘/Ctrl + wheel)" aria-label="Zoom in">+</button>
        <button onClick={() => zoomBy(1.4)} title="Zoom out" aria-label="Zoom out">−</button>
        <button onClick={resetView} title="Fit the whole window" aria-label="Reset view">⟲</button>
      </div>
      {!armed && <div className="lwc-hint">click chart to enable wheel zoom · ⌘/Ctrl+wheel always works</div>}
      {hover && (
        <div className="lwc-readout" role="status">
          <span className="t">{new Date(hover.timeSec * 1000).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
          <span><i className="k" style={{ background: up }} /><b>{fmtUsd(hover.long)}</b> longs at {fmtPrice(hover.level)}</span>
          <span><i className="k" style={{ background: down }} /><b>{fmtUsd(hover.short)}</b> shorts</span>
          <span className="muted">O {fmtPrice(hover.o)} H {fmtPrice(hover.h)} L {fmtPrice(hover.l)} C {fmtPrice(hover.c)}</span>
        </div>
      )}
    </div>
  );
}
