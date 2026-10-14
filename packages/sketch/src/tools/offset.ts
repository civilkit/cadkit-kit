/**
 * Offset. Click a line, arc or circle: the whole chain of lines and arcs connected to it (end to end, no
 * branching) is selected (click it again to unselect; Shift-click toggles a single entity, which must stay
 * connected). Press Enter, then move the pointer to a side: the distance from the chain to the pointer is the
 * offset distance and the pointer's side the direction, or type the distance (`d`; Tab or Enter locks it and, once
 * a side is known, applies it) and click on the side. Escape drops the typed value, then the selection.
 *
 * Geometry (pure, in this file): the chain is walked into a path; every segment is offset by a signed distance
 * (positive = left of the walking direction; an arc walked counter-clockwise has the centre on its left, so its
 * radius becomes r - d); neighbours are joined at the intersection of their offset curves nearest the old
 * corner (lines are trimmed or extended; tangent joins just move the corner along the common normal). A segment
 * that collapses (an arc whose radius would be <= 0, a line that would reverse) is dropped, and its neighbours
 * are joined to each other (hint `offsetDropped`). A closed chain stays closed.
 *
 * What it writes (constraints verified against the solver, see offset kernel tests):
 *  - every copied line: `parallel [orig, copy]` and `pldist [copy.p1, orig]` value d (point to line distance,
 *    driving); corners are shared points, so the whole copy follows the original;
 *  - every copied arc or circle shares the CENTRE POINT of the original (concentric by construction) and gets
 *    `raddiff [smaller, larger]` value |dr| (the solver: value = r(refs[1]) - r(refs[0]); an arc's two ends are
 *    already tied to equal radius by the solver);
 *  - the copy keeps the `construction` flag of the original; originals and their constraints are untouched.
 * There is no single "offset distance" constraint in the vocabulary, so each segment carries its own distance
 * dimension of the same value. Spline and ellipse chains are not supported.
 */
import type { DraftEntity, SketchDraft } from '../index';
import { entityShape } from '../select';
import { chainCurves, edgeNear, edgesFor, flatten, projectCurves, referenceChain, shapesOf as projectedShapes } from './project';
import { offsetSplinePoints, sampleSpline, sideOfSpline, signedArea } from './splineOffset';
import { fitCurve } from './splineMath';
import { circleCircle, cross, dist, dot, len, sample, scale, sub, add, TAU, TOL, wrap, angleOf, arcSweep, type ArcG } from './edit-geom';
import { entityOf, ptOf, withConstraint, withEntity, withPoint } from './edit-draft';
import type { FieldSpec, Pt, PreviewShape, Tool, ToolEnv, ToolOutput, ToolSettings } from './types';

// ---------------------------------------------------------------- chains

interface Seg {
  id: string;
  kind: 'line' | 'arc';
  /** walked in the entity's own direction p1 -> p2 */
  fwd: boolean;
  /** walking start / end (original coordinates) */
  a: Pt; b: Pt;
  /** arc only */
  c?: Pt; cId?: string; r?: number;
  /** walking turns counter-clockwise around the centre (arc only) */
  ccw?: boolean;
}
export interface Path { segs: Seg[]; closed: boolean }
export type Item =
  | { kind: 'path'; path: Path }
  | { kind: 'circle'; id: string; cId: string; c: Pt; r: number }
  | { kind: 'spline'; id: string; ptIds: string[]; pts: Pt[]; closed: boolean };

const vkey = (p: Pt) => `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}`;
const isChainEntity = (e: DraftEntity) => e.type === 'line' || e.type === 'arc';

interface Raw { e: DraftEntity; p1: Pt; p2: Pt; k1: string; k2: string }
function rawOf(draft: SketchDraft, e: DraftEntity): Raw | null {
  const p1 = ptOf(draft, String(e.p1)), p2 = ptOf(draft, String(e.p2));
  if (!p1 || !p2) return null;
  return { e, p1, p2, k1: vkey(p1), k2: vkey(p2) };
}

