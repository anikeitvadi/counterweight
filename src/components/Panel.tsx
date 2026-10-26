import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Bright lead-in before the title, e.g. the asset, so cards can be told apart at a glance. */
  lead?: string;
  sub?: string;
  wide?: boolean;
  loading?: boolean;
  controls?: ReactNode;
  /** Table-view twin of the chart; rendered when the user toggles "table". */
  table?: ReactNode;
  /** Glossary entry shown from the ⓘ button. */
  info?: { what: string; read: string };
  /** Drag-to-reorder wiring from the layout. */
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
  children: ReactNode;
}

export function Panel({ title, lead, sub, wide, loading, controls, table, info, drag, children }: Props) {
  const fullTitle = lead ? `${lead} · ${title}` : title;
  const [showTable, setShowTable] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [over, setOver] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showInfo) return;
    const onDown = (e: PointerEvent) => {
      if (!infoRef.current?.contains(e.target as Node)) setShowInfo(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setShowInfo(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [showInfo]);

  return (
    <section
      className={`panel${wide ? ' wide' : ''}${loading ? ' loading' : ''}${over ? ' drop-target' : ''}${drag?.dragging ? ' dragging' : ''}`}
      onDragOver={drag ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={drag ? () => setOver(false) : undefined}
      onDrop={drag ? (e) => { e.preventDefault(); setOver(false); drag.onDrop(drag.id); } : undefined}
    >
      <div className="ph">
        {drag && (
          <span className="grip" title="Drag to reorder" draggable onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; drag.onDragStart(drag.id); }} aria-label="Drag to reorder">
            ⋮⋮
          </span>
        )}
        <h3>{lead && <span className="lead">{lead}</span>}{lead && ' · '}{title}</h3>
        {info && (
          <div className="info-wrap" ref={infoRef}>
            <button className="info-btn" aria-label={`About ${fullTitle}`} aria-expanded={showInfo} onClick={() => setShowInfo((v) => !v)}>i</button>
            {showInfo && (
              <div className="info-pop" role="dialog" aria-label={`About ${fullTitle}`}>
                <p><b>What it is.</b> {info.what}</p>
                <p><b>How to read it.</b> {info.read}</p>
              </div>
            )}
          </div>
        )}
        {sub && <span className="sub">{sub}</span>}
        <div className="ctl">
          {controls}
          {table && (
            <div className="seg small">
              <button className={showTable ? '' : 'on'} onClick={() => setShowTable(false)} aria-pressed={!showTable}>chart</button>
              <button className={showTable ? 'on' : ''} onClick={() => setShowTable(true)} aria-pressed={showTable}>table</button>
            </div>
          )}
        </div>
      </div>
      {showTable && table ? <div className="tv-wrap">{table}</div> : children}
    </section>
  );
}

export function DataTable({ cols, rows }: { cols: string[]; rows: Array<Array<string | number>> }) {
  return (
    <table className="tv">
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) => (
              <td key={j}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
