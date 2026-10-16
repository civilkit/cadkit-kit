import { useState } from 'preact/hooks';
import { BODY } from '@kit/store';
import { t } from '../i18n';
import { isBodyName, type SelModel } from './model';

export interface Chip { name: string; label: string; kind: 'face' | 'edge' | 'corner' | 'body' }

/** The chips of a selection, in selection order, with a readable label each (the full name is the tooltip). */
export function chipsOf(sel: string[], model: SelModel | null): Chip[] {
  const edges = model ? model.edgeNames : [];
  const bodies = model ? model.bodies() : [];
  return sel.map((name): Chip => {
    if (name === BODY) return { name, label: t('select.chip.part'), kind: 'body' };
    if (isBodyName(name)) {
      const i = bodies.findIndex((b) => b.name === name);
      return { name, label: t(bodies[i]?.surface ? 'select.chip.surface' : 'select.chip.body', { n: i + 1 }), kind: 'body' };
    }
    if (name.startsWith('v:')) return { name, label: t('select.chip.corner', { n: name.slice(2) }), kind: 'corner' };
    const ei = edges.indexOf(name);
    if (ei >= 0) return { name, label: t('select.chip.edge', { n: ei + 1 }), kind: 'edge' };
    return { name, label: t('select.chip.face', { name }), kind: 'face' };
  });
}

/** A panel listing the selection: count, one chip per item with a remove button, and hover that lights the item in the view. */
export function SelectionList(p: { selection: string[]; model: SelModel | null; onRemove(name: string): void; onClear(): void; onHover(name: string | null): void; /** Click on a chip's name: show the feature that owns it in the tree. `canReveal` says which chips have one. */ onReveal?(name: string): void; canReveal?(name: string): boolean }) {
  const [open, setOpen] = useState(true);
  if (!p.selection.length) return null;
  const chips = chipsOf(p.selection, p.model);
  return (
    <div class="sel-list" role="region" aria-label={t('select.list')}>
      <div class="sel-list-head">
        <button type="button" class="sel-list-toggle" aria-expanded={open} title={t(open ? 'select.list.hide' : 'select.list.show')} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {t('select.list')} <b>{chips.length}</b>
        </button>
        <button type="button" class="sel-list-clear" onClick={p.onClear}>{t('select.list.clear')}</button>
      </div>
      {open ? (
        <ul class="sel-chips" onMouseLeave={() => p.onHover(null)}>
          {chips.map((c) => (
            <li key={c.name} class={'sel-chip ' + c.kind} title={c.name} onMouseEnter={() => p.onHover(c.name)}>
              {p.onReveal && (p.canReveal?.(c.name) ?? true) ? (
                <button type="button" class="sel-chip-name" title={t('select.chip.reveal')} aria-label={`${t('select.chip.reveal')}: ${c.label}`} onClick={() => p.onReveal!(c.name)}>{c.label}</button>
              ) : <span>{c.label}</span>}
              <button type="button" aria-label={t('select.list.remove') + ': ' + c.label} title={t('select.list.remove')} onClick={() => { p.onHover(null); p.onRemove(c.name); }}>{'×'}</button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
