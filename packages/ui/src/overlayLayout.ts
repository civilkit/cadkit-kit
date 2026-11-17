// The overlay system's geometry, as pure functions (jsdom has no layout, so the rules are testable here and the real browser check is tools/ux/mobile.mjs).
// One layer over the canvas with named regions. Everything an overlay needs to avoid is a RESERVED rect (the tool column, the undo card, the view controls,
// a floating panel) measured from the layout, never a fixed number; items in a region STACK, they never share a spot.
//
//   +--------------------------------------------------------------+
//   | canvas-left  |        top-center  (notices, busy)            | canvas-right |
//   |  (undo card, |                                               |  (view cube, |
//   |  tool column)|                                               |   Display)   |
//   |              |        bottom-center (hints)                 |              |
//   |              |        bottom-left   (status pills, readouts) |              |
//   +--------------------------------------------------------------+

export interface Rect { x: number; y: number; w: number; h: number }
export interface Insets { top: number; right: number; bottom: number; left: number }
export type RegionId = 'top-center' | 'bottom-center' | 'bottom-left' | 'canvas-right' | 'canvas-left';
export const REGION_IDS: RegionId[] = ['top-center', 'bottom-center', 'bottom-left', 'canvas-right', 'canvas-left'];

export const right = (r: Rect) => r.x + r.w;
export const bottom = (r: Rect) => r.y + r.h;
/** Do two rects share more than `tol` px in both directions (touching edges and hairlines are not an overlap)? */
export function rectsIntersect(a: Rect, b: Rect, tol = 1): boolean {
  return Math.min(right(a), right(b)) - Math.max(a.x, b.x) > tol && Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y) > tol;
}
/** Every pair of rects that overlap (indices), for tests and the browser audit. */
export function overlappingPairs(rects: Rect[], tol = 1): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rectsIntersect(rects[i], rects[j], tol)) out.push([i, j]);
  return out;
}

/** What the layout reserves, measured relative to the canvas: how far from each edge the left and right controls reach (tool column, undo card, view cube ...).
 *  `rightBottom` is the same for the lower part of the right edge (a selection list or the sketch palette), which the top regions need not avoid. */
export interface Reserved { left: number; right: number; rightBottom: number; /** How far a strip across the bottom (a phone's sketch tool strip) reaches up from the canvas bottom. */ bottom: number }

/** Reserved extents from measured rects: `rects` are the visible elements marked as reserving the left or right edge, in the same coordinate space as `canvas`. */
export function reservedFrom(canvas: Rect, items: Array<{ side: 'left' | 'right' | 'right-bottom' | 'bottom'; rect: Rect }>, gap = 8): Reserved {
  const r: Reserved = { left: 0, right: 0, rightBottom: 0, bottom: 0 };
  for (const { side: s0, rect } of items) {
    if (rect.w < 1 || rect.h < 1) continue;
    // a "right-bottom" control that spans most of the width is a strip along the bottom, not a column at the right edge
    const side = s0 === 'right-bottom' && rect.w > canvas.w * 0.6 ? 'bottom' : s0;
    if (side === 'bottom') r.bottom = Math.max(r.bottom, Math.min(canvas.h, bottom(canvas) - rect.y) + gap);
    else if (side === 'left') r.left = Math.max(r.left, Math.min(canvas.w, right(rect) - canvas.x) + gap);
    else { const reach = Math.min(canvas.w, right(canvas) - rect.x) + gap; if (side === 'right') r.right = Math.max(r.right, reach); else r.rightBottom = Math.max(r.rightBottom, reach); }
  }
  return r;
}

/** Right-edge controls that reach down into the bottom stack (a short canvas, such as a phone with a sheet open) must be avoided by it too: they count as "right-bottom". */
export function lowerRight(items: Array<{ side: 'left' | 'right' | 'right-bottom' | 'bottom'; rect: Rect }>, bottomTop: number): Array<{ side: 'right-bottom'; rect: Rect }> {
  return items.filter((i) => i.side === 'right' && bottom(i.rect) > bottomTop + 2).map((i) => ({ side: 'right-bottom' as const, rect: i.rect }));
}

/** How far the on-screen keyboard covers the bottom of the canvas (px): the part of the canvas below the visual viewport. */
export function keyboardOverlap(canvas: Rect, vv: { height: number; offsetTop: number } | null | undefined): number {
  if (!vv) return 0;
  return Math.max(0, Math.min(canvas.h, bottom(canvas) - (vv.offsetTop + vv.height)));
}

export interface RegionOptions { safe?: Partial<Insets>; keyboard?: number; reserved?: Partial<Reserved>; margin?: number; gap?: number; topMaxShare?: number }
/** The rect of each named region inside `canvas` (canvas-local coordinates, origin at the canvas corner):
 *  the safe-area insets and the margin come off every edge, the keyboard off the bottom, the reserved left and right controls off the middle regions. */
