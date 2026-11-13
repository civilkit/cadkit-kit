import { computed, signal } from '@preact/signals-core';
import type { Workspace } from '@kit/store';

/** Which arrangement the app takes: one codebase, three layouts. A phone keeps the canvas free and opens the tree, properties and diagnostics as
 *  bottom sheets; a tablet docks the tree and properties; a desktop is the layout the workspace settings describe. */
export type Layout = 'phone' | 'tablet' | 'desktop';
export type LayoutPref = 'auto' | Layout;
export const LAYOUT_PREFS: LayoutPref[] = ['auto', 'phone', 'tablet', 'desktop'];
export const LAYOUT_KEY = 'cad.layout';

/** Widths (px) where the layout changes: a phone is narrower than PHONE_MAX, a tablet narrower than TABLET_MAX or any coarse pointer. */
export const PHONE_MAX = 700, TABLET_MAX = 1100;
/** A touch device whose short side is under this is a phone even turned sideways. */
export const PHONE_SHORT_SIDE = 500;

/** A tablet this narrow (a portrait iPad is 820 wide) docks ONE panel, the tabbed left one (properties are its Editor tab), so the canvas keeps most of the width. */
export const NARROW_TABLET_MAX = 900;

export interface ViewportInfo { w: number; h: number; coarse: boolean }

export function computeLayout(v: ViewportInfo): Layout {
  if (v.w < PHONE_MAX || (v.coarse && Math.min(v.w, v.h) < PHONE_SHORT_SIDE)) return 'phone';
  if (v.w < TABLET_MAX || v.coarse) return 'tablet';
  return 'desktop';
}

export const asLayoutPref = (v: unknown): LayoutPref => (LAYOUT_PREFS as unknown[]).includes(v) ? (v as LayoutPref) : 'auto';

export const layoutPref = signal<LayoutPref>('auto');
export const viewportInfo = signal<ViewportInfo>({ w: 1440, h: 900, coarse: false });
/** The layout in force: the user's choice in Settings, else what the window and pointer say. */
export const layout = computed<Layout>(() => (layoutPref.value === 'auto' ? computeLayout(viewportInfo.value) : layoutPref.value));
/** A tablet narrower than NARROW_TABLET_MAX: one docked panel instead of two. */
export const narrowTablet = computed<boolean>(() => layout.value === 'tablet' && viewportInfo.value.w <= NARROW_TABLET_MAX);

/** The workspace the layout draws. The stored workspace is never changed by it (a phone must not rewrite the desktop's panels). */
export function effectiveWorkspace(ws: Workspace, l: Layout, narrow = false): Workspace {
  if (l === 'desktop') return ws;
  const ribbon = ws.ribbon === 'off' ? 'off' : 'compact';
  if (l === 'tablet' && narrow) return { ...ws, ribbon, leftPanel: ws.leftPanel === 'hidden' ? 'hidden' : 'docked', leftTabs: true, rightPanel: 'off' };
  if (l === 'tablet') return { ...ws, ribbon, leftPanel: ws.leftPanel === 'hidden' ? 'hidden' : 'docked', rightPanel: ws.rightPanel === 'off' ? 'off' : 'docked' };
  // phone: nothing floats or docks over the canvas; the tree, properties and diagnostics come as sheets from the bottom bar
  return { ...ws, ribbon, leftPanel: 'hidden', leftTabs: true, leftCollapsed: false, rightPanel: 'off', toolRail: false, sketchPalette: false, toolLabels: 'icons', drawerOpen: false };
}

/** The keyboard covers at least this much (px): the phone layout hands the room of its bars to the sheet and the canvas. */
export const KEYBOARD_MIN = 120;

const readViewport = (win: Window): ViewportInfo => ({ w: win.innerWidth, h: win.innerHeight, coarse: !!win.matchMedia?.('(pointer: coarse)').matches });

/** Keep `viewportInfo` current (size and pointer type) and publish the on-screen keyboard as CSS variables on the root:
 *  --kb-inset (px the keyboard covers at the bottom) --vvh and --vv-top (height and offset of what is left), and `data-kb` on the root while it is up, and scroll a focused field into view.
 *  Returns the function that stops it. */
export function watchViewport(win: Window = window): () => void {
  const doc = win.document, root = doc.documentElement;
  const update = () => {
    const next = readViewport(win), cur = viewportInfo.value;
    if (next.w !== cur.w || next.h !== cur.h || next.coarse !== cur.coarse) viewportInfo.value = next;
    const vv = win.visualViewport;
    const inset = vv ? Math.max(0, Math.round(win.innerHeight - vv.height - vv.offsetTop)) : 0;
    root.style.setProperty('--kb-inset', `${inset}px`);
    root.style.setProperty('--vvh', vv ? `${Math.round(vv.height)}px` : '100dvh');
    root.style.setProperty('--vv-top', vv ? `${Math.round(Math.max(0, vv.offsetTop))}px` : '0px');
    if (inset > KEYBOARD_MIN) root.setAttribute('data-kb', ''); else root.removeAttribute('data-kb');
  };
  const focus = (e: Event) => {
    const el = e.target as HTMLElement | null;
    if (!el || !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || (win.visualViewport?.height ?? win.innerHeight) >= win.innerHeight - 1) return;
    win.setTimeout(() => el.scrollIntoView?.({ block: 'center', inline: 'nearest' }), 250);   // after the keyboard has finished opening
  };
  const mq = win.matchMedia?.('(pointer: coarse)');
  update();
  win.addEventListener('resize', update);
  win.addEventListener('orientationchange', update);
  win.visualViewport?.addEventListener('resize', update);
  win.visualViewport?.addEventListener('scroll', update);
  mq?.addEventListener?.('change', update);
  doc.addEventListener('focusin', focus);
  return () => {
    win.removeEventListener('resize', update);
    win.removeEventListener('orientationchange', update);
    win.visualViewport?.removeEventListener('resize', update);
    win.visualViewport?.removeEventListener('scroll', update);
    mq?.removeEventListener?.('change', update);
    doc.removeEventListener('focusin', focus);
  };
}
