// The Catalog side-panel tab and the ghost that follows the pointer while a shape is dragged or armed.
import type { JSX } from 'preact';
import { Icon } from '@kit/ui';
import { t } from '../i18n';
import { CATALOG, catalogItem, type CatalogItem } from './shapes';
import { CatalogIcon } from './CatalogIcon';
import { armedItem, catalogTab, ghost, libFetching, placeStatus, placementSetting, sphereWall } from './state';
import { groundPlane, type StdPlane, type UpAxis } from './placement';
import type { PlaceStatus } from './placer';
import { itemLabel } from './labels';
import { LibraryBrowser, type LibraryActions } from '../library/LibraryBrowser';
import type { LibraryRegistry } from '../library/registry';
import type { ThumbRenderer } from '../library/thumbs';

export interface CatalogPanelProps {
  hasDoc: boolean;
  hasSolid: boolean;
  /** Pointer pressed on a shape: starts a drag, or (a click without movement) arms the shape for click-to-place. */
  onItemDown(item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLElement>): void;
  onItemKey(item: CatalogItem): void;
  upAxis?: UpAxis;
  /** Opens the Propeller wizard (omitted: the Generators block is not offered). */
  onPropeller?(): void;
  /** Opens the Knurl wizard (omitted: no Knurl button). */
  onKnurl?(): void;
  /** Opens the Screw wizard (omitted: no Screw button). */
  onScrew?(): void;
  /** Opens the Washer wizard (omitted: no Washer button). */
  onWasher?(): void;
  /** Opens the Nut, Standoff and Heat-set insert wizards (omitted: no such button). */
  onNut?(): void;
  onStandoff?(): void;
  onInsert?(): void;
  /** Opens the Spring wizard (omitted: no Spring button). */
  onSpring?(): void;
  /** Opens the Case wizard (omitted: no Case button). */
  onCase?(): void;
  /** Opens the Bearing wizard (omitted: no Bearing button). */
  onBearing?(): void;
  /** The libraries (omitted: the Libraries tab is not offered). */
  library?: { registry: LibraryRegistry; actions: LibraryActions; notify?(text: string, level?: 'error' | 'warn' | 'info'): void; renderThumb?: ThumbRenderer };
}

const PLANES: StdPlane[] = ['front', 'top', 'right'];

/** Place on / Direction / Rotate / Mirror: how the next shape stands on its plane (changes the live preview; R and F do the same while placing). */
export function PlacementRow({ upAxis }: { upAxis: UpAxis }) {
  const s = placementSetting.value;
  const partArmed = !!catalogItem(armedItem.value ?? '')?.part;
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
      <label title={partArmed ? t('catalog.place.rotate.parts') : undefined}>{t('catalog.place.rotate')}
        <select value={String(s.rot)} onChange={(e) => set({ rot: Number((e.currentTarget as HTMLSelectElement).value) as typeof s.rot })}>
          {[0, 1, 2, 3].map((r) => <option key={r} value={String(r)}>{r * 90}&deg;</option>)}
        </select>
      </label>
      <label title={t('catalog.place.wall.tip')}>{t('catalog.place.wall')}
        <input type="number" inputMode="decimal" enterKeyHint="done" min="0" step="0.5" value={sphereWall.value} onInput={(e) => { const n = Number((e.currentTarget as HTMLInputElement).value); sphereWall.value = n > 0 ? n : 0; }} />
      </label>
      <label class="place-mirror"><input type="checkbox" checked={s.mirror} onChange={(e) => set({ mirror: (e.currentTarget as HTMLInputElement).checked })} />{t('catalog.place.mirror')}</label>
    </div>
  );
}

const TABS = ['primitives', 'libraries'] as const;

