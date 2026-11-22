/** Pointer tolerances for the 3D view. Pure, so they can be tested without a canvas. */

/** How far (CSS px) the pointer may wander during a right click and still be a click that opens the menu, not a pan. A hand on a mouse or trackpad
 *  jitters a few pixels; a pen or finger more. */
export function rightClickSlop(pointerType: string | undefined): number { return pointerType === 'touch' || pointerType === 'pen' ? 12 : 8; }

/** Whether a right button that went down at `from` and came up at `to` was a click. */
export function isRightClick(from: { x: number; y: number }, to: { x: number; y: number }, slop: number): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) < slop;
}

/** The size on screen (CSS px) of a body of the given radius seen from `dist` with vertical field of view `fovDeg` in a view `heightPx` tall. */
export function bodyScreenPx(radius: number, dist: number, fovDeg: number, heightPx: number): number {
  const view = 2 * Math.max(dist, 1e-9) * Math.tan((fovDeg * Math.PI) / 360);
  return view > 0 ? ((2 * radius) / view) * heightPx : 0;
}

/** A pixel pick tolerance shrunk to the body's own size on screen: the usual `basePx` for a body that fills a good part of the view, but never more
 *  than a fraction of the body's on-screen extent, so a tiny part (an 8 mm knob) or a distant one is not picked as a corner or edge from anywhere
 *  on it. Never below `minPx`, so the body can still be hit. */
export function scaledPickTol(basePx: number, screenPx: number, minPx = 2): number {
  if (!(screenPx > 0)) return basePx;
  return Math.max(Math.min(basePx, screenPx * 0.04), Math.min(minPx, basePx));
}