/** The entities connected end to end to `startId` through vertices where exactly two lines/arcs meet. */
export function chainOf(draft: SketchDraft, startId: string): string[] {
  const raws = draft.entities.filter(isChainEntity).map((e) => rawOf(draft, e)).filter((r): r is Raw => !!r);
  const byKey = new Map<string, Raw[]>();
  for (const r of raws) for (const k of [r.k1, r.k2]) byKey.set(k, [...(byKey.get(k) ?? []), r]);
  const start = raws.find((r) => r.e.id === startId);
  if (!start) return [];
  const seen = new Set<string>([startId]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const k of [cur.k1, cur.k2]) {
      const here = byKey.get(k) ?? [];
      if (here.length !== 2) continue;           // an open end or a branch: the chain stops
      for (const o of here) if (!seen.has(o.e.id) && !o.e.construction === !start.e.construction) { seen.add(o.e.id); queue.push(o); }
    }
  }
  return [...seen];
}

/** Order selected lines/arcs into one path or cycle. A string is the hint key of why not. */
export function pathOf(draft: SketchDraft, ids: string[]): Path | string {
  const raws = ids.map((id) => entityOf(draft, id)).filter((e): e is DraftEntity => !!e && isChainEntity(e)).map((e) => rawOf(draft, e)).filter((r): r is Raw => !!r);
  if (!raws.length) return 'app.sketch.hint.pickCurve';
  const ends = new Map<string, Array<{ r: Raw; end: 1 | 2 }>>();
  for (const r of raws) {
    if (r.k1 === r.k2) return 'app.sketch.hint.offsetBranch';
    ends.set(r.k1, [...(ends.get(r.k1) ?? []), { r, end: 1 }]);
    ends.set(r.k2, [...(ends.get(r.k2) ?? []), { r, end: 2 }]);
  }
  for (const v of ends.values()) if (v.length > 2) return 'app.sketch.hint.offsetBranch';
  const open = [...ends.entries()].filter(([, v]) => v.length === 1);
  if (open.length !== 0 && open.length !== 2) return 'app.sketch.hint.offsetBranch';
  const closed = open.length === 0;
  let key = closed ? raws[0].k1 : open[0][0];
  const used = new Set<string>();
  const segs: Seg[] = [];
  for (;;) {
    const next = (ends.get(key) ?? []).find((x) => !used.has(x.r.e.id));
    if (!next) break;
    const { r, end } = next;
    used.add(r.e.id);
    const fwd = end === 1;
    const a = fwd ? r.p1 : r.p2, b = fwd ? r.p2 : r.p1;
    const seg: Seg = { id: r.e.id, kind: r.e.type as 'line' | 'arc', fwd, a, b };
    if (seg.kind === 'arc') {
      const c = ptOf(draft, String(r.e.c));
      if (!c) return 'app.sketch.hint.pickCurve';
      seg.c = c; seg.cId = String(r.e.c); seg.r = dist(c, r.p1); seg.ccw = fwd;
    }
    segs.push(seg);
    key = fwd ? r.k2 : r.k1;
  }
  if (used.size !== raws.length) return 'app.sketch.hint.offsetBranch';
  return { segs, closed };
}

export function itemOf(draft: SketchDraft, ids: string[]): Item | string {
  if (ids.some((id) => entityOf(draft, id)?.type === 'spline')) {
    if (ids.length !== 1) return 'app.sketch.hint.offsetSplineMixed';
    const e = entityOf(draft, ids[0])!;
    const ptIds = (Array.isArray(e.pts) ? e.pts : []).map(String);
    const pts = ptIds.map((id) => ptOf(draft, id));
    return pts.length >= 2 && pts.every((q): q is Pt => !!q) ? { kind: 'spline', id: e.id, ptIds, pts, closed: e.closed === true } : 'app.sketch.hint.pickCurve';
  }
  if (ids.length === 1) {
    const e = entityOf(draft, ids[0]);
    if (e?.type === 'circle') {
      const c = ptOf(draft, String(e.c));
      const r = Number(e.r);
      return c && r > 0 ? { kind: 'circle', id: e.id, cId: String(e.c), c, r } : 'app.sketch.hint.pickCurve';
    }
  }
  const p = pathOf(draft, ids);
  return typeof p === 'string' ? p : { kind: 'path', path: p };
}

// ---------------------------------------------------------------- offsetting

/** One offset curve: a shifted line (infinite for joining) or a concentric circle. */
type OCurve = { kind: 'line'; a: Pt; b: Pt } | { kind: 'circle'; c: Pt; r: number };

const leftNormal = (a: Pt, b: Pt): Pt => { const d = sub(b, a); const l = len(d); return { x: -d.y / l, y: d.x / l }; };
const segLen = (s: Seg) => (s.kind === 'line' ? dist(s.a, s.b) : s.r!);

