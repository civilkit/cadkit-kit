// The closed shapes of a sketch, for choosing which ones an extrude or revolve uses (the kernel's `regions` field).
// A shape is one circle or ellipse, or a connected chain of lines/arcs/splines that closes on itself. Construction geometry
// and open chains are not shapes (the kernel ignores them too).

export interface SketchShape {
  /** One entity id of the shape's outline: what `regions` takes. */
  id: string;
  kind: 'circle' | 'ellipse' | 'loop' | 'text';
  /** Every entity that makes up the outline. */
  entityIds: string[];
  /** Circle radius, else 0. */
  radius: number;
  /** Every entity is projected reference geometry (a body edge or face outline), not drawn in this sketch. */
  reference?: boolean;
  /** The shape that directly encloses this one (this shape is then a hole of it, or its filled disc when picked alone), if any. */
  inside?: string;
  /** The outline as a dense polygon in sketch coordinates, in walking order (arcs and splines sampled), when every curve of the shape could be resolved. */
  outline?: Array<[number, number]>;
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

/** Two end points closer than this (mm) are one point when joining curves into loops and chains: the script layer and imports give every curve
 *  its own end points, so a closed outline of several arcs often has several point ids at one place. */
export const JOIN_TOL = 1e-5;

/** Maps each point id to one representative id per place (points within JOIN_TOL join; the first in sketch order represents the group). */
export function joinPoints(feature: FeatureLike | null | undefined, tol = JOIN_TOL): (id: string) => string {
  const rep = new Map<string, string>();
  const cells = new Map<string, string[]>();
  const key = (i: number, j: number) => `${i},${j}`;
  const at = new Map<string, { x: number; y: number }>();
  for (const p of feature?.points ?? []) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    at.set(p.id, p);
    const i = Math.floor(p.x / tol), j = Math.floor(p.y / tol);
    let found: string | undefined;
    for (let di = -1; di <= 1 && !found; di++) for (let dj = -1; dj <= 1 && !found; dj++) {
      for (const q of cells.get(key(i + di, j + dj)) ?? []) { const o = at.get(q)!; if (Math.hypot(o.x - p.x, o.y - p.y) <= tol) { found = rep.get(q)!; break; } }
    }
    rep.set(p.id, found ?? p.id);
    const k = key(i, j);
    cells.set(k, [...(cells.get(k) ?? []), p.id]);
  }
  return (id) => rep.get(id) ?? id;
}

type P2 = [number, number];
interface Curve { id: string; a: string; b: string; poly: P2[]; ta: P2; tb: P2 }

const unit = (x: number, y: number): P2 => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };

/** A line, arc or open spline as a polyline from its first to its last end point (joined point ids), with the unit travel direction
 *  at both ends. Null for anything else, or when its points are missing. */
