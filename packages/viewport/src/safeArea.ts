// The "safe area": the part of the canvas that floating panels do not cover. The view centre (origin, orbit target) is drawn at the centre of it by shifting
// the camera's principal point (a projection offset), never by moving the orbit target, so orbit, pan and zoom behave exactly as before.

/** Pixels of the canvas covered on each side (panels floating over it). All zero is the plain, whole-canvas view. */
export interface SafeInsets { left: number; right: number; top: number; bottom: number }
export const NO_INSETS: SafeInsets = { left: 0, right: 0, top: 0, bottom: 0 };

const fin = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
export const sameInsets = (a: SafeInsets, b: SafeInsets): boolean => a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;

/** Insets made safe for a canvas of w x h: no negatives or NaN, and never covering the whole canvas (at least 1 px stays free on each axis). */
export function clampInsets(i: Partial<SafeInsets> | null | undefined, w: number, h: number): SafeInsets {
  let left = fin(i?.left ?? 0), right = fin(i?.right ?? 0), top = fin(i?.top ?? 0), bottom = fin(i?.bottom ?? 0);
  if (left + right > w - 1) { const k = Math.max(0, w - 1) / (left + right); left *= k; right *= k; }
  if (top + bottom > h - 1) { const k = Math.max(0, h - 1) / (top + bottom); top *= k; bottom *= k; }
  return { left, right, top, bottom };
}

/** How far (px) the picture is shifted right and down so that its centre lands at the centre of the free area. */
export const insetShift = (i: SafeInsets): { x: number; y: number } => ({ x: (i.left - i.right) / 2, y: (i.top - i.bottom) / 2 });

/** Where the view centre appears on screen (px from the canvas top-left) for a w x h canvas. */
export const safeCenter = (i: SafeInsets, w: number, h: number): { x: number; y: number } => ({ x: (i.left + (w - i.right)) / 2, y: (i.top + (h - i.bottom)) / 2 });

/** The factor on the field of view's sine that limits Fit: the narrower of the free height and the free width, as a fraction of the canvas height.
 *  With no insets this is min(1, aspect), what Fit always used. */
export const fitLimit = (i: SafeInsets, w: number, h: number): number => Math.max(1e-3, Math.min(h - i.top - i.bottom, w - i.left - i.right) / Math.max(1, h));
