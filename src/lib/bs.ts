/** Black-Scholes greeks for European options on a non-dividend underlying (what Deribit's own greeks use). */

function erf(x: number): number {
  // Abramowitz & Stegun 7.1.26, |error| < 1.5e-7
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return sign * y;
}

export const normCdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));
export const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

export interface Greeks {
  delta: number;
  gamma: number;
  /** Per calendar day. */
  theta: number;
  /** Per 1 vol point (1%). */
  vega: number;
}

/**
 * @param spot underlying price
 * @param strike strike
 * @param tYears time to expiry in years
 * @param iv implied vol as a fraction (0.45 = 45%)
 * @param type 'call' | 'put'
 * @param r risk-free rate (fraction)
 */
export function bsGreeks(spot: number, strike: number, tYears: number, iv: number, type: 'call' | 'put', r = 0): Greeks {
  if (!(spot > 0) || !(strike > 0) || !(iv > 0) || !(tYears > 0)) {
    const intrinsic = type === 'call' ? (spot > strike ? 1 : 0) : spot < strike ? -1 : 0;
    return { delta: intrinsic, gamma: 0, theta: 0, vega: 0 };
  }
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * iv * iv) * tYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  const pdf = normPdf(d1);
  const delta = type === 'call' ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (spot * iv * sqrtT);
  const vega = (spot * pdf * sqrtT) / 100;
  const thetaYear =
    type === 'call'
      ? (-(spot * pdf * iv) / (2 * sqrtT)) - r * strike * Math.exp(-r * tYears) * normCdf(d2)
      : (-(spot * pdf * iv) / (2 * sqrtT)) + r * strike * Math.exp(-r * tYears) * normCdf(-d2);
  return { delta, gamma, theta: thetaYear / 365, vega };
}

/** Black-Scholes price, in quote currency. */
export function bsPrice(spot: number, strike: number, tYears: number, iv: number, type: 'call' | 'put', r = 0): number {
  if (!(tYears > 0) || !(iv > 0)) return Math.max(0, type === 'call' ? spot - strike : strike - spot);
  const sqrtT = Math.sqrt(tYears);
  const d1 = (Math.log(spot / strike) + (r + 0.5 * iv * iv) * tYears) / (iv * sqrtT);
  const d2 = d1 - iv * sqrtT;
  return type === 'call'
    ? spot * normCdf(d1) - strike * Math.exp(-r * tYears) * normCdf(d2)
    : strike * Math.exp(-r * tYears) * normCdf(-d2) - spot * normCdf(-d1);
}
