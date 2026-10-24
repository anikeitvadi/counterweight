import type { Candle } from '../api/delta';

/**
 * Estimated liquidation heatmap, built the way the public heatmaps describe
 * their method: every rise in open interest is treated as new positions opened
 * at that bar's price; the notional is spread across leverage tiers with fixed
 * weights; each tier maps to a liquidation price via the maintenance margin;
 * a level stays "live" until price trades through it (liquidated) and shrinks
 * proportionally when open interest falls (positions closed). Every input is
 * an estimate — nothing here is a confirmed position.
 */

export type LiqModel = 'balanced' | 'directional';
export type LiqSide = 'all' | 'long' | 'short';

export interface LiqConfig {
  model: LiqModel;
  /** Maintenance margin as a fraction (0.005 = 0.5%). */
  mm: number;
  bins: number;
}

export const LEVERAGE_TIERS: Array<{ lev: number; w: number }> = [
  { lev: 10, w: 0.18 },
  { lev: 20, w: 0.22 },
  { lev: 25, w: 0.22 },
  { lev: 50, w: 0.18 },
  { lev: 75, w: 0.1 },
  { lev: 100, w: 0.1 },
];

export interface Heatmap {
  times: number[];
  candles: Candle[];
  priceMin: number;
  priceMax: number;
  binSize: number;
  bins: number;
  /** [col * bins + bin] USD notional of live long liquidation levels. */
  long: Float32Array;
  short: Float32Array;
  /** Colour ceilings per side: the strongest cell, so only the top clusters reach the ramp's end. */
  capLong: number;
  capShort: number;
  capAll: number;
}

function quantile(sample: number[], q: number): number {
  if (sample.length === 0) return 0;
  const s = sample.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * (s.length - 1)))];
}

export function computeHeatmap(price: Candle[], oi: Candle[], cfg: LiqConfig): Heatmap | null {
  const oiByT = new Map(oi.map((c) => [c.t, c.c]));
  const rows = price.filter((c) => oiByT.has(c.t));
  if (rows.length < 3) return null;

  let lo = Infinity;
  let hi = -Infinity;
  for (const c of rows) {
    if (c.l < lo) lo = c.l;
    if (c.h > hi) hi = c.h;
  }
  // Room for the 10× levels (±10%) on both sides of the traded range.
  lo *= 0.89;
  hi *= 1.11;
  const bins = cfg.bins;
  const binSize = (hi - lo) / bins;
  const binOf = (p: number) => Math.min(bins - 1, Math.max(0, Math.floor((p - lo) / binSize)));
  const levelOf = (b: number) => lo + (b + 0.5) * binSize;

  const long = new Float32Array(rows.length * bins);
  const short = new Float32Array(rows.length * bins);
  const liveLong = new Float64Array(bins);
  const liveShort = new Float64Array(bins);
  const sampleL: number[] = [];
  const sampleS: number[] = [];
  const sampleA: number[] = [];
  const stride = Math.max(1, Math.floor((rows.length * bins) / 60_000));
  let k = 0;

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    const oiNow = oiByT.get(c.t)!;
    if (i > 0) {
      const prev = rows[i - 1];
      const oiPrev = oiByT.get(prev.t)!;

      // 1. Price traded through a level -> those positions are gone.
      for (let b = 0; b < bins; b++) {
        if (liveLong[b] > 0 && levelOf(b) >= c.l) liveLong[b] = 0;
        if (liveShort[b] > 0 && levelOf(b) <= c.h) liveShort[b] = 0;
      }

      // 2. Open interest fell -> positions closed, scale the book down.
      if (oiPrev > 0 && oiNow < oiPrev) {
        const f = oiNow / oiPrev;
        for (let b = 0; b < bins; b++) {
          liveLong[b] *= f;
          liveShort[b] *= f;
        }
      }

      // 3. Open interest rose -> new positions at this bar's price.
      if (oiNow > oiPrev) {
        const notional = (oiNow - oiPrev) * c.c;
        let longShare = 0.5;
        if (cfg.model === 'directional' && prev.c > 0) {
          const ret = c.c / prev.c - 1;
          longShare = Math.min(0.7, Math.max(0.3, 0.5 + ret * 20));
        }
        for (const { lev, w } of LEVERAGE_TIERS) {
          liveLong[binOf(c.c * (1 - 1 / lev + cfg.mm))] += notional * w * longShare;
          liveShort[binOf(c.c * (1 + 1 / lev - cfg.mm))] += notional * w * (1 - longShare);
        }
      }
    }

    const off = i * bins;
    for (let b = 0; b < bins; b++) {
      const l = liveLong[b];
      const s = liveShort[b];
      long[off + b] = l;
      short[off + b] = s;
      if (k++ % stride === 0) {
        if (l > 0) sampleL.push(l);
        if (s > 0) sampleS.push(s);
        if (l + s > 0) sampleA.push(l + s);
      }
    }
  }

  return {
    times: rows.map((c) => c.t),
    candles: rows,
    priceMin: lo,
    priceMax: hi,
    binSize,
    bins,
    long,
    short,
    capLong: quantile(sampleL, 1),
    capShort: quantile(sampleS, 1),
    capAll: quantile(sampleA, 1),
  };
}

export interface LiqCluster {
  price: number;
  usd: number;
  side: 'long' | 'short';
  /** Distance from the current price, in percent (negative = below). */
  distPct: number;
}

/** Largest live liquidation clusters right now, shorts above spot first, nearest first within each side. */
export function currentClusters(h: Heatmap, spot: number, perSide = 4): LiqCluster[] {
  const col = (h.times.length - 1) * h.bins;
  const pick = (arr: Float32Array, side: 'long' | 'short'): LiqCluster[] => {
    const out: LiqCluster[] = [];
    for (let b = 0; b < h.bins; b++) {
      const usd = arr[col + b];
      if (usd <= 0) continue;
      const price = h.priceMin + (b + 0.5) * h.binSize;
      if (side === 'long' ? price >= spot : price <= spot) continue;
      out.push({ price, usd, side, distPct: ((price - spot) / spot) * 100 });
    }
    return out.sort((a, b) => b.usd - a.usd).slice(0, perSide).sort((a, b) => Math.abs(a.distPct) - Math.abs(b.distPct));
  };
  return [...pick(h.short, 'short').reverse(), ...pick(h.long, 'long')];
}

/** Merge candles into at most `n` buckets for drawing. */
export function aggregateCandles(candles: Candle[], n: number): Array<Candle & { span: number }> {
  if (candles.length <= n) return candles.map((c) => ({ ...c, span: 1 }));
  const per = Math.ceil(candles.length / n);
  const out: Array<Candle & { span: number }> = [];
  for (let i = 0; i < candles.length; i += per) {
    const chunk = candles.slice(i, i + per);
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      c: chunk[chunk.length - 1].c,
      h: Math.max(...chunk.map((c) => c.h)),
      l: Math.min(...chunk.map((c) => c.l)),
      span: chunk.length,
    });
  }
  return out;
}
