import { useEffect, useState } from 'react';
import { fetchOptions, type Asset } from '../api/delta';
import { DERIBIT_CCY, fetchDeribitOptions } from '../api/deribit';
import { leanTone, type LeanTone } from '../components/RatioPanel';
import { expiryCodes, groupByExpiry, lean, maxPain, putCallRatio, resolveExpiry, type ExpirySel, type Lean } from '../lib/options';
import type { VenuePref } from './useMarketData';

export interface ChainLean {
  lean: Lean | null;
  tone: LeanTone;
  maxPain: number | null;
  /** Resolved expiry code for this chain ('D1', 'W1', …) or 'all'. */
  expiry: string;
  updatedAt: number;
}

/**
 * The read for assets the desk is not currently showing: only the options chain is fetched (one REST call per asset
 * a minute, nothing streamed), scoped to the same expiry code as the header, so the strip shows every asset's lean,
 * direction and max pain without running a full market feed for each.
 */
export function useChainLeans(assets: Asset[], venuePref: VenuePref, expirySel: ExpirySel, tick = 0): Partial<Record<Asset, ChainLean>> {
  const [state, setState] = useState<Partial<Record<Asset, ChainLean>>>({});
  const key = assets.join(',');

  useEffect(() => {
    if (!assets.length) return;
    let alive = true;
    const load = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      await Promise.all(
        assets.map(async (a) => {
          try {
            const ccy = venuePref === 'deribit' ? DERIBIT_CCY[a] : undefined;
            const opts = ccy ? await fetchDeribitOptions(ccy) : await fetchOptions(a);
            const groups = groupByExpiry(opts);
            const codes = expiryCodes(groups.map((g) => g.expiryMs));
            const sel = resolveExpiry(groups, codes, expirySel);
            const scoped = sel ? [...sel.calls, ...sel.puts] : opts;
            const pcr = scoped.length ? putCallRatio(scoped) : null;
            const l = pcr ? lean(pcr.putOiUsd, pcr.callOiUsd) : null;
            const next: ChainLean = { lean: l, tone: leanTone(l), maxPain: scoped.length ? maxPain(scoped) : null, expiry: sel ? codes.get(sel.expiryMs) ?? 'all' : 'all', updatedAt: Date.now() };
            if (alive) setState((s) => ({ ...s, [a]: next }));
          } catch {
            /* keep the last good read; the primary feed's error banner covers connectivity */
          }
        }),
      );
    };
    void load();
    const id = setInterval(load, 60_000);
    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // `key` stands in for the assets array so a new array with the same members does not restart polling
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, venuePref, expirySel, tick]);

  return state;
}
