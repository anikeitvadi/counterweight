import { useState } from 'react';
import { useMeasure } from '../hooks/useMeasure';
import { fmtDateShort, fmtPct, niceTicks } from '../lib/format';
import type { TermPoint } from '../lib/options';
import { dims, linear } from './chartUtils';
import { DataTable, Panel } from './Panel';
import { Tooltip, type TipState } from './Tooltip';

interface Props {
  points: TermPoint[];
  realized: number | null;
  loading: boolean;
  info?: { what: string; read: string };
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

const H = 190;

export function TermStructure({ points, realized, loading, info, drag }: Props) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const d = dims(w, H, { l: 40, r: 28, t: 22, b: 30 });
  const vals = points.map((p) => p.iv * 100).concat(realized !== null ? [realized * 100] : []);
  const lo = Math.min(...vals, Infinity);
  const hi = Math.max(...vals, -Infinity);
  const pad = Math.max(2, (hi - lo) * 0.15);
  const yTicks = vals.length ? niceTicks(Math.max(0, lo - pad), hi + pad, 4) : [0];
  const yMin = vals.length ? Math.min(yTicks[0], Math.max(0, lo - pad)) : 0;
  const yMax = vals.length ? Math.max(yTicks[yTicks.length - 1], hi + pad) : 1;
  const y = linear(yMin, yMax, d.t + d.ph, d.t);
  const inner = 18; // keep end markers and their labels clear of the plot edges
  const x = (i: number) => (points.length === 1 ? d.l + d.pw / 2 : d.l + inner + (i / (points.length - 1)) * (d.pw - 2 * inner));
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.iv * 100).toFixed(1)}`).join(' ');

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = d.l + ((e.clientX - rect.left) / rect.width) * d.pw;
    let bi = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(bi) - px)) bi = i; });
    const p = points[bi];
    if (!p) return;
    const rows = [{ value: fmtPct(p.iv * 100), label: 'ATM IV', color: 'var(--accent)' }];
    if (realized !== null) rows.push({ value: fmtPct(realized * 100), label: 'realised 7d', color: 'var(--muted)' });
    setTip({ x: e.clientX, y: e.clientY, title: `${fmtDateShort(p.expiryMs)} · ${p.dte.toFixed(1)}d`, rows });
  };

  const table = (
    <DataTable cols={['Expiry', 'DTE', 'ATM IV']} rows={points.map((p) => [fmtDateShort(p.expiryMs), p.dte.toFixed(1), fmtPct(p.iv * 100)])} />
  );

  return (
    <Panel title="Volatility term structure" sub="ATM implied vol by expiry" loading={loading} table={table} info={info} drag={drag}>
      <div className="legend">
        <span className="k"><i className="ln" style={{ background: 'var(--accent)' }} /> ATM IV</span>
        {realized !== null && <span className="k"><i className="ln" style={{ background: 'var(--muted)' }} /> Realised vol (7d, {fmtPct(realized * 100, 0)})</span>}
      </div>
      <div className="chart" ref={ref}>
        {w > 0 && points.length > 0 ? (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onPointerLeave={() => setTip(null)}>
            {yTicks.map((t) => (
              <g key={t}>
                <line className="gridline" x1={d.l} x2={d.l + d.pw} y1={y(t)} y2={y(t)} />
                <text x={d.l - 4} y={y(t) + 3} textAnchor="end">{t.toFixed(0)}%</text>
              </g>
            ))}
            <line className="baseline" x1={d.l} x2={d.l + d.pw} y1={d.t + d.ph} y2={d.t + d.ph} />
            {realized !== null && <line className="ref" x1={d.l} x2={d.l + d.pw} y1={y(realized * 100)} y2={y(realized * 100)} />}
            <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {points.map((p, i) => (
              <g key={p.expiryMs}>
                <circle cx={x(i)} cy={y(p.iv * 100)} r={4} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
                {(i === 0 || i === points.length - 1) && (
                  <text x={x(i)} y={y(p.iv * 100) - 8} textAnchor="middle" style={{ fill: 'var(--ink-2)' }}>{fmtPct(p.iv * 100, 0)}</text>
                )}
                <text x={x(i)} y={H - 16} textAnchor="middle">{fmtDateShort(p.expiryMs)}</text>
                <text x={x(i)} y={H - 5} textAnchor="middle">{p.dte < 1 ? `${Math.round(p.dte * 24)}h` : `${Math.round(p.dte)}d`}</text>
              </g>
            ))}
            <rect x={d.l} y={d.t} width={d.pw} height={d.ph} fill="transparent" onPointerMove={onMove} />
          </svg>
        ) : (
          <div className="empty">{loading ? 'Loading…' : 'No expiries'}</div>
        )}
        <Tooltip tip={tip} />
      </div>
    </Panel>
  );
}
