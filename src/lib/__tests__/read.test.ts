import { describe, expect, it } from 'vitest';
import { composeRead } from '../read';

const ctx = { asset: 'BTC', scope: 'D1 · 25 Oct', spot: 80_000, maxPain: 80_600, above: { price: 82_085, usd: 4_000_000, side: 'short' as const, distPct: 2.6 }, below: { price: 78_064, usd: 5_300_000, side: 'long' as const, distPct: -2.4 }, fundingPct: 0.002 };

describe('composeRead', () => {
  it('names the thin side and the lean, then the obstacle in that direction', () => {
    const s = composeRead({ ratio: 2.25, fewer: 'puts' }, ctx);
    expect(s).toMatch(/^BTC on D1 · 25 Oct: calls outweigh puts 2\.3 to 1\. Puts are the thin side, so the lean is short\./);
    expect(s).toContain('Max pain 80,600 sits 0.75% above spot.');
    expect(s).toContain('long cluster on the way down is $5.3M at 78,064, 2.4% below.');
    expect(s).not.toContain('paying');
  });
  it('flips for a call-thin book and mentions funding only when it is extreme', () => {
    const s = composeRead({ ratio: 1.4, fewer: 'calls' }, { ...ctx, fundingPct: -0.05, scope: 'all expiries' });
    expect(s).toContain('BTC across all expiries: puts outweigh calls 1.4 to 1. Calls are the thin side, so the lean is long.');
    expect(s).toContain('short cluster on the way up is $4.0M at 82,085, 2.6% above.');
    expect(s).toContain('Shorts are paying 0.050% per 8h to stay in.');
  });
  it('calls a near-even book balanced and lists both clusters', () => {
    const s = composeRead({ ratio: 1.05, fewer: 'puts' }, { ...ctx, maxPain: null });
    expect(s).toContain('balanced at 1 : 1.05');
    expect(s).toContain('Nearest clusters: $4.0M of shorts 2.6% above, $5.3M of longs 2.4% below.');
    expect(s).not.toContain('Max pain');
  });
  it('degrades without data', () => {
    expect(composeRead(null, ctx)).toBe('BTC: waiting for the options chain.');
    expect(composeRead({ ratio: Infinity, fewer: 'calls' }, { ...ctx, above: null, below: null, maxPain: null })).toBe('BTC on D1 · 25 Oct: puts outweigh calls entirely. Calls are the thin side, so the lean is long.');
  });
});
