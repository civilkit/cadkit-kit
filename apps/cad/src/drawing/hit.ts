// Hit testing on the primitive list: which annotation (or the title block) is under a point of the sheet.
import type { Prim, Tag } from './render';
import type { V2 } from './model';
import { distToSeg } from './geom';

const textBox = (p: Extract<Prim, { t: 'text' }>): { x0: number; y0: number; x1: number; y1: number } => {
  const w = p.s.length * p.size * 0.55;
  const x0 = p.anchor === 'start' ? p.x : p.anchor === 'middle' ? p.x - w / 2 : p.x - w;
  return { x0, y0: p.y - p.size, x1: x0 + w, y1: p.y + p.size * 0.3 };
};

/** Distance from a point to a primitive (0 inside a text box). Rotated text is boxed unrotated, close enough for picking short labels. */
export function distToPrim(p: V2, pr: Prim): number {
  if (pr.t === 'poly') {
    let best = Infinity;
    for (let i = 2; i < pr.pts.length; i += 2) best = Math.min(best, distToSeg(p, [pr.pts[i - 2], pr.pts[i - 1]], [pr.pts[i], pr.pts[i + 1]]));
    return best;
  }
  if (pr.t === 'circle' || pr.t === 'arc') return Math.abs(Math.hypot(p[0] - pr.c[0], p[1] - pr.c[1]) - pr.r);
  const b = pr.rot ? { x0: pr.x - pr.size * 2, x1: pr.x + pr.size * 2, y0: pr.y - pr.size * 2, y1: pr.y + pr.size * 2 } : textBox(pr);
  const dx = Math.max(b.x0 - p[0], 0, p[0] - b.x1), dy = Math.max(b.y0 - p[1], 0, p[1] - b.y1);
  return Math.hypot(dx, dy);
}

/** The annotation nearest to a point within `tol` mm (dimensions, notes, balloons, view labels), or null. The title block and BOM count when the point is inside. */
export function hitAnnotation(prims: Prim[], p: V2, tol: number): Tag | null {
  let best: { tag: Tag; d: number } | null = null;
  for (const pr of prims) {
    const tag = pr.tag;
    if (!tag || tag.kind === 'view') continue;
    if (tag.kind === 'title' || tag.kind === 'bom' || tag.kind === 'table') continue;
    const d = distToPrim(p, pr);
    if (d <= tol && (!best || d < best.d)) best = { tag, d };
  }
  if (best) return best.tag;
  for (const kind of ['title', 'bom'] as const) {
    const poly = prims.find((pr) => pr.tag?.kind === kind && pr.t === 'poly' && pr.closed);
    if (poly && poly.t === 'poly') {
      const xs = poly.pts.filter((_, i) => i % 2 === 0), ys = poly.pts.filter((_, i) => i % 2 === 1);
      if (p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys)) return poly.tag!;
    }
  }
  for (const poly of prims) {   // table blocks: inside the outline
    if (poly.t !== 'poly' || poly.tag?.kind !== 'table' || !poly.closed) continue;
    const xs = poly.pts.filter((_, i) => i % 2 === 0), ys = poly.pts.filter((_, i) => i % 2 === 1);
    if (p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys)) return poly.tag;
  }
  return null;
}
