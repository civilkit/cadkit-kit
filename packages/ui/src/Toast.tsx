import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Notice } from '@kit/store';

/** Shows the newest notice for `ms`, then hides it. A newer notice shows again. */
export function Toast(p: { notices: Notice[]; ms?: number }): JSX.Element | null {
  const last = p.notices.at(-1);
  const [shownId, setShownId] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    setShownId(last.id);
    const t = setTimeout(() => setShownId((id) => (id === last.id ? null : id)), p.ms ?? 3000);
    return () => clearTimeout(t);
  }, [last?.id]);
  if (!last || shownId !== last.id) return null;
  const icon = last.level === 'error' ? '✕' : last.level === 'warn' ? '!' : '✓';
  return (
    <div class={'toast ' + last.level} role="status">
      <span class="toast-icon">{icon}</span>
      <span>{last.text}</span>
    </div>
  );
}
