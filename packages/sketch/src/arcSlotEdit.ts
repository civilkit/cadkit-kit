/**
 * Editing an arc slot after it is drawn. The Arc slot tool leaves seven points and four arcs (two concentric arcs joined by two
 * half-round caps, tangent at the joins, see tools/arcSlot.ts); nothing marks them as a slot, so this module finds one from its
 * geometry, reads its four parameters and rewrites its points from changed ones:
 *
 *   findArcSlot        the slot an arc belongs to (the arcs and points of it), or undefined
 *   arcSlotParams      centre radius R, start angle a0 (radians, of the counter-clockwise first end), sweep (radians, > 0), width w
 *   withArcSlotParams  the draft with the slot moved to new parameters, or null when they do not make a slot
 *
 * The solver then settles the rest of the sketch. A typed radius or width dimension of the slot keeps its constraint and takes the
 * new value; a horizontal or vertical constraint of the start inference is dropped when the angles change, because it would
 * hold the old direction.
 */
import type { DraftConstraint, DraftEntity, SketchDraft } from './index';
import { geometry, MAX_SWEEP, problem } from './tools/arcSlot';
import { angleOf, dist } from './tools/builders-arcs';
import type { Pt } from './tools/types';

const TAU = Math.PI * 2;

export interface ArcSlot { c: string; m0: string; m1: string; pi0: string; po0: string; pi1: string; po1: string; outer: string; inner: string; cap0: string; cap1: string }
export interface ArcSlotParams { R: number; a0: number; sweep: number; w: number }

type Arc = DraftEntity & { c: string; p1: string; p2: string };
const isArc = (e: DraftEntity): e is Arc => e.type === 'arc' && typeof e.c === 'string' && typeof e.p1 === 'string' && typeof e.p2 === 'string';

/** The arc slot that arc `entityId` is one of (its outer or inner arc, or one of its caps). */
export function findArcSlot(d: SketchDraft, entityId: string): ArcSlot | undefined {
  const pt = (id: string): Pt | undefined => d.points.find((p) => p.id === id);
  const arcs = d.entities.filter(isArc);
  if (!arcs.some((a) => a.id === entityId)) return undefined;
  for (const o of arcs) {
    for (const i of arcs) {
      if (o === i || o.c !== i.c) continue;
      const c = pt(o.c), po0 = pt(o.p1), po1 = pt(o.p2), pi0 = pt(i.p1), pi1 = pt(i.p2);
      if (!c || !po0 || !po1 || !pi0 || !pi1) continue;
      const ro = dist(c, po0), ri = dist(c, pi0);
      if (ri >= ro - 1e-9 || Math.abs(dist(c, po1) - ro) > 1e-6 || Math.abs(dist(c, pi1) - ri) > 1e-6) continue;
      const cap1 = arcs.find((a) => a.p1 === o.p2 && a.p2 === i.p2);
      const cap0 = arcs.find((a) => a.p1 === i.p1 && a.p2 === o.p1);
      if (!cap0 || !cap1 || ![o, i, cap0, cap1].some((a) => a.id === entityId)) continue;
      return { c: o.c, m0: cap0.c, m1: cap1.c, pi0: i.p1, po0: o.p1, pi1: i.p2, po1: o.p2, outer: o.id, inner: i.id, cap0: cap0.id, cap1: cap1.id };
    }
  }
  return undefined;
}

export function arcSlotParams(d: SketchDraft, s: ArcSlot): ArcSlotParams | undefined {
  const pt = (id: string): Pt | undefined => d.points.find((p) => p.id === id);
  const c = pt(s.c), m0 = pt(s.m0), m1 = pt(s.m1), pi0 = pt(s.pi0), po0 = pt(s.po0);
  if (!c || !m0 || !m1 || !pi0 || !po0) return undefined;
  const a0 = angleOf(c, m0);
  const sweep = (((angleOf(c, m1) - a0) % TAU) + TAU) % TAU;
  return { R: dist(c, m0), a0, sweep: sweep < 1e-9 ? TAU - 1e-6 : sweep, w: dist(pi0, po0) };
}

/** The slot of `s` moved to the parameters (those not given keep their value); null when they do not make a slot (too wide, no sweep). */
export function withArcSlotParams(d: SketchDraft, s: ArcSlot, change: Partial<ArcSlotParams>): SketchDraft | null {
  const cur = arcSlotParams(d, s);
  const c = d.points.find((p) => p.id === s.c);
  if (!cur || !c) return null;
  const n: ArcSlotParams = { ...cur, ...change };
  if (![n.R, n.a0, n.sweep, n.w].every(Number.isFinite) || n.R <= 0 || n.w <= 0 || n.sweep <= 0 || n.sweep > MAX_SWEEP) return null;
  const g = geometry({ x: c.x, y: c.y }, { x: c.x + n.R * Math.cos(n.a0), y: c.y + n.R * Math.sin(n.a0) }, n.sweep, n.w);
  if (problem(g)) return null;
  // the new positions go straight into the points (no drag fix): the solver starts from a shape that already is a tangent slot
  const to = new Map<string, Pt>([[s.m0, g.m0], [s.m1, g.m1], [s.pi0, g.pi0], [s.po0, g.po0], [s.pi1, g.pi1], [s.po1, g.po1]]);
  const out: SketchDraft = { ...d, points: d.points.map((p) => { const q = to.get(p.id); return q ? { ...p, x: q.x, y: q.y } : p; }) };
  const angular = change.a0 !== undefined || change.sweep !== undefined;
  const pair = (r: string[] | undefined, a: string, b: string) => !!r && r.length === 2 && ((r[0] === a && r[1] === b) || (r[0] === b && r[1] === a));
  const constraints: DraftConstraint[] = [];
  for (const k of out.constraints) {
    const r = k.refs;
    const centreToCap = pair(r, s.c, s.m0) || pair(r, s.c, s.m1);
    if (k.type === 'distance' && centreToCap) { constraints.push({ ...k, value: n.R }); continue; }
    if (k.type === 'distance' && (pair(r, s.pi0, s.po0) || pair(r, s.pi1, s.po1))) { constraints.push({ ...k, value: n.w }); continue; }
    if (angular && (k.type === 'horizontal' || k.type === 'vertical') && centreToCap) continue;   // the inferred start direction would hold the old angle
    constraints.push(k);
  }
  return { ...out, constraints };
}
