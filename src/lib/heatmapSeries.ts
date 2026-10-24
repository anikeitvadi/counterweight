import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type {
  AutoscaleInfo, IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, Time,
} from 'lightweight-charts';

/**
 * A lightweight-charts series primitive (z-order "bottom") that paints a
 * price × time heatmap beneath the candles it is attached to. A primitive is
 * used rather than a custom series because the chart redraws the hovered series
 * last, which would paint the heatmap over the candles on hover. The grid is
 * rasterised once per visible range into an ImageData that is reused while
 * only the crosshair moves.
 */

export type Palette = 'viridis' | 'mono';
export type RGB = [number, number, number];
type Stop = { at: number; c: RGB };

const VIRIDIS: Stop[] = [
  { at: 0, c: [48, 10, 72] },
  { at: 0.2, c: [68, 1, 84] },
  { at: 0.4, c: [59, 82, 139] },
  { at: 0.6, c: [33, 145, 140] },
  { at: 0.8, c: [94, 201, 98] },
  { at: 1, c: [253, 231, 37] },
];
const MONO_DARK: Stop[] = [
  { at: 0, c: [26, 26, 25] },
  { at: 0.3, c: [16, 50, 100] },
  { at: 0.6, c: [28, 92, 171] },
  { at: 0.85, c: [57, 135, 229] },
  { at: 1, c: [205, 226, 251] },
];
const MONO_LIGHT: Stop[] = [
  { at: 0, c: [252, 252, 251] },
  { at: 0.3, c: [205, 226, 251] },
  { at: 0.6, c: [134, 182, 239] },
  { at: 0.85, c: [42, 120, 214] },
  { at: 1, c: [13, 54, 107] },
];

export function paletteStops(palette: Palette, theme: 'dark' | 'light'): Stop[] {
  return palette === 'viridis' ? VIRIDIS : theme === 'light' ? MONO_LIGHT : MONO_DARK;
}

export function paletteCss(palette: Palette, theme: 'dark' | 'light'): string {
  return `linear-gradient(90deg, ${paletteStops(palette, theme).map((s) => `rgb(${s.c[0]},${s.c[1]},${s.c[2]}) ${Math.round(s.at * 100)}%`).join(',')})`;
}

function ramp(stops: Stop[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x <= b.at) {
      const f = (x - a.at) / (b.at - a.at || 1);
      return [a.c[0] + (b.c[0] - a.c[0]) * f, a.c[1] + (b.c[1] - a.c[1]) * f, a.c[2] + (b.c[2] - a.c[2]) * f];
    }
  }
  return stops[stops.length - 1].c;
}

