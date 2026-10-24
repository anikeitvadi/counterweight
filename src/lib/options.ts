import type { OptionTicker } from '../api/delta';

export interface ExpiryGroup {
  expiryMs: number;
  /** Days to expiry (fractional). */
  dte: number;
  calls: OptionTicker[];
  puts: OptionTicker[];
  strikes: number[];
}

export function groupByExpiry(opts: OptionTicker[], nowMs = Date.now()): ExpiryGroup[] {
  const map = new Map<number, ExpiryGroup>();
  for (const o of opts) {
    let g = map.get(o.expiryMs);
    if (!g) {
      g = { expiryMs: o.expiryMs, dte: Math.max((o.expiryMs - nowMs) / 86_400_000, 1 / 24 / 60), calls: [], puts: [], strikes: [] };
      map.set(o.expiryMs, g);
    }
    (o.type === 'call' ? g.calls : g.puts).push(o);
  }
  for (const g of map.values()) {
    g.strikes = [...new Set([...g.calls, ...g.puts].map((o) => o.strike))].sort((a, b) => a - b);
  }
  return [...map.values()].sort((a, b) => a.expiryMs - b.expiryMs);
}

export interface StrikeOi {
  strike: number;
  /** Open interest in underlying units. */
  callOi: number;
  putOi: number;
  /** Open interest in USD notional. */
  callOiUsd: number;
  putOiUsd: number;
  /** 24h volume in underlying units and in USD notional (volume × spot), as Delta's "Volume($)" chart shows it. */
  callVol: number;
  putVol: number;
  callVolUsd: number;
  putVolUsd: number;
}

export function oiByStrike(opts: OptionTicker[]): StrikeOi[] {
  const map = new Map<number, StrikeOi>();
  for (const o of opts) {
    const row = map.get(o.strike) ?? { strike: o.strike, callOi: 0, putOi: 0, callOiUsd: 0, putOiUsd: 0, callVol: 0, putVol: 0, callVolUsd: 0, putVolUsd: 0 };
    if (o.type === 'call') {
      row.callOi += o.oi;
      row.callOiUsd += o.oiUsd;
      row.callVol += o.volume;
      row.callVolUsd += o.volume * o.spot;
    } else {
      row.putOi += o.oi;
      row.putOiUsd += o.oiUsd;
      row.putVol += o.volume;
      row.putVolUsd += o.volume * o.spot;
    }
    map.set(o.strike, row);
  }
  return [...map.values()].sort((a, b) => a.strike - b.strike);
}

/** Strike at which the total intrinsic value paid out to option holders is smallest. */
export function maxPain(opts: OptionTicker[]): number | null {
  const rows = oiByStrike(opts);
  if (rows.length === 0) return null;
  let best = rows[0].strike;
  let bestPain = Infinity;
  for (const k of rows) {
    let pain = 0;
    for (const r of rows) {
      pain += r.callOi * Math.max(0, k.strike - r.strike) + r.putOi * Math.max(0, r.strike - k.strike);
    }
    if (pain < bestPain) {
      bestPain = pain;
      best = k.strike;
    }
  }
  return best;
}

export interface Pcr {
  oi: number;
  volume: number;
  callOi: number;
  putOi: number;
  callVol: number;
  putVol: number;
  callOiUsd: number;
  putOiUsd: number;
}

export function putCallRatio(opts: OptionTicker[]): Pcr {
  const r: Pcr = { oi: 0, volume: 0, callOi: 0, putOi: 0, callVol: 0, putVol: 0, callOiUsd: 0, putOiUsd: 0 };
  for (const o of opts) {
    if (o.type === 'call') {
      r.callOi += o.oi;
      r.callVol += o.volume;
      r.callOiUsd += o.oiUsd;
    } else {
      r.putOi += o.oi;
      r.putVol += o.volume;
      r.putOiUsd += o.oiUsd;
    }
  }
  r.oi = r.callOi > 0 ? r.putOi / r.callOi : 0;
  r.volume = r.callVol > 0 ? r.putVol / r.callVol : 0;
  return r;
}

const validIv = (o: OptionTicker) => o.markIv > 0.01 && o.markIv < 5;

/** At-the-money IV: mean of the call and put mark IV at the strike nearest spot. */
export function atmIv(g: ExpiryGroup, spot: number): number | null {
  const all = [...g.calls, ...g.puts].filter(validIv);
  if (all.length === 0) return null;
  const nearest = all.reduce((a, b) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a));
  const atStrike = all.filter((o) => o.strike === nearest.strike);
  return atStrike.reduce((s, o) => s + o.markIv, 0) / atStrike.length;
}

export interface TermPoint {
  expiryMs: number;
  dte: number;
  iv: number;
}

export function termStructure(groups: ExpiryGroup[], spot: number): TermPoint[] {
  const out: TermPoint[] = [];
  for (const g of groups) {
    const iv = atmIv(g, spot);
    if (iv !== null) out.push({ expiryMs: g.expiryMs, dte: g.dte, iv });
  }
  return out;
}

export interface SmilePoint {
  strike: number;
  callIv: number | null;
  putIv: number | null;
  /** Call delta at this strike (puts: 1 + put delta), for the delta axis. */
  callDelta: number | null;
}

export function smile(g: ExpiryGroup): SmilePoint[] {
  return g.strikes.map((k) => {
    const c = g.calls.find((o) => o.strike === k);
    const p = g.puts.find((o) => o.strike === k);
    return {
      strike: k,
      callIv: c && validIv(c) ? c.markIv : null,
      putIv: p && validIv(p) ? p.markIv : null,
      callDelta: c ? c.delta : p ? 1 + p.delta : null,
    };
  });
}

