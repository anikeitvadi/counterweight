import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Liquidation } from '../api/okx';
import { fmtCompact, fmtPrice, fmtUsd } from './format';
import type { LiqCluster } from './liquidation';
import type { StrikeOi } from './options';

/** Maps a unix-second timestamp to the chart's logical bar index (bars are regular). */
export type TimeToLogical = (tsSec: number) => number;

abstract class BasePrimitive implements ISeriesPrimitive<Time> {
  protected param: SeriesAttachedParameter<Time> | null = null;
  attached(p: SeriesAttachedParameter<Time>) {
    this.param = p;
  }
  detached() {
    this.param = null;
  }
  requestUpdate() {
    this.param?.requestUpdate();
  }
  abstract paneViews(): readonly IPrimitivePaneView[];
}

/* ---------- actual liquidations as dots ---------- */

export interface LiqDotsOptions {
  longColor: string;
  shortColor: string;
  ring: string;
}

class LiqDotsRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly pts: Array<{ x: number; y: number; r: number; long: boolean }>, private readonly o: LiqDotsOptions) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const p of this.pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.long ? this.o.longColor : this.o.shortColor;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 1;
        ctx.strokeStyle = this.o.ring;
        ctx.stroke();
      }
    });
  }
}

export class LiquidationDots extends BasePrimitive {
  private rows: Liquidation[] = [];
  private toLogical: TimeToLogical = () => NaN;
  private opts: LiqDotsOptions = { longColor: '#089981', shortColor: '#f23645', ring: 'rgba(0,0,0,0.6)' };
  private view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'top',
    renderer: () => this.build(),
  };

  setData(rows: Liquidation[], toLogical: TimeToLogical) {
    this.rows = rows;
    this.toLogical = toLogical;
    this.requestUpdate();
  }
  setOptions(o: Partial<LiqDotsOptions>) {
    this.opts = { ...this.opts, ...o };
    this.requestUpdate();
  }
  paneViews() {
    return [this.view];
  }

  private build(): IPrimitivePaneRenderer | null {
    const p = this.param;
    if (!p || this.rows.length === 0) return null;
    const ts = p.chart.timeScale();
    const range = ts.getVisibleLogicalRange();
    if (!range) return null;
    const pts: Array<{ x: number; y: number; r: number; long: boolean }> = [];
    let maxUsd = 1;
    for (const r of this.rows) if (r.usd > maxUsd) maxUsd = r.usd;
    // logicalToCoordinate only accepts whole bar indexes (fractions return 0), so place the
    // integer bar and add the fraction of one bar's width ourselves.
    const x0 = ts.logicalToCoordinate(0 as Logical);
    const x1 = ts.logicalToCoordinate(1 as Logical);
    if (x0 === null || x1 === null) return null;
    const barW = x1 - x0;
    for (const r of this.rows) {
      const lg = this.toLogical(r.ts / 1000);
      if (!Number.isFinite(lg) || lg < range.from - 1 || lg > range.to + 1) continue;
      const base = Math.floor(lg);
      const bx = ts.logicalToCoordinate(base as Logical);
      const y = p.series.priceToCoordinate(r.price);
      if (bx === null || y === null) continue;
      pts.push({ x: bx + (lg - base) * barW, y, r: 1.5 + 4 * Math.sqrt(r.usd / maxUsd), long: r.side === 'long' });
    }
    return new LiqDotsRenderer(pts, this.opts);
  }
}

/* ---------- options walls: OI by strike on the heatmap's own price axis ---------- */

export interface WallsOptions {
  callColor: string;
  putColor: string;
  text: string;
  maxPainColor: string;
  flipColor: string;
  /** Share of the pane width the largest wall may take. */
  maxShare: number;
}

interface WallsData {
  rows: StrikeOi[];
  maxPain: number | null;
  flip: number | null;
  unit: string;
}

class WallsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly bars: Array<{ y: number; call: number; put: number; strike: number; label: boolean }>,
    private readonly lines: Array<{ y: number; label: string; color: string; dash: number[] }>,
    private readonly o: WallsOptions,
    private readonly unit: string,
  ) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const maxW = W * this.o.maxShare;
      let maxOi = 1;
      for (const b of this.bars) maxOi = Math.max(maxOi, b.call + b.put);
      const h = Math.max(2, Math.min(5, this.barHeight()));
      ctx.font = '10px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      for (const b of this.bars) {
        const cw = (b.call / maxOi) * maxW;
        const pw = (b.put / maxOi) * maxW;
        // calls grow left from the right edge, puts continue further left
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = this.o.callColor;
        ctx.fillRect(W - cw, b.y - h / 2, cw, h);
        ctx.fillStyle = this.o.putColor;
        ctx.fillRect(W - cw - pw, b.y - h / 2, pw, h);
        ctx.globalAlpha = 1;
        if (b.label) {
          const txt = this.unit === '$' ? `${fmtCompact(b.strike)}  ${fmtUsd(b.call + b.put)}` : `${fmtCompact(b.strike)}  ${fmtCompact(b.call + b.put)} ${this.unit}`;
          ctx.fillStyle = this.o.text;
          ctx.textAlign = 'right';
          ctx.fillText(txt, W - cw - pw - 4, b.y);
        }
      }
      for (const l of this.lines) {
        ctx.save();
        ctx.setLineDash(l.dash);
        ctx.strokeStyle = l.color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, l.y);
        ctx.lineTo(W, l.y);
        ctx.stroke();
        ctx.restore();
        ctx.fillStyle = l.color;
        ctx.textAlign = 'left';
        ctx.fillText(l.label, 6, l.y - 7);
      }
    });
  }
  private barHeight(): number {
    if (this.bars.length < 2) return 6;
    let min = Infinity;
    for (let i = 1; i < this.bars.length; i++) min = Math.min(min, Math.abs(this.bars[i].y - this.bars[i - 1].y));
    return min - 1;
  }
}

export class OptionsWalls extends BasePrimitive {
  private data: WallsData = { rows: [], maxPain: null, flip: null, unit: '' };
  private opts: WallsOptions = { callColor: '#089981', putColor: '#f23645', text: '#c3c2b7', maxPainColor: '#c3c2b7', flipColor: '#898781', maxShare: 0.14 };
  private view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'top',
    renderer: () => this.build(),
  };

  setData(d: WallsData) {
    this.data = d;
    this.requestUpdate();
  }
  setOptions(o: Partial<WallsOptions>) {
    this.opts = { ...this.opts, ...o };
    this.requestUpdate();
  }
  paneViews() {
    return [this.view];
  }

  private build(): IPrimitivePaneRenderer | null {
    const p = this.param;
    if (!p || this.data.rows.length === 0) return null;
    const H = p.chart.paneSize().height;
    const bars: Array<{ y: number; call: number; put: number; strike: number; label: boolean }> = [];
    for (const r of this.data.rows) {
      const y = p.series.priceToCoordinate(r.strike);
      if (y === null || y < 0 || y > H) continue;
      bars.push({ y, call: r.callOi, put: r.putOi, strike: r.strike, label: false });
    }
    // label only the two biggest walls on screen
    [...bars].sort((a, b) => b.call + b.put - (a.call + a.put)).slice(0, 2).forEach((b) => (b.label = true));
    const lines: Array<{ y: number; label: string; color: string; dash: number[] }> = [];
    if (this.data.maxPain !== null) {
      const y = p.series.priceToCoordinate(this.data.maxPain);
      if (y !== null && y >= 0 && y <= H) lines.push({ y, label: `max pain ${fmtPrice(this.data.maxPain)}`, color: this.opts.maxPainColor, dash: [6, 4] });
    }
    if (this.data.flip !== null) {
      const y = p.series.priceToCoordinate(this.data.flip);
      if (y !== null && y >= 0 && y <= H) lines.push({ y, label: `gamma flip ${fmtPrice(this.data.flip)}`, color: this.opts.flipColor, dash: [2, 3] });
    }
    return new WallsRenderer(bars, lines, this.opts, this.data.unit);
  }
}

