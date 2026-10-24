import { useMemo } from 'react';
import type { Liquidation } from '../api/okx';
import { useMeasure } from '../hooks/useMeasure';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { GLOSSARY } from '../lib/glossary';
import { paletteCss, type Palette } from '../lib/heatmapSeries';
import { currentClusters, type Heatmap, type LiqModel, type LiqSide } from '../lib/liquidation';
import type { StrikeOi } from '../lib/options';
import { HeatmapChart } from './HeatmapChart';
import { DataTable, Panel } from './Panel';

export interface HeatmapPanelProps {
  heatmap: Heatmap | null;
  computing: boolean;
  spot: number;
  venue: string;
  side: LiqSide;
  onSide: (s: LiqSide) => void;
  model: LiqModel;
  onModel: (m: LiqModel) => void;
  palette: Palette;
  threshold: number;
  onThreshold: (t: number) => void;
  theme: 'dark' | 'light';
  up: string;
  down: string;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  liquidations: Liquidation[];
  showLiquidations: boolean;
  onShowLiquidations: (v: boolean) => void;
  walls: { rows: StrikeOi[]; maxPain: number | null; flip: number | null; unit: string } | null;
  showWalls: boolean;
  onShowWalls: (v: boolean) => void;
  windowKey: string;
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

export function LiqHeatmap(p: HeatmapPanelProps) {
  const { heatmap, spot, side } = p;
  const [ref, w] = useMeasure<HTMLDivElement>();
  const H = w >= 700 ? 440 : 330;
  const cap = heatmap ? (side === 'long' ? heatmap.capLong : side === 'short' ? heatmap.capShort : heatmap.capAll) : 0;
  const clusters = useMemo(() => (heatmap && spot > 0 ? currentClusters(heatmap, spot, 4) : []), [heatmap, spot]);
  const recentLiq = useMemo(() => {
    const cut = Date.now() - 3600_000;
    let longUsd = 0;
    let shortUsd = 0;
    for (const l of p.liquidations) if (l.ts >= cut) (l.side === 'long' ? (longUsd += l.usd) : (shortUsd += l.usd));
    return { longUsd, shortUsd };
  }, [p.liquidations]);

  const table = heatmap ? (
    <DataTable
      cols={['Level', 'Side', 'Est. liquidations', 'From spot']}
      rows={currentClusters(heatmap, spot, 12).map((c) => [fmtPrice(c.price), c.side, fmtUsd(c.usd), fmtPct(c.distPct, 2, true)])}
    />
  ) : undefined;

  return (
    <Panel
      title="Liquidation heatmap"
      sub={`${p.venue} perp · drag to pan, wheel to zoom`}
      wide
      loading={p.loading || p.computing}
      table={table}
      info={GLOSSARY.heatmap}
      drag={p.drag}
      controls={
        <>
          <div className="seg small" role="group" aria-label="Side">
            {(['all', 'long', 'short'] as LiqSide[]).map((s) => (
              <button key={s} className={side === s ? 'on' : ''} onClick={() => p.onSide(s)}>{s === 'all' ? 'Both' : s === 'long' ? 'Longs' : 'Shorts'}</button>
            ))}
          </div>
          <div className="seg small" role="group" aria-label="Model">
            {(['balanced', 'directional'] as LiqModel[]).map((m) => (
              <button key={m} className={p.model === m ? 'on' : ''} onClick={() => p.onModel(m)} title={m === 'balanced' ? 'New OI split 50/50 long/short' : 'New OI leans with the bar direction (up bar = more longs)'}>
                {m === 'balanced' ? 'Model 1' : 'Model 2'}
              </button>
            ))}
          </div>
          <div className="seg small" role="group" aria-label="Overlays">
            <button className={p.showLiquidations ? 'on' : ''} onClick={() => p.onShowLiquidations(!p.showLiquidations)} title="Actual liquidations from the exchange feed">Liqs</button>
            <button className={p.showWalls ? 'on' : ''} onClick={() => p.onShowWalls(!p.showWalls)} title="Option open interest by strike on the same price axis, with max pain and gamma flip">Walls</button>
          </div>
          <label className="slider" title="Hide levels weaker than this share of the strongest">
            <span>Threshold {p.threshold.toFixed(2)}</span>
            <input type="range" min={0} max={0.6} step={0.05} value={p.threshold} onChange={(e) => p.onThreshold(parseFloat(e.target.value))} />
          </label>
        </>
      }
    >
      <div className="heat" ref={ref}>
        {heatmap ? (
          <HeatmapChart
            heatmap={heatmap} side={side} palette={p.palette} threshold={p.threshold} theme={p.theme} spot={spot} height={H} windowKey={p.windowKey} up={p.up} down={p.down}
            liquidations={p.liquidations} showLiquidations={p.showLiquidations} walls={p.walls} showWalls={p.showWalls}
          />
        ) : (
          <div className="empty" style={{ height: H }}>
            {p.error ? (
              <span>Couldn't load OKX history: {p.error}. <button className="link" onClick={p.onRetry}>Retry</button></span>
            ) : (
              'Loading candles and open interest…'
            )}
          </div>
        )}
        <div className="scale">
          <span className="k"><i className="sw" style={{ background: p.up }} /><i className="sw" style={{ background: p.down, marginLeft: -3 }} /> price</span>
          <span className="k"><i className="ln" /> now</span>
          {p.showLiquidations && (
            <span className="k" title="Actual liquidations in the last hour">
              <i className="dot" style={{ background: p.up }} /> longs liq. {fmtUsd(recentLiq.longUsd)} <i className="dot" style={{ background: p.down, marginLeft: 6 }} /> shorts liq. {fmtUsd(recentLiq.shortUsd)} <span className="muted">(1h)</span>
            </span>
          )}
          <span style={{ marginLeft: 'auto' }}>weak</span>
          <i className="bar" style={{ background: paletteCss(p.palette, p.theme) }} />
          <span>strong · {fmtUsd(cap)}</span>
        </div>
        {clusters.length > 0 && (
          <div className="clusters">
            <h5>Largest live clusters</h5>
            {clusters.map((c, i) => (
              <div className="c" key={i}>
                <span className="side"><i className="dot" style={{ background: c.side === 'long' ? p.up : p.down }} />{c.side}s</span>
                <span className="p">{fmtPrice(c.price)}</span>
                <span className="d">{fmtPct(c.distPct, 1, true)}</span>
                <span>{fmtUsd(c.usd)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