/** IV at a target |delta| by linear interpolation along the chain. */
function ivAtDelta(opts: OptionTicker[], target: number): number | null {
  const pts = opts
    .filter(validIv)
    .map((o) => ({ d: Math.abs(o.delta), iv: o.markIv }))
    .filter((p) => p.d > 0.02 && p.d < 0.98)
    .sort((a, b) => a.d - b.d);
  if (pts.length < 2) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if ((a.d <= target && target <= b.d) || (b.d <= target && target <= a.d)) {
      if (b.d === a.d) return a.iv;
      return a.iv + ((target - a.d) / (b.d - a.d)) * (b.iv - a.iv);
    }
  }
  return null;
}

/** 25-delta skew: IV(25d put) - IV(25d call), in vol points. Positive = puts bid. */
export function skew25(g: ExpiryGroup): number | null {
  const p = ivAtDelta(g.puts, 0.25);
  const c = ivAtDelta(g.calls, 0.25);
  return p !== null && c !== null ? p - c : null;
}

export interface GexPoint {
  strike: number;
  /** Dealer gamma exposure in USD per 1% spot move (calls long, puts short convention). */
  gex: number;
}

export function gammaExposure(opts: OptionTicker[], spot: number): { points: GexPoint[]; total: number; flip: number | null } {
  const map = new Map<number, number>();
  for (const o of opts) {
    const sign = o.type === 'call' ? 1 : -1;
    const v = sign * o.gamma * o.oi * spot * spot * 0.01;
    map.set(o.strike, (map.get(o.strike) ?? 0) + v);
  }
  const points = [...map.entries()].map(([strike, gex]) => ({ strike, gex })).sort((a, b) => a.strike - b.strike);
  const total = points.reduce((s, p) => s + p.gex, 0);
  // Gamma flip: where cumulative GEX (from the lowest strike) crosses zero nearest spot.
  let flip: number | null = null;
  let cum = 0;
  let prevCum = 0;
  let prevStrike: number | null = null;
  let bestDist = Infinity;
  for (const p of points) {
    prevCum = cum;
    cum += p.gex;
    if (prevStrike !== null && Math.sign(prevCum) !== Math.sign(cum) && prevCum !== 0) {
      const x = prevStrike + ((0 - prevCum) / (cum - prevCum)) * (p.strike - prevStrike);
      const dist = Math.abs(x - spot);
      if (dist < bestDist) {
        bestDist = dist;
        flip = x;
      }
    }
    prevStrike = p.strike;
  }
  return { points, total, flip };
}

/** One-standard-deviation expected move to expiry, in price units. */
export function expectedMove(iv: number, dte: number, spot: number): number {
  return iv * Math.sqrt(dte / 365) * spot;
}

/** Annualised realised volatility from close-to-close log returns. */
export function realizedVol(closes: number[], barsPerYear: number): number | null {
  if (closes.length < 10) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const varr = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varr * barsPerYear);
}

/**
 * Delta-style expiry codes: non-Friday expiries are D1..Dn, the first three Fridays are W1..W3,
 * and later last-Friday-of-month expiries are M<n> where n counts months from the current one
 * (so October's monthly is M1, November's M2 …). Matches the dropdown on Delta's analytics page.
 */
export function expiryCodes(expiries: number[], nowMs = Date.now()): Map<number, string> {
  const sorted = [...new Set(expiries)].sort((a, b) => a - b);
  const now = new Date(nowMs);
  const baseMonth = now.getUTCFullYear() * 12 + now.getUTCMonth();
  let d = 0;
  let w = 0;
  const out = new Map<number, string>();
  for (const ms of sorted) {
    const dt = new Date(ms);
    if (dt.getUTCDay() !== 5) {
      out.set(ms, `D${++d}`);
      continue;
    }
    if (w < 3) {
      out.set(ms, `W${++w}`);
      continue;
    }
    const monthIdx = dt.getUTCFullYear() * 12 + dt.getUTCMonth() - baseMonth + 1;
    out.set(ms, `M${monthIdx}`);
  }
  return out;
}

/**
 * Conviction view of put vs call open interest: the smaller side is normalised to 1 and the
 * larger side is the ratio, so `1 : 2.3` reads as "2.3× as many of the bigger side".
 * `fewer` names the thin side (the direction a contrarian would trade): fewer puts = crowd is
 * long, so lean short; fewer calls = crowd is hedged, so lean long.
 */
export interface Lean {
  /** Larger side ÷ smaller side, always ≥ 1 (1 when equal or when either side is zero-sized and the other isn't finite). */
  ratio: number;
  fewer: 'puts' | 'calls' | 'even';
}
export function lean(puts: number, calls: number): Lean | null {
  if (!(puts > 0) && !(calls > 0)) return null;
  if (puts === calls) return { ratio: 1, fewer: 'even' };
  const fewer = puts < calls ? 'puts' : 'calls';
  const small = Math.min(puts, calls);
  const big = Math.max(puts, calls);
  return { ratio: small > 0 ? big / small : Infinity, fewer };
}
/** `1 : 2.3` (or `1 : ∞` when one side is empty). */
export function fmtLean(l: Lean, digits = 2): string {
  return `1 : ${Number.isFinite(l.ratio) ? l.ratio.toFixed(digits) : '∞'}`;
}

/**
 * Header expiry selection, kept as Delta's code ('D1', 'W2', …) or 'all' so it carries across
 * assets and venues: each chain resolves the code against its own expiries. A code the chain does
 * not have falls back to the nearest expiry, so "D1" always means "the front".
 */
export type ExpirySel = 'all' | string;
export function resolveExpiry(groups: ExpiryGroup[], codes: Map<number, string>, sel: ExpirySel): ExpiryGroup | null {
  if (sel === 'all') return null;
  return groups.find((g) => codes.get(g.expiryMs) === sel) ?? groups[0] ?? null;
}
