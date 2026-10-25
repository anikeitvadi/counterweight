import { useMemo } from 'react';
import type { Asset } from '../api/delta';
import { useHeatmap } from '../hooks/useHeatmap';
import { useMarketData, type MarketData, type RangeKey, type VenuePref } from '../hooks/useMarketData';
import { fmtDateShort, fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import { ivRank } from '../lib/ivrank';
import { currentClusters, type LiqModel } from '../lib/liquidation';
import { atmIv, expiryCodes, groupByExpiry, maxPain, resolveExpiry, type ExpirySel } from '../lib/options';
import { ErrorBoundary } from './ErrorBoundary';
import { RatioPanel } from './RatioPanel';

export const ASSET_NAME: Record<Asset, string> = { BTC: 'BTC', ETH: 'ETH', XAUT: 'Gold' };
export const UNIT: Record<Asset, string> = { BTC: 'BTC', ETH: 'ETH', XAUT: 'oz' };

interface CardProps {
  asset: Asset;
  data: MarketData;
  expirySel: ExpirySel;
  model: LiqModel;
}

/** Widget block for one asset: the ratio first, then only the numbers that change a decision. */
export function WidgetCard({ asset, data, expirySel, model }: CardProps) {
  const spot = data.options[0]?.spot || data.perp?.last || 0;
  const perpPrice = data.perp?.last || spot;
  const groups = useMemo(() => groupByExpiry(data.options), [data.options]);
  const codes = useMemo(() => expiryCodes(groups.map((g) => g.expiryMs)), [groups]);
  const selected = resolveExpiry(groups, codes, expirySel);
  const front = groups[0] ?? null;
  const frontMaxPain = useMemo(() => (front ? maxPain([...front.calls, ...front.puts]) : null), [front]);
  const frontIv = useMemo(() => (front ? atmIv(front, spot) : null), [front, spot]);
  const rank = useMemo(() => ivRank(data.dvol), [data.dvol]);
  const { heatmap } = useHeatmap(data.price, data.oi, model);
  const nearest = heatmap && perpPrice > 0 ? currentClusters(heatmap, perpPrice, 1) : [];
  const above = nearest.find((c) => c.side === 'short') ?? null;
  const below = nearest.find((c) => c.side === 'long') ?? null;
  const chg = data.perp && data.perp.open24h > 0 ? ((data.perp.last - data.perp.open24h) / data.perp.open24h) * 100 : null;
  const name = ASSET_NAME[asset];
  const context = useMemo(() => ({ asset: name, spot, maxPain: frontMaxPain, above, below, fundingPct: data.perp ? data.perp.fundingRate * 100 : null }), [name, spot, frontMaxPain, above, below, data.perp]);

  return (
    <section className="wcard" aria-label={`${name} widget`}>
      <ErrorBoundary title="Put / call ratio">
        <RatioPanel
          options={data.options} history={data.pcrHistory} venue={data.optionsVenue} unit={UNIT[asset]} loading={data.loading} compact
          selectedExpiryMs={selected ? selected.expiryMs : null} codes={codes} context={context}
        />
      </ErrorBoundary>
      <div className="widget-strip tiles">
        <div className="tile"><div className="lbl">{name} perp</div><div className="val">{perpPrice > 0 ? fmtPrice(perpPrice) : '—'}</div>{chg !== null && <div className={`sub ${chg >= 0 ? 'up' : 'down'}`}>{fmtPct(chg, 2, true)} 24h</div>}</div>
        <div className="tile"><div className="lbl">Funding (8h)</div><div className="val">{data.perp ? `${data.perp.fundingRate >= 0 ? '+' : ''}${(data.perp.fundingRate * 100).toFixed(4)}%` : '—'}</div><div className="sub">{data.perp ? `${fmtPct(data.perp.fundingRate * 100 * 3 * 365, 0, true)} annualised` : ''}</div></div>
        <div className="tile"><div className="lbl" title={front ? `Front expiry ${fmtDateShort(front.expiryMs)}` : undefined}>Max pain</div><div className="val">{frontMaxPain !== null ? fmtPrice(frontMaxPain) : '—'}</div>{frontMaxPain !== null && spot > 0 && <div className="sub">{fmtPct(((frontMaxPain - spot) / spot) * 100, 2, true)} from spot</div>}</div>
        <div className="tile"><div className="lbl">IV rank</div><div className="val">{rank ? Math.round(rank.rank * 100) : '—'}</div><div className="sub">{rank ? `DVOL ${rank.current.toFixed(1)} · ${rank.rank > 0.6 ? 'rich' : rank.rank < 0.3 ? 'cheap' : 'mid'}` : frontIv !== null ? `ATM IV ${fmtPct(frontIv * 100, 0)}` : ''}</div></div>
        <div className="tile"><div className="lbl">Liq. above</div><div className="val">{above ? fmtPrice(above.price) : '—'}</div>{above && <div className="sub">{fmtPct(above.distPct, 1, true)} · {fmtUsd(above.usd)}</div>}</div>
        <div className="tile"><div className="lbl">Liq. below</div><div className="val">{below ? fmtPrice(below.price) : '—'}</div>{below && <div className="sub">{fmtPct(below.distPct, 1, true)} · {fmtUsd(below.usd)}</div>}</div>
      </div>
    </section>
  );
}

interface LiveProps extends Omit<CardProps, 'data'> {
  range: RangeKey;
  venuePref: VenuePref;
}

/** Same card with its own data feed: used for every widget asset except the primary one, whose feed the app already owns. */
export function LiveWidgetCard({ range, venuePref, ...rest }: LiveProps) {
  const data = useMarketData(rest.asset, range, venuePref);
  return <WidgetCard data={data} {...rest} />;
}
