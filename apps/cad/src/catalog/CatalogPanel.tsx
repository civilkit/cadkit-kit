// The Catalog side-panel tab and the ghost that follows the pointer while a shape is dragged or armed.
import type { JSX } from 'preact';
import { t } from '../i18n';
import { CATALOG, catalogItem, type CatalogItem } from './shapes';
import { CatalogIcon } from './CatalogIcon';
import { armedItem, ghost, placeStatus, placementSetting } from './state';
import { groundPlane, type StdPlane, type UpAxis } from './placement';
import type { PlaceStatus } from './placer';
import { BoslSection } from './BoslSection';
import { itemLabel } from './labels';
import { LibrarySection, type LibraryActions } from '../library/LibrarySection';
import type { LibraryRegistry } from '../library/registry';

export interface CatalogPanelProps {
  hasDoc: boolean;
  hasSolid: boolean;
  /** Pointer pressed on a shape: starts a drag, or (a click without movement) arms the shape for click-to-place. */
  onItemDown(item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLButtonElement>): void;
  onItemKey(item: CatalogItem): void;
  upAxis?: UpAxis;
  /** The external parts libraries (omitted: no Libraries section). */
  library?: { registry: LibraryRegistry; actions: LibraryActions };
}

const PLANES: StdPlane[] = ['front', 'top', 'right'];

/** Place on / Direction / Rotate / Mirror: how the next shape stands on its plane (changes the live preview; R and F do the same while placing). */
export function PlacementRow({ upAxis }: { upAxis: UpAxis }) {
  const s = placementSetting.value;
  const set = (patch: Partial<typeof s>) => { placementSetting.value = { ...s, ...patch }; };
  return (
    <div class="place-row" data-testid="place-row" role="group" aria-label={t('catalog.place.title')} title={t('catalog.place.tip')}>
      <label>{t('catalog.place.on')}
        <select value={s.plane} onChange={(e) => set({ plane: (e.currentTarget as HTMLSelectElement).value as typeof s.plane })}>
          <option value="auto">{t('catalog.place.auto', { plane: t('catalog.plane.' + groundPlane(upAxis)) })}</option>
          {PLANES.map((p) => <option key={p} value={p}>{t('catalog.plane.' + p)}</option>)}
        </select>
      </label>
      <label>{t('catalog.place.direction')}
        <select value={s.flip ? 'down' : 'up'} onChange={(e) => set({ flip: (e.currentTarget as HTMLSelectElement).value === 'down' })}>
          <option value="up">{t('catalog.place.up')}</option>
          <option value="down">{t('catalog.place.down')}</option>
        </select>
      </label>
      <label>{t('catalog.place.rotate')}
        <select value={String(s.rot)} onChange={(e) => set({ rot: Number((e.currentTarget as HTMLSelectElement).value) as typeof s.rot })}>
          {[0, 1, 2, 3].map((r) => <option key={r} value={String(r)}>{r * 90}&deg;</option>)}
        </select>
      </label>
      <label class="place-mirror"><input type="checkbox" checked={s.mirror} onChange={(e) => set({ mirror: (e.currentTarget as HTMLInputElement).checked })} />{t('catalog.place.mirror')}</label>
    </div>
  );
}

export function CatalogPanel({ hasDoc, hasSolid, onItemDown, onItemKey, upAxis = 'y', library }: CatalogPanelProps) {
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
      <PlacementRow upAxis={upAxis} />
      {column('add', t('catalog.add'))}
      {column('cut', t('catalog.remove'))}
      <BoslSection onItemDown={onItemDown} onItemKey={onItemKey} />
      {library ? <LibrarySection registry={library.registry} hasDoc={hasDoc} actions={library.actions} /> : null}
    </div>
  );
}

/** The chip that follows the pointer: the shape's name, and what it is about to land on. */
/** 'First body on the Top plane' / 'On the Front plane' / 'On plane P3' for a ground target. */
function planeLine(s: Extract<PlaceStatus, { state: 'ready' }>, hasSolid: boolean): string {
  const p = s.plane;
  if (p?.kind === 'feature') return t('catalog.status.onPlaneFeature', { plane: p.id });
  const plane = t('catalog.plane.' + (p?.id ?? 'front'));
  return hasSolid ? t('catalog.status.onPlane', { plane }) : t('catalog.status.ground', { plane });
}

export function CatalogGhost({ hasSolid = false }: { hasSolid?: boolean }) {
  const g = ghost.value;
  if (!g) return null;
  const item = catalogItem(g.itemId);
  if (!item) return null;
  const s = placeStatus.value;
  let line = '';
  if (s.state === 'ready') line = s.face ? t('catalog.status.face', { face: s.face }) + (s.snap ? ' - ' + t('catalog.snap.' + s.snap) : '') : planeLine(s, hasSolid);
  else if (s.state === 'blocked') line = t('catalog.blocked.' + s.reason);
  return (
    <div class={'cat-ghost' + (s.state === 'blocked' ? ' blocked' : '')} style={{ left: g.x + 16 + 'px', top: g.y + 14 + 'px' }} role="status">
      <CatalogIcon kind={item.kind} op={item.op} />
      <span class="cat-ghost-t"><b>{itemLabel(item)}</b>{line ? <span>{line}</span> : null}<span class="cat-keys">{t('catalog.keys')}</span></span>
    </div>
  );
}
