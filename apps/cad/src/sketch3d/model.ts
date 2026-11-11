// The 3D Sketch tool, pure part: the draft (points with x / y / z and the curves built on them, the wire shape of the kernel's
// `sketch3d` feature), how a stroke of clicks becomes line / arc / spline / control-vertex-spline / point entities, deleting and
// moving points, the work plane a click lands on, snapping to existing points, and the `sketch3d` feature (and the optional plane
// normal to the path) the tool adds. No DOM and no kernel: tested on its own.
import { arcSamples, bsplineSamples, circumcentre, clampDegree, cross, dist, dot, len, mul, add, splineSamples, sub, sweepAngle, unit, type P3 } from './curves';

export type { P3 } from './curves';

export type Mode = 'line' | 'arc' | 'spline' | 'cvspline' | 'point';
export const MODES: Mode[] = ['line', 'arc', 'spline', 'cvspline', 'point'];

export interface Pt3 { id: string; x: number; y: number; z: number; fixed?: boolean }
/** Any entity of the wire shape; the tool makes line, arc, spline, cvspline and point, and carries others (ref) through unchanged. */
export type Ent3 = { id: string; type: string; construction?: boolean; [k: string]: unknown };
export interface Draft3 { points: Pt3[]; entities: Ent3[]; constraints: unknown[] }
/** The points of the stroke under way, in click order (they are in `Draft3.points` already; the entity is made when the stroke ends). */
export interface Stroke { mode: Mode; ids: string[]; degree: number }

export const emptyDraft = (): Draft3 => ({ points: [], entities: [], constraints: [] });
export const posOf = (p: Pt3): P3 => [p.x, p.y, p.z];

