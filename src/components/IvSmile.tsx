import { useMemo, useState } from 'react';
import { useMeasure } from '../hooks/useMeasure';
import { fmtCompact, fmtPct, fmtPrice, niceTicks } from '../lib/format';
import type { SmilePoint } from '../lib/options';
import { dims, labelEvery, linear } from './chartUtils';
import { DataTable, Panel } from './Panel';
import { Tooltip, type TipState } from './Tooltip';

interface Props {
  points: SmilePoint[];
  spot: number;
  skew: number | null;
  sub: string;
  loading: boolean;
  info?: { what: string; read: string };
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

const H = 210;

export function IvSmile({ points, spot, skew, sub, loading, info, drag }: Props) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const data = useMemo(
    () => points.filter((p) => (p.callIv !== null || p.putIv !== null) && p.strike >= spot * 0.6 && p.strike <= spot * 1.6),
    [points, spot],
  );
  const d = dims(w, H, { l: 40, r: 10, t: 14, b: 22 });
  const ivs = data.flatMap((p) => [p.callIv, p.putIv]).filter((v): v is number => v !== null).map((v) => v * 100);
  const lo = Math.min(...ivs, Infinity);
  const hi = Math.max(...ivs, -Infinity);
  const pad = Math.max(2, (hi - lo) * 0.1);
  const yTicks = ivs.length ? niceTicks(Math.max(0, lo - pad), hi + pad, 4) : [0];
  // ticks are rounded; the domain must still contain every point
  const yMin = ivs.length ? Math.min(yTicks[0], Math.max(0, lo - pad)) : 0;
  const yMax = ivs.length ? Math.max(yTicks[yTicks.length - 1], hi + pad) : 1;
  const y = linear(yMin, yMax, d.t + d.ph, d.t);
  const kMin = data[0]?.strike ?? 0;
  const kMax = data[data.length - 1]?.strike ?? 1;
  const x = linear(kMin, kMax, d.l, d.l + d.pw);
  const every = labelEvery(data.length, d.pw, 52);

  const path = (key: 'callIv' | 'putIv') =>
    data
      .filter((p) => p[key] !== null)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.strike).toFixed(1)},${y((p[key] as number) * 100).toFixed(1)}`)
      .join(' ');

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = d.l + ((e.clientX - rect.left) / rect.width) * d.pw;
    let best = data[0];
    for (const p of data) if (Math.abs(x(p.strike) - px) < Math.abs(x(best.strike) - px)) best = p;
    if (!best) return;
    setTip({
      x: e.clientX, y: e.clientY, title: `Strike ${fmtPrice(best.strike)}${best.callDelta !== null ? ` · Δ ${best.callDelta.toFixed(2)}` : ''}`,
      rows: [
        { value: best.callIv !== null ? fmtPct(best.callIv * 100) : '—', label: 'call IV', color: 'var(--s1)' },
        { value: best.putIv !== null ? fmtPct(best.putIv * 100) : '—', label: 'put IV', color: 'var(--s2)' },
      ],
    });
  };

  const hovStrike = tip ? parseFloat(tip.title.replace(/[^0-9.]/g, '')) : null;

  const table = (
    <DataTable
      cols={['Strike', 'Call IV', 'Put IV', 'Call Δ']}
      rows={points.map((p) => [
        fmtPrice(p.strike),
        p.callIv !== null ? fmtPct(p.callIv * 100) : '—',
        p.putIv !== null ? fmtPct(p.putIv * 100) : '—',
        p.callDelta !== null ? p.callDelta.toFixed(2) : '—',
      ])}
    />
  );

  return (
    <Panel title="IV smile" sub={`${sub}${skew !== null ? ` · 25Δ skew ${skew >= 0 ? '+' : ''}${(skew * 100).toFixed(1)} pts` : ''}`} loading={loading} table={table} info={info} drag={drag}>
      <div className="legend">
        <span className="k"><i className="ln" style={{ background: 'var(--s1)' }} /> Calls</span>
        <span className="k"><i className="ln" style={{ background: 'var(--s2)' }} /> Puts</span>
        <span className="k"><i className="ln" style={{ background: 'var(--ink)' }} /> Spot</span>
      </div>
      <div className="chart" ref={ref}>
        {w > 0 && data.length > 1 ? (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onPointerLeave={() => setTip(null)}>
            {yTicks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={d.l} x2={d.l + d.pw} y1={y(t)} y2={y(t)} />
                <text x={d.l - 4} y={y(t) + 3} textAnchor="end">{t.toFixed(0)}%</text>
              </g>
            ))}
            <line className="baseline" x1={d.l} x2={d.l + d.pw} y1={d.t + d.ph} y2={d.t + d.ph} />
            {data.map((p, i) => i % every === 0 && (
              <text key={p.strike} x={x(p.strike)} y={H - 6} textAnchor="middle">{fmtCompact(p.strike)}</text>
            ))}
            {spot >= kMin && spot <= kMax && (
              <g>
                <line x1={x(spot)} x2={x(spot)} y1={d.t - 2} y2={d.t + d.ph} stroke="var(--ink)" strokeWidth={1} />
                <text x={x(spot)} y={d.t - 4} textAnchor="middle" className="ref-label">{fmtPrice(spot)}</text>
              </g>
            )}
            <path d={path('callIv')} fill="none" stroke="var(--s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            <path d={path('putIv')} fill="none" stroke="var(--s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {data.map((p) => (
              <g key={p.strike}>
                {p.callIv !== null && <circle cx={x(p.strike)} cy={y(p.callIv * 100)} r={hovStrike === p.strike ? 4.5 : 3} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />}
                {p.putIv !== null && <circle cx={x(p.strike)} cy={y(p.putIv * 100)} r={hovStrike === p.strike ? 4.5 : 3} fill="var(--s2)" stroke="var(--surface)" strokeWidth={2} />}
              </g>
            ))}
            {hovStrike !== null && data.some((p) => p.strike === hovStrike) && (
              <line x1={x(hovStrike)} x2={x(hovStrike)} y1={d.t} y2={d.t + d.ph} stroke="var(--muted)" strokeWidth={1} />
            )}
            <rect x={d.l} y={d.t} width={d.pw} height={d.ph} fill="transparent" onPointerMove={onMove} />
          </svg>
        ) : (
          <div className="empty">{loading ? 'Loading…' : 'Not enough quotes for a smile'}</div>
        )}
        <Tooltip tip={tip} />
      </div>
    </Panel>
  );
}
