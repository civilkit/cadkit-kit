// The click that closes a menu or popover belongs to the menu: it must not also reach the viewport, where it would
// start a line point, pick a face or clear the selection. The guard runs in the capture phase on the document and
// swallows a pointer-down on the viewport while any popover button is open (it still closes on its own handler).
const OPEN_POPUP = 'button[aria-haspopup][aria-expanded="true"], .ctx-menu, .slot-flyout, .aux-menu';

export function popupOpen(doc: Document): boolean {
  return doc.querySelector(OPEN_POPUP) !== null;
}

/** Install the guard; returns the function that removes it. */
export function installDismissGuard(doc: Document = document, viewportSelector = '#vp'): () => void {
  const onDown = (e: Event) => {
    const el = e.target as Element | null;
    if (!el?.closest?.(viewportSelector)) return;
    // the view navigation ring is part of the viewport but not a place a click can land by mistake: its arrows keep working while its own menu is open
    if (popupOpen(doc) && !el.closest('.viewnav')) e.stopPropagation();
  };
  doc.addEventListener('pointerdown', onDown, true);
  return () => doc.removeEventListener('pointerdown', onDown, true);
}
