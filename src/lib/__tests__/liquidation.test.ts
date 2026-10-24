import { describe, expect, it } from 'vitest';
import type { Candle } from '../../api/delta';
import { aggregateCandles, computeHeatmap, currentClusters, LEVERAGE_TIERS } from '../liquidation';

const bar = (t: number, px: number, oi: number, h = px, l = px): { p: Candle; o: Candle } => ({
  p: { t, o: px, h, l, c: px },
  o: { t, o: oi, h: oi, l: oi, c: oi },
});

function series(rows: Array<{ p: Candle; o: Candle }>) {
  return { price: rows.map((r) => r.p), oi: rows.map((r) => r.o) };
}

describe('liquidation heatmap estimator', () => {
  it('leverage tier weights sum to one', () => {
    expect(LEVERAGE_TIERS.reduce((s, t) => s + t.w, 0)).toBeCloseTo(1, 10);
  });

  it('a rise in OI creates long levels below and short levels above the entry price', () => {
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 20), bar(120, 100, 20)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400 })!;
    expect(h).not.toBeNull();
    const last = (h.times.length - 1) * h.bins;
    let longBelow = 0;
    let shortAbove = 0;
    let wrongSide = 0;
    for (let b = 0; b < h.bins; b++) {
      const level = h.priceMin + (b + 0.5) * h.binSize;
      if (h.long[last + b] > 0) (level < 100 ? longBelow++ : wrongSide++);
      if (h.short[last + b] > 0) (level > 100 ? shortAbove++ : wrongSide++);
    }
    expect(longBelow).toBeGreaterThan(0);
    expect(shortAbove).toBeGreaterThan(0);
    expect(wrongSide).toBe(0);
    // notional = ΔOI × price = 10 × 100, split evenly
    const totalLong = Array.from(h.long.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    const totalShort = Array.from(h.short.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(totalLong).toBeCloseTo(500, 3);
    expect(totalShort).toBeCloseTo(500, 3);
  });

  it('price trading through a level clears it', () => {
    // open positions at 100, then a bar whose low sweeps to 85: every long level ≥ 85 (25×, 50×, 100×: all of them) is gone
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 20), bar(120, 85, 20, 100, 85)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400 })!;
    const last = (h.times.length - 1) * h.bins;
    const liveLong = Array.from(h.long.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(liveLong).toBe(0);
    const liveShort = Array.from(h.short.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(liveShort).toBeCloseTo(500, 3); // shorts above were never touched
  });

  it('falling OI scales the live book down proportionally', () => {
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 20), bar(120, 100, 15)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400 })!;
    const last = (h.times.length - 1) * h.bins;
    const liveLong = Array.from(h.long.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(liveLong).toBeCloseTo(500 * 0.75, 3);
  });

  it('directional model leans new OI toward the bar direction', () => {
    const up = series([bar(0, 100, 10), bar(60, 102, 20), bar(120, 102, 20)]);
    const h = computeHeatmap(up.price, up.oi, { model: 'directional', mm: 0.005, bins: 400 })!;
    const last = (h.times.length - 1) * h.bins;
    const liveLong = Array.from(h.long.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    const liveShort = Array.from(h.short.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(liveLong).toBeGreaterThan(liveShort);
  });

  it('settles open interest as one net entry per window', () => {
    // OI 10 → 15 → 12 over one 2-bar window: net +2 at the window close, not +5 then ×0.8
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 15), bar(120, 100, 12), bar(180, 100, 12)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400, entryBars: 2 })!;
    const last = (h.times.length - 1) * h.bins;
    const liveLong = Array.from(h.long.slice(last, last + h.bins)).reduce((s, v) => s + v, 0);
    expect(liveLong).toBeCloseTo(100, 3); // (12 - 10) × 100 × 0.5
    const perBar = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400 })!;
    const perBarLong = Array.from(perBar.long.slice(last, last + perBar.bins)).reduce((s, v) => s + v, 0);
    expect(perBarLong).toBeCloseTo(250 * 0.8, 3);
  });

  it('bin height follows binPct and is capped by bins', () => {
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 20), bar(120, 100, 20)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400, binPct: 0.001 })!;
    expect(h.bins).toBeLessThan(400);
    expect(h.binSize / 100).toBeCloseTo(0.001, 3);
    expect(computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 50, binPct: 0.001 })!.bins).toBe(50);
  });

  it('returns null without enough joined bars and ignores unmatched timestamps', () => {
    expect(computeHeatmap([{ t: 0, o: 1, h: 1, l: 1, c: 1 }], [], { model: 'balanced', mm: 0.005, bins: 10 })).toBeNull();
  });

  it('current clusters report shorts above and longs below spot, nearest first', () => {
    const { price, oi } = series([bar(0, 100, 10), bar(60, 100, 20), bar(120, 100, 20)]);
    const h = computeHeatmap(price, oi, { model: 'balanced', mm: 0.005, bins: 400 })!;
    const c = currentClusters(h, 100, 2);
    expect(c.filter((x) => x.side === 'short').every((x) => x.price > 100)).toBe(true);
    expect(c.filter((x) => x.side === 'long').every((x) => x.price < 100)).toBe(true);
    const longs = c.filter((x) => x.side === 'long');
    expect(Math.abs(longs[0].distPct)).toBeLessThanOrEqual(Math.abs(longs[1].distPct));
  });

  it('aggregateCandles keeps OHLC semantics across buckets', () => {
    const cs: Candle[] = [
      { t: 0, o: 10, h: 12, l: 9, c: 11 },
      { t: 1, o: 11, h: 15, l: 10, c: 14 },
      { t: 2, o: 14, h: 14, l: 8, c: 9 },
    ];
    const agg = aggregateCandles(cs, 1);
    expect(agg).toEqual([{ t: 0, o: 10, h: 15, l: 8, c: 9, span: 3 }]);
    expect(aggregateCandles(cs, 5).length).toBe(3);
  });
});