function curveOf(e: { id: string; [k: string]: unknown }, join: (id: string) => string, pts: Map<string, P2>): Curve | null {
  const ends = endpoints(e);
  if (ends.length !== 2) return null;
  const a = pts.get(ends[0]), b = pts.get(ends[1]);
  if (!a || !b) return null;
  let poly: P2[];
  let ta: P2 | null = null, tb: P2 | null = null;
  if (e.type === 'line') poly = [a, b];
  else if (e.type === 'arc') {
    const c = typeof e.c === 'string' ? pts.get(e.c) : undefined;
    if (!c) return null;
    const r = (Math.hypot(a[0] - c[0], a[1] - c[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 2;
    const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
    let sw = (Math.atan2(b[1] - c[1], b[0] - c[0]) - a0) % (2 * Math.PI);
    if (sw < 0) sw += 2 * Math.PI;
    if (sw < 1e-9) sw = 2 * Math.PI;   // counter-clockwise from p1 to p2; coincident ends are a full circle
    const n = Math.max(8, Math.ceil(sw / (Math.PI / 24)));
    poly = [a];
    for (let i = 1; i < n; i++) poly.push([c[0] + r * Math.cos(a0 + sw * i / n), c[1] + r * Math.sin(a0 + sw * i / n)]);
    poly.push(b);
    ta = unit(-Math.sin(a0), Math.cos(a0));
    tb = unit(-Math.sin(a0 + sw), Math.cos(a0 + sw));
  } else if ((e.type === 'spline' || e.type === 'cvspline') && Array.isArray(e.pts)) {
    if (e.closed === true) return null;
    const ps = (e.pts as string[]).map((pid) => pts.get(pid));
    if (ps.some((p) => !p)) return null;
    const v = (ps as P2[]).map(([x, y]) => ({ x, y }));
    const dense = v.length >= 3 ? (e.type === 'spline' ? fitCurve(v, false, 12) : bsplineCurve(v, Number(e.degree ?? 3), false, 48)) : [];
    poly = dense.length >= 2 ? dense.map((q) => [q.x, q.y] as P2) : (ps as P2[]);
  } else return null;
  if (poly.length < 2) return null;
  const n = poly.length;
  ta = ta ?? unit(poly[1][0] - poly[0][0], poly[1][1] - poly[0][1]);
  tb = tb ?? unit(poly[n - 1][0] - poly[n - 2][0], poly[n - 1][1] - poly[n - 2][1]);
  return { id: e.id, a: join(ends[0]), b: join(ends[1]), poly, ta, tb };
}

function pointMap(feature: FeatureLike): Map<string, P2> {
  return new Map((feature.points ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)).map((p) => [p.id, [p.x, p.y] as P2]));
}

const signedArea = (p: P2[]): number => p.reduce((s, q, i) => { const r = p[(i + 1) % p.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0) / 2;

/** The outline of one closed chain of entities, walked end to end. Null when a curve cannot be resolved or the walk does not close. */
function simpleOutline(feature: FeatureLike | null | undefined, ids: string[], join: (id: string) => string): P2[] | null {
  if (!feature) return null;
  const pts = pointMap(feature);
  const ents = new Map((feature.entities ?? []).map((e) => [e.id, e]));
  const cs: Curve[] = [];
  for (const id of ids) { const c = ents.get(id) ? curveOf(ents.get(id)!, join, pts) : null; if (!c) return null; cs.push(c); }
  const used = new Set<number>();
  const out: P2[] = [];
  let at = cs[0].a;
  for (let k = 0; k < cs.length; k++) {
    const i = cs.findIndex((c, j) => !used.has(j) && (c.a === at || c.b === at));
    if (i < 0) return null;
    used.add(i);
    const c = cs[i];
    const poly = c.a === at ? c.poly : [...c.poly].reverse();
    out.push(...poly.slice(0, -1));
    at = c.a === at ? c.b : c.a;
  }
  return at === cs[0].a && out.length >= 3 ? out : null;
}

/**
 * The bounded faces of a connected group of curves that share end points at vertices of more than two curves: a petal is the face
 * between two lines from the shared origin and the arc joining their far ends, however many petals share that origin. Curves that
 * lead nowhere (a dangling end) are dropped first, then each face is walked half-edge by half-edge, turning to the next curve in
 * angular order at every vertex. A face is named by an entity that borders no other face (the kernel selects every region an id
 * touches), so toggling one petal never toggles its neighbour.
 */
function facesOf(feature: FeatureLike | null | undefined, g: Array<{ id: string; ends: string[] }>, join: (id: string) => string): SketchShape[] {
  if (!feature) return [];
  const pts = pointMap(feature);
  const ents = new Map((feature.entities ?? []).map((e) => [e.id, e]));
  let cs: Curve[] = [];
  for (const s of g) { const e = ents.get(s.id); const c = e ? curveOf(e, join, pts) : null; if (!c) return []; cs.push({ ...c, id: String(e!.src ?? e!.id) }); }
  for (let again = true; again;) {   // prune dangling curves
    again = false;
    const deg = new Map<string, number>();
    for (const c of cs) { deg.set(c.a, (deg.get(c.a) ?? 0) + 1); deg.set(c.b, (deg.get(c.b) ?? 0) + 1); }
    const keep = cs.filter((c) => deg.get(c.a)! > 1 && deg.get(c.b)! > 1);
    if (keep.length !== cs.length) { cs = keep; again = true; }
  }
  if (cs.length < 2) return [];
  // half-edge 2i runs a -> b, 2i+1 runs b -> a
  const from = (h: number) => (h & 1 ? cs[h >> 1].b : cs[h >> 1].a);
  const to = (h: number) => (h & 1 ? cs[h >> 1].a : cs[h >> 1].b);
  const dir = (h: number): P2 => (h & 1 ? [-cs[h >> 1].tb[0], -cs[h >> 1].tb[1]] : cs[h >> 1].ta);
  const around = new Map<string, number[]>();
  for (let h = 0; h < cs.length * 2; h++) around.set(from(h), [...(around.get(from(h)) ?? []), h]);
  const ang = (h: number) => Math.atan2(dir(h)[1], dir(h)[0]);
  for (const l of around.values()) l.sort((x, y) => ang(x) - ang(y));
  const next = (h: number): number => { const l = around.get(to(h))!; return l[(l.indexOf(h ^ 1) - 1 + l.length) % l.length]; };
  const faceOf = new Map<number, number>();
  const faces: Array<{ hs: number[]; poly: P2[] }> = [];
  for (let h0 = 0; h0 < cs.length * 2; h0++) {
    if (faceOf.has(h0)) continue;
    const hs: number[] = [];
    for (let h = h0; !faceOf.has(h) && hs.length <= cs.length * 2; h = next(h)) { faceOf.set(h, -1); hs.push(h); }
    const poly = hs.flatMap((h) => (h & 1 ? [...cs[h >> 1].poly].reverse() : cs[h >> 1].poly).slice(0, -1));
    const k = faces.length;
    faces.push({ hs, poly });
    for (const h of hs) faceOf.set(h, k);
  }
  // counter-clockwise walks are bounded faces; a clockwise one is the outside of its component
  const bounded = new Set(faces.map((f, i) => (signedArea(f.poly) > 1e-9 ? i : -1)).filter((i) => i >= 0));
  const taken = new Set<string>();
  const out: SketchShape[] = [];
  for (const i of bounded) {
    const f = faces[i];
    const ids = [...new Set(f.hs.map((h) => cs[h >> 1].id))];
    const own = (h: number) => { const o = faceOf.get(h ^ 1)!; return o === i || !bounded.has(o); };
    const pick = f.hs.find((h) => own(h) && !taken.has(cs[h >> 1].id)) ?? f.hs.find((h) => !taken.has(cs[h >> 1].id)) ?? f.hs[0];
    const id = cs[pick >> 1].id;
    taken.add(id);
    out.push({ id, kind: 'loop', entityIds: ids, radius: 0, outline: f.poly });
  }
  return out;
}


/** An end point lying on the inside of another curve, with no shared vertex (a petal outline whose two ends sit on a ring circle), is a
 *  T-junction. The ring has to be cut there for the petal to close into a face. Within this distance (mm) an end point counts as on the curve. */
export const T_TOL = 1e-4;

/**
 * The sketch with its lines, arcs and circles cut at every T-junction: an end point of another curve lying on the curve's inside. The
 * pieces are virtual entities (`src` names the entity each came from) that end at the very point ids that touch them, so the usual
 * joining finds the vertex. Null when nothing is cut.
 */
function splitAtJunctions(feature: FeatureLike | null | undefined): FeatureLike | null {
  if (!feature) return null;
  const pts = pointMap(feature);
  const live = (feature.entities ?? []).filter((e) => !e.construction);
  const probes = new Map<string, P2>();   // end points of open curves (a circle has none)
  for (const e of live) if (e.type !== 'circle' && e.type !== 'ellipse' && e.type !== 'text') for (const id of endpoints(e)) { const q = pts.get(id); if (q) probes.set(id, q); }
  const cut = new Map<string, Array<{ id: string; t: number }>>();
  const TAU = 2 * Math.PI;
  for (const e of live) {
    const own = new Set(endpoints(e));
    const hits: Array<{ id: string; t: number }> = [];
    if (e.type === 'line') {
      const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < T_TOL) continue;
      for (const [id, q] of probes) {
        if (own.has(id)) continue;
        const t = ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / (len * len);
        if (t * len > T_TOL && (1 - t) * len > T_TOL && Math.abs((q[0] - a[0]) * dy - (q[1] - a[1]) * dx) / len <= T_TOL) hits.push({ id, t });
      }
    } else if (e.type === 'circle' || e.type === 'arc') {
      const c = pts.get(String(e.c));
      if (!c) continue;
      let r: number, a0 = 0, sw = TAU;
      if (e.type === 'circle') { if (typeof e.r !== 'number') continue; r = e.r; }
      else {
        const a = pts.get(String(e.p1)), b = pts.get(String(e.p2));
        if (!a || !b) continue;
        r = (Math.hypot(a[0] - c[0], a[1] - c[1]) + Math.hypot(b[0] - c[0], b[1] - c[1])) / 2;
        a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
        sw = (Math.atan2(b[1] - c[1], b[0] - c[0]) - a0) % TAU;
        if (sw < 0) sw += TAU;
        if (sw < 1e-9) sw = TAU;
      }
      for (const [id, q] of probes) {
        if (own.has(id) || Math.abs(Math.hypot(q[0] - c[0], q[1] - c[1]) - r) > T_TOL) continue;
        let t = (Math.atan2(q[1] - c[1], q[0] - c[0]) - a0) % TAU;
        if (t < 0) t += TAU;
        if (e.type === 'arc' ? t * r > T_TOL && (sw - t) * r > T_TOL && t < sw : true) hits.push({ id, t });
      }
    } else continue;
    if (hits.length) cut.set(e.id, hits.sort((x, y) => x.t - y.t).filter((h, i, l) => i === 0 || h.t - l[i - 1].t > 1e-9));
  }
  if (!cut.size) return null;
  const entities: NonNullable<FeatureLike['entities']> = [];
  for (const e of feature.entities ?? []) {
    const hits = cut.get(e.id);
    if (!hits) { entities.push(e); continue; }
    if (e.type === 'line') {
      const ids = [String(e.p1), ...hits.map((h) => h.id), String(e.p2)];
      for (let i = 0; i + 1 < ids.length; i++) entities.push({ id: `${e.id}~${i}`, src: e.id, type: 'line', p1: ids[i], p2: ids[i + 1] });
    } else {
      // a circle is cut into arcs from one cut to the next round the whole way; an arc keeps its ends
      const ids = e.type === 'circle' ? [...hits.map((h) => h.id), hits[0].id] : [String(e.p1), ...hits.map((h) => h.id), String(e.p2)];
      for (let i = 0; i + 1 < ids.length; i++) entities.push({ id: `${e.id}~${i}`, src: e.id, type: 'arc', c: e.c, p1: ids[i], p2: ids[i + 1] });
    }
  }
  return { ...feature, entities };
}

export function sketchShapes(original: FeatureLike | null | undefined): SketchShape[] {
  const out: SketchShape[] = [];
  const feature = splitAtJunctions(original) ?? original;
  const src = (id: string): string => String((feature?.entities ?? []).find((e) => e.id === id)?.src ?? id);
  const uniq = (ids: string[]) => [...new Set(ids.map(src))];
  const chain = (feature?.entities ?? []).filter((e) => !e.construction);
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const segs: Array<{ id: string; ends: string[] }> = [];
  const join = joinPoints(feature);
  for (const e of chain) {
    if (e.type === 'circle') { out.push({ id: e.id, kind: 'circle', entityIds: [e.id], radius: typeof e.r === 'number' ? e.r : 0 }); continue; }
    if (e.type === 'ellipse') { out.push({ id: e.id, kind: 'ellipse', entityIds: [e.id], radius: 0 }); continue; }
    if (e.type === 'text') { out.push({ id: e.id, kind: 'text', entityIds: [e.id], radius: 0 }); continue; }
    const ends = endpoints(e).map(join);
    if (ends.length === 2) { union(ends[0], ends[1]); segs.push({ id: e.id, ends }); }
  }
  const groups = new Map<string, Array<{ id: string; ends: string[] }>>();
  for (const s of segs) { const r = find(s.ends[0]); groups.set(r, [...(groups.get(r) ?? []), s]); }
  for (const g of groups.values()) {
    const degree = new Map<string, number>();
    for (const s of g) for (const p of s.ends) degree.set(p, (degree.get(p) ?? 0) + 1);
    // closed when every point joins exactly two segments (a single arc that closes on itself counts: both ends are one point)
    if ([...degree.values()].every((d) => d === 2)) {
      const sh: SketchShape = { id: src(g[0].id), kind: 'loop', entityIds: uniq(g.map((s) => s.id)), radius: 0 };
      const outline = simpleOutline(feature, g.map((s) => s.id), join);
      if (outline) sh.outline = outline;
      out.push(sh);
    } else out.push(...facesOf(feature, g, join));   // several loops sharing end points (petals from one origin, a rectangle with a diagonal)
  }
  const order = new Map((original?.entities ?? []).map((e, i) => [e.id, i]));
  markNesting(original, out);
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
  const chain = (feature?.entities ?? []).filter((e) => !e.construction && e.type !== 'circle' && e.type !== 'ellipse' && e.type !== 'text');
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const union = (a: string, b: string) => { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); parent.set(find(a), find(b)); };
  const segs: Array<{ id: string; ends: string[] }> = [];
  const join = joinPoints(feature);
  for (const e of chain) {
    const ends = endpoints(e).map(join);
    if (ends.length === 2) { union(ends[0], ends[1]); segs.push({ id: e.id, ends }); }
  }
  const groups = new Map<string, Array<{ id: string; ends: string[] }>>();
  for (const s of segs) { const r = find(s.ends[0]); groups.set(r, [...(groups.get(r) ?? []), s]); }
  for (const g of groups.values()) {
    const degree = new Map<string, number>();
    for (const s of g) for (const p of s.ends) degree.set(p, (degree.get(p) ?? 0) + 1);
    if ([...degree.values()].every((d) => d === 2)) continue;   // closed: a shape
    if (![...degree.values()].some((d) => d === 1)) continue;    // loops sharing end points: shapes (see facesOf), no loose end
    const loose = [...degree.entries()].filter(([, d]) => d === 1).map(([p]) => p);
    out.push({ id: g[0].id, entityIds: g.map((s) => s.id), ends: loose.length === 2 && [...degree.values()].every((d) => d <= 2) ? [loose[0], loose[1]] : null });
  }
  const order = new Map((feature?.entities ?? []).map((e, i) => [e.id, i]));
  return out.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

/**
 * The shapes the kernel extrudes when a feature names no `regions`: even-odd nesting, as the kernel does it. A shape inside no other
 * is solid, one inside it is its hole, one inside that hole is an island again, and so on. Shapes that share curves (a ring cut by
 * petal outlines, a rectangle split by a diagonal) are one level: a petal lying inside the ring's circle is not a hole of the ring.
 * Lettering is always in (the kernel adds text regions on top). This is what the Shapes list shows ticked for a feature with no
 * `regions`, so ticking every box (holes too) is a different selection from the default: it fills the holes.
 */
export function defaultShapeIds(shapes: SketchShape[]): string[] {
  const parent = new Map<string, string>(shapes.map((s) => [s.id, s.id]));
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; return r; };
  const owner = new Map<string, string>();   // entity id -> a shape using it
  for (const s of shapes) for (const e of s.entityIds) {
    const o = owner.get(e);
    if (o === undefined) owner.set(e, s.id); else parent.set(find(s.id), find(o));
  }
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const depth = (s: SketchShape): number => {
    const levels = new Set<string>();
    const seen = new Set<string>([s.id]);
    for (let o = s.inside ? byId.get(s.inside) : undefined; o && !seen.has(o.id); o = o.inside ? byId.get(o.inside) : undefined) {
      seen.add(o.id);
      if (o.kind !== 'text' && find(o.id) !== find(s.id)) levels.add(find(o.id));
    }
    return levels.size;
  };
  return shapes.filter((s) => s.kind === 'text' || depth(s) % 2 === 0).map((s) => s.id);
}

const sameSet = (a: ReadonlySet<string>, b: readonly string[]): boolean => a.size === b.length && b.every((x) => a.has(x));

/** The `regions` value for a set of checked shapes: null when exactly the default shapes are checked (`defaults`, see
 *  defaultShapeIds; every shape when not given), else the id of each checked shape. Every shape checked with a hole among them
 *  is a list, not null: the hole is filled. */
export function regionsFor(shapes: SketchShape[], checked: ReadonlySet<string>, defaults: readonly string[] = shapes.map((s) => s.id)): string[] | null {
  const on = shapes.filter((s) => checked.has(s.id)).map((s) => s.id);
  return sameSet(new Set(on), defaults) ? null : on;
}

/** The `regions` value after toggling one shape (a click on its region in the view, or its checkbox): null when the checked set is
 *  the default one again (`defaults`; every shape when not given), the checked ids otherwise, and `undefined` when it would leave
 *  nothing checked (at least one stays). `current` is the feature's value; absent means the defaults are checked. */
export function toggleRegion(allIds: string[], current: string[] | null | undefined, id: string, defaults: readonly string[] = allIds): string[] | null | undefined {
  const checked = new Set(Array.isArray(current) ? allIds.filter((x) => current.includes(x)) : allIds.filter((x) => defaults.includes(x)));
  if (checked.has(id)) checked.delete(id); else checked.add(id);
  if (!checked.size) return undefined;
  return sameSet(checked, defaults.filter((x) => allIds.includes(x))) ? null : allIds.filter((x) => checked.has(x));
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
import { textInkBox, textOutlineOf } from './text';

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
  if (sh.kind === 'text') {
    // lettering has no single outline: its ink box (from the kernel's outline, cached by the text module) stands for it when a region is picked by a click
    const e = ents.get(sh.id);
    const b = e ? textInkBox(textOutlineOf(feature as never, e as never)) : null;
    return b ? [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]] : null;
  }
  if (sh.kind !== 'loop') return null;
  if (sh.outline) return sh.outline;
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

/**
 * The shape a click at (u, v) of the sketch plane means: the smallest closed shape whose outline encloses the point (a click on
 * the ring between an outer and an inner circle is the outer one, a click inside the inner circle is the inner one). Null off every shape.
 */
export function shapeAtPoint(feature: FeatureLike | null | undefined, shapes: SketchShape[], u: number, v: number): SketchShape | null {
  if (!feature) return null;
  let best: SketchShape | null = null, bestArea = Infinity;
  for (const sh of shapes) {
    const poly = polygonOf(feature, sh);
    if (!poly || !inPoly([u, v], poly)) continue;
    const a = area2(poly);
    if (a < bestArea) { best = sh; bestArea = a; }
  }
  return best;
}
