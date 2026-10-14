/**
 * Snapping for the sketch tools: where the pointer lands when it is near something worth landing on.
 * Pure: the viewport passes the pointer in sketch-plane coordinates and a tolerance in plane units
 * (a few pixels, scaled by zoom). The result is the `SnapHit` the tools consume.
 *
 * Priority (the first kind with a candidate inside the tolerance wins; within a kind the nearest):
 *   point (an end, a centre, the origin: `role` says which) > intersection of two curves > quadrant of a circle or arc
 *   > midpoint of a line > perpendicular foot / tangent point from the reference point `from` > on-curve (the nearest spot
 *   on a line, circle or arc) > alignment with other points (the dotted guide) > grid.
 * Every kind can be switched off with `kinds` (the snaps popover). `oncurve` also names the entity under the pointer in
 * `entityId`, which the edit and constraint tools use to pick a line, circle or arc by clicking it.
 */
import type { SketchDraft } from './index';
import { angleOf, dist, dot, intersect, len, onArc, pointAt, sub, wrap, type CurveG } from './tools/edit-geom';
import { curveOf } from './tools/edit-draft';
import type { Pt, SnapHit, SnapKind } from './tools/types';

/** The switchable snap kinds, in the order the popover lists them. */
export const SNAP_KINDS = ['endpoint', 'center', 'midpoint', 'quadrant', 'intersection', 'perpendicular', 'tangent', 'oncurve', 'align', 'grid'] as const;
export type SnapToggle = (typeof SNAP_KINDS)[number];
export type SnapToggles = Record<SnapToggle, boolean>;
export const ALL_SNAPS: SnapToggles = { endpoint: true, center: true, midpoint: true, quadrant: true, intersection: true, perpendicular: true, tangent: true, oncurve: true, align: true, grid: true };

export interface SnapOptions {
  /** Plane units within which a snap applies. */
  tolerance: number;
  /** Point ids to ignore, for example the point being dragged. */
  skip?: ReadonlySet<string>;
  midpoints?: boolean;
  align?: boolean;
  /** Grid spacing in plane units; the pointer lands on the nearest grid point when nothing else snaps. */
  grid?: number;
  /** Switch kinds off (all on when omitted). `midpoints: false` / `align: false` still work and win. */
  kinds?: Partial<SnapToggles>;
  /** The point the shape being drawn started from (the chain end): enables the perpendicular and tangent snaps. */
  from?: Pt;
}

type Cand = { d: number; at: Pt } & Partial<SnapHit>;
const best = (list: Cand[]): Cand | undefined => list.reduce<Cand | undefined>((b, c) => (!b || c.d < b.d ? c : b), undefined);

