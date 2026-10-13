import type { JSX } from 'preact';
import type { Notice } from '@kit/store';

export function StatusBar(p: { notices: Notice[]; hover: string | null; busy: boolean }): JSX.Element {
  const last = p.notices.at(-1);
  return (
    <div class="status">
      {p.busy ? <span class="st-busy">Busy</span> : null}
      {p.hover ? <span class="st-hover">{p.hover}</span> : null}
      {last ? <span class={'st-notice ' + last.level}>{last.text}</span> : null}
    </div>
  );
}
