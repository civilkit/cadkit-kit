// The size box (IronCAD's "size box"): select a SHAPE (an extrude / cut / revolve / hole feature with its sketch) and a
// wireframe box of its profile and depth is always shown, with a drag handle on each face centre (width, length and
// height / depth, each along its own axis, both directions), a handle on each corner of the cap, an ANCHOR marker at
// the shape's sketch origin and floating number labels. Dragging a handle resizes live through the preview path;
// releasing is ONE edit. The edit is written to what the shape is made of: the sketch (its points, circle radii and
// the dimension constraints that go with them, so the sketch stays consistent) and the feature's depth / diameter.
//
// Pure: the document, the sketch frame and the body box go in, a HandleSession comes out (planSizeBox); the numbers
// (boxFor, opsFor, layout) are exported so they are tested without a kernel. The sketch's u / v / depth axes are the
// frame's x / y / z; "width" is along u, "length" along v, "height" along the extrusion.
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { V, type HandleSpec, type Vec3 } from '@kit/viewport';
import { sketchShapes } from '@kit/sketch';
import { holeDiameter, kindOf } from '../holeData';
import { faceNames } from '../featureCommands';
import { t } from '../i18n';
import { MIN_SIZE, type HandleCommit, type HandleSession } from './session';
import { gridStep, moveCandidates, NO_CANDS, resolveMove, type MoveCands, type MoveMods, type MovePoint, type MoveResult } from './move';
import type { EdgeLike } from '../catalog/geometry';

type Wire = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any

/** How a face drag resizes: the other face stays (opposite), both move (symmetric), or the shape scales about the anchor. */
export type AboutMode = 'opposite' | 'symmetric' | 'anchor';
export const ABOUT_MODES: AboutMode[] = ['anchor', 'symmetric', 'opposite'];
export const DEFAULT_ABOUT: AboutMode = 'opposite';

export interface Frame3 { o: Vec3; x: Vec3; y: Vec3; z: Vec3 }
/** The box in the sketch frame: u along x, v along y, d along z (the extrusion). */
export interface Box { u0: number; u1: number; v0: number; v1: number; d0: number; d1: number }
export const SHAPE_TYPES = ['extrude', 'revolve', 'hole'] as const;

const EPS = 1e-9;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const feats = (doc: PartDoc | null): Wire[] => (doc?.features ?? []) as unknown as Wire[];
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

// ---- which feature the selection stands for ----

export const isShapeFeature = (doc: PartDoc | null, id: string | null): boolean => !!id && feats(doc).some((f) => f.id === id && (SHAPE_TYPES as readonly string[]).includes(f.type));

/** The shape feature a face name (`F2.C1`, `H1.S.h1`, `F2.S.e1~0`) belongs to, or null. */
export function ownerShape(doc: PartDoc | null, face: string): string | null {
  const i = face.indexOf('.');
  if (i <= 0) return null;
  const id = face.slice(0, i);
  return isShapeFeature(doc, id) ? id : null;
}

/**
 * The shape the selection selects: the faces of one shape feature (picked in the viewport), or the shape row picked
 * in the history tree when nothing is picked in the viewport. Edge and corner picks are NOT a shape selection (they
 * keep the fillet / chamfer dot), nor is the whole-body pick.
 */
export function shapeSelection(doc: PartDoc | null, selection: string[], mode: string, treeId: string | null): string | null {
  if (!doc) return null;
  if (selection.includes(BODY)) return null;
  if (!selection.length) return isShapeFeature(doc, treeId) ? treeId : null;
  if (mode === 'edge' || mode === 'vertex') return null;
  const faces = faceNames(selection);
  if (!faces.length || faces.length !== selection.length) return null;
  const owners = new Set(faces.map((f) => ownerShape(doc, f)));
  return owners.size === 1 && !owners.has(null) ? [...owners][0] : null;
}

// ---- the profile of a shape: its closed outlines in the sketch ----

interface Profile {
  pointIds: Set<string>;
  entityIds: Set<string>;
  box: { u0: number; u1: number; v0: number; v1: number };
  /** The outline has circles, arcs or ellipses: only a uniform scale keeps it what it is. */
  round: boolean;
}

