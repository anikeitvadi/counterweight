import { describe, expect, it } from 'vitest';
import type { OptionTicker } from '../../api/delta';
import { atmIv, expectedMove, expiryCodes, fmtLean, gammaExposure, groupByExpiry, lean, maxPain, oiByStrike, putCallRatio, realizedVol, resolveExpiry, skew25 } from '../options';

const DAY = 86_400_000;
const now = Date.UTC(2026, 9, 24, 12);

function opt(p: Partial<OptionTicker> & { type: 'call' | 'put'; strike: number }): OptionTicker {
  return {
    symbol: `${p.type === 'call' ? 'C' : 'P'}-BTC-${p.strike}-x`,
    expiryMs: now + 7 * DAY,
    oi: 1,
    oiUsd: 0,
    volume: 1,
    turnoverUsd: 0,
    mark: 0,
    markIv: 0.5,
    bidIv: 0,
    askIv: 0,
    bid: 0,
    ask: 0,
    delta: p.type === 'call' ? 0.5 : -0.5,
    gamma: 0.0001,
    theta: 0,
    vega: 0,
    spot: 80000,
    ...p,
  };
}

describe('options analytics', () => {
  it('max pain is the strike minimising total intrinsic payout', () => {
    // Heavy call OI at 90k and put OI at 70k: pain is lowest in between, at 80k.
    const chain = [
      opt({ type: 'call', strike: 90000, oi: 100 }),
      opt({ type: 'put', strike: 70000, oi: 100 }),
      opt({ type: 'call', strike: 80000, oi: 1 }),
      opt({ type: 'put', strike: 80000, oi: 1 }),
    ];
    expect(maxPain(chain)).toBe(80000);
    expect(maxPain([])).toBeNull();
  });

  it('aggregates OI by strike and computes put/call ratios', () => {
    const chain = [
      opt({ type: 'call', strike: 80000, oi: 10, volume: 4, oiUsd: 1000 }),
      opt({ type: 'put', strike: 80000, oi: 20, volume: 2, oiUsd: 2000 }),
      opt({ type: 'put', strike: 75000, oi: 10, volume: 2, oiUsd: 1000 }),
    ];
    const rows = oiByStrike(chain);
    expect(rows.map(({ strike, callOi, putOi, callOiUsd, putOiUsd }) => ({ strike, callOi, putOi, callOiUsd, putOiUsd }))).toEqual([
      { strike: 75000, callOi: 0, putOi: 10, callOiUsd: 0, putOiUsd: 1000 },
      { strike: 80000, callOi: 10, putOi: 20, callOiUsd: 1000, putOiUsd: 2000 },
    ]);
    expect(rows[1].callVol).toBe(4);
    expect(rows[1].putVolUsd).toBe(2 * 80000);
    const pcr = putCallRatio(chain);
    expect(pcr.oi).toBe(3);
    expect(pcr.volume).toBe(1);
    expect(pcr.callOiUsd).toBe(1000);
    expect(pcr.putOiUsd).toBe(3000);
  });

  it('groups by expiry in date order with fractional days to expiry', () => {
    const chain = [opt({ type: 'call', strike: 1, expiryMs: now + 30 * DAY }), opt({ type: 'put', strike: 1, expiryMs: now + 2 * DAY })];
    const g = groupByExpiry(chain, now);
    expect(g.map((x) => x.dte)).toEqual([2, 30]);
    expect(g[0].puts.length).toBe(1);
  });

  it('ATM IV averages the call and put at the strike nearest spot', () => {
    const chain = [
      opt({ type: 'call', strike: 80000, markIv: 0.4 }),
      opt({ type: 'put', strike: 80000, markIv: 0.6 }),
      opt({ type: 'call', strike: 90000, markIv: 0.9 }),
    ];
    const [g] = groupByExpiry(chain, now);
    expect(atmIv(g, 80500)).toBeCloseTo(0.5, 10);
  });

  it('25-delta skew is put IV minus call IV at |Δ| = 0.25 (interpolated)', () => {
    const chain = [
      opt({ type: 'call', strike: 85000, delta: 0.3, markIv: 0.5 }),
      opt({ type: 'call', strike: 90000, delta: 0.2, markIv: 0.6 }),
      opt({ type: 'put', strike: 75000, delta: -0.3, markIv: 0.7 }),
      opt({ type: 'put', strike: 70000, delta: -0.2, markIv: 0.8 }),
    ];
    const [g] = groupByExpiry(chain, now);
    expect(skew25(g)).toBeCloseTo(0.75 - 0.55, 10);
  });

  it('gamma exposure signs calls positive and puts negative, and finds the flip between them', () => {
    const chain = [
      opt({ type: 'put', strike: 78000, oi: 10, gamma: 0.0001 }),
      opt({ type: 'call', strike: 82000, oi: 10, gamma: 0.0001 }),
    ];
    const g = gammaExposure(chain, 80000);
    expect(g.points[0].gex).toBeLessThan(0);
    expect(g.points[1].gex).toBeGreaterThan(0);
    expect(g.total).toBeCloseTo(0, 6);
    expect(g.flip).not.toBeNull();
    expect(g.flip!).toBeGreaterThan(78000);
    expect(g.flip!).toBeLessThanOrEqual(82000);
  });

  it('expected move scales with sqrt(time) and realised vol annualises log returns', () => {
    expect(expectedMove(0.5, 365, 100)).toBeCloseTo(50, 10);
    expect(expectedMove(0.5, 365 / 4, 100)).toBeCloseTo(25, 10);
    const closes = Array.from({ length: 200 }, (_, i) => 100 * Math.exp(0.01 * (i % 2 === 0 ? 1 : -1)));
    const rv = realizedVol(closes, 365);
    expect(rv).not.toBeNull();
    expect(rv!).toBeGreaterThan(0.3);
    expect(realizedVol([1, 2], 365)).toBeNull();
  });

  it('labels expiries like Delta: D1..D3, first three Fridays W1..W3, later monthlies M2, M3', () => {
    // Delta's own dropdown on 24 Oct 2026: D1 25/10, D2 26/10, D3 27/10, W1 30/10, W2 06/11, W3 13/11, M2 27/11, M3 25/12
    const e = [
      Date.UTC(2026, 9, 25, 12), Date.UTC(2026, 9, 26, 12), Date.UTC(2026, 9, 27, 12), Date.UTC(2026, 9, 30, 12),
      Date.UTC(2026, 10, 6, 12), Date.UTC(2026, 10, 13, 12), Date.UTC(2026, 10, 27, 12), Date.UTC(2026, 11, 25, 12),
    ];
    const codes = expiryCodes(e, Date.UTC(2026, 9, 24, 12));
    expect([...codes.values()]).toEqual(['D1', 'D2', 'D3', 'W1', 'W2', 'W3', 'M2', 'M3']);
  });
});

