import type { Candle } from '../api/delta';
import { computeHeatmap, type LiqConfig } from './liquidation';

export interface HeatmapRequest {
  id: number;
  price: Candle[];
  oi: Candle[];
  cfg: LiqConfig;
}

self.onmessage = (e: MessageEvent<HeatmapRequest>) => {
  const { id, price, oi, cfg } = e.data;
  const h = computeHeatmap(price, oi, cfg);
  if (!h) {
    (self as unknown as Worker).postMessage({ id, heatmap: null });
    return;
  }
  (self as unknown as Worker).postMessage({ id, heatmap: h }, [h.long.buffer, h.short.buffer]);
};