/** Primitives | Libraries: the shapes of the kernel on one side, every library part (BOSL2, samples, add-ons) on the other. */
export function CatalogPanel({ hasDoc, hasSolid, onItemDown, onItemKey, upAxis = 'y', library, onPropeller, onKnurl, onScrew, onWasher, onNut, onStandoff, onInsert, onSpring, onCase, onBearing }: CatalogPanelProps) {
  if (!hasDoc) return <div class="empty">{t('catalog.empty')}</div>;
  const armed = armedItem.value;
  const tab = library ? catalogTab.value : 'primitives';
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
      {library ? (
        <div class="cat-tabs" role="tablist" aria-label={t('catalog.title')}>
          {TABS.map((id) => <button key={id} role="tab" id={'cat-tab-' + id} aria-selected={tab === id} class={'cat-tab' + (tab === id ? ' on' : '')} onClick={() => { catalogTab.value = id; }}>{t('catalog.tab.' + id)}</button>)}
        </div>
      ) : null}
      <div class="cat-sub">{t(tab === 'libraries' ? 'catalog.hint.libraries' : 'catalog.hint')}</div>
      {tab === 'primitives' ? <PlacementRow upAxis={upAxis} /> : (
        <details class="cat-placement"><summary>{t('catalog.place.title')}</summary><PlacementRow upAxis={upAxis} /></details>
      )}
      {tab === 'primitives' ? (
        <>
          {column('add', t('catalog.add'))}
          {column('cut', t('catalog.remove'))}
          {onPropeller ? (
            <div class="cat-col cat-gen" data-testid="catalog-generators">
              <div class="cat-h">{t('catalog.generators')}</div>
              <div class="cat-grid">
                <button class="cat-item" data-item="propeller" title={t('tip.add-propeller')} onClick={onPropeller}>
                  <Icon name="add-propeller" size={26} />
                  <span class="cat-name">{t('cmd.add-propeller')}</span>
                </button>
                {onKnurl ? (
                  <button class="cat-item" data-item="knurl" title={t('tip.add-knurl')} onClick={onKnurl}>
                    <Icon name="add-knurl" size={26} />
                    <span class="cat-name">{t('cmd.add-knurl')}</span>
                  </button>
                ) : null}
                {onScrew ? (
                  <button class="cat-item" data-item="screw" title={t('tip.add-screw')} onClick={onScrew}>
                    <Icon name="add-screw" size={26} />
                    <span class="cat-name">{t('cmd.add-screw')}</span>
                  </button>
                ) : null}
                {onWasher ? (
                  <button class="cat-item" data-item="washer" title={t('tip.add-washer')} onClick={onWasher}>
                    <Icon name="add-washer" size={26} />
                    <span class="cat-name">{t('cmd.add-washer')}</span>
                  </button>
                ) : null}
                {onNut ? (
                  <button class="cat-item" data-item="nut" title={t('tip.add-nut')} onClick={onNut}>
                    <Icon name="add-nut" size={26} />
                    <span class="cat-name">{t('cmd.add-nut')}</span>
                  </button>
                ) : null}
                {onStandoff ? (
                  <button class="cat-item" data-item="standoff" title={t('tip.add-standoff')} onClick={onStandoff}>
                    <Icon name="add-standoff" size={26} />
                    <span class="cat-name">{t('cmd.add-standoff')}</span>
                  </button>
                ) : null}
                {onInsert ? (
                  <button class="cat-item" data-item="insert" title={t('tip.add-insert')} onClick={onInsert}>
                    <Icon name="add-insert" size={26} />
                    <span class="cat-name">{t('cmd.add-insert')}</span>
                  </button>
                ) : null}
                {onSpring ? (
                  <button class="cat-item" data-item="spring" title={t('tip.add-spring')} onClick={onSpring}>
                    <Icon name="add-spring" size={26} />
                    <span class="cat-name">{t('cmd.add-spring')}</span>
                  </button>
                ) : null}
                {onCase ? (
                  <button class="cat-item" data-item="case" title={t('tip.add-case')} onClick={onCase}>
                    <Icon name="add-case" size={26} />
                    <span class="cat-name">{t('cmd.add-case')}</span>
                  </button>
                ) : null}
                {onBearing ? (
                  <button class="cat-item" data-item="bearing" title={t('tip.add-bearing')} onClick={onBearing}>
                    <Icon name="add-bearing" size={26} />
                    <span class="cat-name">{t('cmd.add-bearing')}</span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : library ? <LibraryBrowser registry={library.registry} hasDoc={hasDoc} actions={library.actions} onItemDown={onItemDown} onItemKey={onItemKey} notify={library.notify} renderThumb={library.renderThumb} wizards={{ screw: hasDoc ? onScrew : undefined, bearing: hasDoc ? onBearing : undefined }} /> : null}
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

/** The chip while a library part is fetched for a drag or a drop (not shown for a part that is already on this device). */
export function LibraryFetching() {
  const title = libFetching.value;
  if (!title) return null;
  return <div class="cat-fetching" role="status" data-testid="lib-fetching"><span class="cat-spin" aria-hidden="true" />{t('library.fetching', { title })}</div>;
}

export function CatalogGhost({ hasSolid = false }: { hasSolid?: boolean }) {
  const g = ghost.value;
  if (!g) return <LibraryFetching />;
  const item = catalogItem(g.itemId);
  if (!item) return <LibraryFetching />;
  const s = placeStatus.value;
  let line = '';
  if (s.state === 'ready') line = s.face ? t('catalog.status.face', { face: s.face }) + (s.snap ? ' - ' + t('catalog.snap.' + s.snap) : '') : planeLine(s, hasSolid);
  else if (s.state === 'blocked') line = t('catalog.blocked.' + s.reason) + (s.hint ? ': ' + s.hint : '');
  return (
    <>
      <div class={'cat-ghost' + (s.state === 'blocked' && s.reason !== 'loading' ? ' blocked' : '')} style={{ left: g.x + 16 + 'px', top: g.y + 14 + 'px' }} role="status">
        <CatalogIcon kind={item.kind} op={item.op} />
        <span class="cat-ghost-t"><b>{itemLabel(item)}</b>{line ? <span>{line}</span> : null}<span class="cat-keys">{t(item.part ? 'catalog.keys.part' : 'catalog.keys')}</span></span>
      </div>
      <LibraryFetching />
    </>
  );
}
