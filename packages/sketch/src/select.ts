/**
 * Selecting and editing what is already in a sketch (the Select mode, no tool active).
 *   pickEntity     the line, circle or arc nearest the pointer, within a tolerance
 *   entityShape    its geometry as preview shapes (to highlight it)
 *   entityDims     the editable size of the picked entity: a line's length, a circle's or arc's radius
 *   setEntityDim   make that size a driving dimension (adds a `distance` / `radius` constraint, replacing an
 *                  existing one of the same kind on the same entity); the kernel then moves the sketch
 *   deleteEntity   remove the entity, the constraints that referred to it and any point nothing else uses
 */
import type { DraftEntity, SketchDraft } from './index';
import { addConstraintOf } from './tools/builders';
import { arcPolyline } from './tools/builders-arcs';
import { curveOf } from './tools/edit-draft';
import { lineLine, paramEnd, sample } from './tools/edit-geom';
import type { FieldSpec, Pt, PreviewShape } from './tools/types';
import { textDistance, textLoops, textOutlineOf } from './text';

const pointMap = (d: SketchDraft) => new Map(d.points.map((p) => [p.id, p]));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-18) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

const TAU = Math.PI * 2;
const ccwFrom = (a0: number, a: number) => ((a - a0) % TAU + TAU) % TAU;

export function pickEntity(draft: SketchDraft, at: Pt, tolerance: number): string | null {
  const pts = pointMap(draft);
  let best: { id: string; d: number } | null = null;
  const consider = (id: string, d: number) => { if (d <= tolerance && (!best || d < best.d)) best = { id, d }; };
  for (const e of draft.entities) {
    if (e.type === 'line') {
      const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
      if (a && b) consider(e.id, segDist(at, a, b));
    } else if (e.type === 'circle') {
      const c = pts.get(String(e.c));
      if (c) consider(e.id, Math.abs(dist(at, c) - Number(e.r)));
    } else if (e.type === 'arc') {
      const c = pts.get(String(e.c)), p1 = pts.get(String(e.p1)), p2 = pts.get(String(e.p2));
      if (!c || !p1 || !p2) continue;
      const r = dist(c, p1);
      const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
      const sweep = ccwFrom(a0, Math.atan2(p2.y - c.y, p2.x - c.x)) || TAU;
      const along = ccwFrom(a0, Math.atan2(at.y - c.y, at.x - c.x));
      if (along <= sweep) consider(e.id, Math.abs(dist(at, c) - r));
      else consider(e.id, Math.min(dist(at, p1), dist(at, p2)));
    } else if (e.type === 'text') {
      // the ink box of the lettering (its outline arrives from the kernel); a little worse than a line at the same spot, so a curve drawn over the text still wins
      const d = textDistance(draft, e, at);
      consider(e.id, d === 0 ? tolerance * 0.9 : d);
    }
  }
  return best ? (best as { id: string }).id : null;
}

export function entityShape(draft: SketchDraft, id: string): PreviewShape[] {
  const pts = pointMap(draft);
  const e = draft.entities.find((x) => x.id === id);
  if (!e) return [];
  if (e.type === 'line') {
    const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
    return a && b ? [{ kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } }] : [];
  }
  if (e.type === 'circle') {
    const c = pts.get(String(e.c));
    return c ? [{ kind: 'circle', c: { x: c.x, y: c.y }, r: Number(e.r) }] : [];
  }
  if (e.type === 'arc') {
    const c = pts.get(String(e.c)), p1 = pts.get(String(e.p1)), p2 = pts.get(String(e.p2));
    if (!c || !p1 || !p2) return [];
    const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
    const sweep = ccwFrom(a0, Math.atan2(p2.y - c.y, p2.x - c.x)) || TAU;
    return arcPolyline({ x: c.x, y: c.y }, dist(c, p1), a0, sweep);
  }
  if (e.type === 'text') {
    // the letters' outlines (a few hundred short lines at most); until they arrive, the anchor point only
    const shapes: PreviewShape[] = [];
    for (const loop of textLoops(textOutlineOf(draft, e))) for (let i = 0; i < loop.length; i++) { const a = loop[i], b = loop[(i + 1) % loop.length]; shapes.push({ kind: 'line', a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } }); }
    return shapes;
  }
  return [];
}

