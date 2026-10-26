import type { Liquidation } from '../api/okx';
import { fmtPct, fmtPrice, fmtUsd } from './format';
import type { LiqCluster } from './liquidation';

export type AlertKind = 'cluster' | 'maxpain' | 'flip' | 'funding' | 'liq' | 'sweep';

export interface AlertRules {
  enabled: boolean;
  /** Fire when price is within this % of a cluster at least `clusterMinUsd` big. */
  cluster: boolean;
  clusterPct: number;
  clusterMinUsd: number;
  maxPain: boolean;
  flip: boolean;
  /** Fire when |funding| per 8h (in %) is at least this. */
  funding: boolean;
  fundingPct: number;
  /** Fire on a single liquidation at least this big (USD). */
  bigLiq: boolean;
  bigLiqUsd: number;
  /** Fire when price trades through an estimated band at least this big (USD). */
  sweep: boolean;
  sweepUsd: number;
  sound: boolean;
  notify: boolean;
}

export const DEFAULT_RULES: AlertRules = {
  enabled: false,
  cluster: true,
  clusterPct: 0.5,
  clusterMinUsd: 2_000_000,
  maxPain: true,
  flip: true,
  funding: true,
  fundingPct: 0.05,
  bigLiq: true,
  bigLiqUsd: 1_000_000,
  sweep: true,
  sweepUsd: 1_000_000,
  sound: true,
  notify: true,
};

export interface AlertEvent {
  id: string;
  kind: AlertKind;
  ts: number;
  title: string;
  body: string;
}

export interface AlertState {
  /** key -> last fired (ms). */
  lastFired: Record<string, number>;
  prevSpot: number | null;
  /** Liquidation timestamps already announced. */
  seenLiq: number[];
}

export const EMPTY_STATE: AlertState = { lastFired: {}, prevSpot: null, seenLiq: [] };

export interface AlertInput {
  asset: string;
  spot: number;
  clusters: LiqCluster[];
  maxPain: number | null;
  flip: number | null;
  /** Funding per 8h window, in percent. */
  fundingPct: number | null;
  liquidations: Liquidation[];
  /** Bands price has just traded through (estimated), newest first. */
  sweeps?: Array<{ ts: number; price: number; usd: number; side: 'long' | 'short' }>;
  now: number;
}

const COOLDOWN: Record<AlertKind, number> = { cluster: 30 * 60_000, maxpain: 15 * 60_000, flip: 15 * 60_000, funding: 8 * 3600_000, liq: 0, sweep: 0 };

function crossed(prev: number | null, cur: number, level: number | null): boolean {
  return prev !== null && level !== null && prev !== cur && (prev - level) * (cur - level) <= 0 && cur !== prev;
}

/** Pure rule evaluation: returns the events to announce and the state to keep for the next tick. */
export function evaluateAlerts(input: AlertInput, rules: AlertRules, state: AlertState): { events: AlertEvent[]; state: AlertState } {
  const events: AlertEvent[] = [];
  const lastFired = { ...state.lastFired };
  const fire = (kind: AlertKind, key: string, title: string, body: string) => {
    const last = lastFired[key];
    if (last !== undefined && input.now - last < COOLDOWN[kind]) return;
    lastFired[key] = input.now;
    events.push({ id: `${key}:${input.now}`, kind, ts: input.now, title, body });
  };
  const a = input.asset;

  if (rules.enabled && input.spot > 0) {
    if (rules.cluster) {
      for (const c of input.clusters) {
        if (c.usd < rules.clusterMinUsd || Math.abs(c.distPct) > rules.clusterPct) continue;
        fire('cluster', `cluster:${c.side}:${Math.round(c.price)}`, `${a}: ${fmtUsd(c.usd)} of ${c.side} liquidations ${fmtPct(Math.abs(c.distPct), 2)} away`, `Cluster at ${fmtPrice(c.price)}, price ${fmtPrice(input.spot)}.`);
      }
    }
    if (rules.maxPain && crossed(state.prevSpot, input.spot, input.maxPain)) {
      fire('maxpain', 'maxpain', `${a} crossed max pain ${fmtPrice(input.maxPain!)}`, `Price ${fmtPrice(input.spot)}.`);
    }
    if (rules.flip && crossed(state.prevSpot, input.spot, input.flip)) {
      const side = input.spot > (input.flip ?? 0) ? 'above' : 'below';
      fire('flip', 'flip', `${a} crossed the gamma flip ${fmtPrice(input.flip!)}`, `Now ${side}: dealers ${side === 'above' ? 'dampen' : 'amplify'} moves.`);
    }
    if (rules.funding && input.fundingPct !== null && Math.abs(input.fundingPct) >= rules.fundingPct) {
      fire('funding', `funding:${input.fundingPct > 0 ? 'pos' : 'neg'}`, `${a} funding ${input.fundingPct > 0 ? '+' : ''}${input.fundingPct.toFixed(4)}% / 8h`, `${input.fundingPct > 0 ? 'Longs' : 'Shorts'} are paying heavily.`);
    }
  }
  const seen = new Set(state.seenLiq);
  const seenLiq = [...state.seenLiq];
  if (rules.enabled && rules.bigLiq) {
    for (const l of input.liquidations) {
      if (seen.has(l.ts)) continue;
      if (l.usd >= rules.bigLiqUsd) {
        fire('liq', `liq:${l.ts}:${l.price}`, `${a}: ${fmtUsd(l.usd)} ${l.side} liquidated at ${fmtPrice(l.price)}`, new Date(l.ts).toLocaleTimeString('en-GB'));
      }
    }
  }
  if (rules.enabled && rules.sweep && input.sweeps) {
    for (const s of input.sweeps) {
      if (s.usd < rules.sweepUsd || input.now - s.ts > 120_000) continue;
      fire('sweep', `sweep:${s.ts}:${Math.round(s.price)}:${s.side}`, `${a}: ${fmtUsd(s.usd)} of ${s.side}s cleared at ${fmtPrice(s.price)}`, `Price traded through the band; ${s.side === 'long' ? 'longs' : 'shorts'} below it are gone.`);
    }
  }
  for (const l of input.liquidations) if (!seen.has(l.ts)) seenLiq.push(l.ts);

  return { events, state: { lastFired, prevSpot: input.spot > 0 ? input.spot : state.prevSpot, seenLiq: seenLiq.slice(-5000) } };
}
