import { useMemo } from 'react';
import type { OptionTicker } from '../api/delta';
import type { PcrSample } from '../hooks/useMarketData';
import { fmtCompact, fmtDateShort, fmtPrice, fmtUsd } from '../lib/format';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { GLOSSARY } from '../lib/glossary';
import { groupByExpiry, lean, putCallRatio, type Lean } from '../lib/options';
import { composeRead, type ReadContext } from '../lib/read';
import { DataTable, Panel } from './Panel';

interface Props {
  options: OptionTicker[];
  history: PcrSample[];
  venue: string;
  unit: string;
  loading: boolean;
  /** Widget mode: tighter type. */
  compact?: boolean;
  /** Header expiry selection; when set, the ratio is scoped to that single expiry (what Delta's page shows). */
  selectedExpiryMs: number | null;
  codes: Map<number, string>;
  /** What the Read may talk about besides the ratio (max pain, nearest clusters, funding). */
  context: Omit<ReadContext, 'scope'>;
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

/**
 * Plain-language reading of the conviction ratio. The thin side is the contrarian trade:
 * fewer puts means the crowd is positioned long, so the lean is short (red); fewer calls
 * means the crowd is hedged or short, so the lean is long (green).
 */
export type LeanTone = 'short' | 'long' | 'neutral';
export function readLean(l: Lean): { label: string; tone: LeanTone } {
  if (l.fewer === 'even' || l.ratio < 1.1) return { label: 'balanced · no crowd to fade', tone: 'neutral' };
  const strong = l.ratio >= 2;
  if (l.fewer === 'puts') return { label: strong ? 'calls crowded · lean short' : 'calls favoured · lean short', tone: 'short' };
  return { label: strong ? 'puts crowded · lean long' : 'puts favoured · lean long', tone: 'long' };
}
export const leanTone = (l: Lean | null): LeanTone => (l ? readLean(l).tone : 'neutral');
/** Which side sits on which side of the colon, in the order the number is written. */
export const leanOrder = (l: Lean) => (l.fewer === 'calls' ? 'calls : puts' : 'puts : calls');
const DIRECTION: Record<LeanTone, string> = { short: 'Short', long: 'Long', neutral: 'Balanced' };

/** Time-to-expiry buckets the ratio can be scoped to. */
export type ExpiryBucket = 'all' | '7d' | '30d' | '90d' | '90d+';
const BUCKETS: Array<{ key: ExpiryBucket; label: string; test: (dte: number) => boolean; title: string }> = [
  { key: 'all', label: 'All', test: () => true, title: 'Every listed expiry' },
  { key: '7d', label: '≤7d', test: (d) => d <= 7, title: 'Expiring within a week: the hedges and bets around now' },
  { key: '30d', label: '≤30d', test: (d) => d <= 30, title: 'Expiring within a month' },
  { key: '90d', label: '≤90d', test: (d) => d <= 90, title: 'Expiring within a quarter' },
  { key: '90d+', label: '>90d', test: (d) => d > 90, title: 'Long-dated: structural positioning' },
];

const signed = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

export function RatioPanel({ options, history, venue, unit, loading, compact, selectedExpiryMs, codes, context, drag }: Props) {
  const [usd, setUsd] = useLocalStorage<boolean>('cd.ratioUsd', true);
  const [bucket, setBucket] = useLocalStorage<ExpiryBucket>('cd.ratioBucket', 'all');
  const groupsAll = useMemo(() => groupByExpiry(options), [options]);
  const b = BUCKETS.find((x) => x.key === bucket) ?? BUCKETS[0];
  const single = selectedExpiryMs !== null ? groupsAll.find((g) => g.expiryMs === selectedExpiryMs) ?? null : null;
  const groups = useMemo(() => (single ? [single] : groupsAll.filter((g) => b.test(g.dte))), [groupsAll, b, single]);
  const scopeShort = single ? `${codes.get(single.expiryMs) ?? ''} · ${fmtDateShort(single.expiryMs)}` : b.key === 'all' ? 'all expiries' : `expiries ${b.label}`;
  const scoped = useMemo(() => groups.flatMap((g) => [...g.calls, ...g.puts]), [groups]);
  const pcr = useMemo(() => (scoped.length ? putCallRatio(scoped) : null), [scoped]);

  // Hero: conviction ratio (smaller side = 1) on contracts or $ notional; the strict put/call figure sits in the facts row.
  const puts = pcr ? (usd ? pcr.putOiUsd : pcr.putOi) : 0;
  const calls = pcr ? (usd ? pcr.callOiUsd : pcr.callOi) : 0;
  const strict = pcr ? (usd ? (pcr.callOiUsd > 0 ? pcr.putOiUsd / pcr.callOiUsd : null) : pcr.oi) : null;
  const l = pcr ? lean(puts, calls) : null;
  const tone = leanTone(l);
  const verdict = useMemo(() => composeRead(l, { ...context, scope: scopeShort }), [l, context, scopeShort]);
  // Changes compare whole-chain put/call with the recorded whole-chain history (contracts basis).
  const wholeChain = useMemo(() => (options.length ? putCallRatio(options) : null), [options]);
  const change = (since: number) => {
    const from = history.find((s) => s.ts >= Date.now() - since) ?? null;
    return from && wholeChain && from.oi > 0 ? wholeChain.oi - from.oi : null;
  };
  const d1 = change(24 * 3600_000);
  const d7 = change(7 * 24 * 3600_000);
  const money = (v: number) => (usd ? fmtUsd(v) : `${fmtCompact(v)} ${unit}`);
  const total = puts + calls;
  const putShare = total > 0 ? (puts / total) * 100 : 50;

  const table = (
    <DataTable
      cols={['Expiry', 'Code', 'Puts', 'Calls', 'Ratio']}
      rows={groupsAll.slice(0, 10).map((g) => {
        const x = putCallRatio([...g.calls, ...g.puts]);
        const lx = lean(usd ? x.putOiUsd : x.putOi, usd ? x.callOiUsd : x.callOi);
        return [fmtDateShort(g.expiryMs), codes.get(g.expiryMs) ?? '', money(usd ? x.putOiUsd : x.putOi), money(usd ? x.callOiUsd : x.callOi), lx ? `1 : ${Number.isFinite(lx.ratio) ? lx.ratio.toFixed(2) : '∞'} ${lx.fewer === 'calls' ? 'calls : puts' : 'puts : calls'}` : '—'];
      })}
    />
  );

  return (
    <Panel
      title={`${context.asset} · ${scopeShort} · ${venue}`}
      info={GLOSSARY.ratio}
      drag={drag}
      loading={loading}
      table={table}
      controls={
        <>
          {!single && (
            <div className="seg small" role="group" aria-label="Expiry range">
              {BUCKETS.map((x) => (
                <button key={x.key} className={bucket === x.key ? 'on' : ''} onClick={() => setBucket(x.key)} title={x.title}>{x.label}</button>
              ))}
            </div>
          )}
          <div className="seg small" role="group" aria-label="Ratio units">
            <button className={!usd ? 'on' : ''} onClick={() => setUsd(false)}>{unit}</button>
            <button className={usd ? 'on' : ''} onClick={() => setUsd(true)}>$</button>
          </div>
        </>
      }
    >
      {pcr === null || !l ? (
        <div className="empty">{loading ? 'Loading chain…' : `No options expiring ${b.label}`}</div>
      ) : (
        <div className={`ratio ${tone}${compact ? ' compact' : ''}`}>
          <div className="num">
            <div className="v" aria-label={`1 to ${l.ratio.toFixed(2)}, ${leanOrder(l)}`}>1<span>:</span>{Number.isFinite(l.ratio) ? l.ratio.toFixed(2) : '∞'}</div>
            <div className="dir">{DIRECTION[tone]}</div>
          </div>
          <p className="verdict">{verdict}</p>
          <div className="sides">
            <div className={`side${l.fewer === 'puts' ? ' thin' : ''}`}><div className="k">Puts</div><div className="v">{money(puts)}</div></div>
            <div className={`side r${l.fewer === 'calls' ? ' thin' : ''}`}><div className="k">Calls</div><div className="v">{money(calls)}</div></div>
          </div>
          <div className="bar" aria-hidden="true"><i className="p" style={{ width: `${putShare}%` }} /><i className="c" style={{ width: `${100 - putShare}%` }} /></div>
          <div className="facts">
            {context.maxPain !== null && <span>Max pain <b>{fmtPrice(context.maxPain)}</b></span>}
            <span title="Classic put/call ratio: puts ÷ calls">Put / call <b>{strict !== null ? strict.toFixed(2) : '—'}</b></span>
            <span className="vol" title="Put/call by 24h traded volume">By volume <b>{pcr.volume.toFixed(2)}</b></span>
            <span className="sp" />
            <span className="chip" title="Whole-chain put/call by contracts vs 24h ago, recorded by this desk (rising = puts growing)">24h <b>{signed(d1)}</b></span>
            <span className="chip d7" title="Whole-chain put/call by contracts vs 7d ago">7d <b>{signed(d7)}</b></span>
          </div>
        </div>
      )}
    </Panel>
  );
}
