/** Page zoom on iOS. WebKit zooms the whole page when a form field under 16 px is focused or when the page is pinched or double-tapped, ignores `user-scalable=no`,
 *  and has no API to set the scale back. The one documented way out is to pin the meta viewport to scale 1 for a moment and then restore it. */

/** The scale above which the page counts as zoomed (the visual viewport reports 1 exactly when it is not). */
export const ZOOM_EPSILON = 1.01;
/** How long the meta viewport stays pinned before it is restored (the browser needs a frame or two to apply it). */
export const RESET_HOLD_MS = 120;

const PIN = 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1';

/** The page's current scale (1 when the browser has no visual viewport). */
export const pageScale = (win: Window = window): number => win.visualViewport?.scale ?? 1;

/** Put the page back to scale 1: pin the meta viewport to `minimum-scale=1, maximum-scale=1` and restore its original content after {@link RESET_HOLD_MS}.
 *  A second call while one is pending does nothing. Returns false when there is no meta viewport to pin. */
export function resetPageZoom(doc: Document = document, win: Window = window): boolean {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return false;
  if (meta.dataset.zoomPinned !== undefined) return true;
  const original = meta.getAttribute('content') ?? '';
  meta.dataset.zoomPinned = '1';
  meta.setAttribute('content', PIN);
  win.setTimeout(() => {
    meta.setAttribute('content', original);
    delete meta.dataset.zoomPinned;
  }, RESET_HOLD_MS);
  return true;
}

const isField = (el: Element | null | undefined): boolean => !!el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

/** Keep the page at scale 1.
 *  - `gesturestart` / `gesturechange` (WebKit's pinch events) are cancelled, except over a field, so the page cannot be pinched; the 3D view's pinch runs on pointer events and is not affected.
 *  - When a field loses the focus while the page is zoomed (the zoom a focus caused), it is reset at once.
 *  - When the page is zoomed by any other means, `onStuck` is called once (the app shows a "Reset zoom" note); `onClear` when it is back to 1.
 *  Returns the function that stops it. */
export function watchPageZoom(opts: { onStuck?: () => void; onClear?: () => void } = {}, win: Window = window): () => void {
  const doc = win.document, vv = win.visualViewport;
  let stuck = false;
  const check = () => {
    const zoomed = pageScale(win) > ZOOM_EPSILON;
    if (zoomed && !stuck) { stuck = true; opts.onStuck?.(); }
    else if (!zoomed && stuck) { stuck = false; opts.onClear?.(); }
  };
  const gesture = (e: Event) => { if (!isField(e.target as Element | null)) e.preventDefault(); };
  const blur = () => { if (pageScale(win) > ZOOM_EPSILON) resetPageZoom(doc, win); };
  doc.addEventListener('gesturestart', gesture, { passive: false });
  doc.addEventListener('gesturechange', gesture, { passive: false });
  doc.addEventListener('focusout', blur);
  vv?.addEventListener('resize', check);
  return () => {
    doc.removeEventListener('gesturestart', gesture);
    doc.removeEventListener('gesturechange', gesture);
    doc.removeEventListener('focusout', blur);
    vv?.removeEventListener('resize', check);
  };
}
