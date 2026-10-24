import { describe, expect, it } from 'vitest';
import { parseInstrument, toOptionTickers, type RawBookSummary } from '../../api/deribit';
import { ivRank } from '../ivrank';

describe('deribit mapping', () => {
  it('parses instrument names, including single-digit days', () => {
    expect(parseInstrument('BTC-27NOV26-73000-P')).toEqual({ expiryMs: Date.UTC(2026, 10, 27, 8), strike: 73000, type: 'put' });
    expect(parseInstrument('ETH-6NOV26-2400-C')).toEqual({ expiryMs: Date.UTC(2026, 10, 6, 8), strike: 2400, type: 'call' });
    expect(parseInstrument('BTC-PERPETUAL')).toBeNull();
    expect(parseInstrument('BTC-27NOV26')).toBeNull();
  });

  it('maps a book summary row into the shared option shape with BS greeks', () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const row: RawBookSummary = {
      instrument_name: 'BTC-27NOV26-80000-C',
      open_interest: 100,
      mark_price: 0.05,
      mark_iv: 45,
      underlying_price: 80000,
      volume: 10,
      volume_usd: 400000,
      bid_price: 0.049,
      ask_price: 0.051,
    };
    const [o] = toOptionTickers([row], 79900, now);
    expect(o.strike).toBe(80000);
    expect(o.type).toBe('call');
    expect(o.markIv).toBeCloseTo(0.45, 10);
    expect(o.oiUsd).toBe(100 * 80000);
    expect(o.mark).toBeCloseTo(4000, 6);
    expect(o.spot).toBe(79900);
    expect(o.delta).toBeGreaterThan(0.5);
    expect(o.delta).toBeLessThan(0.65);
    expect(o.gamma).toBeGreaterThan(0);
  });

  it('drops expired instruments and junk names', () => {
    const now = Date.UTC(2026, 9, 24, 12);
    const rows: RawBookSummary[] = [
      { instrument_name: 'BTC-23OCT26-80000-C', open_interest: 1, mark_price: 0, mark_iv: 40, underlying_price: 80000, volume: 0, volume_usd: 0, bid_price: null, ask_price: null },
      { instrument_name: 'BTC-PERPETUAL', open_interest: 1, mark_price: 0, mark_iv: 0, underlying_price: 80000, volume: 0, volume_usd: 0, bid_price: null, ask_price: null },
    ];
    expect(toOptionTickers(rows, 80000, now)).toEqual([]);
  });
});

describe('iv rank', () => {
  it('ranks the latest close within the history', () => {
    const hist = Array.from({ length: 100 }, (_, i) => ({ t: i, close: 20 + i })); // 20..119, latest 119
    const r = ivRank(hist)!;
    expect(r.rank).toBeCloseTo(1, 10);
    expect(r.percentile).toBeCloseTo(0.99, 10);
    const mid = ivRank([...hist.slice(0, 99), { t: 99, close: 69.5 }])!;
    expect(mid.rank).toBeCloseTo((69.5 - 20) / (118 - 20), 6);
  });
  it('needs at least 20 days', () => {
    expect(ivRank([{ t: 1, close: 50 }])).toBeNull();
  });
});