/** An id not in use, `<prefix><n>` with the lowest n above every number used. */
export function freshId(draft: Draft3, prefix: string): string {
  const used = new Set([...draft.points.map((p) => p.id), ...draft.entities.map((e) => e.id)]);
  let n = 1;
  for (const id of used) { const m = id.match(/^([a-z]+)(\d+)$/); if (m && m[1] === prefix) n = Math.max(n, Number(m[2]) + 1); }
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

const round = (v: number): number => Math.round(v * 1e9) / 1e9;

/** A copy of the draft with a point added; returns the draft and the new id. */
export function withPoint(draft: Draft3, pos: P3): { draft: Draft3; id: string } {
  const id = freshId(draft, 'p');
  return { draft: { ...draft, points: [...draft.points, { id, x: round(pos[0]), y: round(pos[1]), z: round(pos[2]) }] }, id };
}

export function movePoint(draft: Draft3, id: string, pos: P3): Draft3 {
  return { ...draft, points: draft.points.map((p) => (p.id === id ? { ...p, x: round(pos[0]), y: round(pos[1]), z: round(pos[2]) } : p)) };
}

/** Point ids an entity is built on. */
export function entityPointIds(e: Ent3): string[] {
  switch (e.type) {
    case 'line': return [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
    case 'arc': return [e.c, e.p1, e.p2].filter((x): x is string => typeof x === 'string');
    case 'point': return typeof e.p === 'string' ? [e.p] : [];
    default: return Array.isArray(e.pts) ? (e.pts as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  }
}

/** The curve of one entity as a polyline (a point entity gives one point). */
export function entityPolyline(draft: Draft3, e: Ent3): P3[] {
  const at = (id: unknown): P3 | null => { const p = draft.points.find((q) => q.id === id); return p ? posOf(p) : null; };
  switch (e.type) {
    case 'line': { const a = at(e.p1), b = at(e.p2); return a && b ? [a, b] : []; }
    case 'arc': { const c = at(e.c), a = at(e.p1), b = at(e.p2); return c && a && b ? arcSamples(c, a, b) : []; }
    case 'spline': case 'cvspline': case 'ref': {
      const ids = (e.pts as unknown[] | undefined) ?? [];
      const pts = ids.map(at);
      if (pts.some((p) => !p)) return [];
      const ps = pts as P3[];
      if (e.type === 'spline') return splineSamples(e.closed === true && ps.length ? [...ps, ps[0]] : ps);
      if (e.type === 'cvspline') return bsplineSamples(ps, clampDegree(Number(e.degree) || 1, ps.length));
      return Array.isArray((e.curve as { P?: unknown } | undefined)?.P) ? [] : ps;
    }
    case 'point': { const a = at(e.p); return a ? [a] : []; }
    default: return [];
  }
}

// ---- strokes ----

/** Arcs for three clicks: through `a`, `b` to `c`. One arc up to half a turn, else equal pieces (the kernel's arc is at most half a turn). Null when the points are collinear. */
function arcPieces(a: P3, b: P3, c: P3): { centre: P3; ends: P3[] } | null {
  const circ = circumcentre(a, b, c);
  if (!circ) return null;
  const theta = sweepAngle(circ.c, circ.n, a, c);   // a -> b -> c runs anticlockwise about n by construction
  const pieces = theta <= Math.PI - 1e-6 ? 1 : Math.ceil(theta / (0.9 * Math.PI));
  const u = unit(sub(a, circ.c))!;
  const v = cross(circ.n, u);
  const ends: P3[] = [a];
  for (let i = 1; i < pieces; i++) {
    const th = (theta * i) / pieces;
    ends.push(add(circ.c, add(mul(u, circ.r * Math.cos(th)), mul(v, circ.r * Math.sin(th)))));
  }
  ends.push(c);
  return { centre: circ.c, ends };
}

/** Whether a stroke has enough points to make its entity. */
export const strokeReady = (s: Stroke): boolean => {
  const n = new Set(s.ids).size;
  if (s.mode === 'point') return n >= 1;
  if (s.mode === 'arc') return s.ids.length >= 3;
  return n >= 2;
};

/** The draft with the stroke's entity made (the stroke's points stay). A stroke that cannot make one (too few points, collinear arc) is dropped: its points go too, unless an entity uses them. */
export function finishStroke(draft: Draft3, s: Stroke): Draft3 {
  let d = draft;
  const ids = s.ids.filter((id, i) => i === 0 || id !== s.ids[i - 1]);
  const pos = (id: string): P3 => posOf(d.points.find((p) => p.id === id)!);
  const addEnt = (e: Omit<Ent3, 'id'>): void => { d = { ...d, entities: [...d.entities, { id: freshId(d, 'e'), ...e } as Ent3] }; };
  let made = false;
  if (s.mode === 'line') {
    for (let i = 1; i < ids.length; i++) if (ids[i] !== ids[i - 1]) { addEnt({ type: 'line', p1: ids[i - 1], p2: ids[i] }); made = true; }
  } else if (s.mode === 'arc' && ids.length >= 3) {
    const [a, b, c] = ids;
    const pieces = arcPieces(pos(a), pos(b), pos(c));
    if (pieces) {
      // the through point is only a guide: it stays a point of the sketch when the arc is one piece
      const cp = withPoint(d, pieces.centre);
      d = cp.draft;
      let prev = a;
      pieces.ends.slice(1).forEach((q, i, rest) => {
        const last = i === rest.length - 1;
        let end = c;
        if (!last) { const np = withPoint(d, q); d = np.draft; end = np.id; }
        addEnt({ type: 'arc', c: cp.id, p1: prev, p2: end });
        prev = end;
      });
      made = true;
    }
  } else if (s.mode === 'spline' || s.mode === 'cvspline') {
    const closed = ids.length >= 4 && ids[0] === ids[ids.length - 1];
    const body = closed ? ids.slice(0, -1) : ids;
    if (new Set(body).size >= 2) {
      if (s.mode === 'spline') addEnt({ type: 'spline', pts: body, ...(closed ? { closed: true } : {}) });
      else addEnt({ type: 'cvspline', pts: body, degree: clampDegree(s.degree, body.length), ...(closed ? { closed: true } : {}) });
      made = true;
    }
  } else if (s.mode === 'point') {
    for (const id of new Set(ids)) { addEnt({ type: 'point', p: id }); made = true; }
  }
  // the stroke's own points that nothing uses (a stroke that made no entity, the guide point of an arc) go
  return dropOrphans(d, [], new Set(s.ids));
}

/** Points no entity uses (and not in `keep`) are removed; with `only`, just those ids are candidates. */
export function dropOrphans(draft: Draft3, keep: string[], only?: Set<string>): Draft3 {
  const used = new Set<string>(keep);
  for (const e of draft.entities) for (const id of entityPointIds(e)) used.add(id);
  for (const c of draft.constraints) for (const r of refsOf(c)) used.add(r);
  const points = draft.points.filter((p) => used.has(p.id) || (only && !only.has(p.id)));
  return points.length === draft.points.length ? draft : { ...draft, points };
}

const refsOf = (c: unknown): string[] => {
  const o = c as { refs?: unknown; points?: unknown } | null;
  return Array.isArray(o?.refs) ? (o!.refs as unknown[]).filter((x): x is string => typeof x === 'string') : [];
};

/** The entities the draft shows while a stroke is under way (the finished ones plus the stroke made as far as it goes). */
export function withStroke(draft: Draft3, s: Stroke | null): Draft3 {
  if (!s || !s.ids.length) return draft;
  if (s.mode === 'arc' && s.ids.length < 3) return draft;
  if (s.mode === 'cvspline' && s.ids.length < 2) return draft;
  return finishStroke(draft, s);
}

/** Delete a point and what depends on it. A line chain is closed up over the gap; a spline loses the control point (and goes when fewer than two are left); an arc, a point entity or a constraint that used it goes. */
export function removePoint(draft: Draft3, id: string): Draft3 {
  let ents = draft.entities.map((e) => ({ ...e }));
  const lines = ents.filter((e) => e.type === 'line' && (e.p1 === id || e.p2 === id));
  if (lines.length === 2) {
    const [l1, l2] = lines;
    const a = (l1.p1 === id ? l1.p2 : l1.p1) as string;
    const b = (l2.p1 === id ? l2.p2 : l2.p1) as string;
    if (a !== b) ents = ents.filter((e) => e.id !== l2.id).map((e) => (e.id === l1.id ? { ...e, p1: a, p2: b } : e));
  }
  ents = ents.flatMap((e) => {
    if (!entityPointIds(e).includes(id)) return [e];
    if (e.type === 'spline' || e.type === 'cvspline' || e.type === 'ref') {
      const pts = (e.pts as string[]).filter((x) => x !== id);
      if (pts.length < 2) return [];
      return [{ ...e, pts, ...(e.type === 'cvspline' ? { degree: clampDegree(Number(e.degree) || 1, pts.length) } : {}), ...(e.closed === true && pts.length < 3 ? { closed: false } : {}) }];
    }
    return [];
  });
  const constraints = draft.constraints.filter((c) => !refsOf(c).includes(id));
  // points that only the entities this point took with it were using go too; other loose points (a stroke under way) stay
  const affected = new Set(draft.entities.filter((e) => entityPointIds(e).includes(id)).flatMap(entityPointIds));
  return dropOrphans({ ...draft, points: draft.points.filter((p) => p.id !== id), entities: ents, constraints }, [], affected);
}

// ---- work planes and snapping ----

export interface WorkPlane { id: string; o: P3; n: P3; u: P3 }

/** A unit vector perpendicular to n (the in-plane direction handles use). */
export function inPlane(n: P3): P3 {
  const a: P3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return unit(cross(n, cross(a, n)))!;
}

const STD: Record<string, P3> = { front: [0, 0, 1], top: [0, 1, 0], right: [1, 0, 0] };

/** The planes a click can land on: the ground (normal to the up axis), the three standard planes, and the document's datum planes (frame: origin + z). */
export function workPlanes(up: 'y' | 'z', datum: Array<{ id: string; frame: { o: number[]; z: number[] } }>): WorkPlane[] {
  const mk = (id: string, o: P3, n: P3): WorkPlane => ({ id, o, n, u: inPlane(n) });
  return [
    mk('ground', [0, 0, 0], up === 'z' ? STD.front : STD.top),
    mk('front', [0, 0, 0], STD.front), mk('top', [0, 0, 0], STD.top), mk('right', [0, 0, 0], STD.right),
    ...datum.map((d) => mk('plane:' + d.id, d.frame.o as P3, unit(d.frame.z as P3) ?? STD.front)),
  ];
}

/** Where a ray meets a plane lifted by `offset` along its normal; null when parallel (edge-on) or behind. */
export function rayOnPlane(ray: { o: P3; d: P3 }, plane: WorkPlane, offset: number): P3 | null {
  const dn = dot(ray.d, plane.n);
  if (Math.abs(dn) < 1e-6) return null;
  const through = add(plane.o, mul(plane.n, offset));
  const t = dot(sub(through, ray.o), plane.n) / dn;
  if (!(t > 0)) return null;
  return add(ray.o, mul(ray.d, t));
}

export type SnapKind = 'draft' | 'sketch' | 'vertex' | 'endpoint' | 'midpoint' | 'mesh';
export interface SnapCandidate { p: P3; kind: SnapKind; id?: string }
export interface Snap { pos: P3; kind: SnapKind | 'plane'; id?: string }

const BIAS: Record<SnapKind, number> = { draft: 0, sketch: 0.5, vertex: 1, endpoint: 1.5, midpoint: 2.5, mesh: 0 };

/** The nearest candidate whose screen distance to the ray is within `px` pixels (`wpp` gives world units per pixel at a point), else the plane hit, else null. */
export function snapRay(ray: { o: P3; d: P3 }, cands: SnapCandidate[], wpp: (p: P3) => number, px: number, plane: WorkPlane, offset: number, surface?: (ray: { o: P3; d: P3 }) => { pos: P3; normal?: P3 } | null): Snap | null {
  let best: { c: SnapCandidate; score: number } | null = null;
  for (const c of cands) {
    const rel = sub(c.p, ray.o);
    const t = dot(rel, ray.d);
    if (t <= 0) continue;
    const off = len(sub(rel, mul(ray.d, t)));
    const w = Math.max(wpp(c.p), 1e-12);
    const d = off / w;
    if (d > px) continue;
    const score = d + BIAS[c.kind];
    if (!best || score < best.score) best = { c, score };
  }
  if (best) return { pos: best.c.p, kind: best.c.kind, ...(best.c.id ? { id: best.c.id } : {}) };
  // a reference mesh under the pointer: the click lands on its surface (the work plane is the fallback where the ray misses it)
  const on = surface?.(ray);
  if (on) return { pos: on.pos, kind: 'mesh' };
  const hit = rayOnPlane(ray, plane, offset);
  return hit ? { pos: hit, kind: 'plane' } : null;
}

// ---- fitting curves to a surface ----

export interface FitOptions {
  /** Where a sample goes: a point on the surface, or null to leave it where it is. */
  project(p: P3): P3 | null;
  /** About this far apart (mm) along the curve; default a fiftieth of the curve's length, at least the click spacing. */
  spacing?: number;
  /** At most this many points a curve (default 64). */
  maxPoints?: number;
}

/** `n` points evenly spaced by length along a polyline, ends included. */
export function resample(pl: P3[], n: number): P3[] {
  if (pl.length < 2 || n < 2) return pl.slice();
  const cum = [0];
  for (let i = 1; i < pl.length; i++) cum.push(cum[i - 1] + dist(pl[i - 1], pl[i]));
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [pl[0], pl[pl.length - 1]];
  const out: P3[] = [];
  let k = 1;
  for (let i = 0; i < n; i++) {
    const s = (total * i) / (n - 1);
    while (k < cum.length - 1 && cum[k] < s) k++;
    const seg = cum[k] - cum[k - 1] || 1;
    const u = Math.min(1, Math.max(0, (s - cum[k - 1]) / seg));
    out.push([pl[k - 1][0] + (pl[k][0] - pl[k - 1][0]) * u, pl[k - 1][1] + (pl[k][1] - pl[k - 1][1]) * u, pl[k - 1][2] + (pl[k][2] - pl[k - 1][2]) * u]);
  }
  return out;
}

/** Lay the draft's lines, splines and control-vertex splines onto a surface: each curve is sampled along its length and every sample
 *  moves to the surface, so the curve becomes a spline through points that lie on it (the original click points are kept as samples'
 *  ends). Point entities move onto the surface too. Arcs are left as they are. Returns the draft and how many curves were fitted. */
export function fitDraftToSurface(draft: Draft3, o: FitOptions): { draft: Draft3; fitted: number } {
  let d = draft;
  let fitted = 0;
  const maxPoints = Math.max(3, o.maxPoints ?? 64);
  const replaced = new Set<string>();
  for (const e of draft.entities) {
    if (e.construction === true) continue;
    if (e.type === 'point') {
      const q = d.points.find((p) => p.id === e.p);
      const to = q ? o.project(posOf(q)) : null;
      if (q && to) { d = movePoint(d, q.id, to); fitted++; }
      continue;
    }
    if (e.type !== 'line' && e.type !== 'spline' && e.type !== 'cvspline') continue;
    const pl = entityPolyline(draft, e);
    if (pl.length < 2) continue;
    const length = polylineLength(pl);
    const spacing = o.spacing ?? length / 50;
    const closed = e.closed === true;
    const n = Math.min(maxPoints, Math.max(entityPointIds(e).length, Math.ceil(length / Math.max(spacing, 1e-9)) + 1, 3));
    const samples = resample(pl, n);
    const on = samples.map((s) => o.project(s));
    if (on.some((p) => !p)) continue;   // a sample off the surface: the curve is left as drawn
    const ids: string[] = [];
    for (const p of on as P3[]) {
      if (ids.length && dist(posOf(d.points.find((q) => q.id === ids[ids.length - 1])!), p) < 1e-6) continue;
      const w = withPoint(d, p);
      d = w.draft; ids.push(w.id);
    }
    if (ids.length < 2) continue;
    const pts = ids;
    for (const id of entityPointIds(e)) replaced.add(id);
    d = { ...d, entities: d.entities.map((x) => (x.id === e.id ? { id: e.id, type: 'spline', pts, ...(closed ? { closed: true } : {}) } as Ent3 : x)) };
    fitted++;
  }
  return { draft: dropOrphans(d, [], replaced), fitted };
}

// ---- the feature ----

/** The `sketch3d` feature for a draft: the original feature's other keys are kept when editing. */
export function sketch3dFeature(id: string, d: Draft3, base?: Record<string, unknown>): Record<string, unknown> {
  const { points: _p, entities: _e, constraints: _c, ...rest } = (base ?? {}) as Record<string, unknown>;
  return { ...rest, type: 'sketch3d', id, points: d.points.map((p) => ({ ...p })), entities: d.entities.map((e) => ({ ...e })), constraints: d.constraints };
}

/** The draft of an existing `sketch3d` feature. */
export function draftOf(f: Record<string, unknown> | undefined): Draft3 | null {
  if (!f || f.type !== 'sketch3d') return null;
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const points = (Array.isArray(f.points) ? f.points : []).filter((p): p is Record<string, unknown> => !!p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string')
    .map((p) => ({ id: p.id as string, x: num(p.x), y: num(p.y), z: num(p.z), ...(p.fixed === true ? { fixed: true } : {}) }));
  const entities = (Array.isArray(f.entities) ? f.entities : []).filter((e): e is Ent3 => !!e && typeof e === 'object' && typeof (e as { id?: unknown }).id === 'string' && typeof (e as { type?: unknown }).type === 'string');
  return { points, entities, constraints: Array.isArray(f.constraints) ? [...f.constraints] : [] };
}

/** A sketch3d the kernel accepts as a sweep or path-pattern path: exactly one open `spline` and nothing else but points. */
export function isSplinePath(f: { type?: unknown; entities?: unknown } | undefined): boolean {
  if (!f || f.type !== 'sketch3d') return false;
  const ents = (Array.isArray(f.entities) ? f.entities : []) as Ent3[];
  const live = ents.filter((e) => e.construction !== true);
  const splines = live.filter((e) => e.type === 'spline');
  return splines.length === 1 && splines[0].closed !== true && live.every((e) => e === splines[0] || e.type === 'point') && ((splines[0].pts as unknown[] | undefined)?.length ?? 0) >= 2;
}

/** Ops that add the sketch (or replace it when editing) and, when asked, a plane normal to the path's start to sketch the profile on. */
export function sketch3dOps(feature: Record<string, unknown>, replace: boolean, plane?: Record<string, unknown>): Array<Record<string, unknown>> {
  const ops: Array<Record<string, unknown>> = replace ? [{ op: 'replace', id: feature.id, feature }] : [{ op: 'add', feature }];
  if (plane) ops.push({ op: 'add', feature: plane });
  return ops;
}

// ---- drawing the committed sketches in the viewport ----

/** Polylines (curves layer items) for every sketch3d feature except `skip`: one per entity, a small cross for a point entity. */
export function sketch3dCurves(features: Array<Record<string, unknown>>, skip: string | null = null): Array<{ id: string; pts: number[][] }> {
  const out: Array<{ id: string; pts: number[][] }> = [];
  for (const f of features) {
    if (f.type !== 'sketch3d' || f.id === skip || f.suppressed === true) continue;
    const d = draftOf(f);
    if (!d) continue;
    const id = f.id as string;
    let size = 0;
    for (const p of d.points) size = Math.max(size, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    const arm = Math.max(size * 0.012, 0.5);
    for (const e of d.entities) {
      if (e.construction === true) continue;
      const pl = entityPolyline(d, e);
      if (e.type === 'point' && pl.length === 1) {
        const [x, y, z] = pl[0];
        out.push({ id, pts: [[x - arm, y, z], [x + arm, y, z]] }, { id, pts: [[x, y - arm, z], [x, y + arm, z]] }, { id, pts: [[x, y, z - arm], [x, y, z + arm]] });
      } else if (pl.length >= 2) out.push({ id, pts: pl.map((p) => [...p]) });
    }
  }
  return out;
}

/** Length of the polyline (mm). */
export const polylineLength = (pl: P3[]): number => pl.reduce((s, p, i) => (i ? s + dist(pl[i - 1], p) : 0), 0);

/** The plane feature normal to a sweep path's start, for the profile sketch. */
export function normalPlane(id: string, path: string): Record<string, unknown> {
  return { type: 'plane', id, mode: 'normal', path };
}
