import { useMemo } from 'react';
import type { OptionTicker } from '../api/delta';
import type { PcrSample } from '../hooks/useMarketData';
import { fmtCompact, fmtDateShort, fmtUsd } from '../lib/format';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { GLOSSARY } from '../lib/glossary';
import { groupByExpiry, putCallRatio, type ExpiryGroup } from '../lib/options';
import { Panel } from './Panel';

interface Props {
  options: OptionTicker[];
  history: PcrSample[];
  venue: string;
  unit: string;
  loading: boolean;
  /** Widget mode: hero only, no per-expiry table. */
  compact?: boolean;
  /** Header expiry selection; when set, the ratio is scoped to that single expiry (what Delta's page shows). */
  selectedExpiryMs: number | null;
  codes: Map<number, string>;
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

/** Plain-language reading of a put/call ratio by open interest. */
export function readPcr(r: number): { label: string; tone: 'bear' | 'neutral' | 'bull' } {
  if (r >= 1.2) return { label: 'heavily hedged · crowded puts', tone: 'bear' };
  if (r >= 0.9) return { label: 'defensive · more puts than usual', tone: 'bear' };
  if (r >= 0.6) return { label: 'balanced', tone: 'neutral' };
  if (r >= 0.4) return { label: 'call-heavy · upside positioning', tone: 'bull' };
  return { label: 'very call-heavy · complacent', tone: 'bull' };
}

function Spark({ pts, w = 160, h = 34 }: { pts: number[]; w?: number; h?: number }) {
  if (pts.length < 2) return null;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const y = (v: number) => (hi === lo ? h / 2 : h - 2 - ((v - lo) / (hi - lo)) * (h - 4));
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (pts.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = pts[pts.length - 1] >= pts[0];
  return (
    <svg className="ratio-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={up ? 'var(--s2)' : 'var(--s1)'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      <circle cx={w} cy={y(pts[pts.length - 1])} r={2.5} fill={up ? 'var(--s2)' : 'var(--s1)'} />
    </svg>
  );
}

function Gauge({ value }: { value: number }) {
  // 0.3 .. 1.7 mapped across the track; 1.0 marked
  const lo = 0.3;
  const hi = 1.7;
  const pct = Math.max(0, Math.min(100, ((value - lo) / (hi - lo)) * 100));
  const one = ((1 - lo) / (hi - lo)) * 100;
  return (
    <div className="gauge" aria-hidden="true">
      <div className="track" />
      <div className="one" style={{ left: `${one}%` }} />
      <div className="marker" style={{ left: `${pct}%` }} />
      <div className="ends"><span>calls dominate</span><span>puts dominate</span></div>
    </div>
  );
}

/** Time-to-expiry buckets the ratio can be scoped to. */
export type ExpiryBucket = 'all' | '7d' | '30d' | '90d' | '90d+';
const BUCKETS: Array<{ key: ExpiryBucket; label: string; test: (dte: number) => boolean; title: string }> = [
  { key: 'all', label: 'All', test: () => true, title: 'Every listed expiry' },
  { key: '7d', label: '≤7d', test: (d) => d <= 7, title: 'Expiring within a week: the hedges and bets around now' },
  { key: '30d', label: '≤30d', test: (d) => d <= 30, title: 'Expiring within a month' },
  { key: '90d', label: '≤90d', test: (d) => d <= 90, title: 'Expiring within a quarter' },
  { key: '90d+', label: '>90d', test: (d) => d > 90, title: 'Long-dated: structural positioning' },
];

export function RatioPanel({ options, history, venue, unit, loading, compact, selectedExpiryMs, codes, drag }: Props) {
  const [usd, setUsd] = useLocalStorage<boolean>('cd.ratioUsd', true);
  const [bucket, setBucket] = useLocalStorage<ExpiryBucket>('cd.ratioBucket', 'all');
  const [trendDays, setTrendDays] = useLocalStorage<1 | 7>('cd.ratioTrend', 1);
  const groupsAll = useMemo(() => groupByExpiry(options), [options]);
  const b = BUCKETS.find((x) => x.key === bucket) ?? BUCKETS[0];
  const single = selectedExpiryMs !== null ? groupsAll.find((g) => g.expiryMs === selectedExpiryMs) ?? null : null;
  const groups = useMemo(() => (single ? [single] : groupsAll.filter((g) => b.test(g.dte))), [groupsAll, b, single]);
  const scopeText = single ? `${codes.get(single.expiryMs) ?? ''} · ${fmtDateShort(single.expiryMs)} expiry` : b.key === 'all' ? 'all expiries' : `expiries ${b.label}`;
  const scoped = useMemo(() => groups.flatMap((g) => [...g.calls, ...g.puts]), [groups]);
  const pcr = useMemo(() => (scoped.length ? putCallRatio(scoped) : null), [scoped]);
  const perExpiry = useMemo(
    () =>
      groups.slice(0, compact ? 3 : 6).map((g: ExpiryGroup) => {
        const r = putCallRatio([...g.calls, ...g.puts]);
        return { g, r };
      }),
    [groups, compact],
  );
  // The recorded trend is whole-chain (all expiries); it is labelled as such when a bucket is active.
  const trend = useMemo(() => {
    const now = Date.now();
    const cut = now - trendDays * 24 * 3600_000;
    const recent = history.filter((s) => s.ts >= cut);
    const dayAgo = history.find((s) => s.ts >= now - 24 * 3600_000) ?? null;
    const weekAgo = history.find((s) => s.ts >= now - 7 * 24 * 3600_000) ?? null;
    return { pts: recent.map((s) => (usd ? s.putOi / Math.max(1e-9, s.callOi) : s.oi)), dayAgo, weekAgo };
  }, [history, trendDays, usd]);

  // Hero ratio: contracts (count) or notional (USD); both are valid, dealers quote the first, risk desks the second.
  const notional = pcr && pcr.callOiUsd > 0 ? pcr.putOiUsd / pcr.callOiUsd : null;
  const r = pcr ? (usd ? notional : pcr.oi) : null;
  const read = r !== null ? readPcr(r) : null;
  // Changes compare whole-chain ratio with the recorded whole-chain history (contracts basis).
  const wholeChain = useMemo(() => (options.length ? putCallRatio(options) : null), [options]);
  const change = (from: PcrSample | null) => (from && wholeChain && from.oi > 0 ? wholeChain.oi - from.oi : null);
  const d1 = change(trend.dayAgo);
  const d7 = change(trend.weekAgo);

  return (
    <Panel
      title="Put / call ratio"
      sub={`${venue} · ${scopeText} · ${usd ? 'by $ notional' : 'by contracts'}`}
      info={GLOSSARY.ratio}
      drag={drag}
      loading={loading}
      controls={
        <>
          {single ? (
            <span className="muted" title="Scoped by the expiry chosen in the header; pick 'All expiries' there to use the date ranges">header expiry</span>
          ) : (
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
      {pcr === null ? (
        <div className="empty">{loading ? 'Loading chain…' : `No options expiring ${b.label}`}</div>
      ) : (
        <div className={`ratio${compact ? ' compact' : ''}`}>
          <div className="hero-row">
            <div>
              <div className="big">{r !== null ? r.toFixed(2) : '—'}</div>
              <div className={`read ${read?.tone}`}>{read?.label}</div>
            </div>
            <div className="side">
              <div className="kv"><span>puts OI</span><b>{usd ? fmtUsd(pcr.putOiUsd) : `${fmtCompact(pcr.putOi)} ${unit}`}</b></div>
              <div className="kv"><span>calls OI</span><b>{usd ? fmtUsd(pcr.callOiUsd) : `${fmtCompact(pcr.callOi)} ${unit}`}</b></div>
              <div className="kv"><span>{usd ? 'by contracts' : 'by $ notional'}</span><b>{usd ? pcr.oi.toFixed(2) : notional !== null ? notional.toFixed(2) : '—'}</b></div>
              <div className="kv"><span>by volume (24h)</span><b>{pcr.volume.toFixed(2)}</b></div>
            </div>
          </div>
          <Gauge value={r ?? pcr.oi} />
          <div className="trend-row">
            <div className="kv" title="Whole-chain ratio by contracts vs 24h ago"><span>24h</span><b className={d1 === null ? '' : d1 > 0 ? 'bear' : 'bull'}>{d1 === null ? '—' : `${d1 > 0 ? '+' : ''}${d1.toFixed(2)}`}</b></div>
            <div className="kv" title="Whole-chain ratio by contracts vs 7d ago"><span>7d</span><b className={d7 === null ? '' : d7 > 0 ? 'bear' : 'bull'}>{d7 === null ? '—' : `${d7 > 0 ? '+' : ''}${d7.toFixed(2)}`}</b></div>
            <div className="seg small" role="group" aria-label="Trend window">
              <button className={trendDays === 1 ? 'on' : ''} onClick={() => setTrendDays(1)}>1D</button>
              <button className={trendDays === 7 ? 'on' : ''} onClick={() => setTrendDays(7)}>7D</button>
            </div>
            {trend.pts.length >= 2 ? <Spark pts={trend.pts} /> : <span className="muted small-note">trend builds while the desk is open ({history.length} sample{history.length === 1 ? '' : 's'}{b.key !== 'all' ? ', whole chain' : ''})</span>}
          </div>
          <div className="per-expiry">
            {perExpiry.map(({ g, r: x }) => {
              const puts = usd ? x.putOiUsd : x.putOi;
              const calls = usd ? x.callOiUsd : x.callOi;
              const total = calls + puts;
              const putShare = total > 0 ? (puts / total) * 100 : 0;
              const ratio = calls > 0 ? puts / calls : 0;
              return (
                <div className="exp" key={g.expiryMs} title={usd ? `${fmtUsd(puts)} puts · ${fmtUsd(calls)} calls` : `${fmtCompact(puts)} puts · ${fmtCompact(calls)} calls (${unit})`}>
                  <span className="when"><span className="code">{codes.get(g.expiryMs)}</span> {fmtDateShort(g.expiryMs)} <span className="muted">{g.dte < 1 ? `${Math.round(g.dte * 24)}h` : `${Math.round(g.dte)}d`}</span></span>
                  <span className="bar"><i className="put" style={{ width: `${putShare}%` }} /><i className="call" style={{ width: `${100 - putShare}%` }} /></span>
                  <b>{ratio.toFixed(2)}</b>
                  <span className="muted">{usd ? fmtUsd(puts) : `${fmtCompact(puts)}`} puts</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Panel>
  );
}
