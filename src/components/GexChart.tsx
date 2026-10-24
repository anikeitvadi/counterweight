import { useMemo, useState } from 'react';
import { useMeasure } from '../hooks/useMeasure';
import { fmtCompact, fmtPrice, fmtUsd, niceTicks } from '../lib/format';
import type { GexPoint } from '../lib/options';
import { dims, labelEvery, linear } from './chartUtils';
import { DataTable, Panel } from './Panel';
import { Tooltip, type TipState } from './Tooltip';

interface Props {
  points: GexPoint[];
  total: number;
  flip: number | null;
  spot: number;
  sub: string;
  loading: boolean;
  info?: { what: string; read: string };
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

const H = 210;

export function GexChart({ points, total, flip, spot, sub, loading, info, drag }: Props) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);
  const data = useMemo(() => points.filter((p) => p.strike >= spot * 0.7 && p.strike <= spot * 1.3 && p.gex !== 0), [points, spot]);
  const d = dims(w, H, { l: 44, r: 8, t: 14, b: 22 });
  const absMax = Math.max(1e-9, ...data.map((p) => Math.abs(p.gex)));
  const ticks = niceTicks(-absMax, absMax, 4);
  const yMax = Math.max(Math.abs(ticks[0]), Math.abs(ticks[ticks.length - 1]), absMax);
  const y = linear(-yMax, yMax, d.t + d.ph, d.t);
  const band = data.length ? d.pw / data.length : 0;
  const barW = Math.min(24, Math.max(1, band - 2));
  const xOf = (i: number) => d.l + band * i + band / 2;
  const every = labelEvery(data.length, d.pw, 48);
  const priceX = (k: number) => {
    if (data.length < 2) return null;
    if (k < data[0].strike || k > data[data.length - 1].strike) return null;
    for (let i = 0; i < data.length - 1; i++) {
      if (k >= data[i].strike && k <= data[i + 1].strike) {
        const f = (k - data[i].strike) / (data[i + 1].strike - data[i].strike || 1);
        return xOf(i) + f * band;
      }
    }
    return null;
  };
  const spotX = priceX(spot);
  const flipX = flip !== null ? priceX(flip) : null;

  const table = <DataTable cols={['Strike', 'GEX ($ / 1%)']} rows={points.map((p) => [fmtPrice(p.strike), fmtUsd(p.gex, 2)])} />;

  return (
    <Panel title="Gamma exposure" sub={`${sub} · net ${fmtUsd(total, 1)}/1%${flip !== null ? ` · flip ${fmtPrice(flip)}` : ''}`} loading={loading} table={table} info={info} drag={drag}>
      <div className="legend">
        <span className="k"><i className="sw" style={{ background: 'var(--s1)' }} /> Positive (dealers long gamma)</span>
        <span className="k"><i className="sw" style={{ background: 'var(--neg)' }} /> Negative</span>
        {flip !== null && <span className="k"><i className="ln" style={{ background: 'var(--ink-2)' }} /> Gamma flip</span>}
      </div>
      <div className="chart" ref={ref}>
        {w > 0 && data.length > 0 ? (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onPointerLeave={() => setTip(null)}>
            {niceTicks(-yMax, yMax, 4).map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'baseline' : 'gridline'} x1={d.l} x2={d.l + d.pw} y1={y(t)} y2={y(t)} />
                <text x={d.l - 4} y={y(t) + 3} textAnchor="end">{fmtUsd(t, 0)}</text>
              </g>
            ))}
            {data.map((p, i) => {
              const top = Math.min(y(0), y(p.gex));
              const h = Math.abs(y(0) - y(p.gex));
              return (
                <g key={p.strike}>
                  <rect x={xOf(i) - barW / 2} width={barW} y={top} height={Math.max(0.5, h)} rx={Math.min(3, barW / 2)} fill={p.gex >= 0 ? 'var(--s1)' : 'var(--neg)'} />
                  {i % every === 0 && <text x={xOf(i)} y={H - 6} textAnchor="middle">{fmtCompact(p.strike)}</text>}
                  <rect
                    x={xOf(i) - band / 2} width={band} y={d.t} height={d.ph} fill="transparent"
                    onPointerMove={(e) =>
                      setTip({ x: e.clientX, y: e.clientY, title: fmtPrice(p.strike), rows: [{ value: fmtUsd(p.gex, 2), label: 'per 1% move', color: p.gex >= 0 ? 'var(--s1)' : 'var(--neg)' }] })
                    }
                  />
                </g>
              );
            })}
            {spotX !== null && (
              <g>
                <line x1={spotX} x2={spotX} y1={d.t - 2} y2={d.t + d.ph} stroke="var(--ink)" strokeWidth={1} />
                <text x={spotX} y={d.t - 4} textAnchor="middle" className="ref-label">{fmtPrice(spot)}</text>
              </g>
            )}
            {flipX !== null && <line className="ref" x1={flipX} x2={flipX} y1={d.t} y2={d.t + d.ph} />}
          </svg>
        ) : (
          <div className="empty">{loading ? 'Loading…' : 'No gamma data'}</div>
        )}
        <Tooltip tip={tip} />
      </div>
    </Panel>
  );
}
