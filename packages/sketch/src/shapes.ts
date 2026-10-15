// The closed shapes of a sketch, for choosing which ones an extrude or revolve uses (the kernel's `regions` field).
// A shape is one circle or ellipse, or a connected chain of lines/arcs/splines that closes on itself. Construction geometry
// and open chains are not shapes (the kernel ignores them too).

export interface SketchShape {
  /** One entity id of the shape's outline: what `regions` takes. */
  id: string;
  kind: 'circle' | 'ellipse' | 'loop';
  /** Every entity that makes up the outline. */
  entityIds: string[];
  /** Circle radius, else 0. */
  radius: number;
  /** Every entity is projected reference geometry (a body edge or face outline), not drawn in this sketch. */
  reference?: boolean;
  /** The shape that directly encloses this one (this shape is then a hole of it, or its filled disc when picked alone), if any. */
  inside?: string;
}

interface FeatureLike { entities?: Array<{ id: string; type?: string; construction?: boolean; [k: string]: unknown }>; points?: Array<{ id: string; x: number; y: number }> }

const endpoints = (e: { type?: string; [k: string]: unknown }): string[] => {
  if (e.type === 'line' || e.type === 'arc') return [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
  if ((e.type === 'spline' || e.type === 'cvspline') && Array.isArray(e.pts)) {
    // a closed spline is its own loop (both ends are one point); an open one runs first to last
    const p = e.pts as unknown[];
    return p.length ? [String(p[0]), e.closed === true ? String(p[0]) : String(p[p.length - 1])] : [];
  }
  if (Array.isArray(e.points)) { const p = e.points as unknown[]; return p.length ? [String(p[0]), String(p[p.length - 1])] : []; }
  return [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
};

export function sketchShapes(feature: FeatureLike | null | undefined): SketchShape[] {
  const out: SketchShape[] = [];
  const chain = (feature?.entities ?? []).filter((e) => !e.construction);
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const segs: Array<{ id: string; ends: string[] }> = [];
  for (const e of chain) {
    if (e.type === 'circle') { out.push({ id: e.id, kind: 'circle', entityIds: [e.id], radius: typeof e.r === 'number' ? e.r : 0 }); continue; }
    if (e.type === 'ellipse') { out.push({ id: e.id, kind: 'ellipse', entityIds: [e.id], radius: 0 }); continue; }
    const ends = endpoints(e);
    if (ends.length === 2) { union(ends[0], ends[1]); segs.push({ id: e.id, ends }); }
  }
  const groups = new Map<string, Array<{ id: string; ends: string[] }>>();
  for (const s of segs) { const r = find(s.ends[0]); groups.set(r, [...(groups.get(r) ?? []), s]); }
  for (const g of groups.values()) {
    const degree = new Map<string, number>();
    for (const s of g) for (const p of s.ends) degree.set(p, (degree.get(p) ?? 0) + 1);
    // closed when every point joins exactly two segments (a single arc that closes on itself counts: both ends are one point)
    if ([...degree.values()].every((d) => d === 2)) out.push({ id: g[0].id, kind: 'loop', entityIds: g.map((s) => s.id), radius: 0 });
  }
  const order = new Map((feature?.entities ?? []).map((e, i) => [e.id, i]));
  markNesting(feature, out);
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** An open chain of a sketch: lines, arcs and splines joined end to end that do not close (a thin wall can be made of it). */
export interface SketchChain {
  /** One entity id of the chain: what `regions` takes. */
  id: string;
  entityIds: string[];
  /** The two loose end points (point ids) when the chain is a simple path, else null. */
  ends: [string, string] | null;
}

/** The open chains of a sketch (construction geometry is left out; circles and closed loops are shapes, not chains). */
export function sketchOpenChains(feature: FeatureLike | null | undefined): SketchChain[] {
  const out: SketchChain[] = [];
  const chain = (feature?.entities ?? []).filter((e) => !e.construction && e.type !== 'circle' && e.type !== 'ellipse');
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const segs: Array<{ id: string; ends: string[] }> = [];
  for (const e of chain) {
    const ends = endpoints(e);
    if (ends.length === 2) { union(ends[0], ends[1]); segs.push({ id: e.id, ends }); }
  }
  const groups = new Map<string, Array<{ id: string; ends: string[] }>>();
  for (const s of segs) { const r = find(s.ends[0]); groups.set(r, [...(groups.get(r) ?? []), s]); }
  for (const g of groups.values()) {
    const degree = new Map<string, number>();
    for (const s of g) for (const p of s.ends) degree.set(p, (degree.get(p) ?? 0) + 1);
    if ([...degree.values()].every((d) => d === 2)) continue;   // closed: a shape
    const loose = [...degree.entries()].filter(([, d]) => d === 1).map(([p]) => p);
    out.push({ id: g[0].id, entityIds: g.map((s) => s.id), ends: loose.length === 2 && [...degree.values()].every((d) => d <= 2) ? [loose[0], loose[1]] : null });
  }
  const order = new Map((feature?.entities ?? []).map((e, i) => [e.id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/** The `regions` value for a set of checked shapes: null when all are checked (the kernel then uses every region of the sketch,
 *  holes included), else the id of each checked shape. */
export function regionsFor(shapes: SketchShape[], checked: ReadonlySet<string>): string[] | null {
  const on = shapes.filter((s) => checked.has(s.id));
  return on.length === shapes.length ? null : on.map((s) => s.id);
}

interface FeatureRef { id: string; type: string; regions?: unknown; sketch?: unknown; [k: string]: unknown }

/** What a new Extrude or Cut should be built from. A sketch the user selected wins; otherwise the newest sketch that still has
 *  shapes nothing uses: a sketch no feature uses (all its shapes), or one whose features picked only some shapes (the rest). A
 *  feature without `regions` uses every shape. Null when everything is already used: the caller says so instead of stacking an
 *  identical solid on top (which fails as a boolean). */
export function nextExtrudeTarget(features: FeatureRef[], selectedId?: string | null): { sketchId: string; regions: string[] | null } | null {
  const sketches = features.filter((f) => f.type === 'sketch');
  const uncovered = (sk: FeatureRef): string[] | 'all' | 'none' => {
    const users = features.filter((f) => f.type !== 'sketch' && f.sketch === sk.id);
    if (!users.length) return 'all';
    const shapes = sketchShapes(sk as never);
    if (users.some((u) => !Array.isArray(u.regions))) return 'none';   // a user takes every shape
    const covered = new Set(users.flatMap((u) => u.regions as string[]));
    const rest = shapes.filter((s) => !s.entityIds.some((e) => covered.has(e))).map((s) => s.id);
    return rest.length ? rest : 'none';
  };
  const pick = (sk: FeatureRef, forced: boolean) => {
    const u = uncovered(sk);
    if (u === 'all') return { sketchId: sk.id, regions: null };
    if (u === 'none') return forced ? { sketchId: sk.id, regions: null } : null;
    return { sketchId: sk.id, regions: u.length === sketchShapes(sk as never).length ? null : u };
  };
  const chosen = sketches.find((s) => s.id === selectedId);
  if (chosen) return pick(chosen, true);
  for (const sk of [...sketches].reverse()) { const r = pick(sk, false); if (r) return r; }
  return null;
}

import { bsplineCurve, fitCurve } from './tools/splineMath';

// Nesting, by polygon of the shape's own points (spline fit points, circle sample, chain end points); a mixed chain with arcs is
// approximated by its end points, which is enough to tell an offset loop inside its outline.
function polygonOf(feature: FeatureLike, sh: SketchShape): Array<[number, number]> | null {
  const pts = new Map((feature.points ?? []).map((p) => [p.id, [p.x, p.y] as [number, number]]));
  const ents = new Map((feature.entities ?? []).map((e) => [e.id, e]));
  if (sh.kind === 'circle') {
    const e = ents.get(sh.id) as { c?: string; r?: number } | undefined;
    const c = e?.c ? pts.get(e.c) : undefined;
    if (!c || typeof e?.r !== 'number') return null;
    return Array.from({ length: 24 }, (_, i) => [c[0] + e.r! * Math.cos(i * Math.PI / 12), c[1] + e.r! * Math.sin(i * Math.PI / 12)] as [number, number]);
  }
  if (sh.kind !== 'loop') return null;
  const out: Array<[number, number]> = [];
  for (const id of sh.entityIds) {
    const e = ents.get(id) as { type?: string; pts?: string[]; p1?: string; p2?: string; closed?: boolean; degree?: number } | undefined;
    if ((e?.type === 'spline' || e?.type === 'cvspline') && e.pts) {
      // the curve itself, not its fit / control points (those of an exact projected outline are far apart)
      const ps = e.pts.map((pid) => pts.get(pid)).filter((p): p is [number, number] => !!p).map(([x, y]) => ({ x, y }));
      const dense = ps.length === e.pts.length && ps.length >= 3 ? (e.type === 'spline' ? fitCurve(ps, e.closed === true, 12) : bsplineCurve(ps, Number(e.degree ?? 3), e.closed === true, 48)) : [];
      if (dense.length >= 3) { for (const q of dense) out.push([q.x, q.y]); continue; }
    }
    const ids = e?.pts ?? [e?.p1, e?.p2];
    for (const pid of ids) { const p = pid ? pts.get(pid) : undefined; if (p) out.push(p); }
  }
  return out.length >= 3 ? out : null;
}
const inPoly = (pt: [number, number], poly: Array<[number, number]>): boolean => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const area2 = (p: Array<[number, number]>) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q[0] * r[1] - r[0] * q[1]; }, 0));

function markNesting(feature: FeatureLike | null | undefined, shapes: SketchShape[]): void {
  if (!feature) return;
  const ext = new Set((feature.entities ?? []).filter((e) => e.ext === true).map((e) => e.id));
  for (const s of shapes) s.reference = s.entityIds.length > 0 && s.entityIds.every((id) => ext.has(id));
  const polys = new Map(shapes.map((s) => [s.id, polygonOf(feature, s)] as const));
  for (const s of shapes) {
    const p = polys.get(s.id);
    if (!p) continue;
    let best: SketchShape | null = null, bestArea = Infinity;
    for (const o of shapes) {
      const q = polys.get(o.id);
      if (o === s || !q) continue;
      // s is inside o when every one of its points is (a loop's points sit on its curve: all inside means enclosed)
      if (!p.every((pt) => inPoly(pt, q))) continue;
      const a = area2(q);
      if (a < bestArea) { best = o; bestArea = a; }
    }
    if (best) s.inside = best.id;
  }
}

/** The shapes a CUT should remove by default. A sketch of a projected outline plus a loop drawn or offset inside it is a
 *  pocket: the drawn inner loop(s), not the wall between them and the projected outline (which coincides with the body wall).
 *  Null: nothing special, the kernel's default (every region) applies. */
export function defaultCutRegions(feature: FeatureLike | null | undefined): string[] | null {
  const shapes = sketchShapes(feature);
  const enclosingRef = new Set(shapes.filter((s) => s.reference).map((s) => s.id));
  const pocket = shapes.filter((s) => !s.reference && s.inside !== undefined && enclosingRef.has(s.inside));
  return pocket.length ? pocket.map((s) => s.id) : null;
}
