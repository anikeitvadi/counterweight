import { useEffect, useState } from 'react';

export interface TipRow {
  value: string;
  label: string;
  color?: string;
}
export interface TipState {
  x: number;
  y: number;
  title: string;
  rows: TipRow[];
}

/** Fixed-position tooltip that keeps itself inside the viewport. */
export function Tooltip({ tip }: { tip: TipState | null }) {
  const [pos, setPos] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (!tip) return;
    const w = 220;
    const h = 24 + tip.rows.length * 16;
    const left = tip.x + 14 + w > window.innerWidth ? tip.x - w - 10 : tip.x + 14;
    const top = tip.y + 14 + h > window.innerHeight ? tip.y - h - 10 : tip.y + 14;
    setPos({ left, top });
  }, [tip]);
  if (!tip) return null;
  return (
    <div className="tip" style={{ left: pos.left, top: pos.top }} role="status">
      <div className="t">{tip.title}</div>
      {tip.rows.map((r, i) => (
        <div className="r" key={i}>
          {r.color && <i className="k" style={{ background: r.color }} />}
          <b>{r.value}</b>
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  );
}