function profileOf(sk: Wire, regions: unknown): Profile | null {
  const shapes = sketchShapes(sk as never);
  const want = Array.isArray(regions) ? new Set(regions.map(String)) : null;
  const chosen = want ? shapes.filter((s) => want.has(s.id)) : shapes;
  const entityIds = new Set(chosen.flatMap((s) => s.entityIds));
  if (!entityIds.size) return null;
  const pts = new Map<string, { x: number; y: number }>((sk.points ?? []).map((p: Wire) => [p.id, p]));
  const pointIds = new Set<string>();
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  let round = false;
  const add = (x: number, y: number) => { u0 = Math.min(u0, x); u1 = Math.max(u1, x); v0 = Math.min(v0, y); v1 = Math.max(v1, y); };
  const addPt = (id: unknown): { x: number; y: number } | null => { const p = pts.get(String(id)); if (!p) return null; pointIds.add(String(id)); add(p.x, p.y); return p; };
  for (const e of sk.entities ?? []) {
    if (!entityIds.has(e.id)) continue;
    if (e.type === 'circle') {
      round = true;
      const c = addPt(e.c); const r = num(e.r);
      if (c && r !== null) { add(c.x - r, c.y - r); add(c.x + r, c.y + r); }
    } else if (e.type === 'arc') {
      round = true;
      const c = addPt(e.c), a = addPt(e.p1), b = addPt(e.p2);
      if (c && a && b) {
        const r = Math.hypot(a.x - c.x, a.y - c.y);
        const a0 = Math.atan2(a.y - c.y, a.x - c.x);
        const sweep = ((Math.atan2(b.y - c.y, b.x - c.x) - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
        for (let k = 0; k < 4; k++) {
          const th = (k * Math.PI) / 2;
          if ((((th - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) <= sweep) add(c.x + r * Math.cos(th), c.y + r * Math.sin(th));
        }
      }
    } else if (e.type === 'ellipse') {
      round = true;
      const c = addPt(e.c), p = addPt(e.p); const r = num(e.r);
      if (c && p && r !== null) { const R = Math.max(Math.hypot(p.x - c.x, p.y - c.y), r); add(c.x - R, c.y - R); add(c.x + R, c.y + R); }
    } else if (Array.isArray(e.pts)) for (const id of e.pts) addPt(id);
    else { addPt(e.p1); addPt(e.p2); addPt(e.p); }
  }
  if (!Number.isFinite(u0)) return null;
  return { pointIds, entityIds, box: { u0, u1, v0, v1 }, round };
}

// ---- the shape ----

export interface Shape {
  id: string;
  kind: 'extrude' | 'revolve' | 'hole';
  frame: Frame3;
  sketch: Wire;
  profile: Profile | null;
  box: Box;
  /** The anchor in the sketch plane: the sketch origin (a hole: its centre). */
  anchor: { u: number; v: number };
  /** Direction of the extrusion along the frame's z. */
  dir: 1 | -1;
  /** How the depth is held: a blind depth, a mid-plane (symmetric) total, or not editable. */
  depth: 'blind' | 'mid' | null;
  /** The hole's centre point in its sketch, and whether its diameter can be edited here. */
  hole?: { pointId: string; editable: boolean };
  /** Resizing keeps width and length equal (a circle, an arc profile, a hole). */
  uniform: boolean;
  /** The sketch has no editable profile: width and length are shown only. */
  sizeEditable: boolean;
  /** Other features that use the same sketch (moving it moves them too). */
  sharedWith: string[];
}

/** Depth range of an open-ended shape (through, up to ...): the body's extent along the extrusion. */
function reach(frame: Frame3, box: { min: number[]; max: number[] } | null, dir: 1 | -1, fallback: number): number {
  if (!box) return fallback;
  let m = 0;
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) {
    m = Math.max(m, dir * V.dot(V.sub([x, y, z], frame.o), frame.z));
  }
  return m > EPS ? m : fallback;
}

export function shapeModel(doc: PartDoc | null, id: string, frameOf: (sketchId: string) => Frame3 | null, bodyBox: { min: number[]; max: number[] } | null): Shape | null {
  const f = feats(doc).find((x) => x.id === id);
  if (!f || !(SHAPE_TYPES as readonly string[]).includes(f.type) || typeof f.sketch !== 'string') return null;
  const sketch = feats(doc).find((x) => x.id === f.sketch && x.type === 'sketch');
  const frame = frameOf(f.sketch);
  if (!sketch || !frame) return null;
  if (f.type === 'hole') {
    const pe = (sketch.entities ?? []).find((e: Wire) => e.type === 'point');
    const p = pe ? (sketch.points ?? []).find((q: Wire) => q.id === pe.p) : null;
    const d = holeDiameter(f);
    if (!p || d === null) return null;
    const dir: 1 | -1 = f.flip ? 1 : -1;
    const blind = f.end === 'blind' && num(f.depth) !== null && f.depth > 0;
    const len = blind ? (f.depth as number) : reach(frame, bodyBox, dir, 10);
    const editable = kindOf(f) === 'simple';
    return {
      id, kind: 'hole', frame, sketch, profile: null,
      box: { u0: p.x - d / 2, u1: p.x + d / 2, v0: p.y - d / 2, v1: p.y + d / 2, d0: Math.min(0, dir * len), d1: Math.max(0, dir * len) },
      anchor: { u: p.x, v: p.y }, dir, depth: blind ? 'blind' : null, hole: { pointId: p.id, editable }, uniform: true, sizeEditable: editable, sharedWith: usersOf(doc, sketch.id, id),
    };
  }
  const profile = profileOf(sketch, f.regions);
  if (!profile) return null;
  const dir: 1 | -1 = f.type === 'extrude' && f.flip ? -1 : 1;
  let d0 = 0, d1 = 0;
  let depth: Shape['depth'] = null;
  if (f.type === 'extrude') {
    const dv = num(f.depth);
    if ((f.end ?? 'blind') === 'blind' && dv !== null && dv > 0) { depth = 'blind'; d0 = Math.min(0, dir * dv); d1 = Math.max(0, dir * dv); }
    else if (f.end === 'mid' && dv !== null && dv > 0) { depth = 'mid'; d0 = -dv / 2; d1 = dv / 2; }
    else { const r = reach(frame, bodyBox, dir, 10); d0 = Math.min(0, dir * r); d1 = Math.max(0, dir * r); }
  }
  return {
    id, kind: f.type, frame, sketch, profile,
    // the anchor is the profile's own reference point (its footprint centre): it moves with the profile, not the fixed sketch origin
    box: { ...profile.box, d0, d1 }, anchor: { u: (profile.box.u0 + profile.box.u1) / 2, v: (profile.box.v0 + profile.box.v1) / 2 }, dir, depth, uniform: profile.round, sizeEditable: true, sharedWith: usersOf(doc, sketch.id, id),
  };
}

/** The other features (not sketches) that read this sketch. */
export const usersOf = (doc: PartDoc | null, sketchId: string, except: string): string[] =>
  feats(doc).filter((f) => f.type !== 'sketch' && f.sketch === sketchId && f.id !== except).map((f) => f.id as string);

// ---- the numbers of a resize ----

type Side = 'lo' | 'hi';

/** New [lo, hi] of one axis when the dimension becomes `dim`, the dragged face being `side`. */
export function sizeAxis(lo: number, hi: number, side: Side, dim: number, mode: AboutMode, anchor: number): [number, number] {
  const w = hi - lo;
  if (mode === 'symmetric') { const c = (lo + hi) / 2; return [c - dim / 2, c + dim / 2]; }
  if (mode === 'anchor' && w > EPS) { const k = dim / w; return [anchor + (lo - anchor) * k, anchor + (hi - anchor) * k]; }
  return side === 'hi' ? [lo, lo + dim] : [hi - dim, hi];   // from the opposite face (also the fallback for a zero-size axis)
}

/** How far a face moves per unit of the dimension, so the face follows the pointer: 1 / 2 / the anchor's lever. */
export function faceScale(lo: number, hi: number, side: Side, mode: AboutMode, anchor: number): number {
  if (mode === 'symmetric') return 2;
  if (mode === 'anchor') {
    const w = hi - lo;
    const lever = Math.abs((side === 'hi' ? hi : lo) - anchor);
    return w > EPS && lever > EPS ? w / Math.max(lever, 0.1 * w) : 1;
  }
  return 1;
}

export interface Drag { u?: { side: Side; dim: number }; v?: { side: Side; dim: number } }

/** The box after a width / length drag. A uniform shape (circle, hole, arcs) scales both ways by one factor. */
export function boxFor(shape: Shape, drag: Drag, mode: AboutMode): Box {
  const b = shape.box;
  const W = b.u1 - b.u0, L = b.v1 - b.v0;
  let ud = drag.u, vd = drag.v;
  let mu = mode, mv = mode;
  if (shape.uniform) {
    const ks: number[] = [];
    if (ud && W > EPS) ks.push(ud.dim / W);
    if (vd && L > EPS) ks.push(vd.dim / L);
    const k = ks.length ? ks.reduce((a, x) => a + x, 0) / ks.length : 1;
    if (!ud) mu = mode === 'anchor' ? 'anchor' : 'symmetric';
    if (!vd) mv = mode === 'anchor' ? 'anchor' : 'symmetric';
    ud = { side: ud?.side ?? 'hi', dim: W * k };
    vd = { side: vd?.side ?? 'hi', dim: L * k };
  }
  const out = { ...b };
  if (ud) [out.u0, out.u1] = sizeAxis(b.u0, b.u1, ud.side, ud.dim, mu, shape.anchor.u);
  if (vd) [out.v0, out.v1] = sizeAxis(b.v0, b.v1, vd.side, vd.dim, mv, shape.anchor.v);
  return out;
}

/** The box after a depth drag (`dim` is the new depth, or the total for a mid-plane shape). */
export function depthBox(shape: Shape, dim: number): Box {
  const b = { ...shape.box };
  if (shape.depth === 'mid') { b.d0 = -dim / 2; b.d1 = dim / 2; }
  else if (shape.dir > 0) { b.d0 = 0; b.d1 = dim; }
  else { b.d0 = -dim; b.d1 = 0; }
  return b;
}

export const shiftBox = (b: Box, du: number, dv: number): Box => ({ ...b, u0: b.u0 + du, u1: b.u1 + du, v0: b.v0 + dv, v1: b.v1 + dv });

// ---- editing the sketch ----

const mapper = (oldLo: number, oldHi: number, newLo: number, newHi: number) => {
  const w = oldHi - oldLo;
  if (w < EPS) return (c: number) => c + (newLo - oldLo);
  const k = (newHi - newLo) / w;
  return (c: number) => newLo + (c - oldLo) * k;
};

export interface SketchEdit { sketch: Wire; dropped: string[] }

/**
 * The sketch with the profile's points mapped from the old box to the new one, circle radii scaled, and its dimension
 * constraints brought up to date (a distance, hdist, vdist, radius, diameter, pldist or fix constraint takes the new
 * value; a geometric constraint the new coordinates break is dropped and named in `dropped`). Null when a fixed point
 * would have to move.
 */
export function transformSketch(sketch: Wire, profile: Profile, from: Box, to: Box): SketchEdit | null {
  const fu = mapper(from.u0, from.u1, to.u0, to.u1);
  const fv = mapper(from.v0, from.v1, to.v0, to.v1);
  const k = Math.abs((to.u1 - to.u0) > EPS && (from.u1 - from.u0) > EPS ? (to.u1 - to.u0) / (from.u1 - from.u0) : (to.v1 - to.v0) > EPS && (from.v1 - from.v0) > EPS ? (to.v1 - to.v0) / (from.v1 - from.v0) : 1);
  const out = structuredClone(sketch) as Wire;
  const moved = new Set<string>();
  for (const p of out.points ?? []) {
    if (!profile.pointIds.has(p.id)) continue;
    const nx = fu(p.x), ny = fv(p.y);
    if (Math.abs(nx - p.x) < EPS && Math.abs(ny - p.y) < EPS) continue;
    if (p.fixed) return null;
    p.x = round3(nx); p.y = round3(ny);
    moved.add(p.id);
  }
  const touched = new Set<string>(moved);
  for (const e of out.entities ?? []) {
    if (!profile.entityIds.has(e.id)) continue;
    if ((e.type === 'circle' || e.type === 'ellipse') && num(e.r) !== null && Math.abs(k - 1) > EPS) { e.r = round3(e.r * k); touched.add(e.id); }
    for (const id of [e.p1, e.p2, e.c, e.p, ...(e.pts ?? [])]) if (moved.has(id)) touched.add(e.id);
  }
  const pt = new Map<string, Wire & { x: number; y: number }>((out.points ?? []).map((p: Wire) => [p.id, p]));
  const ent = new Map<string, Wire>((out.entities ?? []).map((e: Wire) => [e.id, e]));
  const at = (id: string): { x: number; y: number } | null => {
    const p = pt.get(id); if (p) return p;
    const e = ent.get(id);
    if (!e) return null;
    return pt.get(e.type === 'point' ? e.p : e.c) ?? null;
  };
  const ends = (id: string): [{ x: number; y: number }, { x: number; y: number }] | null => {
    const e = ent.get(id); const a = e ? pt.get(e.p1) : null; const b = e ? pt.get(e.p2) : null;
    return a && b ? [a, b] : null;
  };
  const radiusOf = (id: string): number | null => {
    const e = ent.get(id); if (!e) return null;
    if (e.type === 'circle') return num(e.r);
    const c = pt.get(e.c), a = pt.get(e.p1);
    return c && a ? Math.hypot(a.x - c.x, a.y - c.y) : null;
  };
  const dropped: string[] = [];
  const keep: Wire[] = [];
  for (const c of out.constraints ?? []) {
    const refs: string[] = c.refs ?? [];
    if (!refs.some((r) => touched.has(r))) { keep.push(c); continue; }
    const tol = 1e-6;
    let ok = true;
    if (c.type === 'distance' || c.type === 'hdist' || c.type === 'vdist') {
      const a = at(refs[0]), b = at(refs[1]);
      if (a && b) c.value = round3(c.type === 'distance' ? Math.hypot(b.x - a.x, b.y - a.y) : c.type === 'hdist' ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y));
    } else if (c.type === 'radius' || c.type === 'diameter') {
      const r = radiusOf(refs[0]);
      if (r !== null) c.value = round3(c.type === 'radius' ? r : 2 * r);
    } else if (c.type === 'pldist') {
      const a = at(refs[0]), l = ends(refs[1]);
      if (a && l) { const dx = l[1].x - l[0].x, dy = l[1].y - l[0].y, n = Math.hypot(dx, dy); if (n > EPS) c.value = round3(Math.abs((a.x - l[0].x) * dy - (a.y - l[0].y) * dx) / n); }
    } else if (c.type === 'fix') {
      const a = at(refs[0]);
      if (a) c.value = [a.x, a.y];
    } else if (c.type === 'horizontal' || c.type === 'vertical') {
      const l = refs.length === 1 ? ends(refs[0]) : (() => { const a = at(refs[0]), b = at(refs[1]); return a && b ? ([a, b] as const) : null; })();
      if (l) ok = (c.type === 'horizontal' ? Math.abs(l[1].y - l[0].y) : Math.abs(l[1].x - l[0].x)) < tol;
    } else if (c.type === 'coincident' || c.type === 'concentric') {
      const a = at(refs[0]), b = at(refs[1]);
      if (a && b) ok = Math.hypot(a.x - b.x, a.y - b.y) < tol;
    } else if (c.type === 'equal') {
      const a = ends(refs[0]), b = ends(refs[1]);
      if (a && b) ok = Math.abs(Math.hypot(a[1].x - a[0].x, a[1].y - a[0].y) - Math.hypot(b[1].x - b[0].x, b[1].y - b[0].y)) < tol;
      else { const ra = radiusOf(refs[0]), rb = radiusOf(refs[1]); if (ra !== null && rb !== null) ok = Math.abs(ra - rb) < tol; }
    } else if (c.type === 'parallel' || c.type === 'perpendicular') {
      const a = ends(refs[0]), b = ends(refs[1]);
      if (a && b) {
        const ax = a[1].x - a[0].x, ay = a[1].y - a[0].y, bx = b[1].x - b[0].x, by = b[1].y - b[0].y;
        const n = Math.hypot(ax, ay) * Math.hypot(bx, by) || 1;
        ok = (c.type === 'parallel' ? Math.abs(ax * by - ay * bx) : Math.abs(ax * bx + ay * by)) / n < tol;
      }
    } else if (c.type === 'midpoint') {
      const a = at(refs[0]), l = ends(refs[1]);
      if (a && l) ok = Math.hypot(a.x - (l[0].x + l[1].x) / 2, a.y - (l[0].y + l[1].y) / 2) < 1e-4;
    }
    if (ok) keep.push(c); else dropped.push(c.id);
  }
  out.constraints = keep;
  return { sketch: out, dropped };
}

/**
 * The sketch with the shape's whole profile shifted by (du, dv): its outline points, the points of its construction geometry
 * (a revolve axis) and the dimension constraints that follow. A fixed point moves too (its `fix` value is updated): moving a
 * shape is not resizing it, so a pinned corner goes with the shape.
 */
export function translateSketch(shape: Shape, du: number, dv: number): SketchEdit | null {
  const profile = shape.profile;
  if (!profile) return null;
  const ids = new Set(profile.pointIds);
  const ents = new Set(profile.entityIds);
  for (const e of shape.sketch.entities ?? []) if (e.construction && !e.ext) { ents.add(e.id);   // projected reference geometry (ext) stays where the body is
 for (const id of [e.p1, e.p2, e.c, e.p, ...(e.pts ?? [])]) if (typeof id === 'string') ids.add(id); }
  const pinned = new Set<string>((shape.sketch.points ?? []).filter((p: Wire) => p.fixed && ids.has(p.id)).map((p: Wire) => p.id));
  const free = structuredClone(shape.sketch) as Wire;
  for (const p of free.points ?? []) if (pinned.has(p.id)) delete p.fixed;
  const b = shape.box;
  const r = transformSketch(free, { ...profile, pointIds: ids, entityIds: ents }, b, shiftBox(b, du, dv));
  if (!r) return null;
  for (const p of r.sketch.points ?? []) if (pinned.has(p.id)) p.fixed = true;
  return r;
}

// ---- the ops a box stands for ----

const same = (a: number, b: number): boolean => Math.abs(a - b) < EPS;

/** The edit that takes the shape from its box to `to`: the sketch and the depth / diameter. Null when nothing changes or it cannot be done. */
export function opsFor(shape: Shape, to: Box): { ops: EditOp[]; dropped: string[] } | null {
  const from = shape.box;
  const ops: EditOp[] = [];
  let dropped: string[] = [];
  const uv = !same(from.u0, to.u0) || !same(from.u1, to.u1) || !same(from.v0, to.v0) || !same(from.v1, to.v1);
  const set = (path: string, value: unknown): void => { ops.push({ op: 'set', id: shape.id, path, value } as EditOp); };
  if (shape.kind === 'hole') {
    const D = to.u1 - to.u0;
    const cu = (to.u0 + to.u1) / 2, cv = (to.v0 + to.v1) / 2;
    if (uv && shape.hole) {
      if (shape.hole.editable && Math.abs(D - (from.u1 - from.u0)) > EPS) set('diameter', round3(D));
      if (!same(cu, shape.anchor.u) || !same(cv, shape.anchor.v)) {
        const sk = structuredClone(shape.sketch) as Wire;
        const p = (sk.points ?? []).find((q: Wire) => q.id === shape.hole!.pointId);
        if (!p || p.fixed) return null;
        p.x = round3(cu); p.y = round3(cv);
        ops.push({ op: 'replace', id: sk.id, feature: sk } as EditOp);
      }
    }
  } else if (uv) {
    if (!shape.profile) return null;
    const pure = same(to.u1 - to.u0, from.u1 - from.u0) && same(to.v1 - to.v0, from.v1 - from.v0);
    const r = pure ? translateSketch(shape, to.u0 - from.u0, to.v0 - from.v0) : transformSketch(shape.sketch, shape.profile, from, to);
    if (!r) return null;
    dropped = r.dropped;
    ops.push({ op: 'replace', id: shape.sketch.id, feature: r.sketch } as EditOp);
  }
  const dFrom = from.d1 - from.d0, dTo = to.d1 - to.d0;
  if (shape.depth && Math.abs(dTo - dFrom) > EPS) set('depth', round3(dTo));
  return ops.length ? { ops, dropped } : null;
}

// ---- drawing: the specs for a box ----

const AXIS_COLOUR = { u: '#e5484d', v: '#30a46c', d: '#3e63dd' } as const;
const BOX_COLOUR = '#4da3ff';
const ANCHOR_COLOUR = '#f5a623';
const MOVE_COLOUR = '#d6409f';
const GHOST_COLOUR = '#9aa7b5';
/** Below these on-screen spans (pixels) the handles that would crowd the move pad hide until the view is zoomed in. */
const FACE_MIN_PX = 90, CORNER_MIN_PX = 100, DEPTH_MIN_PX = 50;

export function worldOf(f: Frame3, u: number, v: number, d: number): Vec3 {
  return [f.o[0] + f.x[0] * u + f.y[0] * v + f.z[0] * d, f.o[1] + f.x[1] * u + f.y[1] * v + f.z[1] * d, f.o[2] + f.x[2] * u + f.y[2] * v + f.z[2] * d];
}

/** A round step for a value: whole millimetres up to 20, fives up to 100, tens above. */
export const niceStep = (v: number): number => (Math.abs(v) < 20 ? 1 : Math.abs(v) < 100 ? 5 : 10);

export interface LayoutOpts {
  mode: AboutMode;
  /** the anchor marker's offset while it is dragged */ anchorAt?: { u: number; v: number };
  /** While a move runs: show the original footprint and the inference guides (sketch-plane lines). */
  moving?: { guides: MoveResult['guides'] };
}

/** Every spec of the size box for `box`: wire, face handles, corner handles, anchor marker, labels. */
export function layout(shape: Shape, box: Box, o: LayoutOpts): HandleSpec[] {
  const f = shape.frame;
  const W = (u: number, v: number, d: number): Vec3 => worldOf(f, u, v, d);
  const { u0, u1, v0, v1, d0, d1 } = box;
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2, dm = (d0 + d1) / 2;
  const width = u1 - u0, length = v1 - v0, depth = d1 - d0;
  const neg = (a: Vec3): Vec3 => V.mul(a, -1);
  // the wire: 12 edges
  const lines: Vec3[] = [];
  const corner = (i: number): Vec3 => W(i & 1 ? u1 : u0, i & 2 ? v1 : v0, i & 4 ? d1 : d0);
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) if (!(i & bit)) lines.push(corner(i), corner(i | bit));
  const out: HandleSpec[] = [{ id: 'box', kind: 'wire', origin: W(um, vm, dm), axis: f.z, lines, color: BOX_COLOUR, follow: true }];
  const edit = shape.sizeEditable;
  const face = (id: string, at: Vec3, axis: Vec3, base: number, sc: number, colour: string, label: string, span = Infinity): HandleSpec =>
    ({ id, kind: 'cube', origin: at, axis, base, scale: sc, sizePx: 5, color: colour, unit: 'mm', label, follow: true, shiftSnaps: true, hoverReadout: true, ...(Number.isFinite(span) ? { spanWorld: span, showMinPx: FACE_MIN_PX } : {}) });
  if (edit) {
    out.push(face('u1', W(u1, vm, dm), f.x, width, faceScale(u0, u1, 'hi', o.mode, shape.anchor.u), AXIS_COLOUR.u, t('sizebox.width.tip'), width));
    out.push(face('u0', W(u0, vm, dm), neg(f.x), width, faceScale(u0, u1, 'lo', o.mode, shape.anchor.u), AXIS_COLOUR.u, t('sizebox.width.tip'), width));
    out.push(face('v1', W(um, v1, dm), f.y, length, faceScale(v0, v1, 'hi', o.mode, shape.anchor.v), AXIS_COLOUR.v, t('sizebox.length.tip'), length));
    out.push(face('v0', W(um, v0, dm), neg(f.y), length, faceScale(v0, v1, 'lo', o.mode, shape.anchor.v), AXIS_COLOUR.v, t('sizebox.length.tip'), length));
  }
  const far = shape.dir > 0 ? d1 : d0;
  if (shape.depth === 'blind') out.push({ ...face('df', W(um, vm, far), V.mul(f.z, shape.dir), depth, 1, AXIS_COLOUR.d, t('sizebox.height.tip')), spanWorld: depth, showMinPx: DEPTH_MIN_PX });
  if (shape.depth === 'mid') {
    out.push({ ...face('d1', W(um, vm, d1), f.z, depth, 2, AXIS_COLOUR.d, t('sizebox.height.tip')), spanWorld: depth, showMinPx: DEPTH_MIN_PX });
    out.push({ ...face('d0', W(um, vm, d0), neg(f.z), depth, 2, AXIS_COLOUR.d, t('sizebox.height.tip')), spanWorld: depth, showMinPx: DEPTH_MIN_PX });
  }
  // corners of the cap (the end face away from the sketch plane)
  const cap = shape.depth === 'mid' ? d1 : far;
  if (edit) {
    for (const [id, su, sv] of [['c++', 1, 1], ['c+-', 1, -1], ['c-+', -1, 1], ['c--', -1, -1]] as Array<[string, 1 | -1, 1 | -1]>) {
      out.push({ id, kind: 'cube', origin: W(su > 0 ? u1 : u0, sv > 0 ? v1 : v0, cap), axis: f.z, u: f.x, drag: 'plane', sizePx: 4, color: '#c8d6e5', unit: 'mm', label: t('sizebox.corner.tip'), follow: true, shiftSnaps: true, spanWorld: Math.min(width, length), showMinPx: CORNER_MIN_PX });
    }
  }
  // the MOVE pad: a flat four-arrow cross at the centre of the footprint on the sketch plane; dragging it (or the shape's own faces) moves the shape
  out.push({ id: 'move', kind: 'pad', origin: W(um, vm, 0), axis: f.z, u: f.x, drag: 'plane', reportMods: true, sizePx: 24, color: MOVE_COLOUR, unit: 'mm', label: t('sizebox.move.tip'), follow: true });
  // the anchor: the profile's reference point (an orange diamond, kept off the pad's centre by being drawn small on top of it)
  const au = shape.anchor.u + (o.anchorAt?.u ?? 0), av = shape.anchor.v + (o.anchorAt?.v ?? 0);
  out.push({ id: 'anchor', kind: 'cube', look: 'diamond', reportMods: true, priority: -1, origin: W(au, av, 0), axis: f.z, u: f.x, drag: 'plane', sizePx: 5, color: ANCHOR_COLOUR, unit: 'mm', label: t('sizebox.anchor.tip'), follow: true });
  // the original footprint (ghost) and the alignment guides, only while a move runs
  const sb = shape.box;
  const ghost: Vec3[] = o.moving ? [W(sb.u0, sb.v0, 0), W(sb.u1, sb.v0, 0), W(sb.u1, sb.v0, 0), W(sb.u1, sb.v1, 0), W(sb.u1, sb.v1, 0), W(sb.u0, sb.v1, 0), W(sb.u0, sb.v1, 0), W(sb.u0, sb.v0, 0)] : [];
  out.push({ id: 'ghost', kind: 'wire', origin: W(um, vm, 0), axis: f.z, lines: ghost, color: GHOST_COLOUR, follow: true });
  const guide: Vec3[] = (o.moving?.guides ?? []).flatMap(([a, b, c, d]) => [W(a, b, 0), W(c, d, 0)]);
  out.push({ id: 'guides', kind: 'wire', origin: W(um, vm, 0), axis: f.z, lines: guide, color: MOVE_COLOUR, follow: true });
  // the numbers
  const lab = (id: string, at: Vec3, value: number, forId: string | undefined, colour: string, tip: string): HandleSpec =>
    ({ id, kind: 'label', origin: at, axis: f.z, text: fmt(value), forId, color: colour, label: tip });
  out.push(lab('lw', W(um, v0, d0), width, edit ? 'u1' : undefined, AXIS_COLOUR.u, t('sizebox.label.tip')));
  out.push(lab('ll', W(u1, vm, d0), length, edit ? 'v1' : undefined, AXIS_COLOUR.v, t('sizebox.label.tip')));
  if (depth > EPS) out.push(lab('lh', W(u1, v0, dm), depth, shape.depth === 'blind' ? 'df' : shape.depth === 'mid' ? 'd1' : undefined, AXIS_COLOUR.d, t('sizebox.label.tip')));
  return out;
}

// ---- the session ----

export interface SizeBoxCtx {
  doc: PartDoc | null;
  shapeId: string;
  frameOf(sketchId: string): Frame3 | null;
  bodyBox: { min: number[]; max: number[] } | null;
  mode: AboutMode;
  /** The body's edges on screen: a move snaps to the ones on the shape's plane (corners, hole rims, midpoints, the face centre). */
  edges?: EdgeLike[];
  /** Snap distance in world units for a point (the Catalog's 14 px at the current zoom); absent: no snapping. */
  snapTol?(p: Vec3): number;
}

/** Centres of the other shapes that sit on the same plane as `frame`, in its (u, v). */
function othersOn(doc: PartDoc | null, shape: Shape, frameOf: SizeBoxCtx['frameOf'], bodyBox: SizeBoxCtx['bodyBox']): Array<{ u: number; v: number }> {
  const out: Array<{ u: number; v: number }> = [];
  const f = shape.frame;
  for (const x of feats(doc)) {
    if (x.id === shape.id || !(SHAPE_TYPES as readonly string[]).includes(x.type) || x.sketch === shape.sketch.id) continue;
    const m = shapeModel(doc, x.id, frameOf, bodyBox);
    if (!m) continue;
    const g = m.frame;
    if (V.dot(g.z, f.z) < 0.9999 || Math.abs(V.dot(V.sub(g.o, f.o), f.z)) > 1e-3) continue;
    const c = worldOf(g, (m.box.u0 + m.box.u1) / 2, (m.box.v0 + m.box.v1) / 2, 0);
    const r = V.sub(c, f.o);
    out.push({ u: V.dot(r, f.x), v: V.dot(r, f.y) });
  }
  return out;
}

/** The edit that moves the shape by (du, dv) in its sketch plane, with the shared-sketch choice when other features use the sketch. */
export function moveCommit(doc: PartDoc | null, shape: Shape, du: number, dv: number): HandleCommit | null {
  const o = opsFor(shape, shiftBox(shape.box, du, dv));
  if (!o) return null;
  const notice = o.dropped.length ? t('sizebox.dropped', { ids: o.dropped.join(', ') }) : undefined;
  if (!shape.sharedWith.length) return { ops: o.ops, create: false, ...(notice ? { notice } : {}) };
  const all = o.ops;
  // "Duplicate sketch": the moved copy goes in front of this shape and only this shape reads it
  const sk = all.find((x) => x.op === 'replace' && (x as { id?: string }).id === shape.sketch.id) as { feature: Wire } | undefined;
  const choices: NonNullable<HandleCommit['choices']> = [{ id: 'all', label: t('sizebox.shared.all'), ops: all }];
  if (sk && doc) {
    const nid = `F${(doc as unknown as { seq: number }).seq}`;
    const at = feats(doc).findIndex((x) => x.id === shape.id);
    const copy = { ...structuredClone(sk.feature), id: nid, name: `${shape.sketch.name ?? shape.sketch.id} copy` };
    const rest = all.filter((x) => x !== (sk as unknown));
    choices.push({ id: 'duplicate', label: t('sizebox.shared.duplicate'), ops: [{ op: 'add', feature: copy, index: at } as EditOp, { op: 'set', id: shape.id, path: 'sketch', value: nid } as EditOp, ...rest] });
  }
  return { ops: all, create: false, choices, notice: t('sizebox.shared', { ids: shape.sharedWith.join(', ') }) };
}

/**
 * "Lock to": a persistent relation between the shape and a point of the body it sits on (a hole centre, a corner, an edge
 * midpoint, the face centre). The point is added to the shape's sketch as reference geometry (a fixed, external construction
 * point, the same kind the Project tool makes) and the profile point nearest to it is tied to it: `coincident` when they are
 * at the same place (concentric with a circle centre), else a horizontal and a vertical distance holding the offset the shape
 * has now. Later moves keep the distances up to date (transformSketch), so the lock follows an edit instead of snapping back.
 * Like Project, the reference is a snapshot of where the point is: it does not follow a later change of the body.
 */
export function lockOps(shape: Shape, to: { u: number; v: number }): HandleCommit | null {
  const sk = structuredClone(shape.sketch) as Wire;
  const pts: Wire[] = sk.points ?? [];
  const ids = new Set<string>(pts.map((q) => q.id));
  const uniq = (prefix: string): string => { let i = 1; while (ids.has(prefix + i)) i++; ids.add(prefix + i); return prefix + i; };
  let key: Wire | undefined;
  if (shape.hole) key = pts.find((q) => q.id === shape.hole!.pointId);
  else if (shape.profile) {
    let best = Infinity;
    for (const q of pts) if (shape.profile.pointIds.has(q.id) && !q.fixed && !q.ext) { const d = Math.hypot(q.x - to.u, q.y - to.v); if (d < best) { best = d; key = q; } }
  }
  if (!key) return null;
  let ref = pts.find((q) => q.ext && q.fixed && Math.hypot(q.x - to.u, q.y - to.v) < 1e-6);
  if (!ref) {
    ref = { id: uniq('L'), x: round3(to.u), y: round3(to.v), fixed: true, ext: true };
    pts.push(ref);
    (sk.entities ??= []).push({ id: uniq('Le'), type: 'point', p: ref.id, construction: true, ext: true });
  }
  const dx = key.x - ref.x, dy = key.y - ref.y;
  const pair = (c: Wire): boolean => (c.refs ?? []).length === 2 && c.refs.includes(ref!.id) && c.refs.includes(key!.id);
  const cons: Wire[] = (sk.constraints ?? []).filter((c: Wire) => !pair(c) || !['coincident', 'hdist', 'vdist', 'distance'].includes(c.type));
  const cid = (): string => { let i = 1; while (cons.some((c) => c.id === 'K' + i) || (sk.constraints ?? []).some((c: Wire) => c.id === 'K' + i)) i++; return 'K' + i; };
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) cons.push({ id: cid(), type: 'coincident', refs: [ref.id, key.id] });
  else {
    if (Math.abs(dx) >= 1e-6) cons.push({ id: cid(), type: 'hdist', refs: dx >= 0 ? [ref.id, key.id] : [key.id, ref.id], value: round3(Math.abs(dx)) });
    if (Math.abs(dy) >= 1e-6) cons.push({ id: cid(), type: 'vdist', refs: dy >= 0 ? [ref.id, key.id] : [key.id, ref.id], value: round3(Math.abs(dy)) });
  }
  sk.constraints = cons;
  return { ops: [{ op: 'replace', id: sk.id, feature: sk } as EditOp], create: false, notice: t('sizebox.lock.done', { dx: fmt(Math.abs(dx)), dy: fmt(Math.abs(dy)) }) };
}

