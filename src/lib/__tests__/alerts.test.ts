import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, EMPTY_STATE, evaluateAlerts, type AlertInput } from '../alerts';

const base: AlertInput = { asset: 'BTC', spot: 80000, clusters: [], maxPain: 80500, flip: 79000, fundingPct: 0.001, liquidations: [], now: 1_000_000 };
const rules = { ...DEFAULT_RULES, enabled: true };

describe('alerts', () => {
  it('does nothing when disabled', () => {
    const r = evaluateAlerts({ ...base, clusters: [{ price: 80100, usd: 5e6, side: 'short', distPct: 0.12 }] }, DEFAULT_RULES, EMPTY_STATE);
    expect(r.events).toEqual([]);
  });

  it('fires for a big cluster within range, once per cooldown', () => {
    const input = { ...base, clusters: [{ price: 80100, usd: 5e6, side: 'short' as const, distPct: 0.12 }] };
    const first = evaluateAlerts(input, rules, EMPTY_STATE);
    expect(first.events.map((e) => e.kind)).toEqual(['cluster']);
    const again = evaluateAlerts({ ...input, now: base.now + 60_000 }, rules, first.state);
    expect(again.events).toEqual([]);
    const later = evaluateAlerts({ ...input, now: base.now + 31 * 60_000 }, rules, first.state);
    expect(later.events.length).toBe(1);
  });

  it('ignores small or far clusters', () => {
    const r = evaluateAlerts({ ...base, clusters: [{ price: 80100, usd: 1e5, side: 'short', distPct: 0.12 }, { price: 84000, usd: 9e6, side: 'short', distPct: 5 }] }, rules, EMPTY_STATE);
    expect(r.events).toEqual([]);
  });

  it('fires on crossing max pain and the gamma flip, using the previous spot', () => {
    const s1 = evaluateAlerts({ ...base, spot: 80400 }, rules, EMPTY_STATE).state;
    const r = evaluateAlerts({ ...base, spot: 80600, now: base.now + 1000 }, rules, s1);
    expect(r.events.map((e) => e.kind)).toEqual(['maxpain']);
    const s2 = evaluateAlerts({ ...base, spot: 79100 }, rules, EMPTY_STATE).state;
    const f = evaluateAlerts({ ...base, spot: 78900, now: base.now + 1000 }, rules, s2);
    expect(f.events.map((e) => e.kind)).toEqual(['flip']);
  });

  it('fires on extreme funding with an 8h cooldown per sign', () => {
    const r = evaluateAlerts({ ...base, fundingPct: 0.08 }, rules, EMPTY_STATE);
    expect(r.events.map((e) => e.kind)).toEqual(['funding']);
    const r2 = evaluateAlerts({ ...base, fundingPct: 0.09, now: base.now + 3600_000 }, rules, r.state);
    expect(r2.events).toEqual([]);
  });

  it('announces each big liquidation exactly once', () => {
    const liq = { ts: 5, price: 80000, side: 'long' as const, qtyCoin: 20, usd: 1.6e6 };
    const r = evaluateAlerts({ ...base, liquidations: [liq, { ...liq, ts: 6, usd: 100 }] }, rules, EMPTY_STATE);
    expect(r.events.map((e) => e.kind)).toEqual(['liq']);
    const r2 = evaluateAlerts({ ...base, liquidations: [liq], now: base.now + 10 }, rules, r.state);
    expect(r2.events).toEqual([]);
  });
});
