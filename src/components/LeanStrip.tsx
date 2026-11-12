import type { Asset } from '../api/delta';
import type { ChainLean } from '../hooks/useChainLeans';
import { fmtPrice } from '../lib/format';
import type { ExpirySel } from '../lib/options';
import { ExpirySelect } from './ExpirySelect';
import { ASSET_NAME } from './WidgetCard';

const DIRECTION = { short: 'Short', long: 'Long', neutral: 'Flat' } as const;

interface Props {
  /** Assets in display order with their current read (undefined while loading). */
  items: Array<{ asset: Asset; read: ChainLean | undefined }>;
  active: Asset;
  onPick: (a: Asset) => void;
  /** Each asset's own expiry: its chain lists different dates (gold far fewer than BTC/ETH). */
  onExpiry: (a: Asset, sel: ExpirySel) => void;
}

/** Header strip: every chosen asset's ratio, direction and max pain at a glance. Clicking one makes it the desk's asset. */
export function LeanStrip({ items, active, onPick, onExpiry }: Props) {
  if (!items.length) return null;
  return (
    <div className="lean-strip" role="group" aria-label="Lean by asset">
      {items.map(({ asset, read }) => {
        const l = read?.lean ?? null;
        const tone = read?.tone ?? 'neutral';
        return (
          <div key={asset} className={`ls-item ${tone}${asset === active ? ' active' : ''}`}>
            <button
              className="ls-open"
              onClick={() => onPick(asset)}
              title={read ? `${ASSET_NAME[asset]} · ${read.expiry === 'all' ? 'all expiries' : read.expiry} · click to open` : `${ASSET_NAME[asset]} · loading`}
            >
              <span className="a">{ASSET_NAME[asset]}</span>
              <span className="r">{l ? `1:${Number.isFinite(l.ratio) ? l.ratio.toFixed(2) : '∞'}` : '—'}</span>
              <span className="d">{l ? DIRECTION[tone] : ''}</span>
              <span className="mp">{read?.maxPain != null ? `MP ${fmtPrice(read.maxPain)}` : ''}</span>
            </button>
            {read && <ExpirySelect options={read.expiries} value={read.expiry} onChange={(sel) => onExpiry(asset, sel)} asset={ASSET_NAME[asset]} short className="ls-exp" />}
          </div>
        );
      })}
    </div>
  );
}