/** The size the user can edit for this entity, as an on-view field, or none for shapes without one. */
export function entityDims(draft: SketchDraft, id: string): FieldSpec[] {
  const pts = pointMap(draft);
  const e = draft.entities.find((x) => x.id === id);
  if (!e) return [];
  const has = (type: string) => draft.constraints.some((c) => c.type === type && c.refs?.length === (type === 'distance' ? 2 : 1) && sameRefs(c.refs, refsFor(e)));
  if (e.type === 'line') {
    const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
    return a && b ? [{ id: 'len', label: 'app.sketch.field.length', value: dist(a, b), locked: has('distance'), unit: 'length' }] : [];
  }
  if (e.type === 'circle') return [{ id: 'radius', label: 'app.sketch.field.radius', value: Number(e.r), locked: has('radius'), unit: 'length' }];
  if (e.type === 'arc') {
    const c = pts.get(String(e.c)), p1 = pts.get(String(e.p1));
    return c && p1 ? [{ id: 'radius', label: 'app.sketch.field.radius', value: dist(c, p1), locked: has('radius'), unit: 'length' }] : [];
  }
  return [];
}

function refsFor(e: DraftEntity): string[] {
  return e.type === 'line' ? [String(e.p1), String(e.p2)] : [e.id];
}
const sameRefs = (a: string[] | undefined, b: string[]) => !!a && a.length === b.length && a.every((r, i) => r === b[i]);

/** Make the entity's size a driving dimension with this value. Null when the entity has no editable size or the value is not usable. */
export function setEntityDim(draft: SketchDraft, id: string, field: 'len' | 'radius', value: number): SketchDraft | null {
  const e = draft.entities.find((x) => x.id === id);
  if (!e || !Number.isFinite(value) || value <= 0) return null;
  let type: 'distance' | 'radius';
  if (field === 'len' && e.type === 'line') type = 'distance';
  else if (field === 'radius' && (e.type === 'circle' || e.type === 'arc')) type = 'radius';
  else return null;
  const refs = refsFor(e);
  const kept: SketchDraft = { ...draft, constraints: draft.constraints.filter((c) => !(c.type === type && sameRefs(c.refs, refs))) };
  return addConstraintOf(kept, type, refs, value);
}

/** Remove an entity with the constraints that mention it, and any point no remaining entity or constraint uses. */
export function deleteEntity(draft: SketchDraft, id: string): SketchDraft {
  const entities = draft.entities.filter((e) => e.id !== id);
  const constraints = draft.constraints.filter((c) => !(c.refs ?? []).includes(id));
  const used = new Set<string>();
  for (const e of entities) for (const k of ['p1', 'p2', 'c', 'p']) if (typeof e[k] === 'string') used.add(e[k] as string);
  for (const e of entities) if (Array.isArray(e.pts)) for (const p of e.pts as string[]) used.add(p);
  for (const c of constraints) for (const r of c.refs ?? []) used.add(r);
  const points = draft.points.filter((p) => p.fixed || used.has(p.id));
  // reference dimensions that mention the entity (or a point that went with it) go too
  const live = new Set([...points.map((p) => p.id), ...entities.map((e) => e.id)]);
  const refs = Array.isArray(draft.extras?.refDims) ? (draft.extras!.refDims as Array<{ refs?: string[] }>) : null;
  const kept = refs?.filter((r) => (r.refs ?? []).every((x) => live.has(x)));
  const extras = kept && refs && kept.length !== refs.length ? { ...draft.extras, ...(kept.length ? { refDims: kept } : {}) } : draft.extras;
  if (kept && refs && kept.length !== refs.length && !kept.length && extras) delete (extras as Record<string, unknown>).refDims;
  return { ...draft, entities, constraints, points, ...(extras ? { extras } : {}) };
}

/** The origin point (fixed, at 0,0) that position dimensions are measured from, if the sketch has one. */
const originOf = (d: SketchDraft) => d.points.find((p) => p.fixed && p.x === 0 && p.y === 0);

/** A point's position as two editable fields, x and y, measured from the origin. */
export function pointDims(draft: SketchDraft, id: string): FieldSpec[] {
  const p = draft.points.find((q) => q.id === id);
  if (!p || p.fixed) return [];
  const o = originOf(draft);
  const driven = (type: string) => !!o && draft.constraints.some((c) => c.type === type && c.refs?.[0] === o.id && c.refs?.[1] === id);
  return [
    { id: 'x', label: 'app.sketch.field.x', value: p.x, locked: driven('hdist'), unit: 'length' },
    { id: 'y', label: 'app.sketch.field.y', value: p.y, locked: driven('vdist'), unit: 'length' },
  ];
}

