import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchDeltaOi, fetchOptions, type Asset, type Candle, type OptionTicker } from '../api/delta';
import { DERIBIT_CCY, fetchDeribitOptions, fetchDvolHistory, type DvolPoint } from '../api/deribit';
import {
  BAR_SECONDS, fetchCandles, fetchLiquidations, fetchOiHistory, fetchPerpSnapshot, OKX_INST, subscribePerp,
  type Liquidation, type OkxBar, type PerpState, type WsState,
} from '../api/okx';
import { kv } from '../lib/store';

export type RangeKey = '12H' | '1D' | '3D' | '7D' | '30D';
/** OKX keeps 5m OI history for ~3 days, 15m for ~14, 1H for ~30 — the bar follows the window. */
export const RANGES: Record<RangeKey, { days: number; bar: OkxBar }> = {
  '12H': { days: 0.5, bar: '5m' },
  '1D': { days: 1, bar: '5m' },
  '3D': { days: 3, bar: '5m' },
  '7D': { days: 7, bar: '15m' },
  '30D': { days: 30, bar: '1H' },
};

export type Health = 'live' | 'polling' | 'stale' | 'offline' | 'error';
export type OiSource = 'okx' | 'delta';
export type OptionsVenue = 'Deribit' | 'Delta';
export type VenuePref = 'deribit' | 'delta';

/** Put/call ratio sample recorded by this desk (there is no public PCR history to download). */
export interface PcrSample {
  ts: number;
  oi: number;
  vol: number;
  callOi: number;
  putOi: number;
}

/** Per-instrument open interest captured roughly once an hour, for "what opened today". */
export interface OiSnapshot {
  ts: number;
  oi: Record<string, number>;
}

export interface MarketData {
  options: OptionTicker[];
  optionsVenue: OptionsVenue;
  perp: PerpState | null;
  price: Candle[];
  oi: Candle[];
  secPerBar: number;
  oiChange6hUsd: number | null;
  oiSource: OiSource;
  dvol: DvolPoint[];
  liquidations: Liquidation[];
  /** Oldest snapshot at least ~20h old, if we have one. */
  oiSnapshot: OiSnapshot | null;
  pcrHistory: PcrSample[];
  updatedAt: number | null;
  tickAt: number | null;
  health: Health;
  error: string | null;
  errorAt: number | null;
  loading: boolean;
  /** True while the first paint is from the on-device cache rather than the network. */
  fromCache: boolean;
  refresh: () => void;
}

const OPTIONS_MS = 30_000;
const PERP_MS = 60_000;
const CANDLE_MS = 60_000;
const DVOL_MS = 10 * 60_000;
const LIQ_MS = 5 * 60_000;
const STALE_MS = 120_000;
const LIQ_KEEP = 4000;
const SNAPSHOT_EVERY = 60 * 60_000;
const SNAPSHOT_KEEP = 30 * 3600_000;

const EMPTY_PERP = (instId: string): PerpState => ({ instId, last: 0, open24h: 0, high24h: 0, low24h: 0, volCcy24h: 0, oiCcy: 0, oiUsd: 0, fundingRate: 0, nextFundingMs: 0, ts: 0 });

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/** Runs `tick` now and on an interval (4× slower when the tab is hidden), re-running when the tab becomes visible. */
function useInterval(tick: () => Promise<void>, ms: number, deps: unknown[]) {
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      clearTimeout(timer);
      try {
        await tick();
      } finally {
        if (alive) timer = setTimeout(run, document.hidden ? ms * 4 : ms);
      }
    };
    const onVisible = () => {
      if (!document.hidden) void run();
    };
    document.addEventListener('visibilitychange', onVisible);
    void run();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

interface CachedMarket {
  options: OptionTicker[];
  perp: PerpState | null;
  price: Candle[];
  oi: Candle[];
  oiSource: OiSource;
  dvol: DvolPoint[];
  liquidations: Liquidation[];
  savedAt: number;
}

