import type { AlertEvent, AlertRules } from '../lib/alerts';
import { GLOSSARY } from '../lib/glossary';
import { Panel } from './Panel';

interface Props {
  rules: AlertRules;
  onRules: (r: AlertRules) => void;
  log: AlertEvent[];
  permission: NotificationPermission | 'unsupported';
  onRequestPermission: () => void;
  onClear: () => void;
  onTest: () => void;
  unit: string;
  drag?: { id: string; onDragStart: (id: string) => void; onDrop: (id: string) => void; dragging: boolean };
}

function Num({ label, value, step, min, onChange, suffix }: { label: string; value: number; step: number; min: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input type="number" value={value} step={step} min={min} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} />
      <span className="muted">{suffix}</span>
    </label>
  );
}

export function AlertsPanel({ rules, onRules, log, permission, onRequestPermission, onClear, onTest, drag }: Props) {
  const set = (patch: Partial<AlertRules>) => onRules({ ...rules, ...patch });
  return (
    <Panel
      title="Alerts"
      sub={rules.enabled ? 'watching while this tab is open' : 'off'}
      info={GLOSSARY.alerts}
      drag={drag}
      controls={
        <div className="seg small">
          <button className={rules.enabled ? 'on' : ''} onClick={() => set({ enabled: true })}>On</button>
          <button className={!rules.enabled ? 'on' : ''} onClick={() => set({ enabled: false })}>Off</button>
        </div>
      }
    >
      <div className="alerts">
        <div className="rules">
          <label className="chk"><input type="checkbox" checked={rules.cluster} onChange={(e) => set({ cluster: e.target.checked })} /> Price near a big liquidation cluster</label>
          <div className="sub-rules">
            <Num label="within" value={rules.clusterPct} step={0.1} min={0.05} onChange={(v) => set({ clusterPct: v })} suffix="% of price" />
            <Num label="cluster ≥" value={rules.clusterMinUsd / 1e6} step={0.5} min={0} onChange={(v) => set({ clusterMinUsd: v * 1e6 })} suffix="$M" />
          </div>
          <label className="chk"><input type="checkbox" checked={rules.maxPain} onChange={(e) => set({ maxPain: e.target.checked })} /> Price crosses max pain</label>
          <label className="chk"><input type="checkbox" checked={rules.flip} onChange={(e) => set({ flip: e.target.checked })} /> Price crosses the gamma flip</label>
          <label className="chk"><input type="checkbox" checked={rules.funding} onChange={(e) => set({ funding: e.target.checked })} /> Funding extreme</label>
          <div className="sub-rules">
            <Num label="|funding| ≥" value={rules.fundingPct} step={0.01} min={0} onChange={(v) => set({ fundingPct: v })} suffix="% per 8h" />
          </div>
          <label className="chk"><input type="checkbox" checked={rules.bigLiq} onChange={(e) => set({ bigLiq: e.target.checked })} /> Single large liquidation</label>
          <div className="sub-rules">
            <Num label="≥" value={rules.bigLiqUsd / 1e6} step={0.25} min={0} onChange={(v) => set({ bigLiqUsd: v * 1e6 })} suffix="$M" />
          </div>
          <hr />
          <label className="chk"><input type="checkbox" checked={rules.sound} onChange={(e) => set({ sound: e.target.checked })} /> Sound</label>
          <label className="chk">
            <input type="checkbox" checked={rules.notify} onChange={(e) => set({ notify: e.target.checked })} /> Desktop notification
            {permission === 'default' && rules.notify && <button className="link" onClick={onRequestPermission}>allow</button>}
            {permission === 'denied' && <span className="muted"> (blocked in browser settings)</span>}
            {permission === 'unsupported' && <span className="muted"> (not supported here)</span>}
          </label>
          <div className="row-actions">
            <button className="btn" onClick={onTest}>Test alert</button>
            <button className="link" onClick={onClear} disabled={log.length === 0}>Clear log</button>
          </div>
        </div>
        <div className="alert-log">
          <h5>Recent</h5>
          {log.length === 0 && <div className="empty small">Nothing yet.</div>}
          {log.map((e) => (
            <div className="row" key={e.id}>
              <span className="muted">{new Date(e.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span><b>{e.title}</b><br /><span className="muted">{e.body}</span></span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function Toasts({ toasts, onDismiss }: { toasts: AlertEvent[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div className="toast" key={t.id}>
          <div><b>{t.title}</b><div className="muted">{t.body}</div></div>
          <button className="icon-btn small" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