const lutCache = new Map<string, Uint8ClampedArray>();
function lutFor(palette: Palette, theme: 'dark' | 'light'): Uint8ClampedArray {
  const key = `${palette}:${theme}`;
  let lut = lutCache.get(key);
  if (!lut) {
    lut = new Uint8ClampedArray(256 * 3);
    const stops = paletteStops(palette, theme);
    for (let i = 0; i < 256; i++) {
      const [r, g, b] = ramp(stops, i / 255);
      lut[i * 3] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    lutCache.set(key, lut);
  }
  return lut;
}

export interface HeatmapGrid {
  bins: number;
  priceMin: number;
  binSize: number;
  /** [col * bins + bin] intensity in USD. */
  values: Float32Array;
  /** Colour ceiling (robust max). */
  cap: number;
  /** Per-column lowest / highest non-zero level. */
  lo: Float32Array;
  hi: Float32Array;
  /** Price range the chart should show by default: the traded range plus a margin for nearby bands. */
  viewLo: number;
  viewHi: number;
}

export interface HeatmapOptions {
  palette: Palette;
  theme: 'dark' | 'light';
  threshold: number;
  gamma: number;
}

const DEFAULTS: HeatmapOptions = { palette: 'viridis', theme: 'dark', threshold: 0.2, gamma: 1.5 };

class HeatmapRenderer implements IPrimitivePaneRenderer {
  private cacheKey = '';
  private cacheImg: ImageData | null = null;
  private cacheGrid: HeatmapGrid | null = null;

  constructor(private readonly owner: HeatmapPrimitive) {}

  draw(target: CanvasRenderingTarget2D): void {
    const p = this.owner.param;
    const grid = this.owner.grid;
    if (!p || !grid) return;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const cols = grid.values.length / grid.bins;
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(cols - 1, Math.ceil(range.to));
    if (to < from) return;
    const x0m = ts.logicalToCoordinate(0 as Logical);
    const x1m = ts.logicalToCoordinate(1 as Logical);
    if (x0m === null || x1m === null) return;
    const spacing = x1m - x0m;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr } = scope;
      const W = bitmapSize.width;
      const H = bitmapSize.height;
      if (W === 0 || H === 0) return;
      const yEdge = new Float32Array(grid.bins + 1);
      for (let b = 0; b <= grid.bins; b++) {
        const y = p.series.priceToCoordinate(grid.priceMin + b * grid.binSize);
        yEdge[b] = y === null ? NaN : y * vpr;
      }
      const o = this.owner.options;
      const key = [x0m, spacing, from, to, yEdge[0], yEdge[grid.bins], W, H, o.palette, o.theme, o.threshold, o.gamma].join('|');
      if (key !== this.cacheKey || !this.cacheImg || this.cacheGrid !== grid) {
        this.cacheImg = this.rasterise(ctx, grid, o, W, H, from, to, (x0m + from * spacing) * hpr, spacing * hpr, yEdge);
        this.cacheKey = key;
        this.cacheGrid = grid;
      }
      ctx.putImageData(this.cacheImg, 0, 0);
    });
  }

  private rasterise(ctx: CanvasRenderingContext2D, grid: HeatmapGrid, o: HeatmapOptions, W: number, H: number, from: number, to: number, xFrom: number, step: number, yEdge: Float32Array): ImageData {
    const bins = grid.bins;
    const lut = lutFor(o.palette, o.theme);
    const floor = o.threshold;
    const gamma = o.gamma;
    const denom = Math.max(1e-9, grid.cap);
    const img = ctx.createImageData(W, H);
    const px = img.data;

    // Which data columns cover each pixel column.
    const startCol = new Int32Array(W).fill(-1);
    const endCol = new Int32Array(W).fill(-1);
    const half = step / 2;
    for (let i = from; i <= to; i++) {
      const cx = xFrom + (i - from) * step;
      const xa = Math.max(0, Math.floor(cx - half));
      const xb = Math.min(W - 1, Math.ceil(cx + half) - 1);
      for (let x = xa; x <= xb; x++) {
        if (startCol[x] < 0) startCol[x] = i;
        endCol[x] = i;
      }
    }

    const r0 = lut[0];
    const g0 = lut[1];
    const b0 = lut[2];
    for (let q = 0; q < px.length; q += 4) {
      px[q] = r0;
      px[q + 1] = g0;
      px[q + 2] = b0;
      px[q + 3] = 255;
    }

    const rowTop = new Int32Array(bins);
    const rowBot = new Int32Array(bins);
    for (let b = 0; b < bins; b++) {
      const yb = yEdge[b];
      const yt = yEdge[b + 1];
      if (Number.isNaN(yb) || Number.isNaN(yt)) {
        rowTop[b] = 1;
        rowBot[b] = 0;
        continue;
      }
      rowTop[b] = Math.max(0, Math.round(Math.min(yt, yb)));
      rowBot[b] = Math.min(H - 1, Math.round(Math.max(yt, yb)) - 1);
      if (rowBot[b] < rowTop[b] && rowTop[b] < H) rowBot[b] = rowTop[b];
    }

    const V = grid.values;
    for (let x = 0; x < W; x++) {
      const c0 = startCol[x];
      if (c0 < 0) continue;
      const c1 = endCol[x];
      for (let b = 0; b < bins; b++) {
        const top = rowTop[b];
        const bot = rowBot[b];
        if (bot < top) continue;
        let v = 0;
        for (let c = c0; c <= c1; c++) {
          const cell = V[c * bins + b];
          if (cell > v) v = cell;
        }
        if (v <= 0) continue;
        let t = v / denom;
        if (t < floor) continue;
        t = Math.pow(Math.min(1, t), gamma);
        const li = Math.round(t * 255) * 3;
        const r = lut[li];
        const g = lut[li + 1];
        const bl = lut[li + 2];
        for (let y = top; y <= bot; y++) {
          const q = (y * W + x) * 4;
          px[q] = r;
          px[q + 1] = g;
          px[q + 2] = bl;
        }
      }
    }
    return img;
  }
}

export class HeatmapPrimitive implements ISeriesPrimitive<Time> {
  param: SeriesAttachedParameter<Time> | null = null;
  grid: HeatmapGrid | null = null;
  options: HeatmapOptions = DEFAULTS;
  private readonly r = new HeatmapRenderer(this);
  private readonly view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'bottom',
    renderer: () => (this.grid ? this.r : null),
  };

  attached(p: SeriesAttachedParameter<Time>) {
    this.param = p;
  }
  detached() {
    this.param = null;
  }
  setGrid(grid: HeatmapGrid | null) {
    this.grid = grid;
    this.param?.requestUpdate();
  }
  setOptions(o: Partial<HeatmapOptions>) {
    this.options = { ...this.options, ...o };
    this.param?.requestUpdate();
  }
  paneViews() {
    return [this.view];
  }
  /** Keep the traded range plus margin in view (the candles alone would hug the price path). */
  autoscaleInfo(): AutoscaleInfo | null {
    if (!this.grid) return null;
    return { priceRange: { minValue: this.grid.viewLo, maxValue: this.grid.viewHi } };
  }
}
