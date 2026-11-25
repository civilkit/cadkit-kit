// The collapsible section every feature editor draws: a header of one height (title, a muted summary while collapsed,
// chevron) over a label/control grid (.fedit-fld, see app.css). Which sections are collapsed is remembered per section id
// across editors (localStorage, try/catch: it works without storage).
import { useState } from 'preact/hooks';
import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './icons';
import { safeStorage } from '@kit/platform';
import { t } from './i18n';

const KEY = 'kit.editor.collapsed';

export function loadCollapsed(): Record<string, boolean> {
  const v = safeStorage.getJson<Record<string, boolean>>(KEY, {});
  return typeof v === 'object' ? v : {};
}
/** `dflt`: whether the section starts closed when the user never chose (stored only when the choice differs from it). */
export function rememberCollapsed(id: string, closed: boolean, dflt = false): void {
  const all = loadCollapsed();
  if (closed === dflt) delete all[id]; else all[id] = closed;
  safeStorage.setJson(KEY, all);   // unavailable storage: the state just is not remembered
}

/** `help`: an explanation of the section, kept out of the way behind a small ? button in the header (the section's fields stay uncluttered). */
export function EditorSection(p: { id: string; title: string; summary?: string; defaultClosed?: boolean; help?: string; children: ComponentChildren }): JSX.Element {
  const dflt = p.defaultClosed === true;
  const [closed, setClosedState] = useState(() => loadCollapsed()[p.id] ?? dflt);
  const [helpOpen, setHelpOpen] = useState(false);
  const toggle = (): void => { const next = !closed; setClosedState(next); rememberCollapsed(p.id, next, dflt); };
  return (
    <div class={'fedit-sec' + (closed ? ' closed' : '')} data-section={p.id}>
      <div class="fedit-sec-head" role="button" tabIndex={0} aria-expanded={!closed} onClick={toggle}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); toggle(); } }}>
        <span class="fedit-sec-title">{p.title}</span>
        {closed && p.summary ? <span class="fedit-sec-sum">{p.summary}</span> : null}
        {p.help ? (
          <button type="button" class={'fedit-help-btn' + (helpOpen ? ' on' : '')} aria-label={t('ui.editor.help')} aria-expanded={helpOpen} title={t('ui.editor.help')} data-help={p.id}
            onClick={(e) => { e.stopPropagation(); setHelpOpen((v) => !v); }} onKeyDown={(e) => e.stopPropagation()}>?</button>
        ) : null}
        <Icon name="chevron" size={14} class="fedit-chev" />
      </div>
      {!closed && helpOpen && p.help ? <div class="fedit-help" role="note" data-help-text={p.id}>{p.help}</div> : null}
      {closed ? null : <div class="fedit-sec-fields">{p.children}</div>}
    </div>
  );
}
