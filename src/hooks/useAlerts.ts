import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_STATE, evaluateAlerts, type AlertEvent, type AlertInput, type AlertRules, type AlertState } from '../lib/alerts';
import { useLocalStorage } from './useLocalStorage';

const LOG_MAX = 50;

let audioCtx: AudioContext | null = null;
function beep() {
  try {
    audioCtx ??= new AudioContext();
    const ctx = audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
  } catch {
    /* no audio available */
  }
}

export function useAlerts(rules: AlertRules, input: AlertInput | null) {
  const [log, setLog] = useLocalStorage<AlertEvent[]>('cd.alerts.log', []);
  const [toasts, setToasts] = useState<AlertEvent[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
  const state = useRef<AlertState>(EMPTY_STATE);
  const assetRef = useRef<string>('');

  // The rules engine keeps its own per-asset memory so switching assets does not fire "crossings".
  useEffect(() => {
    if (!input) return;
    if (assetRef.current !== input.asset) {
      assetRef.current = input.asset;
      state.current = { ...EMPTY_STATE, seenLiq: input.liquidations.map((l) => l.ts) };
      return;
    }
    const { events, state: next } = evaluateAlerts(input, rules, state.current);
    state.current = next;
    if (events.length === 0) return;
    setLog((prev) => [...events, ...prev].slice(0, LOG_MAX));
    setToasts((prev) => [...events, ...prev].slice(0, 4));
    if (rules.sound) beep();
    if (rules.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const e of events) {
        try {
          const n = new Notification(e.title, { body: e.body, tag: e.id, silent: true });
          setTimeout(() => n.close(), 15_000);
        } catch {
          /* notifications blocked by the browser context */
        }
      }
    }
    const t = setTimeout(() => setToasts((prev) => prev.filter((x) => !events.includes(x))), 12_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, rules]);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;
    try {
      const p = await Notification.requestPermission();
      setPermission(p);
    } catch {
      setPermission(Notification.permission);
    }
  }, []);

  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);
  const clearLog = useCallback(() => setLog([]), [setLog]);
  const test = useCallback(() => {
    const e: AlertEvent = { id: `test:${Date.now()}`, kind: 'cluster', ts: Date.now(), title: 'Test alert', body: 'This is what an alert looks like.' };
    setToasts((prev) => [e, ...prev].slice(0, 4));
    if (rules.sound) beep();
    if (rules.notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(e.title, { body: e.body, silent: true });
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== e.id)), 8000);
  }, [rules.sound, rules.notify]);

  return { log, toasts, permission, requestPermission, dismiss, clearLog, test };
}
