import { useMemo } from 'react';
import type { OptionTicker } from '../api/delta';
import type { OiSnapshot } from '../hooks/useMarketData';
import { fmtCompact, fmtDateShort, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { GLOSSARY } from '../lib/glossary';
import { Panel } from './Panel';

interface Props {
  options: OptionTicker[];
  snapshot: OiSnapshot | null;
  spot: number;
  unit: string;
  venue: string;
  loading: boolean;
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

interface Row {
  o: OptionTicker;
  oiChange: number | null;
}

/** Most-traded strikes in the last 24h and where open interest moved since yesterday's snapshot. */
export function FlowPanel({ options, snapshot, spot, unit, venue, loading, drag }: Props) {
  const rows = useMemo(() => {
    const withChange: Row[] = options.map((o) => ({ o, oiChange: snapshot && o.symbol in snapshot.oi ? o.oi - snapshot.oi[o.symbol] : null }));
    const byVolume = [...withChange].filter((r) => r.o.turnoverUsd > 0).sort((a, b) => b.o.turnoverUsd - a.o.turnoverUsd).slice(0, 8);
    const byOi = snapshot ? [...withChange].filter((r) => r.oiChange !== null && r.oiChange !== 0).sort((a, b) => Math.abs(b.oiChange!) - Math.abs(a.oiChange!)).slice(0, 8) : [];
    const callVol = options.filter((o) => o.type === 'call').reduce((s, o) => s + o.turnoverUsd, 0);
    const putVol = options.filter((o) => o.type === 'put').reduce((s, o) => s + o.turnoverUsd, 0);
    return { byVolume, byOi, callVol, putVol };
  }, [options, snapshot]);

  const label = (o: OptionTicker) => (
    <span className="flow-name">
      <i className="sw" style={{ background: o.type === 'call' ? 'var(--s1)' : 'var(--s2)' }} />
      {fmtCompact(o.strike)} {o.type === 'call' ? 'C' : 'P'} <span className="muted">{fmtDateShort(o.expiryMs)}</span>
    </span>
  );
  const moneyness = (o: OptionTicker) => (spot > 0 ? fmtPct(((o.strike - spot) / spot) * 100, 1, true) : '');

  return (
    <Panel title="Options flow" sub={`${venue} · last 24h`} loading={loading} info={GLOSSARY.flow} drag={drag}>
      <div className="legend">
        <span className="k"><i className="sw" style={{ background: 'var(--s1)' }} /> Calls {fmtUsd(rows.callVol)}</span>
        <span className="k"><i className="sw" style={{ background: 'var(--s2)' }} /> Puts {fmtUsd(rows.putVol)}</span>
        {rows.callVol + rows.putVol > 0 && <span className="k muted">put share {fmtPct((rows.putVol / (rows.callVol + rows.putVol)) * 100, 0)}</span>}
      </div>
      <div className="flow">
        <div>
          <h5>Most traded (premium)</h5>
          {rows.byVolume.length === 0 && <div className="empty small">{loading ? 'Loading…' : 'No volume yet'}</div>}
          {rows.byVolume.map(({ o }) => (
            <div className="row" key={o.symbol}>
              {label(o)}
              <span className="muted">{moneyness(o)}</span>
              <span className="num">{fmtUsd(o.turnoverUsd)}</span>
              <span className="muted num">IV {fmtPct(o.markIv * 100, 0)}</span>
            </div>
          ))}
        </div>
        <div>
          <h5>Open interest moved {snapshot ? `since ${new Date(snapshot.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} yesterday` : ''}</h5>
          {!snapshot && <div className="empty small">Collecting: needs about a day of this desk being open to compare against.</div>}
          {rows.byOi.map(({ o, oiChange }) => (
            <div className="row" key={o.symbol}>
              {label(o)}
              <span className="muted">{moneyness(o)}</span>
              <span className={`num ${oiChange! > 0 ? 'up' : 'down'}`}>{oiChange! > 0 ? '+' : ''}{fmtCompact(oiChange!)} {unit}</span>
              <span className="muted num">{fmtUsd(oiChange! * spot)}</span>
            </div>
          ))}
        </div>
      </div>
      <p className="note">Volume is 24h premium traded in USD. OI moved compares today's open interest with a snapshot this desk took roughly 24h ago; opening and closing both show up as change, so read it with the volume column. Spot {fmtPrice(spot)}.</p>
    </Panel>
  );
}