export function regionRects(canvas: Rect, o: RegionOptions = {}): Record<RegionId, Rect> {
  const m = o.margin ?? 8, gap = o.gap ?? 0;
  const s = { top: 0, right: 0, bottom: 0, left: 0, ...o.safe };
  const rs = { left: 0, right: 0, rightBottom: 0, bottom: 0, ...o.reserved };
  const inner: Rect = { x: Math.max(m, s.left), y: Math.max(m, s.top), w: 0, h: 0 };
  const innerRight = canvas.w - Math.max(m, s.right);
  const innerBottom = canvas.h - Math.max(m, s.bottom) - Math.max(0, o.keyboard ?? 0, rs.bottom ? rs.bottom - m : 0);
  inner.w = Math.max(0, innerRight - inner.x); inner.h = Math.max(0, innerBottom - inner.y);
  const leftW = Math.max(0, rs.left - inner.x), rightW = Math.max(0, rs.right - (canvas.w - innerRight));
  const midX = inner.x + leftW + (leftW ? gap : 0);
  const midR = innerRight - rightW - (rightW ? gap : 0);
  const mid = { x: midX, w: Math.max(0, midR - midX) };
  const topH = inner.h * (o.topMaxShare ?? 0.4);
  const bottomR = innerRight - Math.max(0, rs.rightBottom - (canvas.w - innerRight)) - (rs.rightBottom ? gap : 0);
  const bmid = { x: midX, w: Math.max(0, bottomR - midX) };
  return {
    'canvas-left': { x: inner.x, y: inner.y, w: leftW, h: inner.h },
    'canvas-right': { x: innerRight - rightW, y: inner.y, w: rightW, h: inner.h },
    'top-center': { x: mid.x, y: inner.y, w: mid.w, h: topH },
    'bottom-center': { x: bmid.x, y: inner.y + inner.h - inner.h * 0.5, w: bmid.w, h: inner.h * 0.5 },
    'bottom-left': { x: bmid.x, y: inner.y + inner.h - inner.h * 0.5, w: bmid.w, h: inner.h * 0.5 },
  };
}

export interface OverlayItem { id: string; region: RegionId; w: number; h: number; /** Lower first (nearest the region's anchor edge). */ order?: number }
export interface Placed { id: string; region: RegionId; rect: Rect; /** The item did not fit in its region and is not drawn (it waits in the queue). */ hidden: boolean }

/** Place every item: items in a region stack from its anchor edge (top regions downward, bottom ones upward, the right and left columns downward) with `gap` between.
 *  The bottom-left row sits at the very bottom, the bottom-center stack above it. An item that does not fit in what is left of its region is `hidden` (queued), never drawn over another. */
export function layoutOverlays(canvas: Rect, items: OverlayItem[], o: RegionOptions = {}): Placed[] {
  const regs = regionRects(canvas, o);
  const gap = o.gap ?? 6;
  const out: Placed[] = [];
  const drawn: Rect[] = [];
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const take = (it: OverlayItem, rect: Rect, fits: boolean): boolean => {
    // a last guard: whatever the region arithmetic said, an item that would touch one already drawn waits in the queue
    const ok = fits && !drawn.some((d) => rectsIntersect(d, rect, 0.5));
    out.push({ id: it.id, region: it.region, hidden: !ok, rect });
    if (ok) drawn.push(rect);
    return ok;
  };
  // the columns at the edges first (they are the fixed controls), then the top stack, the bottom-left row, and the bottom-centre stack above it
  const down = (region: RegionId) => {
    const r = regs[region]; let y = r.y;
    for (const it of sorted.filter((x) => x.region === region)) {
      const w = Math.min(it.w, r.w), x = region === 'canvas-right' ? r.x + r.w - w : region === 'canvas-left' ? r.x : r.x + (r.w - w) / 2;
      if (take(it, { x, y, w, h: it.h }, it.w <= r.w + 0.5 && y + it.h <= r.y + r.h + 0.5)) y += it.h + gap;
    }
  };
  down('canvas-left'); down('canvas-right'); down('top-center');
  const base = regs['bottom-left'].y + regs['bottom-left'].h;
  let leftTop = base;
  { const r = regs['bottom-left'];
    for (const it of sorted.filter((x) => x.region === 'bottom-left')) {
      const y = leftTop - it.h;
      if (take(it, { x: r.x, y, w: Math.min(it.w, r.w), h: it.h }, it.w <= r.w + 0.5 && y >= r.y)) leftTop = y - gap;
    } }
  { const r = regs['bottom-center']; let y = leftTop;
    for (const it of sorted.filter((x) => x.region === 'bottom-center')) {
      const w = Math.min(it.w, r.w), top = y - it.h;
      if (take(it, { x: r.x + (r.w - w) / 2, y: top, w, h: it.h }, it.w <= r.w + 0.5 && top >= r.y)) y = top - gap;
    } }
  return out;
}
