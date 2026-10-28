import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { t } from './i18n';

/** "Rebuilding model... 1.8 s [Cancel]" panel for slow work. Hidden for quick work (shown only after `delayMs`). */
export function BusyOverlay(p: { busy: boolean; onCancel(): void; delayMs?: number; /** Replaces the "Rebuilding model" line (an import says what it is reading and how far it is). */ label?: string; /** With a label: add the seconds since the work started, so a long step shows that it is still going. */ showElapsed?: boolean; /** False when the work cannot be stopped (the Cancel button is left out). */ cancelable?: boolean }): JSX.Element | null {
  const delay = p.delayMs ?? 400;
  const [elapsed, setElapsed] = useState<number | null>(null);   // ms since the work started, once visible
  useEffect(() => {
    if (!p.busy) { setElapsed(null); return; }
    const t0 = Date.now();
    let tick: ReturnType<typeof setInterval> | undefined;
    const show = setTimeout(() => {
      setElapsed(Date.now() - t0);
      tick = setInterval(() => setElapsed(Date.now() - t0), 100);
    }, delay);
    return () => { clearTimeout(show); if (tick) clearInterval(tick); };
  }, [p.busy, delay]);
  if (!p.busy || elapsed === null) return null;
  return (
    <div class="busy-overlay" role="status">
      <span class="busy-spin" aria-hidden="true" />
      <span>{p.label ? (p.showElapsed ? `${p.label} ${Math.floor(elapsed / 1000)} s` : p.label) : t('ui.busy.rebuilding', { seconds: (elapsed / 1000).toFixed(1) })}</span>
      {p.cancelable === false ? null : <button class="busy-cancel" onClick={p.onCancel}>{t('ui.cancel')}</button>}
    </div>
  );
}
