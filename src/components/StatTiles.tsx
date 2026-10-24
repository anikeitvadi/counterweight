import type { Candle } from '../api/delta';
import type { PerpState } from '../api/okx';
import { fmtPct, fmtPrice, fmtUsd } from '../lib/format';
import type { IvRank } from '../lib/ivrank';
import type { Pcr } from '../lib/options';

interface Props {
  perp: PerpState | null;
  venue: string;
  oiChange6hUsd: number | null;
  spot: number;
  /** Recent price candles for the hero sparkline (last 24h is used). */
  price: Candle[];
  secPerBar: number;
  pcr: Pcr | null;
  frontLabel: string | null;
  /** What the put/call tile is scoped to (e.g. 'D1 · 25 Oct' or 'all expiries'). */
  pcrScope: string;
  atmIv: number | null;
  realized: number | null;
  skew: number | null;
  maxPain: number | null;
  expectedMove: number | null;
  ivRank: IvRank | null;
  hasDvol: boolean;
  optionsVenue: string;
  show: boolean;
}

function Tile({ label, value, sub, cls, hero, children }: { label: string; value: string; sub?: string; cls?: string; hero?: boolean; children?: React.ReactNode }) {
  return (
    <div className={`tile${hero ? ' hero-tile' : ''}`}>
      <div className="lbl">{label}</div>
      <div className={`val${hero ? ' hero' : ''}`}>{value}</div>
      {sub && <div className={`sub${cls ? ` ${cls}` : ''}`}>{sub}</div>}
      {children}
    </div>
  );
}

function Sparkline({ closes, up }: { closes: number[]; up: boolean }) {
  if (closes.length < 2) return null;
  const w = 100;
  const h = 26;
  const lo = Math.min(...closes);
  const hi = Math.max(...closes);
  const y = (v: number) => (hi === lo ? h / 2 : h - ((v - lo) / (hi - lo)) * (h - 2) - 1);
  const d = closes.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (closes.length - 1)) * w).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const col = up ? 'var(--good)' : 'var(--bad)';
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={`${d} L${w},${h} L0,${h} Z`} fill={col} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatTiles(p: Props) {
  if (!p.show) return null;
  const perp = p.perp;
  const chg = perp && perp.open24h > 0 ? ((perp.last - perp.open24h) / perp.open24h) * 100 : null;
  const fund = perp ? perp.fundingRate * 100 : null; // percent per 8h
  const nextFund = perp && perp.nextFundingMs > 0 ? Math.max(0, Math.round((perp.nextFundingMs - Date.now()) / 60_000)) : null;
  const barsPerDay = Math.max(1, Math.round(86_400 / p.secPerBar));
  const spark = p.price.slice(-barsPerDay).map((c) => c.c);
  return (
    <div className="tiles">
      <Tile
        label={perp ? `${perp.instId.replace('-SWAP', '')} perp · ${p.venue}` : 'Price'}
        value={perp && perp.last > 0 ? fmtPrice(perp.last) : '—'}
        sub={chg !== null ? `${fmtPct(chg, 2, true)} 24h` : undefined}
        cls={chg !== null ? (chg >= 0 ? 'up' : 'down') : undefined}
        hero
      >
        <Sparkline closes={spark} up={(chg ?? 0) >= 0} />
      </Tile>
      <Tile
        label="Funding (8h)"
        value={fund !== null ? `${fund >= 0 ? '+' : ''}${fund.toFixed(4)}%` : '—'}
        sub={fund !== null ? `${fmtPct(fund * 3 * 365, 1, true)} annualised${nextFund !== null ? ` · next in ${Math.floor(nextFund / 60)}h ${nextFund % 60}m` : ''}` : undefined}
        cls={fund !== null ? (fund > 0.01 ? 'down' : fund < -0.01 ? 'up' : undefined) : undefined}
      />
      <Tile
        label="Perp open interest"
        value={perp && perp.oiUsd > 0 ? fmtUsd(perp.oiUsd) : '—'}
        sub={p.oiChange6hUsd !== null ? `${p.oiChange6hUsd >= 0 ? '+' : ''}${fmtUsd(p.oiChange6hUsd)} 6h` : undefined}
        cls={p.oiChange6hUsd !== null ? (p.oiChange6hUsd >= 0 ? 'up' : 'down') : undefined}
      />
      <Tile label="Perp volume 24h" value={perp && perp.last > 0 ? fmtUsd(perp.volCcy24h * perp.last) : '—'} sub={perp && perp.high24h > 0 ? `range ${fmtPrice(perp.low24h)} – ${fmtPrice(perp.high24h)}` : undefined} />
      <Tile
        label={`Put / call · ${p.pcrScope}`}
        value={p.pcr ? p.pcr.oi.toFixed(2) : '—'}
        sub={p.pcr ? `by OI · ${p.pcr.volume.toFixed(2)} by vol` : undefined}
      />
      <Tile
        label={`Options OI · ${p.optionsVenue}`}
        value={p.pcr ? fmtUsd(p.pcr.callOiUsd + p.pcr.putOiUsd) : '—'}
        sub={p.pcr ? `${fmtUsd(p.pcr.callOiUsd)} calls · ${fmtUsd(p.pcr.putOiUsd)} puts` : undefined}
      />
      <Tile
        label={`ATM IV${p.frontLabel ? ` · ${p.frontLabel}` : ''}`}
        value={p.atmIv !== null ? fmtPct(p.atmIv * 100) : '—'}
        sub={p.realized !== null && p.atmIv !== null ? `RV 7d ${fmtPct(p.realized * 100, 0)} · ${p.atmIv > p.realized ? 'IV rich' : 'IV cheap'}` : undefined}
      />
      <Tile
        label="IV rank · DVOL 1y"
        value={p.ivRank ? `${Math.round(p.ivRank.rank * 100)}` : '—'}
        sub={p.ivRank ? `DVOL ${p.ivRank.current.toFixed(1)} · pct ${Math.round(p.ivRank.percentile * 100)} · ${p.ivRank.rank > 0.6 ? 'options rich' : p.ivRank.rank < 0.3 ? 'options cheap' : 'mid-range'}` : p.hasDvol ? 'loading' : 'no DVOL index for gold'}
      />
      <Tile
        label="25Δ skew"
        value={p.skew !== null ? `${p.skew >= 0 ? '+' : ''}${(p.skew * 100).toFixed(1)} pts` : '—'}
        sub={p.skew !== null ? (p.skew > 0.01 ? 'puts bid · downside hedged' : p.skew < -0.01 ? 'calls bid · upside chased' : 'flat') : undefined}
      />
      <Tile
        label={`Max pain${p.frontLabel ? ` · ${p.frontLabel}` : ''}`}
        value={p.maxPain !== null ? fmtPrice(p.maxPain) : '—'}
        sub={p.maxPain !== null && p.spot > 0 ? `${fmtPct(((p.maxPain - p.spot) / p.spot) * 100, 2, true)} from spot` : undefined}
      />
      <Tile
        label={`1σ move${p.frontLabel ? ` · ${p.frontLabel}` : ''}`}
        value={p.expectedMove !== null ? `±${fmtPrice(p.expectedMove)}` : '—'}
        sub={p.expectedMove !== null && p.spot > 0 ? `±${fmtPct((p.expectedMove / p.spot) * 100, 2)} · ${fmtPrice(p.spot - p.expectedMove)}–${fmtPrice(p.spot + p.expectedMove)}` : undefined}
      />
    </div>
  );
}
