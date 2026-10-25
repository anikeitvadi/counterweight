import { fmtPrice, fmtUsd } from './format';
import type { LiqCluster } from './liquidation';
import { fmtLean, type Lean } from './options';

/** Everything the one-paragraph verdict is allowed to talk about. All numbers, no opinions beyond the lean. */
export interface ReadContext {
  asset: string;
  /** e.g. 'D1 · 25 Oct' or 'all expiries' */
  scope: string;
  spot: number;
  maxPain: number | null;
  /** Nearest live liquidation cluster above / below the current price. */
  above: LiqCluster | null;
  below: LiqCluster | null;
  /** Funding in percent per 8h. */
  fundingPct: number | null;
}

const pct = (v: number, digits = 1) => `${Math.abs(v).toFixed(digits)}%`;

/**
 * Compose the Read: two or three plain sentences derived from the numbers on screen.
 * Sentence one is the positioning and the lean; the rest is what stands in the way of that lean.
 */
export function composeRead(l: Lean | null, c: ReadContext): string {
  const out: string[] = [];
  const where = c.scope === 'all expiries' ? 'across all expiries' : `on ${c.scope}`;
  if (!l) return `${c.asset}: waiting for the options chain.`;
  const r = Number.isFinite(l.ratio) ? `${l.ratio.toFixed(1)} to 1` : 'entirely';
  if (l.fewer === 'even' || l.ratio < 1.1) {
    out.push(`${c.asset} ${where}: puts and calls are balanced at ${fmtLean(l)}, so there is no crowd to fade.`);
  } else if (l.fewer === 'puts') {
    out.push(`${c.asset} ${where}: calls outweigh puts ${r}. Puts are the thin side, so the lean is short.`);
  } else {
    out.push(`${c.asset} ${where}: puts outweigh calls ${r}. Calls are the thin side, so the lean is long.`);
  }
  if (c.maxPain !== null && c.spot > 0) {
    const d = ((c.maxPain - c.spot) / c.spot) * 100;
    out.push(`Max pain ${fmtPrice(c.maxPain)} sits ${pct(d, 2)} ${d >= 0 ? 'above' : 'below'} spot.`);
  }
  const leanShort = l.fewer === 'puts' && l.ratio >= 1.1;
  const leanLong = l.fewer === 'calls' && l.ratio >= 1.1;
  if (leanShort && c.below) {
    out.push(`The first long cluster on the way down is ${fmtUsd(c.below.usd)} at ${fmtPrice(c.below.price)}, ${pct(c.below.distPct)} below.`);
  } else if (leanLong && c.above) {
    out.push(`The first short cluster on the way up is ${fmtUsd(c.above.usd)} at ${fmtPrice(c.above.price)}, ${pct(c.above.distPct)} above.`);
  } else if (c.above && c.below) {
    out.push(`Nearest clusters: ${fmtUsd(c.above.usd)} of shorts ${pct(c.above.distPct)} above, ${fmtUsd(c.below.usd)} of longs ${pct(c.below.distPct)} below.`);
  }
  if (c.fundingPct !== null && Math.abs(c.fundingPct) >= 0.03) {
    out.push(c.fundingPct > 0 ? `Longs are paying ${c.fundingPct.toFixed(3)}% per 8h to stay in.` : `Shorts are paying ${Math.abs(c.fundingPct).toFixed(3)}% per 8h to stay in.`);
  }
  return out.join(' ');
}
