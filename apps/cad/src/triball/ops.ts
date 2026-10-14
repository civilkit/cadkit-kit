// What the positioning ball edits: the target for a selection (a body, faces, or a moveBody feature), and the edit ops for
// a gesture, a copy, a linear or radial pattern. Pure: the document, the selection and the mesh go in, ops come out.
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { reaim, V, WORLD_AXES, type Axes3, type HitOptions, type TriFrame, type TriGesture, type TriValue, type Vec3, perpendicular } from '@kit/viewport';
import type { Box } from '../featureCommands';
import { faceInfo, surfaceNear, type MeshLike } from '../handles/geom';
import { compose, fromRigid, isNoMove, specOf, toRigid, type MoveSpec } from './rigid';

type Feat = { id: string; type: string; [k: string]: unknown };
const feats = (doc: PartDoc | null): Feat[] => (doc?.features ?? []) as unknown as Feat[];

export type BodyRef = { face: string };
/** The sketch a feature move shifts, and its plane's frame (world origin and the two in-plane directions). */
export interface SketchPlane { id: string; o: Vec3; u: Vec3; v: Vec3 }

export interface Target {
  kind: 'body' | 'face' | 'feature';
  /** Feature targets: the sketch whose points the move shifts. */
  sketch?: SketchPlane;
  frame: TriFrame;
  /** Face targets: the faces, and whether they are all planar. */
  faces?: string[];
  planar?: boolean;
  off?: HitOptions['off'];
  /** The moveBody feature the selection is (selecting it edits that feature). */
  feature?: string;
}

export interface TargetCtx {
  doc: PartDoc | null;
  selection: string[];
  mode: string;
  /** The feature selected in the tree, if any. */
  selectedFeature: string | null;
  mesh: MeshLike | null;
  box: Box | null;
}

export type TargetResult = { ok: true; target: Target } | { ok: false; reason: 'nothing' | 'edges' | 'feature' | 'noBody' };

const centre = (b: Box): Vec3 => [0, 1, 2].map((i) => (b.min[i] + b.max[i]) / 2) as Vec3;

/** The ball's target for the current selection. */
export function resolveTarget(c: TargetCtx): TargetResult {
  if (!c.doc || !c.box || !c.mesh) return { ok: false, reason: 'noBody' };
  const bodyTarget = (feature?: string): TargetResult => ({ ok: true, target: { kind: 'body', frame: { origin: centre(c.box!), axes: WORLD_AXES }, ...(feature ? { feature } : {}) } });
  if (c.selection.includes(BODY)) return bodyTarget();
  const names = c.selection.filter((n) => !n.startsWith('v:') && !n.includes('|'));
  if (c.selection.length && c.selection.length === names.length && c.mode === 'face') {
    const info = faceInfo(c.mesh, names[0]);
    if (!info) return { ok: false, reason: 'nothing' };
    const planar = names.every((n) => faceInfo(c.mesh!, n)?.planar);
    let origin = info.centroid, normal = info.normal;
    if (!info.planar) { const on = surfaceNear(c.mesh, names[0], info.centroid); if (on) { origin = on.point; normal = on.normal; } }
    const x = perpendicular(normal);
    const axes: Axes3 = [x, V.cross(normal, x), normal];
    return { ok: true, target: { kind: 'face', frame: { origin, axes }, faces: names, planar, off: { axes: [false, false, true], planes: [false, false, false], rotate: true } } };
  }
  if (c.selection.length) return { ok: false, reason: 'edges' };
  if (c.selectedFeature) {
    const f = feats(c.doc).find((x) => x.id === c.selectedFeature);
    if (f?.type === 'moveBody') return bodyTarget(f.id);
    const sk = f ? sketchTarget(c.doc, f) : null;
    return sk ? { ok: true, target: sk } : { ok: false, reason: 'feature' };
  }
  return { ok: false, reason: 'nothing' };
}

// The standard planes' frames as the kernel draws sketches on them: [u, v] (the normal is u x v).
const STD_FRAMES: Record<string, [Vec3, Vec3]> = { front: [[1, 0, 0], [0, 1, 0]], top: [[1, 0, 0], [0, 0, -1]], right: [[0, 0, -1], [0, 1, 0]] };

type SketchFeat = Feat & { plane?: { kind?: string; id?: string }; points?: Array<{ id: string; x: number; y: number; fixed?: boolean }> };

