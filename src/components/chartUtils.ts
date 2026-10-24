export interface Dims {
  w: number;
  h: number;
  l: number;
  r: number;
  t: number;
  b: number;
  /** Plot width/height. */
  pw: number;
  ph: number;
}

export function dims(w: number, h: number, m: { l: number; r: number; t: number; b: number }): Dims {
  return { w, h, ...m, pw: Math.max(1, w - m.l - m.r), ph: Math.max(1, h - m.t - m.b) };
}

export function linear(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0);
  return (v: number) => r0 + (v - d0) * k;
}

/** Pick every n-th label so that labels are at least `minPx` apart. */
export function labelEvery(count: number, pw: number, minPx = 44): number {
  return Math.max(1, Math.ceil((count * minPx) / Math.max(1, pw)));
}
