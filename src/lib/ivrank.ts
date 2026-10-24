import type { DvolPoint } from '../api/deribit';

export interface IvRank {
  current: number;
  low: number;
  high: number;
  /** (current - low) / (high - low), 0..1. */
  rank: number;
  /** Share of days with a lower close, 0..1. */
  percentile: number;
  days: number;
}

/** IV rank and percentile of the latest DVOL close against the history given. */
export function ivRank(history: DvolPoint[]): IvRank | null {
  if (history.length < 20) return null;
  const closes = history.map((p) => p.close);
  const current = closes[closes.length - 1];
  const low = Math.min(...closes);
  const high = Math.max(...closes);
  const below = closes.filter((c) => c < current).length;
  return {
    current,
    low,
    high,
    rank: high > low ? (current - low) / (high - low) : 0.5,
    percentile: below / closes.length,
    days: closes.length,
  };
}