function offsetCurve(s: Seg, delta: number): OCurve {
  if (s.kind === 'line') { const n = scale(leftNormal(s.a, s.b), delta); return { kind: 'line', a: add(s.a, n), b: add(s.b, n) }; }
  return { kind: 'circle', c: s.c!, r: s.ccw ? s.r! - delta : s.r! + delta };
}

/** Unit left normal and unit tangent of the walked segment at one of its ends. */
function frameAt(s: Seg, at: Pt): { n: Pt; t: Pt } {
  if (s.kind === 'line') { const t = scale(sub(s.b, s.a), 1 / dist(s.a, s.b)); return { n: { x: -t.y, y: t.x }, t }; }
  const rad = scale(sub(at, s.c!), 1 / s.r!);
  const t = s.ccw ? { x: -rad.y, y: rad.x } : { x: rad.y, y: -rad.x };
  return { n: { x: -t.y, y: t.x }, t };
}

function lineCircleInf(a: Pt, b: Pt, c: Pt, r: number): Pt[] {
  const d = sub(b, a); const l = len(d);
  const u = scale(d, 1 / l);
  const f = sub(a, c);
  const tc = -dot(f, u);
  const h = Math.abs(cross(f, u));
  const tol = TOL * Math.max(1, r);
  if (Math.abs(h - r) <= tol) return [add(a, scale(u, tc))];
  if (h > r) return [];
  const w = Math.sqrt(r * r - h * h);
  return [add(a, scale(u, tc - w)), add(a, scale(u, tc + w))];
}

const nearest = (pts: Pt[], ref: Pt): Pt | null => pts.length ? pts.reduce((best, p) => (dist(p, ref) < dist(best, ref) ? p : best)) : null;

function projectOnto(o: OCurve, p: Pt): Pt {
  if (o.kind === 'line') { const u = scale(sub(o.b, o.a), 1 / dist(o.a, o.b)); return add(o.a, scale(u, dot(sub(p, o.a), u))); }
  const v = sub(p, o.c); const l = len(v);
  return l < TOL ? { x: o.c.x + o.r, y: o.c.y } : add(o.c, scale(v, o.r / l));
}

/** The corner between two consecutive offset segments. `vertex` is the old corner (or where the dropped part was). */
function joinAt(sa: Seg, sb: Seg, oa: OCurve, ob: OCurve, vertex: Pt, delta: number, adjacent: boolean): Pt | null {
  if (adjacent) {
    const fa = frameAt(sa, vertex), fb = frameAt(sb, vertex);
    if (Math.abs(cross(fa.t, fb.t)) < 1e-6 && dot(fa.t, fb.t) > 0) return add(vertex, scale(fa.n, delta));
  }
  let cands: Pt[];
  if (oa.kind === 'line' && ob.kind === 'line') {
    const r = sub(oa.b, oa.a), s = sub(ob.b, ob.a);
    const den = cross(r, s);
    if (Math.abs(den) <= 1e-9 * len(r) * len(s)) return dot(r, s) > 0 ? projectOnto(oa, vertex) : null;
    cands = [add(oa.a, scale(r, cross(sub(ob.a, oa.a), s) / den))];
  } else if (oa.kind === 'line' && ob.kind === 'circle') cands = lineCircleInf(oa.a, oa.b, ob.c, ob.r);
  else if (oa.kind === 'circle' && ob.kind === 'line') cands = lineCircleInf(ob.a, ob.b, oa.c, oa.r);
  else if (oa.kind === 'circle' && ob.kind === 'circle') cands = circleCircle(oa.c, oa.r, ob.c, ob.r);
  else cands = [];
  return nearest(cands, vertex);
}

export interface Offset {
  /** the surviving segments with their new walking start and end */
  parts: Array<{ seg: Seg; a: Pt; b: Pt; r?: number }>;
  closed: boolean;
  dropped: string[];
}

