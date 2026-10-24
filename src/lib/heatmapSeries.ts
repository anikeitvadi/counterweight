import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import {
  customSeriesDefaultOptions,
  type CustomData,
  type CustomSeriesOptions,
  type CustomSeriesPricePlotValues,
  type CustomSeriesWhitespaceData,
  type ICustomSeriesPaneRenderer,
  type ICustomSeriesPaneView,
  type PaneRendererCustomData,
  type PriceToCoordinateConverter,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';

/**
 * A lightweight-charts custom series that paints a price × time heatmap under
 * the candles. The grid is held on the pane view (not in options, which are
 * deep-merged) and rasterised once per visible range into an ImageData that is
 * reused while only the crosshair moves.
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
  /** Per-column lowest / highest non-zero level, for autoscale. */
  lo: Float32Array;
  hi: Float32Array;
}

export interface HeatmapPoint extends CustomData<Time> {
  time: UTCTimestamp;
  col: number;
}

export interface HeatmapOptions extends CustomSeriesOptions {
  palette: Palette;
  theme: 'dark' | 'light';
  threshold: number;
  gamma: number;
}

const defaultHeatmapOptions: HeatmapOptions = {
  ...customSeriesDefaultOptions,
  palette: 'viridis',
  theme: 'dark',
  threshold: 0.2,
  gamma: 1.5,
  lastValueVisible: false,
  priceLineVisible: false,
};

class HeatmapRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, HeatmapPoint> | null = null;
  private options: HeatmapOptions = defaultHeatmapOptions;
  private grid: HeatmapGrid | null = null;
  private cacheKey = '';
  private cacheImg: ImageData | null = null;

  update(data: PaneRendererCustomData<Time, HeatmapPoint>, options: HeatmapOptions, grid: HeatmapGrid | null) {
    this.data = data;
    this.options = options;
    if (grid !== this.grid) this.cacheKey = '';
    this.grid = grid;
  }

  draw(target: CanvasRenderingTarget2D, priceConverter: PriceToCoordinateConverter): void {
    const data = this.data;
    const grid = this.grid;
    if (!data || !grid || !data.visibleRange || data.bars.length === 0) return;
    target.useBitmapCoordinateSpace((scope) => {
      const { context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr } = scope;
      const W = bitmapSize.width;
      const H = bitmapSize.height;
      if (W === 0 || H === 0) return;
      const from = Math.max(0, data.visibleRange!.from);
      const to = Math.min(data.bars.length, data.visibleRange!.to);
      if (to <= from) return;

      // Bin edges in bitmap y (price up = y down).
      const bins = grid.bins;
      const yEdge = new Float32Array(bins + 1);
      for (let b = 0; b <= bins; b++) {
        const y = priceConverter(grid.priceMin + b * grid.binSize);
        yEdge[b] = y === null ? NaN : y * vpr;
      }
      const half = (data.barSpacing * hpr) / 2;
      const key = [data.bars[from].x, data.bars[to - 1].x, from, to, data.barSpacing, yEdge[0], yEdge[bins], W, H, this.options.palette, this.options.theme, this.options.threshold, this.options.gamma].join('|');
      if (key !== this.cacheKey || !this.cacheImg) {
        this.cacheImg = this.rasterise(ctx, W, H, from, to, half, hpr, yEdge);
        this.cacheKey = key;
      }
      ctx.putImageData(this.cacheImg, 0, 0);
    });
  }

  private rasterise(ctx: CanvasRenderingContext2D, W: number, H: number, from: number, to: number, half: number, hpr: number, yEdge: Float32Array): ImageData {
    const data = this.data!;
    const grid = this.grid!;
    const bins = grid.bins;
    const lut = lutFor(this.options.palette, this.options.theme);
    const floor = this.options.threshold;
    const gamma = this.options.gamma;
    const denom = Math.max(1e-9, grid.cap);
    const img = ctx.createImageData(W, H);
    const px = img.data;

    // Which data columns cover each pixel column (bars are ordered left -> right).
    const startCol = new Int32Array(W).fill(-1);
    const endCol = new Int32Array(W).fill(-1);
    for (let i = from; i < to; i++) {
      const bar = data.bars[i];
      const x0 = Math.max(0, Math.floor(bar.x * hpr - half));
      const x1 = Math.min(W - 1, Math.ceil(bar.x * hpr + half) - 1);
      for (let x = x0; x <= x1; x++) {
        if (startCol[x] < 0) startCol[x] = bar.originalData.col;
        endCol[x] = bar.originalData.col;
      }
    }

    // Background = palette floor.
    const r0 = lut[0];
    const g0 = lut[1];
    const b0 = lut[2];
    for (let o = 0; o < px.length; o += 4) {
      px[o] = r0;
      px[o + 1] = g0;
      px[o + 2] = b0;
      px[o + 3] = 255;
    }

    // Visible bin rows.
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
      if (rowBot[b] < rowTop[b] && rowTop[b] < H) rowBot[b] = rowTop[b]; // keep sub-pixel bins visible
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
          const o = (y * W + x) * 4;
          px[o] = r;
          px[o + 1] = g;
          px[o + 2] = bl;
        }
      }
    }
    return img;
  }
}

export class HeatmapSeriesView implements ICustomSeriesPaneView<Time, HeatmapPoint, HeatmapOptions> {
  private readonly r = new HeatmapRenderer();
  private grid: HeatmapGrid | null = null;

  /** Swap the grid; call `setData` on the series afterwards so the chart repaints. */
  setGrid(grid: HeatmapGrid | null) {
    this.grid = grid;
  }

  renderer(): ICustomSeriesPaneRenderer {
    return this.r;
  }

  update(data: PaneRendererCustomData<Time, HeatmapPoint>, options: HeatmapOptions): void {
    this.r.update(data, options, this.grid);
  }

  priceValueBuilder(row: HeatmapPoint): CustomSeriesPricePlotValues {
    // A constant range per window keeps the price axis still while panning and zooming;
    // the chart only rescales when the window (and so the grid) changes.
    const g = this.grid;
    if (!g || row.col >= g.lo.length) return [NaN];
    return [g.priceMin, g.priceMin + g.bins * g.binSize, g.hi[row.col] || g.priceMin];
  }

  isWhitespace(d: HeatmapPoint | CustomSeriesWhitespaceData<Time>): d is CustomSeriesWhitespaceData<Time> {
    return (d as HeatmapPoint).col === undefined;
  }

  defaultOptions(): HeatmapOptions {
    return defaultHeatmapOptions;
  }

  destroy(): void {
    this.grid = null;
  }
}
