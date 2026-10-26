import { describe, expect, it } from 'vitest';
import { parseExpiry, SETTLE_HOUR_UTC } from '../../api/delta';

describe('Delta expiry parsing', () => {
  it('reads ddmmyy from the symbol and uses the asset settlement hour', () => {
    expect(parseExpiry('C-BTC-99000-271126', 'BTC')).toBe(Date.UTC(2026, 10, 27, 12));
    expect(parseExpiry('P-XAUT-4120-261026', 'XAUT')).toBe(Date.UTC(2026, 9, 26, 16));
    expect(parseExpiry('P-XAUT-4120-261026')).toBe(Date.UTC(2026, 9, 26, 12));
  });
  it('keeps the afternoon gold expiry alive until 16:00 UTC', () => {
    const noonish = Date.UTC(2026, 9, 26, 14, 58);
    expect(parseExpiry('C-XAUT-4000-261026', 'XAUT')).toBeGreaterThan(noonish);
    expect(SETTLE_HOUR_UTC.XAUT).toBe(16);
  });
});
