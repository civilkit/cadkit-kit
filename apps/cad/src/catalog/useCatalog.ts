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
import { armedItem, ghost, placeStatus, selectShapeFeature } from './state';
import { t } from '../i18n';

export interface CatalogDeps {
  controller: Controller;
  viewport(): Viewport | null;
  notify(text: string, level?: 'error' | 'warn' | 'info'): void;
  /** After a shape was committed (the app redraws). */
  placed(): void;
  /** Hide helper sketches and planes in the view. */
  hide(ids: string[]): void;
}

const DRAG_PX = 4;

export function useCatalog(d: CatalogDeps) {
  const ref = useRef(d);
  ref.current = d;
  const placer = useRef<Placer | null>(null);
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
      rayAt: (x, y) => ref.current.viewport()?.rayAt(x, y) ?? null,
      worldPerPixel: (p) => ref.current.viewport()?.worldPerPixel(p) ?? 0.1,
      holdView: (on) => ref.current.viewport()?.setHoldView(on),
      setFade: (on) => ref.current.viewport()?.setPreviewFade(on ? 0.55 : null),
    };
    placer.current = new Placer(deps, (s) => { placeStatus.value = s; });
  }
  const drag = useRef<{ item: CatalogItem; sx: number; sy: number; moved: boolean; pid: number; el: HTMLElement } | null>(null);

  const finish = async (item: CatalogItem, x: number, y: number, alt: boolean, keepArmed = false): Promise<void> => {
    const vp = ref.current.viewport();
    const p = placer.current!;
    if (!vp || !vp.containsClient(x, y)) { await p.end(); return; }
    const id = await p.drop(item, x, y, alt);
    if (id) {
      if (placer.current!.lastHelpers.length) ref.current.hide(placer.current!.lastHelpers);
      ref.current.placed();
      selectShapeFeature(id);
      ref.current.notify(t('catalog.placed', { name: shapeName(item) }), 'info');
      if (!keepArmed) disarm();
    } else {
      const s = placer.current!.status;
      if (s.state === 'blocked') ref.current.notify(t('catalog.blocked.' + s.reason), 'warn');
    }
  };

  const disarm = (): void => {
    armedItem.value = null;
    ghost.value = null;
    ref.current.viewport()?.setPlacementHook(null);
    void placer.current?.end();
  };
  const arm = (item: CatalogItem): void => {
    if (armedItem.value === item.id) { disarm(); return; }
    if (item.op === 'cut' && !ref.current.controller.hasSolid()) { ref.current.notify(t('catalog.blocked.needsBody'), 'warn'); return; }
    armedItem.value = item.id;
    ref.current.notify(t('catalog.armed', { name: t('catalog.item.' + item.id) }), 'info');
    ref.current.viewport()?.setPlacementHook({
      move: (x, y, m) => { ghost.value = { x, y, itemId: item.id }; placer.current!.hover(catalogItem(item.id) ?? item, x, y, m.alt); },
      tap: (x, y, m) => { void finish(catalogItem(item.id) ?? item, x, y, m.alt, false); },
      leave: () => { ghost.value = null; void placer.current!.end(); },
    });
  };

  // Esc cancels an armed shape or a drag in progress
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drag.current) { const dr = drag.current; drag.current = null; try { dr.el.releasePointerCapture(dr.pid); } catch { /* released already */ } ghost.value = null; void placer.current!.end(); e.stopPropagation(); return; }
      if (armedItem.value) { disarm(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  useEffect(() => () => { ref.current.viewport()?.setPlacementHook(null); ghost.value = null; armedItem.value = null; }, []);

  const onItemDown = (item: CatalogItem, e: JSX.TargetedPointerEvent<HTMLButtonElement>): void => {
    if (e.button !== 0) return;
    if (item.op === 'cut' && !ref.current.controller.hasSolid()) { ref.current.notify(t('catalog.blocked.needsBody'), 'warn'); return; }
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    drag.current = { item, sx: e.clientX, sy: e.clientY, moved: false, pid: e.pointerId, el };
    const move = (ev: PointerEvent) => {
      const dr = drag.current;
      if (!dr) return;
      if (!dr.moved && Math.hypot(ev.clientX - dr.sx, ev.clientY - dr.sy) < DRAG_PX) return;
      if (!dr.moved) { dr.moved = true; if (armedItem.value) disarm(); }
      ghost.value = { x: ev.clientX, y: ev.clientY, itemId: dr.item.id };
      const vp = ref.current.viewport();
      if (vp && vp.containsClient(ev.clientX, ev.clientY)) placer.current!.hover(dr.item, ev.clientX, ev.clientY, ev.altKey);
      else void placer.current!.end();
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel);
      const dr = drag.current;
      drag.current = null;
      try { el.releasePointerCapture(e.pointerId); } catch { /* released already */ }
      if (!dr) return;                       // cancelled with Esc
      ghost.value = null;
      if (dr.moved) void finish(dr.item, ev.clientX, ev.clientY, ev.altKey);
      else arm(dr.item);                     // a click, not a drag: arm it for click-to-place
    };
    const cancel = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', cancel); drag.current = null; ghost.value = null; void placer.current!.end(); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', cancel);
  };
  /** Keyboard: Enter on a shape arms it. */
  const onItemKey = (item: CatalogItem): void => arm(item);
  return { onItemDown, onItemKey, disarm, arm: (id: string) => { const i = catalogItem(id); if (i) arm(i); } };
}