/** The session of a size box: its specs, and the ops every handle drag stands for. Null when the shape has no sketch frame yet. */
export function planSizeBox(c: SizeBoxCtx): HandleSession | null {
  const shape = shapeModel(c.doc, c.shapeId, c.frameOf, c.bodyBox);
  if (!shape) return null;
  const { mode } = c;
  const b = shape.box;
  let last = '';
  let cands: MoveCands | null = null;
  const candidates = (): MoveCands => cands ??= c.edges ? moveCandidates(shape.frame, b, c.edges, othersOn(c.doc, shape, c.frameOf, c.bodyBox)) : NO_CANDS;
  const step = gridStep(b);
  /** The few body points closest to the shape's centre, for "Lock to". */
  const nearest = (): MovePoint[] => {
    const cu = (b.u0 + b.u1) / 2, cv = (b.v0 + b.v1) / 2, out: MovePoint[] = [];
    for (const p of [...candidates().pts].sort((x, y) => Math.hypot(x.u - cu, x.v - cv) - Math.hypot(y.u - cu, y.v - cv))) {
      if (p.kind === 'center' || out.some((q) => Math.hypot(q.u - p.u, q.v - p.v) < 1e-6)) continue;
      out.push(p);
      if (out.length === 4) break;
    }
    return out;
  };
  const snapLabel = (r: MoveResult): string => (r.snap ? ' - ' + t(r.snap === 'grid' || r.snap === 'axis' || r.snap === 'align' ? 'sizebox.snap.' + r.snap : 'catalog.snap.' + r.snap) : '');
  /** The box a handle reading stands for. `q` is the new dimension (faces) or the drag length (corner / anchor, which read `vec`). */
  const resolve = (id: string, q: number, vec: Vec3, mods: MoveMods = {}): { box: Box; text: string; anchorAt?: { u: number; v: number }; moved?: MoveResult } | null => {
    const f = shape.frame;
    if (id === 'u1' || id === 'u0') return q < MIN_SIZE ? null : { box: boxFor(shape, { u: { side: id === 'u1' ? 'hi' : 'lo', dim: q } }, mode), text: t('sizebox.width', { v: fmt(q) }) };
    if (id === 'v1' || id === 'v0') return q < MIN_SIZE ? null : { box: boxFor(shape, { v: { side: id === 'v1' ? 'hi' : 'lo', dim: q } }, mode), text: t('sizebox.length', { v: fmt(q) }) };
    if (id === 'df' || id === 'd1' || id === 'd0') return q < MIN_SIZE ? null : { box: depthBox(shape, q), text: t('sizebox.height', { v: fmt(q) }) };
    if (id === 'anchor' || id === 'move') {
      const tol = c.snapTol ? c.snapTol(worldOf(f, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, 0)) : 0;
      const m = resolveMove(b, { du: V.dot(vec, f.x), dv: V.dot(vec, f.y) }, mods, tol > 0 ? candidates() : NO_CANDS, tol, step);
      return { box: shiftBox(b, m.du, m.dv), text: t('sizebox.delta', { dx: fmt(m.du), dy: fmt(m.dv) }) + snapLabel(m), anchorAt: { u: m.du, v: m.dv }, moved: m };
    }
    if (id.startsWith('c')) {
      const su = id[1] === '+' ? 1 : -1, sv = id[2] === '+' ? 1 : -1;
      const W = b.u1 - b.u0, L = b.v1 - b.v0;
      const wsc = faceScale(b.u0, b.u1, su > 0 ? 'hi' : 'lo', mode, shape.anchor.u), lsc = faceScale(b.v0, b.v1, sv > 0 ? 'hi' : 'lo', mode, shape.anchor.v);
      const w = W + (su * V.dot(vec, f.x)) * wsc, l = L + (sv * V.dot(vec, f.y)) * lsc;
      if (w < MIN_SIZE || l < MIN_SIZE) return null;
      const box = boxFor(shape, { u: { side: su > 0 ? 'hi' : 'lo', dim: w }, v: { side: sv > 0 ? 'hi' : 'lo', dim: l } }, mode);
      return { box, text: t('sizebox.both', { w: fmt(box.u1 - box.u0), l: fmt(box.v1 - box.v0) }) };
    }
    return null;
  };
  const edit = (id: string, q: number, vec: Vec3, mods?: MoveMods) => {
    const r = resolve(id, q, vec, mods);
    if (!r) return null;
    last = r.text;
    const o = opsFor(shape, r.box);
    return o ? { ...o, r } : null;
  };
  return {
    kind: 'size-box', target: shape.id,
    specs: layout(shape, b, { mode }),
    preview: (id, q, vec, mods) => edit(id, q, vec, mods)?.ops ?? null,
    commit: (id, q, vec, mods) => {
      if (id === 'move' || id === 'anchor') {
        const r = resolve(id, q, vec, mods);
        return r?.moved ? moveCommit(c.doc, shape, r.moved.du, r.moved.dv) : null;
      }
      const e = edit(id, q, vec, mods);
      return e ? { ops: e.ops, create: false, ...(e.dropped.length ? { notice: t('sizebox.dropped', { ids: e.dropped.join(', ') }) } : {}) } : null;
    },
    live: (id, q, vec, mods) => { const r = resolve(id, q, vec, mods); if (r) last = r.text; return r ? layout(shape, r.box, { mode, anchorAt: r.anchorAt, ...(r.moved ? { moving: { guides: r.moved.guides } } : {}) }) : null; },
    format: (id, q) => (id.startsWith('c') || id === 'anchor' || id === 'move' ? last : id.startsWith('u') ? t('sizebox.width', { v: fmt(q) }) : id.startsWith('v') ? t('sizebox.length', { v: fmt(q) }) : t('sizebox.height', { v: fmt(q) })),
    step: (id) => niceStep(id === 'u1' || id === 'u0' ? b.u1 - b.u0 : id === 'v1' || id === 'v0' ? b.v1 - b.v0 : id === 'df' || id === 'd1' || id === 'd0' ? b.d1 - b.d0 : Math.max(b.u1 - b.u0, b.v1 - b.v0)),
    move: {
      box: { u0: b.u0, u1: b.u1, v0: b.v0, v1: b.v1 }, host: candidates().host, step, to: (du, dv) => moveCommit(c.doc, shape, du, dv),
      centre: { u: (b.u0 + b.u1) / 2, v: (b.v0 + b.v1) / 2 },
      world: worldOf(shape.frame, (b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, 0),
      near: nearest(),
      lockTo: (pt) => lockOps(shape, pt),
    },
  };
}
