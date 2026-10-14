import { useEffect, useRef, useState } from 'preact/hooks';
import { PICK_FILTER_KINDS, type PickFilterKind, type PickFilters } from '@kit/store';
import { Icon, Tip } from '@kit/ui';
import { t } from '../i18n';

/** Pick types that are not selectable in the 3D view itself: they are picked from the history tree, so the switch is shown but marked. */
const TREE_ONLY: PickFilterKind[] = ['sketches'];

/** A funnel button with a popover of checkboxes: which kinds of thing the pointer can pick. */
export function FilterMenu(p: { filters: PickFilters; onChange(kind: PickFilterKind, on: boolean): void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    addEventListener('mousedown', away, true);
    addEventListener('keydown', esc, true);
    return () => { removeEventListener('mousedown', away, true); removeEventListener('keydown', esc, true); };
  }, [open]);
  const off = PICK_FILTER_KINDS.filter((k) => !p.filters[k]).length;
  return (
    <div class="sel-filter" ref={box}>
      <Tip label={t('select.filters.tip')}>
        <button type="button" class="sel-filter-btn" aria-haspopup="true" aria-expanded={open} aria-label={t('select.filters')} aria-pressed={off > 0} onClick={() => setOpen(!open)}>
          <Icon name="sel-filter" size={16} />{off > 0 ? <b class="sel-filter-n">{off}</b> : null}
        </button>
      </Tip>
      {open ? (
        <div class="sel-filter-pop" role="group" aria-label={t('select.filters')}>
          {PICK_FILTER_KINDS.map((k) => (
            <label key={k} title={TREE_ONLY.includes(k) ? t('select.filter.sketches.tip') : undefined}>
              <input type="checkbox" checked={p.filters[k]} onChange={(e) => p.onChange(k, (e.target as HTMLInputElement).checked)} />
              {t('select.filter.' + k)}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
