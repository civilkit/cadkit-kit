import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';

/** "Rebuilding model... 1.8 s [Cancel]" panel for slow work. Hidden for quick work (shown only after `delayMs`). */
export function BusyOverlay(p: { busy: boolean; onCancel(): void; delayMs?: number }): JSX.Element | null {
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
      <span>Rebuilding model... {(elapsed / 1000).toFixed(1)} s</span>
      <button class="busy-cancel" onClick={p.onCancel}>Cancel</button>
    </div>
  );
}
