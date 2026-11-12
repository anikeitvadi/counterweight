import { fmtDateShort } from '../lib/format';
import type { ExpiryOption, ExpirySel } from '../lib/options';

interface Props {
  options: ExpiryOption[];
  /** Resolved code ('D1', 'W2', …) or 'all'. */
  value: string;
  onChange: (sel: ExpirySel) => void;
  /** Names the asset in the accessible label when several dropdowns are on screen. */
  asset?: string;
  /** Code and date only (the header strip); the full form adds time to expiry. */
  short?: boolean;
  className?: string;
}

/** Expiry scope for one asset's chain: lists exactly the expiries that chain has, by Delta's code. */
export function ExpirySelect({ options, value, onChange, asset, short, className = '' }: Props) {
  return (
    <select
      className={`sel ${className}`} value={value} onChange={(e) => onChange(e.target.value)}
      aria-label={asset ? `${asset} expiry` : 'Expiry'}
      title="Expiry scope for the ratio and the strike charts. D1 = nearest daily, W = weekly, M = monthly (Delta's codes)"
    >
      <option value="all">{short ? 'All' : 'All expiries'}</option>
      {options.map((o) => (
        <option key={o.expiryMs} value={o.code}>
          {o.code} · {fmtDateShort(o.expiryMs)}{short ? '' : ` · ${o.dte < 1 ? `${Math.round(o.dte * 24)}h` : `${Math.round(o.dte)}d`}`}
        </option>
      ))}
    </select>
  );
}
