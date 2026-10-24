// Deribit public REST (no auth, CORS open). The deepest crypto options venue: used for BTC and ETH chains and the DVOL index.
import { bsGreeks } from '../lib/bs';
import type { Asset, OptionTicker } from './delta';

const BASE = 'https://www.deribit.com/api/v2/public';
export const DERIBIT_CCY: Partial<Record<Asset, 'BTC' | 'ETH'>> = { BTC: 'BTC', ETH: 'ETH' };

export class DeribitError extends Error {}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

async function rpc<T>(method: string, params: Record<string, string | number>, attempt = 0): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)])).toString();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(`${BASE}/${method}?${qs}`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) {
      if ((res.status === 429 || res.status >= 500) && attempt < 2) return retry(method, params, attempt);
      throw new DeribitError(`Deribit ${res.status}`);
    }
    const body = (await res.json()) as { result?: T; error?: { message: string; code: number } };
    if (body.error) throw new DeribitError(`Deribit ${body.error.code}: ${body.error.message}`);
    return body.result as T;
  } catch (e) {
    if (e instanceof DeribitError) throw e;
    if (attempt < 1) return retry(method, params, attempt);
    throw new DeribitError(e instanceof DOMException && e.name === 'AbortError' ? 'Deribit timed out' : 'Network error');
  } finally {
    clearTimeout(timer);
  }
}
async function retry<T>(method: string, params: Record<string, string | number>, attempt: number): Promise<T> {
  await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  return rpc<T>(method, params, attempt + 1);
}

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** `BTC-27NOV26-73000-P` -> { expiryMs (08:00 UTC), strike, type }. Returns null for anything that isn't an option name. */
export function parseInstrument(name: string): { expiryMs: number; strike: number; type: 'call' | 'put' } | null {
  const m = /^[A-Z]+-(\d{1,2})([A-Z]{3})(\d{2})-(\d+(?:\.\d+)?)-([CP])$/.exec(name);
  if (!m) return null;
  const month = MONTHS[m[2]];
  if (month === undefined) return null;
  return {
    expiryMs: Date.UTC(2000 + parseInt(m[3], 10), month, parseInt(m[1], 10), 8, 0, 0),
    strike: parseFloat(m[4]),
    type: m[5] === 'C' ? 'call' : 'put',
  };
}

export interface RawBookSummary {
  instrument_name: string;
  open_interest: number;
  mark_price: number;
  mark_iv: number;
  underlying_price: number;
  volume: number;
  volume_usd: number;
  bid_price: number | null;
  ask_price: number | null;
}

/** Map Deribit's book summary into the shared option shape; greeks are Black-Scholes from mark IV. */
export function toOptionTickers(rows: RawBookSummary[], index: number, nowMs = Date.now()): OptionTicker[] {
  const out: OptionTicker[] = [];
  for (const r of rows) {
    const meta = parseInstrument(r.instrument_name);
    if (!meta || meta.expiryMs <= nowMs) continue;
    const under = num(r.underlying_price) || index;
    const iv = num(r.mark_iv) / 100;
    const tYears = (meta.expiryMs - nowMs) / (365 * 86_400_000);
    const g = bsGreeks(under, meta.strike, tYears, iv, meta.type);
    const oi = num(r.open_interest);
    out.push({
      symbol: r.instrument_name,
      type: meta.type,
      strike: meta.strike,
      expiryMs: meta.expiryMs,
      oi,
      oiUsd: oi * under,
      volume: num(r.volume),
      turnoverUsd: num(r.volume_usd),
      mark: num(r.mark_price) * under,
      markIv: iv,
      bidIv: 0,
      askIv: 0,
      bid: num(r.bid_price) * under,
      ask: num(r.ask_price) * under,
      delta: g.delta,
      gamma: g.gamma,
      theta: g.theta,
      vega: g.vega,
      spot: index,
    });
  }
  return out;
}

export async function fetchDeribitOptions(ccy: 'BTC' | 'ETH'): Promise<OptionTicker[]> {
  const [rows, idx] = await Promise.all([
    rpc<RawBookSummary[]>('get_book_summary_by_currency', { currency: ccy, kind: 'option' }),
    rpc<{ index_price: number }>('get_index_price', { index_name: `${ccy.toLowerCase()}_usd` }),
  ]);
  return toOptionTickers(rows, num(idx.index_price));
}

export interface DvolPoint {
  /** Unix ms, start of day. */
  t: number;
  close: number;
}

/** Daily DVOL (Deribit's 30-day implied-vol index) for the last `days`. */
export async function fetchDvolHistory(ccy: 'BTC' | 'ETH', days = 365): Promise<DvolPoint[]> {
  const end = Date.now();
  const res = await rpc<{ data: Array<[number, number, number, number, number]> }>('get_volatility_index_data', {
    currency: ccy,
    resolution: '1D',
    start_timestamp: end - days * 86_400_000,
    end_timestamp: end,
  });
  return (res.data ?? []).map((r) => ({ t: r[0], close: num(r[4]) })).filter((p) => p.close > 0).sort((a, b) => a.t - b.t);
}