/** Put a point at a typed x or y and, when the sketch has an origin, keep it there with an `hdist` or `vdist`
 *  dimension from the origin (those measure an absolute distance, so the point is moved first and the solver
 *  keeps it on that side). Null for an unknown, fixed or unusable point or value. */
export function setPointDim(draft: SketchDraft, id: string, axis: 'x' | 'y', value: number): SketchDraft | null {
  const p = draft.points.find((q) => q.id === id);
  if (!p || p.fixed || !Number.isFinite(value)) return null;
  const moved: SketchDraft = { ...draft, points: draft.points.map((q) => (q.id === id ? { ...q, [axis]: value } : q)) };
  const o = originOf(draft);
  if (!o) return moved;
  const type = axis === 'x' ? 'hdist' : 'vdist';
  const kept: SketchDraft = { ...moved, constraints: moved.constraints.filter((c) => !(c.type === type && c.refs?.[0] === o.id && c.refs?.[1] === id)) };
  return Math.abs(value) < 1e-9 ? kept : addConstraintOf(kept, type, [o.id, id], Math.abs(value));
}

// ---- box selection -------------------------------------------------------------------------------------------

export interface BoxRect { x0: number; y0: number; x1: number; y1: number }

/** The segments an entity is drawn as, for box tests (curves are sampled; splines and ellipses use their points). */
function entitySegments(draft: SketchDraft, e: DraftEntity): Array<[Pt, Pt]> {
  const g = curveOf(draft, e);
  if (g) return sample(g, 0, paramEnd(g), g.kind === 'line' ? 1 : 48).map((s) => [s.a, s.b] as [Pt, Pt]);
  const pts = pointMap(draft);
  const ids: string[] = [];
  for (const k of ['p1', 'p2', 'c', 'p']) if (typeof e[k] === 'string') ids.push(e[k] as string);
  if (Array.isArray(e.pts)) for (const p of e.pts) if (typeof p === 'string') ids.push(p);
  const poly = ids.flatMap((i) => { const p = pts.get(i); return p ? [{ x: p.x, y: p.y }] : []; });
  if (poly.length === 1) return [[poly[0], poly[0]]];
  return poly.slice(1).map((p, i) => [poly[i], p] as [Pt, Pt]);
}

const inside = (r: BoxRect, p: Pt) => p.x >= Math.min(r.x0, r.x1) && p.x <= Math.max(r.x0, r.x1) && p.y >= Math.min(r.y0, r.y1) && p.y <= Math.max(r.y0, r.y1);

/** Does the segment ab touch the rectangle (an end inside, or a crossing of one of its sides)? */
function segTouches(r: BoxRect, a: Pt, b: Pt): boolean {
  if (inside(r, a) || inside(r, b)) return true;
  const lo = { x: Math.min(r.x0, r.x1), y: Math.min(r.y0, r.y1) }, hi = { x: Math.max(r.x0, r.x1), y: Math.max(r.y0, r.y1) };
  const corners = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }];
  for (let i = 0; i < 4; i++) if (lineLine(a, b, corners[i], corners[(i + 1) % 4]).some((p) => onSeg(p, a, b) && onSeg(p, corners[i], corners[(i + 1) % 4]))) return true;
  return false;
}
const onSeg = (p: Pt, a: Pt, b: Pt) => {
  const t = Math.abs(b.x - a.x) > Math.abs(b.y - a.y) ? (p.x - a.x) / (b.x - a.x) : (p.y - a.y) / (b.y - a.y);
  return Number.isFinite(t) ? t >= -1e-9 && t <= 1 + 1e-9 : false;
};

/**
 * Entities selected by a rectangle. `window` (dragged left to right): only those entirely inside it. `crossing` (dragged
 * right to left): those inside it or touching it. Construction geometry is selectable like the rest.
 */
export function boxSelect(draft: SketchDraft, rect: BoxRect, mode: 'window' | 'crossing'): string[] {
  const out: string[] = [];
  for (const e of draft.entities) {
    const segs = entitySegments(draft, e);
    if (!segs.length) continue;
    const hit = mode === 'window'
      ? segs.every(([a, b]) => inside(rect, a) && inside(rect, b))
      : segs.some(([a, b]) => segTouches(rect, a, b));
    if (hit) out.push(e.id);
  }
  return out;
}

/** The points (not shapes) inside a rectangle, for selecting loose points. Fixed points are skipped. */
export function boxPoints(draft: SketchDraft, rect: BoxRect): string[] {
  return draft.points.filter((p) => !p.fixed && inside(rect, p)).map((p) => p.id);
}