/** Offset a path by `delta` (positive = left of the walking direction). */
export function offsetPath(path: Path, delta: number): Offset | string {
  let active = path.segs.map((_, i) => i);
  const dropped: string[] = [];
  for (let guard = 0; guard <= path.segs.length; guard++) {
    // arcs that collapse
    const keep = active.filter((i) => { const s = path.segs[i]; return s.kind !== 'arc' || (s.ccw ? s.r! - delta : s.r! + delta) > TOL; });
    if (keep.length !== active.length) {
      for (const i of active) if (!keep.includes(i)) dropped.push(path.segs[i].id);
      active = keep;
      if (!active.length || (path.closed && active.length < 2)) return 'app.sketch.hint.offsetCollapsed';
      continue;
    }
    const m = active.length;
    const segs = active.map((i) => path.segs[i]);
    const oc = segs.map((s) => offsetCurve(s, delta));
    const starts: Pt[] = [], ends: Pt[] = [];
    const nJoin = path.closed ? m : m + 1;
    const verts: Pt[] = [];
    for (let j = 0; j < nJoin; j++) {
      const hasPrev = path.closed || j > 0, hasNext = path.closed || j < m;
      const prev = hasPrev ? (j - 1 + m) % m : -1, next = hasNext ? j % m : -1;
      let v: Pt | null;
      if (prev < 0) { const s = segs[next]; v = projectOnto(oc[next], s.a); if (s.kind === 'line') v = add(s.a, scale(frameAt(s, s.a).n, delta)); }
      else if (next < 0) { const s = segs[prev]; v = s.kind === 'line' ? add(s.b, scale(frameAt(s, s.b).n, delta)) : projectOnto(oc[prev], s.b); }
      else {
        const sp = segs[prev], sn = segs[next];
        const adj = (active[next] - active[prev] + path.segs.length) % path.segs.length === 1;
        const vertex = adj ? sp.b : { x: (sp.b.x + sn.a.x) / 2, y: (sp.b.y + sn.a.y) / 2 };
        v = joinAt(sp, sn, oc[prev], oc[next], vertex, delta, adj);
      }
      if (!v) return dropped.length ? 'app.sketch.hint.offsetCollapsed' : 'app.sketch.hint.offsetNoJoin';
      verts.push(v);
    }
    for (let k = 0; k < m; k++) { starts.push(verts[k]); ends.push(verts[path.closed ? (k + 1) % m : k + 1]); }
    // segments that collapse after joining
    const bad: number[] = [];
    segs.forEach((s, k) => {
      if (s.kind === 'line') { if (dot(sub(ends[k], starts[k]), sub(s.b, s.a)) <= TOL * dist(s.a, s.b)) bad.push(k); return; }
      const o = oc[k] as { kind: 'circle'; c: Pt; r: number };
      const e1 = s.fwd ? starts[k] : ends[k], e2 = s.fwd ? ends[k] : starts[k];
      const orig: ArcG = { kind: 'arc', c: s.c!, r: s.r!, p1: s.fwd ? s.a : s.b, p2: s.fwd ? s.b : s.a };
      const sweepNew = wrap(angleOf(sub(e2, o.c)) - angleOf(sub(e1, o.c))) || TAU;
      if (sweepNew > arcSweep(orig) + Math.PI) bad.push(k);
    });
    if (bad.length) {
      for (const k of bad) dropped.push(segs[k].id);
      active = active.filter((_, k) => !bad.includes(k));
      if (!active.length || (path.closed && active.length < 2)) return 'app.sketch.hint.offsetCollapsed';
      continue;
    }
    return {
      parts: segs.map((seg, k) => ({ seg, a: starts[k], b: ends[k], ...(seg.kind === 'arc' ? { r: (oc[k] as { r: number }).r } : {}) })),
      closed: path.closed, dropped,
    };
  }
  return 'app.sketch.hint.offsetCollapsed';
}

export type OffsetResult =
  | { kind: 'path'; offset: Offset }
  | { kind: 'circle'; c: Pt; r: number; id: string; cId: string; origR: number }
  | { kind: 'spline'; id: string; pts: Pt[]; closed: boolean };

/** Offset an item by a signed distance (positive = left of the walk; a circle is walked counter-clockwise). */
export function offsetItem(item: Item, delta: number): OffsetResult | string {
  if (item.kind === 'spline') {
    const pts = offsetSplinePoints(item.pts, item.closed, delta);
    return typeof pts === 'string' ? pts : { kind: 'spline', id: item.id, pts, closed: item.closed };
  }
  if (item.kind === 'circle') {
    const r = item.r - delta;
    return r > TOL ? { kind: 'circle', c: item.c, r, id: item.id, cId: item.cId, origR: item.r } : 'app.sketch.hint.offsetCollapsed';
  }
  const o = offsetPath(item.path, delta);
  return typeof o === 'string' ? o : { kind: 'path', offset: o };
}

