export function fmtUsd(v: number, digits = 1): string {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(digits)}K`;
  return `${sign}$${a.toFixed(0)}`;
}

export function fmtNum(v: number, digits = 0): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtPrice(v: number): string {
  if (v >= 10000) return fmtNum(v, 0);
  if (v >= 1000) return fmtNum(v, 1);
  return fmtNum(v, 2);
}

export function fmtPct(v: number, digits = 1, signed = false): string {
  const s = signed && v > 0 ? '+' : '';
  return `${s}${v.toFixed(digits)}%`;
}

export function fmtCompact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(a >= 100 ? 0 : 1);
}

export function fmtDateShort(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

export function fmtTime(sec: number, withDate: boolean): string {
  const d = new Date(sec * 1000);
  return withDate
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
    : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Clean axis ticks: ~n ticks at 1/2/2.5/5 multiples. */
export function niceTicks(min: number, max: number, n = 5): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const rough = span / n;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const steps = [1, 2, 2.5, 5, 10];
  const step = steps.map((s) => s * pow).find((s) => span / s <= n) ?? 10 * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
  return out;
}
