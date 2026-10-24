// OKX public REST + WebSocket (no auth). CORS reflects any origin.
import type { Asset, Candle } from './delta';

const BASE = 'https://www.okx.com/api/v5';
/**
 * OKX's `rubik/stat` endpoints (OI history) answer curl and Node but refuse
 * browser cross-origin calls, so they go through a same-origin relay:
 * Vite's dev proxy locally, `api/okx/[...path].ts` on Vercel.
 */
const RELAY = '/api/okx';
const WS_URL = 'wss://ws.okx.com:8443/ws/v5/public';

export const OKX_INST: Record<Asset, string> = { BTC: 'BTC-USDT-SWAP', ETH: 'ETH-USDT-SWAP', XAUT: 'XAU-USDT-SWAP' };

/** Contract value in coin per contract (`ctVal` from /public/instruments). */
export const CT_VAL: Record<string, number> = { 'BTC-USDT-SWAP': 0.01, 'ETH-USDT-SWAP': 0.1, 'XAU-USDT-SWAP': 0.001 };

export type OkxBar = '5m' | '15m' | '1H';
export const BAR_SECONDS: Record<OkxBar, number> = { '5m': 300, '15m': 900, '1H': 3600 };

export interface PerpState {
  instId: string;
  last: number;
  open24h: number;
  high24h: number;
  low24h: number;
  /** 24h volume in coin (OKX `volCcy24h`). */
  volCcy24h: number;
  /** Open interest in coin. */
  oiCcy: number;
  oiUsd: number;
  /** Current funding rate as a fraction per 8h window (0.0001 = 0.01%). */
  fundingRate: number;
  nextFundingMs: number;
  /** Exchange timestamp (ms) of the newest field. */
  ts: number;
}

export class OkxError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
  }
}

const num = (v: unknown): number => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : 0;
};

const TIMEOUT_MS = 15_000;
/** OKX answers rate-limit hits with HTTP 200 and one of these codes. */
const RATE_LIMIT_CODES = new Set(['50011', '50013', '50061', '50113']);

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/*
 * All OKX REST calls go through one queue with a minimum gap, so the paged
 * history loads (and React StrictMode's doubled effects) never burst past the
 * per-IP limits on the public endpoints.
 */
const MIN_GAP_MS = 230;
let queueTail: Promise<unknown> = Promise.resolve();
let lastStart = 0;
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = lastStart + MIN_GAP_MS - Date.now();
    if (wait > 0) await pause(wait);
    lastStart = Date.now();
    return job();
  };
  const p = queueTail.then(run, run);
  queueTail = p.catch(() => undefined);
  return p;
}

async function getOkx<T>(path: string): Promise<T> {
  let lastErr: OkxError = new OkxError('OKX request failed');
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await pause(600 * 2 ** (attempt - 1));
    try {
      return await enqueue(() => getOnce<T>(path));
    } catch (e) {
      lastErr = e instanceof OkxError ? e : new OkxError(String(e));
      if (!lastErr.retryable) throw lastErr;
    }
  }
  throw lastErr;
}