/** A feature built from a sketch on a standard plane is moved by shifting that sketch's free points in the plane; any other feature has no target. */
function sketchTarget(doc: PartDoc, f: Feat): Target | null {
  const sid = f.type === 'sketch' ? f.id : typeof f.sketch === 'string' ? f.sketch : null;
  const sk = sid ? (feats(doc).find((x) => x.id === sid) as SketchFeat | undefined) : undefined;
  const frame = sk?.plane?.kind === 'std' && sk.plane.id ? STD_FRAMES[sk.plane.id] : undefined;
  if (!sk || !frame || !sk.points?.some((p) => !p.fixed)) return null;
  const [u, v] = frame;
  const pts = sk.points.filter((p) => !p.fixed);
  const cu = pts.reduce((s, p) => s + p.x, 0) / pts.length, cv = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const n = V.cross(u, v);
  const origin = V.add(V.mul(u, cu), V.mul(v, cv));
  return { kind: 'feature', sketch: { id: sk.id, o: [0, 0, 0], u, v }, frame: { origin, axes: [u, v, n] }, off: { axes: [true, true, false], planes: [false, false, true], rotate: true } };
}

/** Shift every free point of the sketch by the in-plane part of `vec`. Null for no motion. */
export function shiftSketchOps(doc: PartDoc | null, sp: SketchPlane, vec: Vec3): EditOp[] | null {
  const sk = feats(doc).find((x) => x.id === sp.id) as SketchFeat | undefined;
  if (!sk?.points) return null;
  const du = V.dot(vec, sp.u), dv = V.dot(vec, sp.v);
  if (Math.hypot(du, dv) < 1e-9) return null;
  const points = sk.points.map((p) => (p.fixed ? p : { ...p, x: +(p.x + du).toFixed(9), y: +(p.y + dv).toFixed(9) }));
  return [{ op: 'replace', id: sk.id, feature: { ...sk, points } } as unknown as EditOp];
}

/** `bodies` for a move: omitted (every lump) unless copies exist, then the original lump only, so a copy is never moved by a later drag. */
export function bodyRefs(faceIds: string[] | null | undefined): BodyRef[] | undefined {
  const ids = faceIds ?? [];
  if (!ids.some((f) => f.includes('@'))) return undefined;
  const orig = ids.find((f) => !f.includes('@'));
  return orig ? [{ face: orig }] : undefined;
}

/** The first face of the original body, for copies and patterns (a copy always names the lump it copies). */
export function copySource(faceIds: string[] | null | undefined): BodyRef[] | undefined {
  const orig = (faceIds ?? []).find((f) => !f.includes('@'));
  return orig ? [{ face: orig }] : undefined;
}

/** The motion a gesture stands for, relative to the frame the drag began in. */
export function motionOf(g: TriGesture, v: TriValue, frame: TriFrame): MoveSpec {
  if (g.kind === 'spin') return { translate: [0, 0, 0], rotate: { axis: v.dir, origin: frame.origin, angle: v.angle } };
  return { translate: v.vec };
}

const roundV = (v: Vec3): Vec3 => v.map((x) => +x.toFixed(9)) as Vec3;
const feature = (m: MoveSpec, copy: boolean, bodies?: BodyRef[]): Record<string, unknown> => ({
  type: 'moveBody', ...(bodies ? { bodies } : {}), translate: roundV(m.translate),
  ...(m.rotate && Math.abs(m.rotate.angle) > 1e-12 ? { rotate: { axis: roundV(m.rotate.axis), origin: roundV(m.rotate.origin), angle: +m.rotate.angle.toFixed(9) } } : {}), copy,
});

/** The moveBody feature a plain move folds into: the one being edited, else the last feature when it is a move of the same bodies. */
export function existingMove(doc: PartDoc | null, bodies: BodyRef[] | undefined, editing?: string): Feat | null {
  const all = feats(doc);
  const f = editing ? all.find((x) => x.id === editing) : all[all.length - 1];
  if (!f || f.type !== 'moveBody' || f.copy === true || f.suppressed) return null;
  if (!editing && JSON.stringify(f.bodies ?? null) !== JSON.stringify(bodies ?? null)) return null;
  return specOf(f) ? f : null;
}

/** Ops that move the body: a new moveBody, or the existing one replaced with the two motions composed. Null for no motion. */
export function moveOps(doc: PartDoc | null, m: MoveSpec, bodies: BodyRef[] | undefined, editing?: string): EditOp[] | null {
  if (isNoMove(m)) return null;
  const old = existingMove(doc, bodies, editing);
  if (!old) return [{ op: 'add', feature: feature(m, false, bodies) } as EditOp];
  const total = fromRigid(compose(toRigid(specOf(old)!), toRigid(m)));
  const next = { ...old, ...feature(total, false, old.bodies as BodyRef[] | undefined) };
  if (!total.rotate) delete (next as Record<string, unknown>).rotate;
  return [{ op: 'replace', id: old.id, feature: next } as unknown as EditOp];
}