/** Which side of the item the point is on (+1 left, -1 right) and how far it is from it. */
export function sideOf(item: Item, p: Pt): { side: 1 | -1; dist: number } {
  if (item.kind === 'spline') return sideOfSpline(item.pts, item.closed, p);
  if (item.kind === 'circle') { const d = dist(p, item.c); return { side: d <= item.r ? 1 : -1, dist: Math.abs(d - item.r) }; }
  let best = { side: 1 as 1 | -1, dist: Infinity };
  for (const s of item.path.segs) {
    let d: number, side: 1 | -1;
    if (s.kind === 'line') {
      const u = scale(sub(s.b, s.a), 1 / dist(s.a, s.b));
      const t = Math.min(dist(s.a, s.b), Math.max(0, dot(sub(p, s.a), u)));
      d = dist(p, add(s.a, scale(u, t)));
      side = cross(u, sub(p, s.a)) >= 0 ? 1 : -1;
    } else {
      const g: ArcG = { kind: 'arc', c: s.c!, r: s.r!, p1: s.fwd ? s.a : s.b, p2: s.fwd ? s.b : s.a };
      const off = wrap(angleOf(sub(p, g.c)) - angleOf(sub(g.p1, g.c)));
      const on = off <= arcSweep(g) + 1e-9;
      const rad = dist(p, g.c);
      d = on ? Math.abs(rad - g.r) : Math.min(dist(p, g.p1), dist(p, g.p2));
      side = (rad <= g.r) === s.ccw ? 1 : -1;
    }
    if (d < best.dist) best = { side, dist: d };
  }
  return best;
}

const polyShapes = (pts: Pt[], closed: boolean): PreviewShape[] => pts.slice(0, closed ? pts.length : -1).map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % pts.length] }));

function shapesOf(res: OffsetResult): PreviewShape[] {
  if (res.kind === 'spline') return polyShapes(fitCurve(res.pts, res.closed, 12).slice(0, res.closed ? -1 : undefined), res.closed);
  if (res.kind === 'circle') return [{ kind: 'circle', c: res.c, r: res.r }];
  const out: PreviewShape[] = [];
  for (const p of res.offset.parts) {
    if (p.seg.kind === 'line') { out.push({ kind: 'line', a: p.a, b: p.b }); continue; }
    const g: ArcG = { kind: 'arc', c: p.seg.c!, r: p.r!, p1: p.seg.fwd ? p.a : p.b, p2: p.seg.fwd ? p.b : p.a };
    for (const s of sample(g, 0, arcSweep(g))) out.push({ kind: 'line', a: s.a, b: s.b });
  }
  return out;
}

/** A copy keeps the construction flag of its original, except that a copy of projected reference geometry is real geometry. */
const copyFlag = (src: DraftEntity): Record<string, unknown> => (src.construction && !src.ext ? { construction: true } : {});

export type ApplyRes = { ok: true; draft: SketchDraft; created: string[]; dropped: string[] } | { ok: false; hint: string };

