// The collapsible section every feature editor draws: a header of one height (title, a muted summary while collapsed,
// chevron) over a label/control grid (.fedit-fld, see app.css). Which sections are collapsed is remembered per section id
// across editors (localStorage, try/catch: it works without storage).
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './icons';

const KEY = 'kit.editor.collapsed';

export function loadCollapsed(): Record<string, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}
export function rememberCollapsed(id: string, closed: boolean): void {
  try {
    const all = loadCollapsed();
    if (closed) all[id] = true; else delete all[id];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* storage unavailable: the state just is not remembered */ }
}

export function EditorSection(p: { id: string; title: string; summary?: string; children: ComponentChildren }): JSX.Element {
  const [closed, setClosedState] = useState(() => loadCollapsed()[p.id] === true);
  const toggle = (): void => { const next = !closed; setClosedState(next); rememberCollapsed(p.id, next); };
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" role="button" tabIndex={0} aria-expanded={!closed} onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } }}>
        <span class="fedit-sec-title">{p.title}</span>
        {closed && p.summary ? <span class="fedit-sec-sum">{p.summary}</span> : null}
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}
