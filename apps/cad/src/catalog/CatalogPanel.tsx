// The Catalog side-panel tab and the ghost that follows the pointer while a shape is dragged or armed.
import type { JSX } from 'preact';
import { t } from '../i18n';
import { CATALOG, catalogItem, type CatalogItem } from './shapes';
import { CatalogIcon } from './CatalogIcon';
import { armedItem, ghost, placeStatus } from './state';
import { BoslSection } from './BoslSection';
import { itemLabel } from './labels';

export interface CatalogPanelProps {
  hasDoc: boolean;
  hasSolid: boolean;
  /** Pointer pressed on a shape: starts a drag, or (a click without movement) arms the shape for click-to-place. */
  onItemDown(item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLButtonElement>): void;
  onItemKey(item: CatalogItem): void;
}

export function CatalogPanel({ hasDoc, hasSolid, onItemDown, onItemKey }: CatalogPanelProps) {
  if (!hasDoc) return <div class="empty">{t('catalog.empty')}</div>;
  const armed = armedItem.value;
  const column = (op: 'add' | 'cut', title: string) => (
    <div class={'cat-col cat-' + op} data-testid={'catalog-' + op}>
      <div class="cat-h">{title}</div>
      <div class="cat-grid">
        {CATALOG.filter((c) => c.op === op).map((item) => {
          const off = item.op === 'cut' && !hasSolid;
          return (
            <button key={item.id} class={'cat-item' + (armed === item.id ? ' armed' : '') + (off ? ' off' : '')} data-item={item.id}
              title={t('catalog.tip.' + item.id)} aria-pressed={armed === item.id} aria-disabled={off}
              onPointerDown={(e) => onItemDown(item, e)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onItemKey(item); } }}>
              <CatalogIcon kind={item.kind} op={item.op} />
              <span class="cat-name">{t('catalog.item.' + item.id)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <div class="catalog" aria-label={t('catalog.title')}>
      <div class="cat-sub">{t('catalog.hint')}</div>
      {column('add', t('catalog.add'))}
      {column('cut', t('catalog.remove'))}
      <BoslSection onItemDown={onItemDown} onItemKey={onItemKey} />
    </div>
  );
}

/** The chip that follows the pointer: the shape's name, and what it is about to land on. */
export function CatalogGhost() {
  const g = ghost.value;
  if (!g) return null;
  const item = catalogItem(g.itemId);
  if (!item) return null;
  const s = placeStatus.value;
  let line = '';
  if (s.state === 'ready') line = s.face ? t('catalog.status.face', { face: s.face }) + (s.snap ? ' - ' + t('catalog.snap.' + s.snap) : '') : t('catalog.status.ground');
  else if (s.state === 'blocked') line = t('catalog.blocked.' + s.reason);
  return (
    <div class={'cat-ghost' + (s.state === 'blocked' ? ' blocked' : '')} style={{ left: g.x + 16 + 'px', top: g.y + 14 + 'px' }} role="status">
      <CatalogIcon kind={item.kind} op={item.op} />
      <span class="cat-ghost-t"><b>{itemLabel(item)}</b>{line ? <span>{line}</span> : null}</span>
    </div>
  );
}
