// Where the floating panels leave the canvas free, so the view centre and the "Start here" card can sit in the middle of what is visible.
import { signal } from '@preact/signals-core';
import type { Layout } from './layoutMode';

export interface Insets { left: number; right: number; top: number; bottom: number }
export const ZERO_INSETS: Insets = { left: 0, right: 0, top: 0, bottom: 0 };
/** Below this much free width (px) the panels are ignored and the view is centred in the whole canvas. */
export const MIN_FREE_WIDTH = 300;

/** A panel over the canvas, in canvas coordinates (px from the canvas top-left). Null when it is not drawn. */
export interface PanelBox { left: number; right: number }

export interface InsetInput {
  layout: Layout;
  /** Canvas width, px. */
  width: number;
  /** The floating side panel (outliner/features); null when docked, hidden, or folded away with the chevron. */
  leftPanel: PanelBox | null;
  /** The floating feature-editor card. */
  editorCard: PanelBox | null;
  /** A floating right-hand panel (not the view cube or Display column, which do not count). */
  rightPanel: PanelBox | null;
}

/** The rule: the canvas minus whatever floats over its left and right sides.
 *  - phone: panels are sheets, no insets.
 *  - left inset = the furthest right edge of the floating left panel and the open editor card (a docked panel is not over the canvas, so it adds nothing: no double offset);
 *  - right inset = the canvas width minus the left edge of a floating right panel;
 *  - if the free width would be under MIN_FREE_WIDTH, everything is ignored (centre in the whole canvas).
 *  Vertical insets are always 0: the view stays vertically centred. */
export function computeSafeInsets(i: InsetInput): Insets {
  if (i.layout === 'phone' || !(i.width > 0)) return ZERO_INSETS;
  const w = i.width;
  const clip = (v: number) => Math.min(w, Math.max(0, v));
  let left = 0, right = 0;
  for (const b of [i.leftPanel, i.editorCard]) if (b && b.right > b.left) left = Math.max(left, clip(b.right));
  if (i.rightPanel && i.rightPanel.right > i.rightPanel.left) right = Math.max(0, w - clip(i.rightPanel.left));
  if (w - left - right < MIN_FREE_WIDTH) return ZERO_INSETS;
  return { left, right, top: 0, bottom: 0 };
}

/** The x (px from the canvas left) of the middle of the free area, or null where nothing should be aligned (a phone). */
export const safeCenterX = (ins: Insets, width: number, layout: Layout): number | null => (layout === 'phone' ? null : (ins.left + (width - ins.right)) / 2);

/** The latest result, for the "Start here" card. */
export const safeArea = signal<{ insets: Insets; width: number; centerX: number | null }>({ insets: ZERO_INSETS, width: 0, centerX: null });

const box = (el: HTMLElement | null): PanelBox | null => (el && el.offsetParent ? { left: el.offsetLeft, right: el.offsetLeft + el.offsetWidth } : null);

/** Watch the floating panels over the canvas `vp` and call `apply` with the insets whenever they change (size, open/close, window resize).
 *  offsetLeft/offsetWidth ignore the slide-away transform, so a folded panel is told apart by `folded()`. Returns `refresh` (run it after a render) and `stop`. */
export function watchSafeInsets(vp: HTMLElement, o: { layout: () => Layout; folded: () => boolean; apply: (i: Insets) => void }): { refresh: () => void; stop: () => void } {
  const ro = new ResizeObserver(() => refresh());
  const seen = new Set<Element>();
  function refresh(): void {
    const lp = vp.querySelector<HTMLElement>('.tree-wrap.floating'), ec = vp.querySelector<HTMLElement>('.editor-card'), rp = vp.querySelector<HTMLElement>('.insp-wrap.floating');
    for (const el of [lp, ec, rp]) if (el && !seen.has(el)) { seen.add(el); ro.observe(el); }
    for (const el of seen) if (!el.isConnected) { seen.delete(el); ro.unobserve(el); }
    const layout = o.layout(), width = vp.clientWidth;
    const insets = computeSafeInsets({ layout, width, leftPanel: o.folded() ? null : box(lp), editorCard: box(ec), rightPanel: box(rp) });
    const cur = safeArea.value, cx = safeCenterX(insets, width, layout);
    if (cur.width !== width || cur.centerX !== cx || cur.insets.left !== insets.left || cur.insets.right !== insets.right) safeArea.value = { insets, width, centerX: cx };
    o.apply(insets);
  }
  ro.observe(vp);
  refresh();
  return { refresh, stop: () => ro.disconnect() };
}