/* ---------- band labels + leader lines: "how far to the pain" without reading the axis ---------- */


export interface BandLabelsOptions {
  text: string;
  muted: string;
  longColor: string;
  shortColor: string;
  backing: string;
  font: string;
  /** Pane width reserved on the right for the side profile, so labels sit left of it. */
  rightInset: number;
}

interface BandLabelsData {
  /** Strongest live clusters (both sides) plus the nearest above and below the price. */
  clusters: LiqCluster[];
  nearestAbove: LiqCluster | null;
  nearestBelow: LiqCluster | null;
  spot: number;
}

type Placed = { y: number; text: string; color: string; strong: boolean };

class BandLabelsRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly labels: Placed[],
    private readonly leaders: Array<{ y0: number; y1: number; text: string; color: string }>,
    private readonly o: BandLabelsOptions,
  ) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const xRight = W - this.o.rightInset - 10;
      ctx.font = this.o.font;
      ctx.textBaseline = 'middle';
      // leader lines: a thin vertical from the price to the nearest cluster on each side, distance written beside it
      const xLead = xRight - 4;
      for (const l of this.leaders) {
        ctx.save();
        ctx.strokeStyle = l.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(xLead, l.y0);
        ctx.lineTo(xLead, l.y1);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(xLead - 3, l.y1);
        ctx.lineTo(xLead + 3, l.y1);
        ctx.stroke();
        ctx.restore();
        const my = (l.y0 + l.y1) / 2;
        if (Math.abs(l.y1 - l.y0) > 26) this.pill(ctx, l.text, xLead - 8, my, l.color, false);
      }
      for (const p of this.labels) this.pill(ctx, p.text, xRight, p.y, p.color, p.strong);
    });
  }
  private pill(ctx: CanvasRenderingContext2D, text: string, xRight: number, y: number, color: string, strong: boolean) {
    const w = ctx.measureText(text).width + 12;
    const h = 16;
    ctx.fillStyle = this.o.backing;
    ctx.beginPath();
    ctx.roundRect(xRight - w, y - h / 2, w, h, 4);
    ctx.fill();
    ctx.fillStyle = strong ? color : this.o.text;
    ctx.textAlign = 'right';
    ctx.fillText(text, xRight - 6, y + 0.5);
  }
}

export class BandLabels extends BasePrimitive {
  private data: BandLabelsData = { clusters: [], nearestAbove: null, nearestBelow: null, spot: 0 };
  private opts: BandLabelsOptions = { text: '#f4f4f5', muted: '#a1a1aa', longColor: '#089981', shortColor: '#f23645', backing: 'rgba(9,9,11,0.78)', font: '500 10.5px "Geist Mono Variable", ui-monospace, monospace', rightInset: 0 };
  private view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'top',
    renderer: () => this.build(),
  };
  setData(d: BandLabelsData) {
    this.data = d;
    this.requestUpdate();
  }
  setOptions(o: Partial<BandLabelsOptions>) {
    this.opts = { ...this.opts, ...o };
    this.requestUpdate();
  }
  paneViews() {
    return [this.view];
  }
  private build(): IPrimitivePaneRenderer | null {
    const p = this.param;
    const d = this.data;
    if (!p || !(d.spot > 0) || (d.clusters.length === 0 && !d.nearestAbove && !d.nearestBelow)) return null;
    const H = p.chart.paneSize().height;
    const ySpot = p.series.priceToCoordinate(d.spot);
    if (ySpot === null) return null;
    const colorOf = (c: LiqCluster) => (c.side === 'long' ? this.opts.longColor : this.opts.shortColor);
    // Labels: nearest above/below always, then the strongest others, at most four, de-duplicated by price.
    const seen = new Set<number>();
    const picks: Array<{ c: LiqCluster; strong: boolean }> = [];
    for (const c of [d.nearestAbove, d.nearestBelow]) if (c && !seen.has(c.price)) { seen.add(c.price); picks.push({ c, strong: true }); }
    for (const c of [...d.clusters].sort((a, b) => b.usd - a.usd)) {
      if (picks.length >= 4) break;
      if (!seen.has(c.price)) { seen.add(c.price); picks.push({ c, strong: false }); }
    }
    const labels: Placed[] = [];
    for (const { c, strong } of picks) {
      const y = p.series.priceToCoordinate(c.price);
      if (y === null || y < 8 || y > H - 8) continue;
      labels.push({ y, text: `${fmtUsd(c.usd)} ${c.side}s · ${fmtPrice(c.price)}`, color: colorOf(c), strong });
    }
    // Push overlapping labels apart (16px pills, 3px air), keeping their order along the axis.
    labels.sort((a, b) => a.y - b.y);
    for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 19) labels[i].y = labels[i - 1].y + 19;
    for (let i = labels.length - 2; i >= 0; i--) if (labels[i + 1].y - labels[i].y < 19) labels[i].y = labels[i + 1].y - 19;
    const leaders: Array<{ y0: number; y1: number; text: string; color: string }> = [];
    for (const c of [d.nearestAbove, d.nearestBelow]) {
      if (!c) continue;
      const y = p.series.priceToCoordinate(c.price);
      if (y === null) continue;
      leaders.push({ y0: ySpot, y1: Math.max(2, Math.min(H - 2, y)), text: `${c.distPct > 0 ? '+' : '−'}${Math.abs(c.distPct).toFixed(1)}%`, color: colorOf(c) });
    }
    return new BandLabelsRenderer(labels, leaders, this.opts);
  }
}

