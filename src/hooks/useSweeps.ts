import { useEffect, useRef, useState } from 'react';
import type { Sweep } from '../lib/chartPrimitives';
import type { Heatmap } from '../lib/liquidation';

const KEEP = 40;
const WINDOW_MS = 30 * 60_000;

/**
 * Sweep events: a live band that disappears between two heatmap computations while price traded through its level.
 * The estimator clears a level the moment a bar's range crosses it, so comparing consecutive latest columns and
 * keeping only the cleared bins that sit between the previous and current price yields "price took that band out".
 */
export function useSweeps(heatmap: Heatmap | null, spot: number, key: string, minUsd = 250_000): Sweep[] {
  const [sweeps, setSweeps] = useState<Sweep[]>([]);
  const prev = useRef<{ key: string; long: Float32Array; short: Float32Array; priceMin: number; binSize: number; spot: number } | null>(null);

  useEffect(() => {
    if (!heatmap || !(spot > 0)) return;
    const col = (heatmap.times.length - 1) * heatmap.bins;
    const long = heatmap.long.slice(col, col + heatmap.bins);
    const short = heatmap.short.slice(col, col + heatmap.bins);
    const p = prev.current;
    prev.current = { key, long, short, priceMin: heatmap.priceMin, binSize: heatmap.binSize, spot };
    if (!p || p.key !== key || p.binSize !== heatmap.binSize || p.priceMin !== heatmap.priceMin) return;
    const lo = Math.min(p.spot, spot);
    const hi = Math.max(p.spot, spot);
    const found: Sweep[] = [];
    const now = Date.now();
    for (let b = 0; b < heatmap.bins; b++) {
      const level = heatmap.priceMin + (b + 0.5) * heatmap.binSize;
      if (level < lo - heatmap.binSize || level > hi + heatmap.binSize) continue;
      if (p.long[b] >= minUsd && long[b] === 0) found.push({ ts: now, price: level, usd: p.long[b], side: 'long' });
      if (p.short[b] >= minUsd && short[b] === 0) found.push({ ts: now, price: level, usd: p.short[b], side: 'short' });
    }
    if (found.length) setSweeps((s) => [...found, ...s].filter((x) => now - x.ts < WINDOW_MS).slice(0, KEEP));
  }, [heatmap, spot, key, minUsd]);

  useEffect(() => {
    setSweeps([]);
    prev.current = null;
  }, [key]);

  return sweeps;
}
