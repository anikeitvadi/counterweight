import { useMemo, useState } from 'react';
import { useMeasure } from '../hooks/useMeasure';
import { fmtCompact, fmtPrice, fmtUsd, niceTicks } from '../lib/format';
import type { StrikeOi } from '../lib/options';
import { dims, labelEvery, linear } from './chartUtils';
import { DataTable, Panel } from './Panel';
import { Tooltip, type TipState } from './Tooltip';

interface Props {
  rows: StrikeOi[];
  spot: number;
  maxPain: number | null;
  unit: string;
  /** Show notional in USD instead of underlying units. */
  usd: boolean;
  onUsd: (v: boolean) => void;
  metric: 'oi' | 'vol';
  onMetric: (m: 'oi' | 'vol') => void;
  sub: string;
  loading: boolean;
  info?: { what: string; read: string };
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

const H = 210;

export function OiByStrike({ rows, spot, maxPain, unit, usd, onUsd, metric, onMetric, sub, loading, info, drag }: Props) {
  const [ref, w] = useMeasure<HTMLDivElement>();
  const [tip, setTip] = useState<TipState | null>(null);

  // Keep the chart readable: strikes within ±30% of spot (the rest is in the table view).
  const data = useMemo(
    () =>
      rows
        .filter((r) => r.strike >= spot * 0.7 && r.strike <= spot * 1.3)
        .map((r) => ({
          strike: r.strike,
          callOi: metric === 'vol' ? (usd ? r.callVolUsd : r.callVol) : usd ? r.callOiUsd : r.callOi,
          putOi: metric === 'vol' ? (usd ? r.putVolUsd : r.putVol) : usd ? r.putOiUsd : r.putOi,
        })),
    [rows, spot, usd, metric],
  );
  const fmtV = (v: number) => (usd ? fmtUsd(v, 1) : fmtCompact(v));
  const unitLabel = usd ? 'USD' : unit;
  const d = dims(w, H, { l: usd ? 48 : 40, r: 8, t: 14, b: 22 });
  const maxOi = Math.max(1e-9, ...data.map((r) => Math.max(r.callOi, r.putOi)));
  const yTicks = niceTicks(0, maxOi, 4);
  const y = linear(0, yTicks[yTicks.length - 1] ?? maxOi, d.t + d.ph, d.t);
  const band = data.length ? d.pw / data.length : 0;
  const barW = Math.min(24, Math.max(1, (band - 2) / 2 - 1));
  const xOf = (i: number) => d.l + band * i;
  const strikeX = (k: number) => {
    // place a price on the categorical axis by interpolating between neighbouring strikes
    if (data.length < 2) return null;
    if (k <= data[0].strike) return xOf(0) + band / 2;
    for (let i = 0; i < data.length - 1; i++) {
      if (k >= data[i].strike && k <= data[i + 1].strike) {
        const f = (k - data[i].strike) / (data[i + 1].strike - data[i].strike || 1);
        return xOf(i) + band / 2 + f * band;
      }
    }
    return xOf(data.length - 1) + band / 2;
  };
  const every = labelEvery(data.length, d.pw, 48);
  const spotX = strikeX(spot);
  const mpX = maxPain !== null ? strikeX(maxPain) : null;

  const table = (
    <DataTable
      cols={['Strike', `Calls (${unit})`, `Puts (${unit})`, 'Calls ($)', 'Puts ($)', 'Total ($)']}
      rows={rows.map((r) => [fmtPrice(r.strike), fmtCompact(r.callOi), fmtCompact(r.putOi), fmtUsd(r.callOiUsd), fmtUsd(r.putOiUsd), fmtUsd(r.callOiUsd + r.putOiUsd)])}
    />
  );
  const unitsToggle = (
    <>
      <div className="seg small" role="group" aria-label="Metric">
        <button className={metric === 'oi' ? 'on' : ''} onClick={() => onMetric('oi')}>OI</button>
        <button className={metric === 'vol' ? 'on' : ''} onClick={() => onMetric('vol')} title="24h traded volume by strike">Volume</button>
      </div>
      <div className="seg small" role="group" aria-label="Units">
        <button className={!usd ? 'on' : ''} onClick={() => onUsd(false)}>{unit}</button>
        <button className={usd ? 'on' : ''} onClick={() => onUsd(true)}>$</button>
      </div>
    </>
  );
  const totals = data.reduce((a, r) => ({ c: a.c + r.callOi, p: a.p + r.putOi }), { c: 0, p: 0 });

  return (
    <Panel title={metric === 'vol' ? 'Volume by strike' : 'Open interest by strike'} sub={`${sub} · calls ${fmtV(totals.c)} · puts ${fmtV(totals.p)}${totals.c > 0 ? ` · PCR ${(totals.p / totals.c).toFixed(2)}` : ''}`} loading={loading} table={table} info={info} drag={drag} controls={unitsToggle}>
      <div className="legend">
        <span className="k"><i className="sw" style={{ background: 'var(--s1)' }} /> Calls</span>
        <span className="k"><i className="sw" style={{ background: 'var(--s2)' }} /> Puts</span>
        {maxPain !== null && <span className="k"><i className="ln" style={{ background: 'var(--ink-2)' }} /> Max pain {fmtPrice(maxPain)}</span>}
        <span className="k"><i className="ln" style={{ background: 'var(--ink)' }} /> Spot</span>
      </div>
      <div className="chart" ref={ref}>
        {w > 0 && data.length > 0 ? (
          <svg viewBox={`0 0 ${w} ${H}`} width={w} height={H} onPointerLeave={() => setTip(null)}>
            {yTicks.map((t) => (
              <g key={t}>
                <line className={t === 0 ? 'baseline' : 'gridline'} x1={d.l} x2={d.l + d.pw} y1={y(t)} y2={y(t)} />
                <text x={d.l - 4} y={y(t) + 3} textAnchor="end">{fmtV(t)}</text>
              </g>
            ))}
            {data.map((r, i) => {
              const x0 = xOf(i) + band / 2;
              const hovered = tip?.title === fmtPrice(r.strike);
              return (
                <g key={r.strike} opacity={hovered ? 1 : 0.92}>
                  <rect x={x0 - barW - 1} width={barW} y={y(r.callOi)} height={Math.max(0, y(0) - y(r.callOi))} rx={Math.min(3, barW / 2)} fill="var(--s1)" />
                  <rect x={x0 + 1} width={barW} y={y(r.putOi)} height={Math.max(0, y(0) - y(r.putOi))} rx={Math.min(3, barW / 2)} fill="var(--s2)" />
                  {i % every === 0 && (
                    <text x={x0} y={H - 6} textAnchor="middle">{fmtCompact(r.strike)}</text>
                  )}
                  <rect
                    x={xOf(i)} width={band} y={d.t} height={d.ph} fill="transparent"
                    onPointerMove={(e) =>
                      setTip({
                        x: e.clientX, y: e.clientY, title: fmtPrice(r.strike),
                        rows: [
                          { value: usd ? fmtUsd(r.callOi) : `${fmtCompact(r.callOi)} ${unitLabel}`, label: metric === 'vol' ? 'calls volume' : 'calls OI', color: 'var(--s1)' },
                          { value: usd ? fmtUsd(r.putOi) : `${fmtCompact(r.putOi)} ${unitLabel}`, label: metric === 'vol' ? 'puts volume' : 'puts OI', color: 'var(--s2)' },
                        ],
                      })
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
            {mpX !== null && (
              <line className="ref" x1={mpX} x2={mpX} y1={d.t} y2={d.t + d.ph} />
            )}
          </svg>
        ) : (
          <div className="empty">{loading ? 'Loading…' : 'No open interest'}</div>
        )}
        <Tooltip tip={tip} />
      </div>
    </Panel>
  );
}