export function snapAt(draft: SketchDraft, at: Pt, opts: SnapOptions): SnapHit | undefined {
  const tol = opts.tolerance;
  const on = (k: SnapToggle) => opts.kinds?.[k] !== false;
  const pts = draft.points.filter((p) => !opts.skip?.has(p.id));
  const byId = new Map(draft.points.map((p) => [p.id, p]));

  // which points are centres, and which are ends
  const centres = new Set<string>();
  for (const e of draft.entities) if ((e.type === 'circle' || e.type === 'arc' || e.type === 'ellipse') && typeof e.c === 'string') centres.add(e.c);
  const used = new Set<string>();
  for (const e of draft.entities) for (const k of ['p1', 'p2', 'p']) if (typeof e[k] === 'string') used.add(e[k] as string);
  const roleOf = (id: string, fixed?: boolean): NonNullable<SnapHit['role']> => (fixed && byId.get(id)?.x === 0 && byId.get(id)?.y === 0 ? 'origin' : centres.has(id) && !used.has(id) ? 'center' : 'endpoint');

  const hit = (kind: SnapKind, c: Cand): SnapHit => {
    const { d: _d, at: a, ...rest } = c;
    return { kind, at: a, ...rest } as SnapHit;
  };

  // 1. existing points
  const pc: Cand[] = [];
  for (const p of pts) {
    const d = dist(p, at);
    if (d > tol) continue;
    const role = roleOf(p.id, p.fixed);
    if (role === 'center' ? !on('center') : !on('endpoint')) continue;
    pc.push({ d, at: { x: p.x, y: p.y }, pointId: p.id, role });
  }
  const bp = best(pc);
  if (bp) return hit('point', bp);

  const curves = draft.entities.flatMap((e) => { const g = curveOf(draft, e); return g ? [{ id: e.id, g, e }] : []; });

  // 2. intersections
  if (on('intersection')) {
    const ic: Cand[] = [];
    for (let i = 0; i < curves.length; i++) {
      for (let j = i + 1; j < curves.length; j++) {
        for (const p of intersect(curves[i].g, curves[j].g)) {
          const d = dist(p, at);
          if (d <= tol) ic.push({ d, at: p, entityId: curves[i].id, entityIds: [curves[i].id, curves[j].id] });
        }
      }
    }
    const bi = best(ic);
    if (bi) return hit('intersection', bi);
  }

  // 3. quadrants of circles and arcs
  if (on('quadrant')) {
    const qc: Cand[] = [];
    for (const { id, g } of curves) {
      if (g.kind === 'line') continue;
      for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2;
        if (g.kind === 'arc' && !onArc(g, t)) continue;
        const p = { x: g.c.x + g.r * Math.cos(t), y: g.c.y + g.r * Math.sin(t) };
        const d = dist(p, at);
        if (d <= tol) qc.push({ d, at: p, entityId: id });
      }
    }
    const bq = best(qc);
    if (bq) return hit('quadrant', bq);
  }

  // 4. midpoints of lines
  if (opts.midpoints !== false && on('midpoint')) {
    const mc: Cand[] = [];
    for (const { id, g } of curves) {
      if (g.kind !== 'line') continue;
      const m = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 };
      const d = dist(m, at);
      if (d <= tol) mc.push({ d, at: m, entityId: id });
    }
    const bm = best(mc);
    if (bm) return hit('midpoint', bm);
  }

  // 5. perpendicular foot and tangent point from the reference point
  if (opts.from) {
    const from = opts.from;
    if (on('perpendicular')) {
      const fc: Cand[] = [];
      for (const { id, g } of curves) {
        const foot = footFrom(g, from);
        if (foot && dist(foot, from) > 1e-9) { const d = dist(foot, at); if (d <= tol) fc.push({ d, at: foot, entityId: id }); }
      }
      const bf = best(fc);
      if (bf) return hit('perpendicular', bf);
    }
    if (on('tangent')) {
      const tc: Cand[] = [];
      for (const { id, g } of curves) {
        if (g.kind === 'line') continue;
        for (const p of tangentPoints(g, from)) { const d = dist(p, at); if (d <= tol) tc.push({ d, at: p, entityId: id }); }
      }
      const bt = best(tc);
      if (bt) return hit('tangent', bt);
    }
  }

  // 6. anywhere on a curve
  if (on('oncurve')) {
    const cc: Cand[] = [];
    for (const { id, g } of curves) {
      const p = nearestOn(g, at);
      if (!p) continue;
      const d = dist(p, at);
      if (d <= tol) cc.push({ d, at: p, entityId: id });
    }
    const bc = best(cc);
    if (bc) return hit('oncurve', bc);
  }

  // 7. alignment with other points
  if (opts.align !== false && on('align')) {
    let x: { id: string; x: number } | undefined;
    let y: { id: string; y: number } | undefined;
    for (const p of pts) {
      if (!x && Math.abs(p.x - at.x) <= tol) x = { id: p.id, x: p.x };
      if (!y && Math.abs(p.y - at.y) <= tol) y = { id: p.id, y: p.y };
    }
    if (x || y) return { kind: 'align', at: { x: x ? x.x : at.x, y: y ? y.y : at.y }, alignTo: { ...(x ? { x: x.id } : {}), ...(y ? { y: y.id } : {}) } };
  }

  // 8. grid
  if (opts.grid && opts.grid > 0 && on('grid')) {
    const g = opts.grid;
    const gx = Math.round(at.x / g) * g;
    const gy = Math.round(at.y / g) * g;
    if (Math.abs(gx - at.x) <= tol && Math.abs(gy - at.y) <= tol) return { kind: 'grid', at: { x: gx, y: gy } };
  }
  return undefined;
}

/** The nearest point of a line segment, or of a circle / arc (the arc's ends when the pointer is off its span). */
export function nearestOn(g: CurveG, p: Pt): Pt | null {
  if (g.kind === 'line') {
    const d = sub(g.b, g.a), l2 = dot(d, d);
    if (l2 < 1e-18) return null;
    const t = Math.max(0, Math.min(1, dot(sub(p, g.a), d) / l2));
    return { x: g.a.x + d.x * t, y: g.a.y + d.y * t };
  }
  const v = sub(p, g.c);
  const l = len(v);
  if (l < 1e-12) return null;
  const t = angleOf(v);
  if (g.kind === 'arc' && !onArc(g, t)) return dist(p, g.p1) <= dist(p, g.p2) ? { ...g.p1 } : { ...g.p2 };
  return { x: g.c.x + (v.x / l) * g.r, y: g.c.y + (v.y / l) * g.r };
}

/** The foot of the perpendicular from `from` onto the curve, when it lies on the curve (a line's span, an arc's sweep). */
function footFrom(g: CurveG, from: Pt): Pt | null {
  if (g.kind === 'line') {
    const d = sub(g.b, g.a), l2 = dot(d, d);
    if (l2 < 1e-18) return null;
    const t = dot(sub(from, g.a), d) / l2;
    return t < 0 || t > 1 ? null : { x: g.a.x + d.x * t, y: g.a.y + d.y * t };
  }
  const v = sub(from, g.c);
  if (len(v) < 1e-12) return null;
  const t = angleOf(v);
  if (g.kind === 'arc' && !onArc(g, t)) return null;
  return pointAt(g, g.kind === 'arc' ? wrap(t - angleOf(sub(g.p1, g.c))) : t);
}

/** The points of a circle or arc where the tangent passes through `from` (none when `from` is inside). */
function tangentPoints(g: Exclude<CurveG, { kind: 'line' }>, from: Pt): Pt[] {
  const v = sub(from, g.c);
  const l = len(v);
  if (l <= g.r + 1e-9) return [];
  const a = angleOf(v), da = Math.acos(g.r / l);
  const out: Pt[] = [];
  for (const t of [a + da, a - da]) {
    const tt = wrap(t);
    if (g.kind === 'arc' && !onArc(g, tt)) continue;
    out.push({ x: g.c.x + g.r * Math.cos(tt), y: g.c.y + g.r * Math.sin(tt) });
  }
  return out;
}