export function copyOps(m: MoveSpec, source: BodyRef[] | undefined): EditOp[] | null {
  return isNoMove(m) ? null : [{ op: 'add', feature: feature(m, true, source) } as EditOp];
}

export interface RepeatSpec {
  kind: 'linear' | 'radial';
  /** Copies to make (the original stays: 5 copies = 6 bodies). */
  number: number;
  /** Linear: the spacing in mm along `dir`. */
  distance: number;
  /** Radial: degrees between copies. */
  angle: number;
  /** Radial: lift along the axis per copy, mm. */
  stepUp: number;
  /** Linear: the unit direction; radial: the axis. */
  dir: Vec3;
  /** Radial: a point on the axis. */
  origin: Vec3;
}

/** One copy per step, each made from the original body (a chain would copy its own copies). */
export function repeatOps(r: RepeatSpec, source: BodyRef[] | undefined): EditOp[] {
  const out: EditOp[] = [];
  const n = Math.max(0, Math.floor(r.number));
  const dir = V.norm(r.dir);
  for (let i = 1; i <= n; i++) {
    const m: MoveSpec = r.kind === 'linear'
      ? { translate: V.mul(dir, r.distance * i) }
      : { translate: V.mul(dir, r.stepUp * i), rotate: { axis: dir, origin: r.origin, angle: r.angle * i } };
    const o = copyOps(m, source);
    if (o) out.push(...o);
  }
  return out;
}

// ---- faces ----

/** Push or pull the faces by `distance` along the first face's normal. Planar faces use translate mode (the component along each normal); curved faces use offset. */
export function faceMoveOps(doc: PartDoc | null, faces: string[], planar: boolean, normal: Vec3, distance: number): EditOp[] | null {
  if (Math.abs(distance) < 1e-9) return null;
  const last = feats(doc).at(-1);
  const same = last && last.type === 'moveFace' && !last.suppressed && JSON.stringify(last.faces) === JSON.stringify(faces) && (last.mode ?? 'offset') === (planar ? 'translate' : 'offset');
  if (planar) {
    const t = V.mul(normal, distance);
    const old = same ? ((last!.translate as unknown[]) ?? []).map(Number) : null;
    if (old && old.length === 3 && old.every(Number.isFinite)) {
      const sum = roundV(V.add(old as Vec3, t));
      return [{ op: 'replace', id: last!.id, feature: { ...last, translate: sum } } as unknown as EditOp];
    }
    return [{ op: 'add', feature: { type: 'moveFace', faces, mode: 'translate', translate: roundV(t) } } as EditOp];
  }
  const d0 = same && typeof last!.distance === 'number' ? (last!.distance as number) : null;
  if (d0 !== null) return [{ op: 'replace', id: last!.id, feature: { ...last, distance: +(d0 + distance).toFixed(9) } } as unknown as EditOp];
  return [{ op: 'add', feature: { type: 'moveFace', faces, mode: 'offset', distance: +distance.toFixed(9) } } as EditOp];
}

/** Re-aim one axis of the frame, choosing the sign nearest to where it points now (a picked axis has no preferred sense). */
export function aimAxis(axes: Axes3, i: 0 | 1 | 2, dir: Vec3, keepSense = true): Axes3 {
  const d = keepSense && V.dot(dir, axes[i]) < 0 ? V.mul(dir, -1) : dir;
  return reaim(axes, i, d);
}

// ---- mirror ----

const STD_PLANE = ['right', 'top', 'front'];   // normals X, Y, Z

/** The world plane id when the plane through the ball origin perpendicular to axis `i` is one the kernel mirrors about (a standard plane through the world origin), else null. */
export function mirrorPlaneId(frame: TriFrame, i: number): string | null {
  const a = frame.axes[i];
  const k = [0, 1, 2].find((j) => Math.abs(Math.abs(a[j]) - 1) < 1e-6);
  if (k === undefined) return null;
  return Math.abs(frame.origin[k]) < 1e-6 ? STD_PLANE[k] : null;
}

/** Mirror the body about a standard plane: the kernel unites the mirror image with the body (a copy; it cannot replace the body). */
export function mirrorOps(doc: PartDoc | null, planeId: string): EditOp[] | null {
  const seed = feats(doc).filter((f) => f.type !== 'sketch' && f.type !== 'sketch3d' && f.type !== 'plane' && !f.suppressed).at(-1);
  return seed ? [{ op: 'add', feature: { type: 'mirror', seeds: [seed.id], plane: { kind: 'std', id: planeId }, body: true } } as EditOp] : null;
}
