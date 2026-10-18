// Wires the Catalog into the app: pointer drag from the panel (with the ghost and the live preview), click-to-place, Esc, and
// the selection of the shape afterwards. main.tsx only calls this and renders the panel and ghost.
import { useEffect, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Viewport } from '@kit/viewport';
import type { Controller } from '../controller';
import type { EditOp } from '@ck/session';
import { Placer, type PlacerDeps } from './placer';
import { catalogItem, shapeName, type BuildResult, type CatalogItem } from './shapes';
import { buildBosl } from './bosl/build';
import type { ScriptHost } from '@kit/script';
import { armedItem, catalogActive, catalogPlane, ghost, libFetching, placeStatus, placementSetting, selectShapeFeature } from './state';
import type { PlaneRef, UpAxis } from './placement';
import { t } from '../i18n';
import { itemLabel } from './labels';
import type { LibraryRegistry, PartData } from '../library/registry';
import { withSource, type SourceEntry } from '../library/insert';
import { buildPlaced } from '../library/buildPlaced';
import { errText } from '../library/AddLibrary';

export interface CatalogDeps {
  controller: Controller;
  viewport(): Viewport | null;
  notify(text: string, level?: 'error' | 'warn' | 'info'): void;
  /** After a shape was committed (the app redraws). */
  placed(): void;
  /** Hide helper sketches and planes in the view. */
  hide(ids: string[]): void;
  /** The view's up axis (nav setting): decides the ground plane. */
  upAxis(): UpAxis;
  /** The libraries: a dragged library part is fetched (and verified) through it. */
  library?: LibraryRegistry;
}

const DRAG_PX = 4;

/** The plane row of the history tree under a screen position (Front / Top / Right, or a plane feature), or null. */
export function planeRowAt(x: number, y: number, isPlaneFeature: (id: string) => boolean): PlaneRef | null {
  const row = typeof document === 'undefined' ? null : document.elementFromPoint(x, y)?.closest<HTMLElement>('.row');
  if (!row) return null;
  const r = row.dataset.ref;
  if (r === 'front' || r === 'top' || r === 'right') return { kind: 'std', id: r };
  const id = row.dataset.id;
  return id && isPlaneFeature(id) ? { kind: 'feature', id } : null;
}