/** Write the offset copy of `ids` at the signed distance `delta` (positive = left of the walk). */
export function applyOffset(draft: SketchDraft, ids: string[], delta: number): ApplyRes {
  if (!(Math.abs(delta) > TOL)) return { ok: false, hint: 'app.sketch.hint.degenerate' };
  const item = itemOf(draft, ids);
  if (typeof item === 'string') return { ok: false, hint: item };
  const res = offsetItem(item, delta);
  if (typeof res === 'string') return { ok: false, hint: res };
  const d0 = Math.abs(delta);
  let d = draft;
  const created: string[] = [];
  const radDiff = (orig: string, copy: string, rOrig: number, rCopy: number) => {
    const bigger = rCopy > rOrig;
    d = withConstraint(d, 'raddiff', bigger ? [orig, copy] : [copy, orig], { value: Math.abs(rCopy - rOrig) });
  };
  if (res.kind === 'spline') {
    const src = entityOf(draft, res.id)!;
    const ids: string[] = [];
    for (const at of res.pts) { const p = withPoint(d, at); d = p.draft; ids.push(p.id); created.push(p.id); }
    const e = withEntity(d, { type: 'spline', pts: ids, ...(res.closed ? { closed: true } : {}), ...copyFlag(src) });
    d = e.draft; created.push(e.id);
    return { ok: true, draft: d, created, dropped: [] };
  }
  if (res.kind === 'circle') {
    const src = entityOf(draft, res.id)!;
    const e = withEntity(d, { type: 'circle', c: res.cId, r: res.r, ...copyFlag(src) });
    d = e.draft; created.push(e.id);
    radDiff(res.id, e.id, res.origR, res.r);
    return { ok: true, draft: d, created, dropped: [] };
  }
  const { parts, closed, dropped } = res.offset;
  const m = parts.length;
  const vid: string[] = [];
  const nv = closed ? m : m + 1;
  for (let j = 0; j < nv; j++) {
    const at = j < m ? parts[j].a : parts[m - 1].b;
    const p = withPoint(d, at);
    d = p.draft; vid.push(p.id); created.push(p.id);
  }
  parts.forEach((part, k) => {
    const s = part.seg;
    const startId = vid[k], endId = vid[closed ? (k + 1) % m : k + 1];
    const src = entityOf(draft, s.id)!;
    const flag = copyFlag(src);
    const p1 = s.fwd ? startId : endId, p2 = s.fwd ? endId : startId;
    if (s.kind === 'line') {
      const e = withEntity(d, { type: 'line', p1, p2, ...flag });
      d = e.draft; created.push(e.id);
      d = withConstraint(d, 'parallel', [s.id, e.id]);
      d = withConstraint(d, 'pldist', [p1, s.id], { value: d0 });
    } else {
      const e = withEntity(d, { type: 'arc', c: s.cId, p1, p2, ...flag });
      d = e.draft; created.push(e.id);
      radDiff(s.id, e.id, s.r!, part.r!);
    }
  });
  return { ok: true, draft: d, created, dropped };
}

// ---------------------------------------------------------------- reference outlines

/** Is the closed item walked counter-clockwise (then its left side is the inside)? Null for an open one. */
export function leftIsInside(item: Item): boolean | null {
  if (item.kind === 'circle') return true;
  if (item.kind === 'spline') return item.closed ? signedArea(sampleSpline(item.pts, true, 8)) > 0 : null;
  if (!item.path.closed) return null;
  const poly: Pt[] = [];
  for (const s of item.path.segs) {
    poly.push(s.a);
    if (s.kind === 'arc') {
      const g: ArcG = { kind: 'arc', c: s.c!, r: s.r!, p1: s.fwd ? s.a : s.b, p2: s.fwd ? s.b : s.a };
      const a0 = angleOf(sub(s.a, s.c!));
      const sw = arcSweep(g);
      for (let k = 1; k < 8; k++) { const a = a0 + (s.ccw ? 1 : -1) * (sw * k) / 8; poly.push({ x: s.c!.x + s.r! * Math.cos(a), y: s.c!.y + s.r! * Math.sin(a) }); }
    }
  }
  return signedArea(poly) > 0;
}

/** The reference chain under `at`: the body edge nearest the pointer and the outline it belongs to. */
function referenceAt(env: ToolEnv | undefined, at: Pt) {
  if (!env?.body) return null;
  const edge = edgeNear(env, at);
  return edge ? referenceChain(env, edge) : null;
}

/** The outer boundary of the face the sketch is on (the selected face's edges, joined into outlines; the one with the
 *  biggest extent is the outer loop). Null when no face boundary is known. */
export function faceOuterLoop(env: ToolEnv | undefined) {
  if (!env?.body || !env.selection?.length) return null;
  const mine = edgesFor(env.body.edges, env.selection).filter((e) => flatten(env.body!.frame, e.pts).off <= 1e-4);
  const seen = new Set<unknown>();
  let best: { chain: ReturnType<typeof referenceChain>; area: number } | null = null;
  for (const e of mine) {
    if (seen.has(e)) continue;
    const chain = referenceChain(env, e);
    for (const c of chain) seen.add(c.edge);
    const pts = chain.flatMap((c) => c.pts);
    if (!pts.length) continue;
    const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
    if (!best || area > best.area) best = { chain, area };
  }
  return best?.chain ?? null;
}

// ---------------------------------------------------------------- the tool

export interface OffsetState {
  phase: 'pick' | 'side';
  selected: string[];
  /** typed and committed distance */
  locked?: number;
  /** typed, uncommitted distance (the face-outline flow starts with the default here) */
  live?: number;
  /** from the pointer: its side of the chain and distance from it */
  side?: 1 | -1;
  dist?: number;
  /** a side chosen on purpose (the face-outline flow's inside, or the flip key): the pointer no longer changes it */
  fixedSide?: 1 | -1;
}