async function getOnce<T>(path: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const base = path.startsWith('/rubik/') ? RELAY : BASE;
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) throw new OkxError(`OKX ${res.status}`, res.status, res.status === 429 || res.status >= 500);
    const body = (await res.json()) as { code: string; msg: string; data: T };
    if (body.code !== '0') throw new OkxError(`OKX ${body.code}: ${body.msg}`, undefined, RATE_LIMIT_CODES.has(body.code));
    return body.data;
  } catch (e) {
    if (e instanceof OkxError) throw e;
    throw new OkxError(e instanceof DOMException && e.name === 'AbortError' ? 'OKX timed out' : 'Network error', undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- incremental history cache ----------
 * Each key holds candles sorted ascending that are contiguous from `from` to the newest row.
 * A refresh fetches only the newest page and pages backwards until it meets the cache.
 */
interface Series {
  rows: Candle[];
}
const cache = new Map<string, Series>();
const inflight = new Map<string, Promise<Candle[]>>();

function merge(rows: Candle[], incoming: Candle[]): Candle[] {
  const byT = new Map(rows.map((c) => [c.t, c]));
  for (const c of incoming) byT.set(c.t, c);
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/** Pages backwards from `pageOlderThan(ms)` until the rows reach `sinceSec`, merging into the cache. */
function fill(
  key: string,
  sinceSec: number,
  stepSec: number,
  newest: () => Promise<Candle[]>,
  olderThan: (ms: number) => Promise<Candle[]>,
  maxPages: number,
): Promise<Candle[]> {
  // One paging run per series at a time; concurrent callers share it.
  const running = inflight.get(key);
  if (running) return running.then((rows) => rows.filter((c) => c.t >= sinceSec));
  const p = fillOnce(key, sinceSec, stepSec, newest, olderThan, maxPages).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function fillOnce(
  key: string,
  sinceSec: number,
  stepSec: number,
  newest: () => Promise<Candle[]>,
  olderThan: (ms: number) => Promise<Candle[]>,
  maxPages: number,
): Promise<Candle[]> {
  const entry = cache.get(key) ?? { rows: [] };
  const head = await newest();
  if (head.length === 0) return entry.rows.filter((c) => c.t >= sinceSec);
  const cachedNewest = entry.rows.length ? entry.rows[entry.rows.length - 1].t : -Infinity;
  let rows = merge(entry.rows, head);
  let cursor = head[0].t; // oldest of the newest page
  // 1. bridge any gap between the newest page and the cache
  let pages = 0;
  while (cursor - stepSec > cachedNewest && cursor > sinceSec && pages < maxPages) {
    const page = await olderThan(cursor * 1000);
    pages++;
    if (page.length === 0) break;
    rows = merge(rows, page);
    cursor = page[0].t;
  }
  // 2. extend further back than anything cached until `sinceSec`
  let oldest = rows[0].t;
  while (oldest > sinceSec && pages < maxPages) {
    const page = await olderThan(oldest * 1000);
    pages++;
    if (page.length === 0) break;
    rows = merge(rows, page);
    if (page[0].t >= oldest) break;
    oldest = page[0].t;
  }
  // keep memory bounded: drop rows older than 40 days
  const floor = Math.floor(Date.now() / 1000) - 40 * 86_400;
  rows = rows.filter((c) => c.t >= floor);
  cache.set(key, { rows });
  return rows.filter((c) => c.t >= sinceSec);
}

type RawCandle = [string, string, string, string, string, ...string[]];
const parseCandles = (raw: RawCandle[]): Candle[] =>
  raw
    .map((r) => ({ t: Math.floor(num(r[0]) / 1000), o: num(r[1]), h: num(r[2]), l: num(r[3]), c: num(r[4]) }))
    .filter((c) => c.c > 0)
    .sort((a, b) => a.t - b.t);

/** Perp OHLC candles since `sinceSec`, oldest first. */
export function fetchCandles(instId: string, bar: OkxBar, sinceSec: number): Promise<Candle[]> {
  return fill(
    `c:${instId}:${bar}`,
    sinceSec,
    BAR_SECONDS[bar],
    async () => parseCandles(await getOkx<RawCandle[]>(`/market/candles?instId=${instId}&bar=${bar}&limit=300`)),
    async (ms) => parseCandles(await getOkx<RawCandle[]>(`/market/history-candles?instId=${instId}&bar=${bar}&after=${ms}&limit=300`)),
    16,
  );
}

type RawOi = [string, string, string, string];
// [ts, oi (contracts), oiCcy (coin), oiUsd]
const parseOi = (raw: RawOi[]): Candle[] =>
  raw
    .map((r) => {
      const v = num(r[2]);
      return { t: Math.floor(num(r[0]) / 1000), o: v, h: v, l: v, c: v };
    })
    .filter((c) => c.c > 0)
    .sort((a, b) => a.t - b.t);

/**
 * Open-interest history in coin, as candles (o=h=l=c) so it joins the price series by `t`.
 * OKX keeps ~3 days at 5m, ~14 days at 15m, ~30 days at 1H; 100 rows per page.
 */
export function fetchOiHistory(instId: string, bar: OkxBar, sinceSec: number): Promise<Candle[]> {
  const q = `instId=${instId}&period=${bar}&limit=100`;
  return fill(
    `oi:${instId}:${bar}`,
    sinceSec,
    BAR_SECONDS[bar],
    async () => parseOi(await getOkx<RawOi[]>(`/rubik/stat/contracts/open-interest-history?${q}`)),
    async (ms) => parseOi(await getOkx<RawOi[]>(`/rubik/stat/contracts/open-interest-history?${q}&end=${ms}`)),
    40,
  );
}

type RawTicker = { instId: string; last: string; open24h: string; high24h: string; low24h: string; volCcy24h: string; ts: string };
type RawOiNow = { instId: string; oiCcy: string; oiUsd: string; ts: string };
type RawFunding = { instId: string; fundingRate: string; fundingTime: string; ts?: string };

export function tickerPatch(t: RawTicker): Partial<PerpState> {
  return { instId: t.instId, last: num(t.last), open24h: num(t.open24h), high24h: num(t.high24h), low24h: num(t.low24h), volCcy24h: num(t.volCcy24h), ts: num(t.ts) };
}
function oiPatch(o: RawOiNow): Partial<PerpState> {
  return { oiCcy: num(o.oiCcy), oiUsd: num(o.oiUsd), ts: num(o.ts) };
}
function fundingPatch(f: RawFunding): Partial<PerpState> {
  return { fundingRate: num(f.fundingRate), nextFundingMs: num(f.fundingTime) };
}

export async function fetchPerpSnapshot(instId: string): Promise<PerpState> {
  const [t, o, f] = await Promise.all([
    getOkx<RawTicker[]>(`/market/ticker?instId=${instId}`),
    getOkx<RawOiNow[]>(`/public/open-interest?instId=${instId}`),
    getOkx<RawFunding[]>(`/public/funding-rate?instId=${instId}`),
  ]);
  const base: PerpState = { instId, last: 0, open24h: 0, high24h: 0, low24h: 0, volCcy24h: 0, oiCcy: 0, oiUsd: 0, fundingRate: 0, nextFundingMs: 0, ts: 0 };
  return { ...base, ...tickerPatch(t[0]), ...oiPatch(o[0]), ...fundingPatch(f[0]) };
}

export interface Liquidation {
  /** Unix ms. */
  ts: number;
  /** Bankruptcy price. */
  price: number;
  /** Which position was liquidated. */
  side: 'long' | 'short';
  qtyCoin: number;
  usd: number;
}

type RawLiq = { instId: string; details: Array<{ bkPx: string; sz: string; posSide: string; ts: string }> };

function toLiquidations(groups: RawLiq[], instId: string): Liquidation[] {
  const ct = CT_VAL[instId] ?? 1;
  const out: Liquidation[] = [];
  for (const g of groups) {
    if (g.instId !== instId) continue;
    for (const d of g.details) {
      const price = num(d.bkPx);
      const qty = num(d.sz) * ct;
      if (price <= 0 || qty <= 0) continue;
      out.push({ ts: num(d.ts), price, side: d.posSide === 'long' ? 'long' : 'short', qtyCoin: qty, usd: qty * price });
    }
  }
  return out;
}

/**
 * Recent actual liquidations on the perp, newest first, 100 per page. OKX only serves a
 * few hours of history this way, so the websocket keeps the list growing while the desk is open.
 */
export async function fetchLiquidations(instId: string, sinceMs: number, maxPages = 8): Promise<Liquidation[]> {
  const uly = instId.replace('-SWAP', '');
  const q = `instType=SWAP&uly=${uly}&state=filled&limit=100`;
  const out: Liquidation[] = [];
  let after: number | null = null;
  for (let page = 0; page < maxPages; page++) {
    const groups = await getOkx<RawLiq[]>(`/public/liquidation-orders?${q}${after ? `&after=${after}` : ''}`);
    const rows = toLiquidations(groups, instId);
    if (rows.length === 0) break;
    out.push(...rows);
    const oldest = Math.min(...rows.map((r) => r.ts));
    if (oldest <= sinceMs || (after !== null && oldest >= after)) break;
    after = oldest;
  }
  return out.filter((r) => r.ts >= sinceMs).sort((a, b) => a.ts - b.ts);
}

export type WsState = 'connecting' | 'open' | 'closed';

/**
 * Live ticker / open interest / funding over OKX's public websocket. Pings every 25s
 * (OKX closes idle sockets at 30s), reconnects with backoff, recycles after 60s of silence.
 */
export function subscribePerp(
  instId: string,
  onPatch: (p: Partial<PerpState>) => void,
  onState: (s: WsState) => void,
  onLiquidation?: (l: Liquidation[]) => void,
): () => void {
  let ws: WebSocket | null = null;
  let disposed = false;
  let backoff = 1000;
  let lastMsg = Date.now();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;

  const watchdog = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastMsg > 60_000) ws.close();
  }, 10_000);

  const connect = () => {
    if (disposed) return;
    onState('connecting');
    try {
      ws = new WebSocket(WS_URL);
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      lastMsg = Date.now();
      backoff = 1000;
      ws?.send(
        JSON.stringify({
          op: 'subscribe',
          args: [
            { channel: 'tickers', instId },
            { channel: 'open-interest', instId },
            { channel: 'funding-rate', instId },
            // the liquidation feed is per instrument type; we filter to our instId
            { channel: 'liquidation-orders', instType: 'SWAP' },
          ],
        }),
      );
      clearInterval(pingTimer);
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25_000);
      onState('open');
    };
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      if (ev.data === 'pong') return;
      let m: { arg?: { channel: string; instId?: string }; data?: unknown[] };
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (!m.arg || !m.data?.length) return;
      if (m.arg.channel === 'liquidation-orders') {
        const rows = toLiquidations(m.data as RawLiq[], instId);
        if (rows.length && onLiquidation) onLiquidation(rows);
        return;
      }
      if (m.arg.instId !== instId) return;
      const row = m.data[0];
      if (m.arg.channel === 'tickers') onPatch(tickerPatch(row as RawTicker));
      else if (m.arg.channel === 'open-interest') onPatch(oiPatch(row as RawOiNow));
      else if (m.arg.channel === 'funding-rate') onPatch(fundingPatch(row as RawFunding));
    };
    ws.onclose = () => {
      clearInterval(pingTimer);
      onState('closed');
      scheduleReconnect();
    };
    ws.onerror = () => ws?.close();
  };

  const scheduleReconnect = () => {
    if (disposed) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, backoff);
    backoff = Math.min(30_000, backoff * 2);
  };

  connect();
  return () => {
    disposed = true;
    clearInterval(watchdog);
    clearInterval(pingTimer);
    clearTimeout(reconnectTimer);
    if (ws) {
      ws.onclose = null;
      ws.close();
    }
  };
}