export function useCatalog(d: CatalogDeps) {
  const ref = useRef(d);
  ref.current = d;
  const placer = useRef<Placer | null>(null);
  // library parts fetched for the drag in progress: one fetch per part, the answer kept for the next pointer move
  const parts = useRef({ data: new Map<string, PartData>(), flight: new Map<string, Promise<PartData | null>>(), failed: new Set<string>() });
  const fetchPart = (pr: NonNullable<CatalogItem['part']>): Promise<PartData | null> => {
    const key = pr.libId + '::' + pr.partId, P = parts.current;
    const have = P.data.get(key);
    if (have) return Promise.resolve(have);
    const going = P.flight.get(key);
    if (going) return going;
    libFetching.value = pr.title;
    const job = (async () => {
      try {
        const data = await ref.current.library!.part(pr.libId, pr.partId);
        P.data.set(key, data);
        return data;
      } catch (e) {
        P.failed.add(key);
        ref.current.notify(t('library.fetchFailed', { title: pr.title, reason: errText(e) }), 'error');
        return null;
      } finally {
        P.flight.delete(key);
        if (!P.flight.size) libFetching.value = null;
        placer.current?.rehover();
      }
    })();
    P.flight.set(key, job);
    return job;
  };
  if (!placer.current) {
    const deps: PlacerDeps = {
      document: () => ref.current.controller.document(),
      hasSolid: () => ref.current.controller.hasSolid(),
      bodyFaces: () => ref.current.controller.bodyFaces() as never,
      bodyEdges: () => ref.current.controller.bodyEdges(),
      bodyBox: () => ref.current.controller.bodyBox(),
      preview: (ops: EditOp[]) => ref.current.controller.preview(ops, 0) as never,
      cancelPreview: () => ref.current.controller.cancelPreview(),
      commit: (ops, reason) => ref.current.controller.commit(ops, reason),
      commitPatch: (patch, reason) => ref.current.controller.applyDocPatch(patch, reason),
      buildBosl: async (item, target, doc, linked): Promise<BuildResult> => {
        const c = ref.current.controller;
        if (!item.bosl) return { error: 'invalid' };
        // attach mode never loads or edits through the host: it only builds on the scratch kernel
        const host: ScriptHost = {
          load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
          build: (d, view) => c.scratchBuild(d as never, view) as never, release: () => c.scratchRelease(), facts: (need) => c.scratchFacts(need),
        };
        const r = await buildBosl(host, doc, { entryId: item.bosl.entryId, params: item.bosl.params }, target, linked);
        return r;
      },
      buildPart: async (item, target, doc, linked): Promise<BuildResult> => {
        const c = ref.current, reg = c.library, pr = item.part;
        if (!reg || !pr) return { error: 'invalid' };
        const key = pr.libId + '::' + pr.partId;
        let data = parts.current.data.get(key);
        if (!data) {
          if (!linked) {
            if (parts.current.failed.has(key)) return { error: 'fetchFailed' };
            void fetchPart(pr);
            return { error: 'loading' };
          }
          data = (await fetchPart(pr)) ?? undefined;     // the drop: wait for it, a spinner shows meanwhile
          if (!data) return { error: 'fetchFailed' };
        }
        const lib = reg.get(pr.libId);
        if (!lib) return { error: 'invalid' };
        return buildPlaced(doc, data, lib, target, { linked, flip: placementSetting.value.flip, commitSource: (entry: SourceEntry) => c.controller.setDocExtra('sources', withSource(c.controller.document()!, entry)) });
      },
      upAxis: () => ref.current.upAxis(),
      placement: () => placementSetting.value,
      planeAt: (x, y) => {
        const vp = ref.current.viewport();
        const std = vp?.refPlaneAt(x, y);
        if (std) return { kind: 'std', id: std };
        const f = vp?.planeFeatureAt(x, y);
        return f ? { kind: 'feature', id: f } : null;
      },
      rayAt: (x, y) => ref.current.viewport()?.rayAt(x, y) ?? null,
      worldPerPixel: (p) => ref.current.viewport()?.worldPerPixel(p) ?? 0.1,
      holdView: (on) => ref.current.viewport()?.setHoldView(on),
      setFade: (on) => ref.current.viewport()?.setPreviewFade(on ? 0.55 : null),
    };
    placer.current = new Placer(deps, (s) => {
      placeStatus.value = s;
      const id = s.state === 'ready' && s.plane?.kind === 'std' ? s.plane.id : null;
      if (catalogPlane.value !== id) catalogPlane.value = id;
    });
  }
  const drag = useRef<{ item: CatalogItem; sx: number; sy: number; moved: boolean; pid: number; el: HTMLElement } | null>(null);

  const finish = async (item: CatalogItem, x: number, y: number, alt: boolean, keepArmed = false): Promise<void> => {
    const vp = ref.current.viewport();
    const p = placer.current!;
    const row = !vp || !vp.containsClient(x, y) ? planeRowAt(x, y, (fid) => ref.current.controller.document()?.features.some((f) => f.id === fid && f.type === 'plane') ?? false) : null;
    if (!row && (!vp || !vp.containsClient(x, y))) { await p.end(); return; }
    const id = row ? await p.dropOnPlane(item, row) : await p.drop(item, x, y, alt);
    if (id) {
      if (placer.current!.lastHelpers.length) ref.current.hide(placer.current!.lastHelpers);
      ref.current.placed();
      selectShapeFeature(id);
      ref.current.notify(t('catalog.placed', { name: shapeName(item) }), 'info');
      if (placer.current!.lastNotice) ref.current.notify(placer.current!.lastNotice, 'warn');
      if (!keepArmed) disarm();
    } else {
      const s = placer.current!.status;
      if (s.state === 'blocked' && s.reason !== 'fetchFailed') ref.current.notify(t('catalog.blocked.' + s.reason), 'warn');     // a failed fetch was reported with its reason already
    }
  };

  const disarm = (): void => {
    catalogActive.value = false; catalogPlane.value = null;
    armedItem.value = null;
    ghost.value = null;
    ref.current.viewport()?.setPlacementHook(null);
    void placer.current?.end();
  };
  const arm = (item: CatalogItem): void => {
    if (armedItem.value === item.id) { disarm(); return; }
    if (item.op === 'cut' && !ref.current.controller.hasSolid()) { ref.current.notify(t('catalog.blocked.needsBody'), 'warn'); return; }
    armedItem.value = item.id;
    catalogActive.value = true;
    ref.current.notify(t('catalog.armed', { name: itemLabel(item) }), 'info');
    ref.current.viewport()?.setPlacementHook({
      move: (x, y, m) => { ghost.value = { x, y, itemId: item.id }; placer.current!.hover(catalogItem(item.id) ?? item, x, y, m.alt); },
      tap: (x, y, m) => { void finish(catalogItem(item.id) ?? item, x, y, m.alt, false); },
      leave: () => { ghost.value = null; void placer.current!.end(); },
    });
  };

  // Esc cancels an armed shape or a drag in progress
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!drag.current && !armedItem.value) return;
      const k = e.key.toLowerCase();
      // library parts cannot be turned yet (only their placement-plane sketches would move; needs a kernel transform): R is left alone for them
      if ((k === 'f' || k === 'r') && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // R turns the shape 90 degrees about the plane normal, F flips it to the other side; the preview follows
        const s = placementSetting.value;
        placementSetting.value = k === 'r' ? { ...s, rot: ((s.rot + 1) % 4) as 0 | 1 | 2 | 3 } : { ...s, flip: !s.flip };
        placer.current?.rehover();
        e.preventDefault(); e.stopPropagation();
        return;
      }
      if (e.key !== 'Escape') return;
      if (drag.current) { catalogActive.value = false; catalogPlane.value = null; const dr = drag.current; drag.current = null; try { dr.el.releasePointerCapture(dr.pid); } catch { /* released already */ } ghost.value = null; void placer.current!.end(); e.stopPropagation(); return; }
      if (armedItem.value) { disarm(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  useEffect(() => () => { ref.current.viewport()?.setPlacementHook(null); ghost.value = null; armedItem.value = null; }, []);

  const onItemDown = (item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLElement>): void => {
    if (e.button !== 0) return;
    if (item.op === 'cut' && !ref.current.controller.hasSolid()) { ref.current.notify(t('catalog.blocked.needsBody'), 'warn'); return; }
    const el = e.currentTarget;
    parts.current.failed.clear();
    el.setPointerCapture(e.pointerId);
    drag.current = { item, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId, el };
    const move = (ev: PointerEvent) => {
      const dr = drag.current;
      if (!dr) return;
      if (!dr.moved && Math.hypot(ev.clientX - dr.sx, ev.clientY - dr.sy) < DRAG_PX) return;
      if (!dr.moved) { dr.moved = true; if (armedItem.value) disarm(); catalogActive.value = true; }
      ghost.value = { x: ev.clientX, y: ev.clientY, itemId: dr.item.id };
      const vp = ref.current.viewport();
      if (vp && vp.containsClient(ev.clientX, ev.clientY)) placer.current!.hover(dr.item, ev.clientX, ev.clientY, ev.altKey);
      else {
        void placer.current!.end();
        const row = planeRowAt(ev.clientX, ev.clientY, () => false);
        catalogPlane.value = row?.kind === 'std' ? row.id : null;     // over a plane row of the tree: that plane lights up
      }
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      const dr = drag.current;
      drag.current = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* released already */ }
      if (!dr) return;                       // cancelled with Esc
      ghost.value = null;
      catalogActive.value = false; catalogPlane.value = null;
      if (dr.moved) void finish(dr.item, ev.clientX, ev.clientY, ev.altKey);
      else arm(dr.item);                     // a click, not a drag: arm it for click-to-place
    };
    const cancel = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel); drag.current = null; ghost.value = null; catalogActive.value = false; catalogPlane.value = null; void placer.current!.end(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
  };
  /** Keyboard: Enter on a shape arms it. */
  const onItemKey = (item: CatalogItem): void => arm(item);
  return { onItemDown, onItemKey, disarm, arm: (id: string) => { const i = catalogItem(id); if (i) arm(i); } };
}