/**
 * Options from Deribit (BTC, ETH) or Delta (gold); perp, candles, OI and liquidations from OKX;
 * DVOL from Deribit. The last good state is cached on-device so the next open paints instantly.
 */
/** `tick` is an outside refresh counter (the header button) so every feed on screen restarts together. */
export function useMarketData(asset: Asset, range: RangeKey, venuePref: VenuePref = 'deribit', tick = 0): MarketData {
  const [options, setOptions] = useState<OptionTicker[]>([]);
  const [perp, setPerp] = useState<PerpState | null>(null);
  const [price, setPrice] = useState<Candle[]>([]);
  const [oi, setOi] = useState<Candle[]>([]);
  const [oiSource, setOiSource] = useState<OiSource>('okx');
  const [dvol, setDvol] = useState<DvolPoint[]>([]);
  const [liquidations, setLiquidations] = useState<Liquidation[]>([]);
  const [oiSnapshot, setOiSnapshot] = useState<OiSnapshot | null>(null);
  const [pcrHistory, setPcrHistory] = useState<PcrSample[]>([]);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [tickAt, setTickAt] = useState<number | null>(null);
  const [wsState, setWsState] = useState<WsState>('closed');
  const [error, setError] = useState<string | null>(null);
  const [errorAt, setErrorAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fromCache, setFromCache] = useState(false);
  const [ownBump, setBump] = useState(0);
  const bump = ownBump + tick;
  const [, setClock] = useState(0);
  const online = useOnline();
  const assetRef = useRef(asset);
  assetRef.current = asset;
  const refresh = useCallback(() => setBump((b) => b + 1), []);

  const inst = OKX_INST[asset];
  // Gold has no Deribit chain; BTC/ETH follow the preference (Delta matches Delta's own app numbers).
  const ccy = venuePref === 'deribit' ? DERIBIT_CCY[asset] : undefined;
  const optionsVenue: OptionsVenue = ccy ? 'Deribit' : 'Delta';
  const cacheKey = `market:${asset}:${range}:${optionsVenue}`;
  const fail = (e: unknown) => {
    setError(e instanceof Error ? e.message : String(e));
    setErrorAt(Date.now());
  };

  // Reset on asset / venue change so the old market never shows under the new label.
  useEffect(() => {
    setOptions([]);
    setPerp(null);
    setDvol([]);
    setLiquidations([]);
    setPcrHistory([]);
    setError(null);
    setLoading(true);
  }, [asset, optionsVenue]);

  // A new window only invalidates the candles and OI history.
  useEffect(() => {
    setPrice([]);
    setOi([]);
  }, [range]);

  // Paint the cached state for this asset/window while the network catches up.
  useEffect(() => {
    let alive = true;
    setFromCache(false);
    void kv.get<CachedMarket>(cacheKey).then((c) => {
      if (!alive || !c || assetRef.current !== asset) return;
      // only trust a cache younger than 2 days, and only if nothing live has arrived yet
      if (Date.now() - c.savedAt > 2 * 86_400_000) return;
      setOptions((cur) => (cur.length ? cur : c.options));
      setPerp((cur) => cur ?? c.perp);
      setPrice((cur) => (cur.length ? cur : c.price));
      setOi((cur) => (cur.length ? cur : c.oi));
      setOiSource(c.oiSource);
      setDvol((cur) => (cur.length ? cur : c.dvol));
      setLiquidations((cur) => (cur.length ? cur : c.liquidations));
      setFromCache(true);
      setLoading(false);
    });
    void kv.get<PcrSample[]>(`pcr:${asset}:${optionsVenue}`).then((h) => alive && h && setPcrHistory(h));
    return () => {
      alive = false;
    };
  }, [asset, range, cacheKey, optionsVenue]);

  // Options chain.
  useInterval(
    async () => {
      try {
        const o = ccy ? await fetchDeribitOptions(ccy) : await fetchOptions(asset);
        if (assetRef.current !== asset) return;
        setOptions(o);
        setUpdatedAt(Date.now());
        setFromCache(false);
        setError(null);
        void recordOiSnapshot(asset, o).then((snap) => assetRef.current === asset && setOiSnapshot(snap));
        void recordPcr(`pcr:${asset}:${optionsVenue}`, o).then((h) => assetRef.current === asset && setPcrHistory(h));
      } catch (e) {
        if (assetRef.current === asset) fail(e);
      } finally {
        if (assetRef.current === asset) setLoading(false);
      }
    },
    OPTIONS_MS,
    [asset, optionsVenue, bump],
  );

  // OKX perp snapshot (REST fallback for the websocket).
  useInterval(
    async () => {
      try {
        const p = await fetchPerpSnapshot(inst);
        if (assetRef.current !== asset) return;
        setPerp((prev) => (prev && prev.ts > p.ts ? { ...p, ...prev } : { ...prev, ...p }));
        setUpdatedAt(Date.now());
      } catch (e) {
        if (assetRef.current === asset) fail(e);
      }
    },
    PERP_MS,
    [asset, bump],
  );

  // OKX candles + OI history (incremental, paged).
  useInterval(
    async () => {
      const { days, bar } = RANGES[range];
      const since = Math.floor(Date.now() / 1000) - Math.ceil(days * 86_400);
      try {
        const p = await fetchCandles(inst, bar, since);
        if (assetRef.current !== asset) return;
        setPrice(p);
        let o: Candle[];
        let src: OiSource = 'okx';
        try {
          o = await fetchOiHistory(inst, bar, since);
        } catch (e) {
          console.warn('[Counterweight] OKX OI history unavailable, falling back to Delta', e);
          o = await fetchDeltaOi(asset, bar === '1H' ? '1h' : bar, since, Math.floor(Date.now() / 1000));
          src = 'delta';
        }
        if (assetRef.current !== asset) return;
        setOi(o);
        setOiSource(src);
        setUpdatedAt(Date.now());
        setFromCache(false);
      } catch (e) {
        if (assetRef.current === asset) fail(e);
      }
    },
    CANDLE_MS,
    [asset, range, bump],
  );

  // Recent actual liquidations (REST), then the websocket keeps appending.
  useInterval(
    async () => {
      try {
        const rows = await fetchLiquidations(inst, Date.now() - 6 * 3600_000);
        if (assetRef.current !== asset) return;
        setLiquidations((cur) => mergeLiq(cur, rows));
      } catch (e) {
        console.warn('[Counterweight] liquidation history unavailable', e);
      }
    },
    LIQ_MS,
    [asset, bump],
  );

  // DVOL history (Deribit) for IV rank — an index, so it applies whichever venue the chain comes from.
  const dvolCcy = DERIBIT_CCY[asset];
  useInterval(
    async () => {
      if (!dvolCcy) {
        setDvol([]);
        return;
      }
      try {
        const d = await fetchDvolHistory(dvolCcy, 365);
        if (assetRef.current === asset) setDvol(d);
      } catch (e) {
        console.warn('[Counterweight] DVOL unavailable', e);
      }
    },
    DVOL_MS,
    [asset, bump],
  );

  // Live patches + liquidation feed over websocket.
  useEffect(() => {
    setTickAt(null);
    return subscribePerp(
      inst,
      (patch) => {
        setPerp((prev) => ({ ...(prev ?? EMPTY_PERP(inst)), ...patch }));
        setTickAt(Date.now());
      },
      setWsState,
      (rows) => setLiquidations((cur) => mergeLiq(cur, rows)),
    );
  }, [inst]);

  // Persist the last good state (debounced) for instant paint next time.
  useEffect(() => {
    if (fromCache || (!options.length && !price.length)) return;
    const id = setTimeout(() => {
      const snap: CachedMarket = { options, perp, price, oi, oiSource, dvol, liquidations: liquidations.slice(-500), savedAt: Date.now() };
      void kv.set(cacheKey, snap);
    }, 2000);
    return () => clearTimeout(id);
  }, [options, perp, price, oi, oiSource, dvol, liquidations, fromCache, cacheKey]);

  // Re-evaluate staleness every 5s even when nothing arrives.
  useEffect(() => {
    const id = setInterval(() => setClock((c) => c + 1), 5000);
    return () => clearInterval(id);
  }, []);

  const now = Date.now();
  const lastGood = Math.max(updatedAt ?? 0, tickAt ?? 0);
  let health: Health;
  if (!online) health = 'offline';
  else if (error && !lastGood) health = 'error';
  else if (lastGood && now - lastGood > STALE_MS) health = 'stale';
  else if (wsState === 'open' && tickAt && now - tickAt < 60_000) health = 'live';
  else health = 'polling';

  let oiChange6hUsd: number | null = null;
  if (oi.length > 2 && perp) {
    const target = oi[oi.length - 1].t - 6 * 3600;
    const past = oi.find((c) => c.t >= target) ?? oi[0];
    oiChange6hUsd = (oi[oi.length - 1].c - past.c) * (perp.last || 0);
  }

  return {
    options, optionsVenue, perp, price, oi, secPerBar: BAR_SECONDS[RANGES[range].bar], oiChange6hUsd, oiSource, dvol, liquidations, oiSnapshot, pcrHistory,
    updatedAt, tickAt, health, error, errorAt, loading, fromCache, refresh,
  };
}

