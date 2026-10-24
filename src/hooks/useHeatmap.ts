import { useEffect, useRef, useState } from 'react';
import type { Candle } from '../api/delta';
import { computeHeatmap, type Heatmap, type LiqModel } from '../lib/liquidation';

// Bands ~0.1% of price tall; open interest settles as ~48 net entries per window (30 min on 1D, 90 min on 3D, …),
// so the map has the same density whatever the range instead of one entry per tick.
const CFG = { mm: 0.005, bins: 400, binPct: 0.001 };
const ENTRIES_PER_WINDOW = 48;
const entryBarsFor = (price: Candle[]): number => Math.max(1, Math.round(price.length / ENTRIES_PER_WINDOW));

/** Runs the estimator in a Web Worker (falls back to the main thread where workers are unavailable). */
export function useHeatmap(price: Candle[], oi: Candle[], model: LiqModel): { heatmap: Heatmap | null; computing: boolean } {
  const [heatmap, setHeatmap] = useState<Heatmap | null>(null);
  const [computing, setComputing] = useState(false);
  const worker = useRef<Worker | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    try {
      worker.current = new Worker(new URL('../lib/heatmap.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      worker.current = null;
    }
    return () => {
      worker.current?.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!price.length || !oi.length) {
      setHeatmap(null);
      return;
    }
    const id = ++seq.current;
    const w = worker.current;
    if (!w) {
      setHeatmap(computeHeatmap(price, oi, { model, ...CFG, entryBars: entryBarsFor(price) }));
      return;
    }
    setComputing(true);
    const onMsg = (e: MessageEvent<{ id: number; heatmap: Heatmap | null }>) => {
      if (e.data.id !== id) return;
      setHeatmap(e.data.heatmap);
      setComputing(false);
      w.removeEventListener('message', onMsg);
    };
    w.addEventListener('message', onMsg);
    w.postMessage({ id, price, oi, cfg: { model, ...CFG, entryBars: entryBarsFor(price) } });
    return () => w.removeEventListener('message', onMsg);
  }, [price, oi, model]);

  return { heatmap, computing };
}
