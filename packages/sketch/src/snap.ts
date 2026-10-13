/**
 * Snapping for the sketch tools: where the pointer lands when it is near something worth landing on.
 * Pure: the viewport passes the pointer in sketch-plane coordinates and a tolerance in plane units
 * (a few pixels, scaled by zoom). Priority: an existing point, then a line's midpoint, then alignment
 * with other points (the dotted guide). The result is the `SnapHit` the tools consume.
 */
import type { SketchDraft } from './index';
import type { Pt, SnapHit } from './tools/types';

export interface SnapOptions {
  /** Plane units within which a snap applies. */
  tolerance: number;
  /** Point ids to ignore, for example the point being dragged. */
  skip?: ReadonlySet<string>;
  midpoints?: boolean;
  align?: boolean;
  /** Grid spacing in plane units; the pointer lands on the nearest grid point when nothing else snaps. */
  grid?: number;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

export function snapAt(draft: SketchDraft, at: Pt, opts: SnapOptions): SnapHit | undefined {
  const tol = opts.tolerance;
  const pts = draft.points.filter((p) => !opts.skip?.has(p.id));

  let best: { id: string; d: number; p: Pt } | undefined;
  for (const p of pts) {
    const d = dist(p, at);
    if (d <= tol && (!best || d < best.d)) best = { id: p.id, d, p: { x: p.x, y: p.y } };
  }
  if (best) return { kind: 'point', at: best.p, pointId: best.id };

  if (opts.midpoints !== false) {
    const byId = new Map(draft.points.map((p) => [p.id, p]));
    let mid: { d: number; p: Pt; entityId: string } | undefined;
    for (const e of draft.entities) {
      if (e.type !== 'line') continue;
      const a = byId.get(String(e.p1));
      const b = byId.get(String(e.p2));
      if (!a || !b) continue;
      const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = dist(m, at);
      if (d <= tol && (!mid || d < mid.d)) mid = { d, p: m, entityId: e.id };
    }
    if (mid) return { kind: 'midpoint', at: mid.p, entityId: mid.entityId };
  }

  if (opts.align !== false) {
    let x: { id: string; x: number } | undefined;
    let y: { id: string; y: number } | undefined;
    for (const p of pts) {
      if (!x && Math.abs(p.x - at.x) <= tol) x = { id: p.id, x: p.x };
      if (!y && Math.abs(p.y - at.y) <= tol) y = { id: p.id, y: p.y };
    }
    if (x || y) return { kind: 'align', at: { x: x ? x.x : at.x, y: y ? y.y : at.y }, alignTo: { ...(x ? { x: x.id } : {}), ...(y ? { y: y.id } : {}) } };
  }

  if (opts.grid && opts.grid > 0) {
    const g = opts.grid;
    const gx = Math.round(at.x / g) * g;
    const gy = Math.round(at.y / g) * g;
    if (Math.abs(gx - at.x) <= tol && Math.abs(gy - at.y) <= tol) return { kind: 'grid', at: { x: gx, y: gy } };
  }
  return undefined;
}