/** The distance the face-outline flow offers (inward). */
export const DEFAULT_FACE_OFFSET = 1;

const typed = (s: OffsetState) => s.locked ?? s.live;
const distanceOf = (s: OffsetState) => typed(s) ?? s.dist ?? 0;
const sideNow = (s: OffsetState) => s.fixedSide ?? s.side;

const eligible = (e: DraftEntity | undefined): e is DraftEntity => !!e && (isChainEntity(e) || e.type === 'circle' || e.type === 'spline');
const chainFor = (draft: SketchDraft, e: DraftEntity): string[] => (isChainEntity(e) ? chainOf(draft, e.id) : [e.id]);

function highlight(draft: SketchDraft, ids: string[]): PreviewShape[] {
  return ids.flatMap((id) => {
    const e = entityOf(draft, id);
    if (e?.type === 'spline') {
      const it = itemOf(draft, [id]);
      return typeof it !== 'string' && it.kind === 'spline' ? polyShapes(sampleSpline(it.pts, it.closed, 12), it.closed) : [];
    }
    return entityShape(draft, id) as PreviewShape[];
  });
}

function view(state: OffsetState, draft: SketchDraft, settings: ToolSettings, hint?: string, extra: PreviewShape[] = []): ToolOutput<OffsetState> {
  let preview: PreviewShape[] = [...highlight(draft, state.selected), ...extra];
  let h = hint;
  if (state.phase === 'side') {
    const item = itemOf(draft, state.selected);
    const dd = distanceOf(state);
    const side = sideNow(state);
    if (typeof item !== 'string' && side && dd > TOL) {
      const res = offsetItem(item, side * dd);
      if (typeof res === 'string') h = h ?? res;
      else {
        preview = [...shapesOf(res), ...extra];
        if (res.kind === 'path' && res.offset.dropped.length) h = h ?? 'app.sketch.hint.offsetDropped';
      }
    }
  }
  const fields: FieldSpec[] = settings.onViewValues === 'off' || state.phase !== 'side' ? [] :
    [{ id: 'd', label: 'app.sketch.field.distance', value: distanceOf(state), locked: state.locked !== undefined, unit: 'length' }];
  return { state, draft, preview, fields, ...(h ? { hint: h } : {}) };
}

function commit(state: OffsetState, draft: SketchDraft, settings: ToolSettings, side: 1 | -1, dd: number): ToolOutput<OffsetState> {
  const r = applyOffset(draft, state.selected, side * dd);
  if (!r.ok) return view(state, draft, settings, r.hint);
  const next: OffsetState = { phase: 'pick', selected: [] };
  return view(next, r.draft, settings, r.dropped.length ? 'app.sketch.hint.offsetDropped' : undefined);
}

/** Project a reference outline into the sketch (a real, fixed outline: it is what the offset is measured from and what a ring is
 *  cut between) and select it. */
function pickReference(state: OffsetState, draft: SketchDraft, settings: ToolSettings, chain: NonNullable<ReturnType<typeof referenceAt>>, extraState: Partial<OffsetState> = {}): ToolOutput<OffsetState> {
  const r = projectCurves(draft, chainCurves(chain), { construction: false });
  if (!r.ids.length) return view(state, draft, settings, 'app.sketch.hint.nothingProjected');
  const next: OffsetState = { ...state, selected: r.ids, ...extraState };
  const item = itemOf(r.draft, r.ids);
  return view(next, r.draft, settings, typeof item === 'string' ? item : undefined);
}

