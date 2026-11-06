import { fmtDateShort } from '../lib/format';
import type { ExpiryGroup, ExpirySel } from '../lib/options';

interface Props {
  groups: ExpiryGroup[];
  codes: Map<number, string>;
  selected: ExpiryGroup | null;
  onChange: (sel: ExpirySel) => void;
  /** Names the asset in the accessible label when several dropdowns are on screen. */
  asset?: string;
}

/** Expiry scope for one asset's chain: lists exactly the expiries that chain has, by Delta's code. */
export function ExpirySelect({ groups, codes, selected, onChange, asset }: Props) {
  return (
    <select
      className="sel" value={selected ? codes.get(selected.expiryMs) ?? 'all' : 'all'} onChange={(e) => onChange(e.target.value)}
      aria-label={asset ? `${asset} expiry` : 'Expiry'}
      title="Expiry scope for the ratio and the strike charts. D1 = nearest daily, W = weekly, M = monthly (Delta's codes)"
    >
      <option value="all">All expiries</option>
      {groups.map((g) => (
        <option key={g.expiryMs} value={codes.get(g.expiryMs)}>
          {codes.get(g.expiryMs)} · {fmtDateShort(g.expiryMs)} · {g.dte < 1 ? `${Math.round(g.dte * 24)}h` : `${Math.round(g.dte)}d`}
        </option>
      ))}
    </select>
  );
}
