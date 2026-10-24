import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { IPrimitivePaneRenderer, IPrimitivePaneView, ISeriesPrimitive, Logical, PrimitivePaneViewZOrder, SeriesAttachedParameter, Time } from 'lightweight-charts';
import type { Liquidation } from '../api/okx';
import { fmtCompact, fmtPrice, fmtUsd } from './format';
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
