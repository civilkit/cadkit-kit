import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Notice } from '@kit/store';
import { MAX_TOASTS, visibleToasts, type ToastEntry } from './overlayLayout';

/** The toast stack (the overlay layer's bottom-centre region): at most `max` at a time, the rest queue and show as room frees up; identical messages merge into one with a
 *  count; errors jump the queue and stay longer; each auto-dismisses (3 s, 6 s for an error, 7 s with an action) and can be dismissed by tapping its text.
 *  `ms` overrides how long each stays. */
export function Toast(p: { notices: Notice[]; max?: number; ms?: number; now?: () => number }): JSX.Element | null {
  const now = p.now ?? Date.now;
  // a notice without a timestamp lives from the moment it was first seen
  const firstSeen = useRef(new Map<number, number>());
  const entries: ToastEntry[] = p.notices.map((n) => { if (!firstSeen.current.has(n.id)) firstSeen.current.set(n.id, now()); return { ...n, at: n.at ?? firstSeen.current.get(n.id)! }; });
  const [dismissed, setDismissed] = useState<ReadonlySet<number>>(new Set());
  const [, tick] = useState(0);
  const { shown } = visibleToasts(entries, now(), { max: p.max ?? MAX_TOASTS, dismissed, ...(p.ms ? { ttl: p.ms } : {}) });
  // re-evaluate while anything is live: when a toast expires the next queued one takes its place
  const live = entries.some((n) => now() - n.at! < (p.ms ?? 7000));
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 400);
    return () => clearInterval(t);
  }, [live]);
  if (!shown.length) return null;
  const dismiss = (ids: number[]) => setDismissed((d) => new Set([...d, ...ids]));
  return (
    <div class="toast-stack" role="status" aria-live="polite">
      {shown.map((last) => {
        const icon = last.level === 'error' ? '✕' : last.level === 'warn' ? '!' : '✓';
        const same = p.notices.filter((n) => n.text === last.text && n.level === last.level).map((n) => n.id);
        return (
          <div key={last.id} class={'toast ' + last.level}>
            <span class="toast-icon">{icon}</span>
            <span class="toast-text" onClick={() => dismiss(same)}>{last.text}</span>
            {(last.count ?? 1) > 1 ? <span class="toast-count" aria-label={`${last.count} times`}>×{last.count}</span> : null}
            {last.action ? <button class="toast-act" onClick={() => { last.action!.run(); dismiss(same); }}>{last.action.label}</button> : null}
          </div>
        );
      })}
    </div>
  );
}
