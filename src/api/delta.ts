// Delta Exchange public REST (no auth): the options chain. CORS is open (`access-control-allow-origin: *`).
const BASE = 'https://api.india.delta.exchange/v2';

export type Asset = 'BTC' | 'ETH' | 'XAUT';
export const ASSETS: Asset[] = ['BTC', 'ETH', 'XAUT'];

export interface OptionTicker {
  symbol: string;
  type: 'call' | 'put';
  strike: number;
  /** Expiry as a UTC timestamp (ms). Delta settles at 12:00 UTC. */
  expiryMs: number;
  /** Open interest in underlying units (BTC, ETH, oz). */
  oi: number;
  oiUsd: number;
  /** 24h traded volume in underlying units. */
  volume: number;
  turnoverUsd: number;
  mark: number;
  markIv: number;
  bidIv: number;
  askIv: number;
  bid: number;
  ask: number;
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  spot: number;
}

export interface Candle {
  /** Unix seconds. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

type RawTicker = {
  symbol: string;
  contract_type: string;
  strike_price?: string;
  oi?: string;
  oi_value_usd?: string;
  volume?: number;
  turnover_usd?: number;
  mark_price?: string;
  spot_price?: string;
  quotes?: { mark_iv?: string | null; bid_iv?: string | null; ask_iv?: string | null; best_bid?: string | null; best_ask?: string | null };
  greeks?: { delta?: string; gamma?: string; theta?: string; vega?: string } | null;
};

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

export class DeltaError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

/** GET with a hard timeout and one retry on network/5xx errors. */
async function getJson<T>(path: string, attempt = 0): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { Accept: 'application/json' }, signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) {
      if (res.status >= 500 && attempt < 1) return retry(path, attempt);
      throw new DeltaError(`Delta ${res.status}`, res.status);
    }
    const body = (await res.json()) as { success: boolean; result: T; error?: { code?: string } };
    if (!body.success) throw new DeltaError(`Delta error: ${body.error?.code ?? 'unknown'}`);
    return body.result;
  } catch (e) {
    if (e instanceof DeltaError) throw e;
    if (attempt < 1) return retry(path, attempt);
    throw new DeltaError(e instanceof DOMException && e.name === 'AbortError' ? 'Delta timed out' : 'Network error');
  } finally {
    clearTimeout(timer);
  }
}

async function retry<T>(path: string, attempt: number): Promise<T> {
  await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  return getJson<T>(path, attempt + 1);
}

/** Symbol like `C-BTC-99000-271126` -> expiry 2026-11-27 12:00 UTC. */
export function parseExpiry(symbol: string): number {
  const tail = symbol.split('-').pop() ?? '';
  const dd = parseInt(tail.slice(0, 2), 10);
  const mm = parseInt(tail.slice(2, 4), 10);
  const yy = parseInt(tail.slice(4, 6), 10);
  return Date.UTC(2000 + yy, mm - 1, dd, 12, 0, 0);
}

export async function fetchOptions(asset: Asset): Promise<OptionTicker[]> {
  const raw = await getJson<RawTicker[]>(
    `/tickers?contract_types=call_options,put_options&underlying_asset_symbols=${asset}`,
  );
  const now = Date.now();
  return raw
    .filter((r) => r.strike_price)
    .map((r): OptionTicker => ({
      symbol: r.symbol,
      type: r.contract_type === 'call_options' ? 'call' : 'put',
      strike: num(r.strike_price),
      expiryMs: parseExpiry(r.symbol),
      oi: num(r.oi),
      oiUsd: num(r.oi_value_usd),
      volume: num(r.volume),
      turnoverUsd: num(r.turnover_usd),
      mark: num(r.mark_price),
      markIv: num(r.quotes?.mark_iv),
      bidIv: num(r.quotes?.bid_iv),
      askIv: num(r.quotes?.ask_iv),
      bid: num(r.quotes?.best_bid),
      ask: num(r.quotes?.best_ask),
      delta: num(r.greeks?.delta),
      gamma: num(r.greeks?.gamma),
      theta: num(r.greeks?.theta),
      vega: num(r.greeks?.vega),
      spot: num(r.spot_price),
    }))
    .filter((o) => o.strike > 0 && o.expiryMs > now);
}

export const DELTA_PERP: Record<Asset, string> = { BTC: 'BTCUSD', ETH: 'ETHUSD', XAUT: 'XAUTUSD' };

/**
 * Fallback open-interest history from Delta's own perp (`OI:` candles, in coin).
 * Used only when the OKX relay is unreachable (e.g. the built page opened from disk).
 */
export async function fetchDeltaOi(asset: Asset, resolution: '5m' | '15m' | '1h', startSec: number, endSec: number): Promise<Candle[]> {
  const raw = await getJson<Array<{ time: number; close: number }>>(
    `/history/candles?symbol=OI:${DELTA_PERP[asset]}&resolution=${resolution}&start=${startSec}&end=${endSec}`,
  );
  return raw
    .map((c) => ({ t: c.time, o: num(c.close), h: num(c.close), l: num(c.close), c: num(c.close) }))
    .filter((c) => c.c > 0)
    .sort((a, b) => a.t - b.t);
}