export const offsetTool: Tool<OffsetState> = {
  id: 'offset',
  start: () => ({ phase: 'pick', selected: [] }),
  step(state, ev, draft, settings, env) {
    switch (ev.type) {
      case 'move': {
        if (state.phase !== 'side') {
          const id = ev.snap?.entityId;
          const e = id ? entityOf(draft, id) : undefined;
          if (eligible(e)) return view(state, draft, settings, undefined, highlight(draft, chainFor(draft, e)));
          const chain = referenceAt(env, ev.at);
          if (chain) return view(state, draft, settings, 'app.sketch.hint.offsetReference', chainCurves(chain).flatMap((c) => (c ? projectedShapes(c) : [])));
          return view(state, draft, settings);
        }
        const item = itemOf(draft, state.selected);
        if (typeof item === 'string') return view(state, draft, settings, item);
        const s = sideOf(item, ev.at);
        return view({ ...state, side: s.side, dist: s.dist }, draft, settings);
      }
      case 'click': {
        if (state.phase === 'pick') {
          const id = ev.snap?.entityId;
          const e = id ? entityOf(draft, id) : undefined;
          if (!eligible(e)) {
            const chain = referenceAt(env, ev.at);
            if (chain) return pickReference(state, draft, settings, chain);
            return view(state, draft, settings, env?.body ? 'app.sketch.hint.pickCurveOrEdge' : 'app.sketch.hint.pickCurve');
          }
          if (ev.mods.shift && isChainEntity(e)) {
            const selected = state.selected.includes(e.id) ? state.selected.filter((x) => x !== e.id) : [...state.selected, e.id];
            const ok = !selected.length || typeof pathOf(draft, selected) !== 'string';
            return ok ? view({ ...state, selected }, draft, settings) : view(state, draft, settings, 'app.sketch.hint.offsetBranch');
          }
          const chain = chainFor(draft, e);
          const same = chain.length === state.selected.length && chain.every((c) => state.selected.includes(c));
          return view({ ...state, selected: same ? [] : chain }, draft, settings);
        }
        const item = itemOf(draft, state.selected);
        if (typeof item === 'string') return view(state, draft, settings, item);
        const s = sideOf(item, ev.snap?.at ?? ev.at);
        const dd = typed(state) ?? s.dist;
        return commit(state, draft, settings, state.fixedSide ?? s.side, dd);
      }
      case 'field': {
        if (state.phase !== 'side' || ev.id !== 'd') return view(state, draft, settings);
        if (ev.value === null || !Number.isFinite(ev.value)) return view({ ...state, locked: undefined, live: undefined }, draft, settings);
        if (ev.value <= 0) return view(state, draft, settings, 'app.sketch.hint.degenerate');
        if (ev.commit) {
          const next = { ...state, locked: ev.value, live: undefined };
          const side = sideNow(next);
          return side ? commit(next, draft, settings, side, ev.value) : view(next, draft, settings);
        }
        return view({ ...state, live: ev.value }, draft, settings);
      }
      case 'key': {
        if (ev.key === OFFSET_FACE_KEY) {
          // "Offset the face outline": nothing picked yet and the sketch is on a face: take its outer loop, inward, by the default
          if (state.phase !== 'pick' || state.selected.length) return view(state, draft, settings);
          const chain = faceOuterLoop(env);
          if (!chain) return view(state, draft, settings, env?.body ? 'app.sketch.hint.noFaceOutline' : undefined);
          const picked = pickReference(state, draft, settings, chain);
          const item = itemOf(picked.draft, picked.state.selected);
          if (typeof item === 'string') return picked;
          const inside = leftIsInside(item);
          const side: 1 | -1 = inside === false ? -1 : 1;
          return view({ phase: 'side', selected: picked.state.selected, side, fixedSide: side, live: DEFAULT_FACE_OFFSET }, picked.draft, settings, 'app.sketch.hint.offsetFaceOutline');
        }
        if ((ev.key === 'f' || ev.key === 'F') && state.phase === 'side') {
          const cur = sideNow(state);
          return view({ ...state, fixedSide: cur ? (cur === 1 ? -1 : 1) : 1 }, draft, settings);
        }
        if (ev.key === 'Enter') {
          if (state.phase === 'pick') {
            if (!state.selected.length) return view(state, draft, settings, 'app.sketch.hint.nothingToOffset');
            const item = itemOf(draft, state.selected);
            return typeof item === 'string' ? view(state, draft, settings, item) : view({ ...state, phase: 'side' }, draft, settings);
          }
          const dd = distanceOf(state);
          const side = sideNow(state);
          return side && dd > TOL ? commit(state, draft, settings, side, dd) : view(state, draft, settings);
        }
        if (ev.key === 'Escape') {
          if (typed(state) !== undefined) return view({ ...state, locked: undefined, live: undefined }, draft, settings);
          return view({ phase: 'pick', selected: state.phase === 'side' ? state.selected : [] }, draft, settings);
        }
        return view(state, draft, settings);
      }
    }
  },
};

/** The synthetic key the app sends when Offset is chosen with a face selected as the sketch plane. */
export const OFFSET_FACE_KEY = '@offsetFace';