describe('lean (conviction ratio)', () => {
  it('normalises the smaller side to 1 and names it', () => {
    expect(lean(81.4, 190.2)).toEqual({ ratio: 190.2 / 81.4, fewer: 'puts' });
    expect(lean(120, 84)).toEqual({ ratio: 120 / 84, fewer: 'calls' });
    expect(lean(5, 5)).toEqual({ ratio: 1, fewer: 'even' });
    expect(lean(0, 0)).toBeNull();
    expect(lean(0, 10)).toEqual({ ratio: Infinity, fewer: 'puts' });
  });
  it('formats as 1 : x', () => {
    expect(fmtLean({ ratio: 2.336, fewer: 'puts' })).toBe('1 : 2.34');
    expect(fmtLean({ ratio: 2.336, fewer: 'puts' }, 1)).toBe('1 : 2.3');
    expect(fmtLean({ ratio: Infinity, fewer: 'calls' })).toBe('1 : ∞');
  });
});

describe('resolveExpiry', () => {
  const now = Date.UTC(2026, 9, 24, 12);
  const chain = [1, 2, 7].map((d) => opt({ type: 'call', strike: 1, expiryMs: now + d * DAY }));
  const groups = groupByExpiry(chain, now);
  const codes = expiryCodes(groups.map((g) => g.expiryMs), now);
  it('returns null for all, the coded expiry when present, the front otherwise', () => {
    expect(resolveExpiry(groups, codes, 'all')).toBeNull();
    expect(resolveExpiry(groups, codes, 'D2')?.expiryMs).toBe(now + 2 * DAY);
    expect(resolveExpiry(groups, codes, 'M9')?.expiryMs).toBe(now + DAY);
    expect(resolveExpiry([], codes, 'D1')).toBeNull();
  });
});