/* ---------- side profile: live liquidation notional by price, Coinglass-style, at the right edge ---------- */

export interface ProfileOptions {
  longColor: string;
  shortColor: string;
  text: string;
  backing: string;
  font: string;
  /** Share of the pane width the largest bar may take. */
  maxShare: number;
}

interface ProfileData {
  /** [bin] live notional for the latest column. */
  long: Float32Array | null;
  short: Float32Array | null;
  priceMin: number;
  binSize: number;
  bins: number;
  spot: number;
}

class ProfileRenderer implements IPrimitivePaneRenderer {
  constructor(
    private readonly rows: Array<{ y: number; h: number; long: number; short: number }>,
    private readonly totals: { above: number; below: number },
    private readonly o: ProfileOptions,
  ) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const W = mediaSize.width;
      const H = mediaSize.height;
      const maxW = W * this.o.maxShare;
      let max = 1;
      for (const r of this.rows) max = Math.max(max, r.long + r.short);
      for (const r of this.rows) {
        const lw = (r.long / max) * maxW;
        const sw = (r.short / max) * maxW;
        if (lw > 0) {
          ctx.fillStyle = this.o.longColor;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(W - lw, r.y, lw, r.h);
        }
        if (sw > 0) {
          ctx.fillStyle = this.o.shortColor;
          ctx.globalAlpha = 0.55;
          ctx.fillRect(W - lw - sw, r.y, sw, r.h);
        }
      }
      ctx.globalAlpha = 1;
      ctx.font = this.o.font;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      const tag = (text: string, y: number, color: string) => {
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = this.o.backing;
        ctx.beginPath();
        ctx.roundRect(W - w - 4, y - 8, w, 16, 4);
        ctx.fill();
        ctx.fillStyle = color;
        ctx.fillText(text, W - 9, y + 0.5);
      };
      if (this.totals.above > 0) tag(`${fmtUsd(this.totals.above)} shorts above`, 12, this.o.shortColor);
      if (this.totals.below > 0) tag(`${fmtUsd(this.totals.below)} longs below`, H - 12, this.o.longColor);
    });
  }
}