function mergeLiq(cur: Liquidation[], add: Liquidation[]): Liquidation[] {
  if (add.length === 0) return cur;
  const seen = new Set(cur.map((l) => `${l.ts}:${l.price}:${l.qtyCoin}`));
  const fresh = add.filter((l) => !seen.has(`${l.ts}:${l.price}:${l.qtyCoin}`));
  if (fresh.length === 0) return cur;
  return [...cur, ...fresh].sort((a, b) => a.ts - b.ts).slice(-LIQ_KEEP);
}

/** Keep hourly per-instrument OI snapshots for ~30h; return the one closest to 24h ago. */
async function recordOiSnapshot(asset: Asset, options: OptionTicker[]): Promise<OiSnapshot | null> {
  const key = `oisnap:${asset}`;
  const now = Date.now();
  const list = (await kv.get<OiSnapshot[]>(key)) ?? [];
  const last = list[list.length - 1];
  if (!last || now - last.ts >= SNAPSHOT_EVERY) {
    const oi: Record<string, number> = {};
    for (const o of options) oi[o.symbol] = o.oi;
    list.push({ ts: now, oi });
  }
  const kept = list.filter((s) => now - s.ts <= SNAPSHOT_KEEP);
  await kv.set(key, kept);
  const target = now - 24 * 3600_000;
  let best: OiSnapshot | null = null;
  for (const s of kept) {
    if (now - s.ts < 20 * 3600_000) continue;
    if (!best || Math.abs(s.ts - target) < Math.abs(best.ts - target)) best = s;
  }
  return best;
}

const PCR_EVERY = 5 * 60_000;
const PCR_KEEP = 7 * 86_400_000;

/** Append a put/call sample at most every 5 minutes; keep a week. */
async function recordPcr(key: string, options: OptionTicker[]): Promise<PcrSample[]> {
  let callOi = 0;
  let putOi = 0;
  let callVol = 0;
  let putVol = 0;
  for (const o of options) {
    if (o.type === 'call') {
      callOi += o.oi;
      callVol += o.volume;
    } else {
      putOi += o.oi;
      putVol += o.volume;
    }
  }
  if (callOi <= 0) return (await kv.get<PcrSample[]>(key)) ?? [];
  const now = Date.now();
  const list = (await kv.get<PcrSample[]>(key)) ?? [];
  const last = list[list.length - 1];
  if (!last || now - last.ts >= PCR_EVERY) {
    list.push({ ts: now, oi: putOi / callOi, vol: callVol > 0 ? putVol / callVol : 0, callOi, putOi });
  }
  const kept = list.filter((s) => now - s.ts <= PCR_KEEP);
  await kv.set(key, kept);
  return kept;
}
