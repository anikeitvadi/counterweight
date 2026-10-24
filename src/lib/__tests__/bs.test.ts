import { describe, expect, it } from 'vitest';
import { bsGreeks, bsPrice, normCdf } from '../bs';

describe('black-scholes', () => {
  it('normal cdf matches known values', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975, 3);
    expect(normCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it('prices a textbook call (S=100, K=100, T=1, σ=20%, r=5%) at 10.45', () => {
    expect(bsPrice(100, 100, 1, 0.2, 'call', 0.05)).toBeCloseTo(10.4506, 3);
    expect(bsPrice(100, 100, 1, 0.2, 'put', 0.05)).toBeCloseTo(5.5735, 3);
  });

  it('put-call parity holds', () => {
    const c = bsPrice(80000, 85000, 0.1, 0.5, 'call');
    const p = bsPrice(80000, 85000, 0.1, 0.5, 'put');
    expect(c - p).toBeCloseTo(80000 - 85000, 6);
  });

  it('greeks have the right signs and ATM delta ≈ 0.5', () => {
    const g = bsGreeks(80000, 80000, 30 / 365, 0.45, 'call');
    expect(g.delta).toBeGreaterThan(0.5);
    expect(g.delta).toBeLessThan(0.6);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
    expect(g.vega).toBeGreaterThan(0);
    const p = bsGreeks(80000, 80000, 30 / 365, 0.45, 'put');
    expect(p.delta).toBeCloseTo(g.delta - 1, 10);
    expect(p.gamma).toBeCloseTo(g.gamma, 12);
  });

  it('expired or degenerate inputs return intrinsic delta and zero gamma', () => {
    expect(bsGreeks(80000, 70000, 0, 0.5, 'call')).toEqual({ delta: 1, gamma: 0, theta: 0, vega: 0 });
    expect(bsGreeks(80000, 90000, 0.1, 0, 'put').delta).toBe(-1);
  });
});