export class LiqProfile extends BasePrimitive {
  private data: ProfileData = { long: null, short: null, priceMin: 0, binSize: 1, bins: 0, spot: 0 };
  private opts: ProfileOptions = { longColor: '#089981', shortColor: '#f23645', text: '#f4f4f5', backing: 'rgba(9,9,11,0.78)', font: '500 10.5px "Geist Mono Variable", ui-monospace, monospace', maxShare: 0.12 };
  private view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'top',
    renderer: () => this.build(),
  };
  setData(d: ProfileData) {
    this.data = d;
    this.requestUpdate();
  }
  setOptions(o: Partial<ProfileOptions>) {
    this.opts = { ...this.opts, ...o };
    this.requestUpdate();
  }
  paneViews() {
    return [this.view];
  }
  private build(): IPrimitivePaneRenderer | null {
    const p = this.param;
    const d = this.data;
    if (!p || !d.long || !d.short || d.bins === 0) return null;
    const H = p.chart.paneSize().height;
    const rows: Array<{ y: number; h: number; long: number; short: number }> = [];
    const totals = { above: 0, below: 0 };
    for (let b = 0; b < d.bins; b++) {
      const lo = d.priceMin + b * d.binSize;
      const hi = lo + d.binSize;
      const l = d.long[b];
      const s = d.short[b];
      if (l + s <= 0) continue;
      const yTop = p.series.priceToCoordinate(hi);
      const yBot = p.series.priceToCoordinate(lo);
      if (yTop === null || yBot === null || yBot < 0 || yTop > H) continue;
      rows.push({ y: yTop, h: Math.max(1, yBot - yTop - 0.5), long: l, short: s });
      const mid = lo + d.binSize / 2;
      if (d.spot > 0) (mid > d.spot ? (totals.above += l + s) : (totals.below += l + s));
    }
    return new ProfileRenderer(rows, totals, this.opts);
  }
}

/* ---------- sweep flash: a band that price just traded through lights up for a few seconds ---------- */

export interface Sweep {
  ts: number;
  price: number;
  usd: number;
  side: 'long' | 'short';
}

class SweepRenderer implements IPrimitivePaneRenderer {
  constructor(private readonly rows: Array<{ y: number; h: number; alpha: number; color: string }>) {}
  draw(target: CanvasRenderingTarget2D) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      for (const r of this.rows) {
        ctx.globalAlpha = r.alpha;
        ctx.fillStyle = r.color;
        ctx.fillRect(0, r.y, mediaSize.width, r.h);
      }
      ctx.globalAlpha = 1;
    });
  }
}

export class SweepFlash extends BasePrimitive {
  private sweeps: Sweep[] = [];
  private binSize = 1;
  private opts = { longColor: '#089981', shortColor: '#f23645', lifeMs: 6000 };
  private timer: ReturnType<typeof setInterval> | null = null;
  private view: IPrimitivePaneView = {
    zOrder: (): PrimitivePaneViewZOrder => 'top',
    renderer: () => this.build(),
  };
  setData(sweeps: Sweep[], binSize: number) {
    this.sweeps = sweeps;
    this.binSize = binSize;
    this.requestUpdate();
    // keep repainting while anything is still fading
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      const live = this.sweeps.some((s) => Date.now() - s.ts < this.opts.lifeMs);
      this.requestUpdate();
      if (!live && this.timer) { clearInterval(this.timer); this.timer = null; }
    }, 120);
  }
  setOptions(o: Partial<{ longColor: string; shortColor: string; lifeMs: number }>) {
    this.opts = { ...this.opts, ...o };
  }
  detached() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    super.detached();
  }
  paneViews() {
    return [this.view];
  }
  private build(): IPrimitivePaneRenderer | null {
    const p = this.param;
    if (!p || this.sweeps.length === 0) return null;
    const now = Date.now();
    const rows: Array<{ y: number; h: number; alpha: number; color: string }> = [];
    for (const s of this.sweeps) {
      const age = now - s.ts;
      if (age > this.opts.lifeMs) continue;
      const yTop = p.series.priceToCoordinate(s.price + this.binSize / 2);
      const yBot = p.series.priceToCoordinate(s.price - this.binSize / 2);
      if (yTop === null || yBot === null) continue;
      const k = 1 - age / this.opts.lifeMs;
      rows.push({ y: yTop - 2, h: Math.max(3, yBot - yTop) + 4, alpha: 0.12 + 0.5 * k * k, color: s.side === 'long' ? this.opts.longColor : this.opts.shortColor });
    }
    return rows.length ? new SweepRenderer(rows) : null;
  }
}
