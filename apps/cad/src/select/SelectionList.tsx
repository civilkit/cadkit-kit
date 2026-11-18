import { useState } from 'preact/hooks';
import { BODY } from '@kit/store';
import { ChipList } from '@kit/ui';
import { t } from '../i18n';
import { isBodyName, type SelModel } from './model';

export interface Chip { name: string; label: string; kind: 'face' | 'edge' | 'corner' | 'body' }

/** A name that is an edge's: the two faces it lies between (`A|B`), or the fallback `edge#n`. */
export const isEdgeShaped = (name: string): boolean => name.includes('|') || name.startsWith('edge#');

/** The chips of a selection, in selection order, with a readable label each (the full name is the tooltip). */
export function chipsOf(sel: string[], model: SelModel | null, bodyName?: (name: string) => string | null): Chip[] {
  const edges = model ? model.edgeNames : [];
  const bodies = model ? model.bodies() : [];
  return sel.map((name): Chip => {
    if (name === BODY) return { name, label: t('select.chip.part'), kind: 'body' };
    if (isBodyName(name)) {
      const i = bodies.findIndex((b) => b.name === name);
      const own = bodyName?.(name);
      if (own) return { name, label: own, kind: 'body' };
      return { name, label: t(bodies[i]?.surface ? 'select.chip.surface' : 'select.chip.body', { n: i + 1 }), kind: 'body' };
    }
    if (name.startsWith('v:')) return { name, label: t('select.chip.corner', { n: name.slice(2) }), kind: 'corner' };
    const ei = edges.indexOf(name);
    if (ei >= 0) return { name, label: t('select.chip.edge', { n: ei + 1 }), kind: 'edge' };
    // an edge name the model does not hold (a persistent name while a preview is up, or `edge#n`): still an edge, never a face
    if (isEdgeShaped(name)) return { name, label: name.startsWith('edge#') ? t('select.chip.edge', { n: Number(name.slice(5)) + 1 }) : t('select.chip.edgeNamed', { name: name.replace(/#\d+$/, '') }), kind: 'edge' };
    return { name, label: t('select.chip.face', { name }), kind: 'face' };
  });
}

/** A panel listing the selection: count, one chip per item with a remove button, and hover that lights the item in the view. */
export function SelectionList(p: { selection: string[]; model: SelModel | null; onRemove(name: string): void; onClear(): void; onHover(name: string | null): void; /** Click on a chip's name: show the feature that owns it in the tree. `canReveal` says which chips have one. */ onBodyName?(name: string): string | null; onReveal?(name: string): void; canReveal?(name: string): boolean; /** An editor is picking into a field: the field is the selection then, so the tray steps aside. */ hidden?: boolean }) {
  const [open, setOpen] = useState(true);
  if (!p.selection.length || p.hidden) return null;
  const chips = chipsOf(p.selection, p.model, p.onBodyName);
  return (
    <div class="sel-list" data-ovr-reserve="right-bottom" role="region" aria-label={t('select.list')}>
      <div class="sel-list-head">
        <button type="button" class="sel-list-toggle" aria-expanded={open} title={t(open ? 'select.list.hide' : 'select.list.show')} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'} {t('select.list')} <b>{chips.length}</b>
        </button>
        <button type="button" class="sel-list-clear" onClick={p.onClear}>{t('select.list.clear')}</button>
      </div>
      {open ? (
        <ChipList
          items={chips.map((c) => ({ key: c.name, label: c.label, kind: c.kind }))}
          removeLabel={(c) => t('select.list.remove') + ': ' + c.label}
          onRemove={(c) => p.onRemove(c.key)}
          onHover={(c) => p.onHover(c ? c.key : null)}
          revealLabel={t('select.chip.reveal')}
          {...(p.onReveal ? { onReveal: (c) => p.onReveal!(c.key), canReveal: (c) => p.canReveal?.(c.key) ?? true } : {})}
        />
      ) : null}
    </div>
  );
}
