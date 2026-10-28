// Which handle the current selection gets, and what dragging it edits. Pure: the document, the selection and the body on
// screen go in, a HandleSession (the handles to draw and the ops each drag step stands for) comes out, or null.
//
//   edge / corner         dot at the edge: out = fillet radius, in = chamfer distance (one new feature)
//   edge / face of a fillet or chamfer feature: the same dot edits that feature's radius / distance in place
//   end cap (Fn.C1) of a blind extrude: arrow along the normal edits `depth` (a cut deepens when the cap moves into the part)
//   inner wall of a shell: arrow edits the shell `thickness`
//   wall of a plain hole: dot edits the hole `diameter`
//   cylinder or sphere face (not a hole, fillet or thin wall): arrow pushes or pulls the face along its normal (one `moveFace` offset, merged on repeat)
//   Extrude / Cut card open (blind or mid-plane): one red arrow at the profile centre sets `depth` in the card's draft (depthArrow.ts)
//   Thread editor open: dot at the end of the thread edits `length` in the editor's draft (threadHandle.ts)
//   whole body (Alt+click): the placement gizmo, only when the kernel has moveBody (it does not yet)
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { V, type HandleSpec, type Vec3 } from '@kit/viewport';
import { edgeRefs, faceNames, type Box, type ViewEdge } from '../featureCommands';
import { holeDiameter, kindOf } from '../holeData';
import { t } from '../i18n';
import { bisectorAt, faceInfo, onHull, sphereOf, surfaceNear, type MeshLike } from './geom';
import { cylinderOfFace } from '../threadData';
import { faceMoveOps } from '../triball/ops';
import { MIN_SIZE, type HandleSession } from './session';
import { placementSession, type Placement } from './placement';
import { threadLengthSession, type ThreadHandleCtx } from './threadHandle';
import { depthArrowSession, type DepthArrowCtx } from './depthArrow';
import { thinOf } from '../thinRules';
import { clampToTip } from '../taperLimit';

type Feat = { id: string; type: string; [k: string]: unknown };

export interface PlanCtx {
  doc: PartDoc | null;
  selection: string[];
  mode: string;
  edges: ViewEdge[];
  mesh: MeshLike | null;
  box: Box | null;
  /** The Editor is open on a feature: handles would fight its preview, so there are none. */
  editingId: string | null;
  sketching: boolean;
  /** The `handles` workspace setting. */
  enabled: boolean;
  /** Whether the kernel can move a body (`moveBody`); the placement gizmo is off without it. */
  placement?: Placement | null;
  /** The Thread editor is open on a thread: its length handle (the only handle shown while an editor is open). */
  thread?: ThreadHandleCtx | null;
  /** An Extrude / Cut card is open on a blind or mid-plane extrude: the depth arrow on its preview (depthArrow.ts). */
  depthArrow?: DepthArrowCtx | null;
  /** The depth at which a tapered extrude closes to a tip (the kernel's `limits`), when it has one. */
  tipLimit?(featureId: string): number | undefined;
}

const feats = (doc: PartDoc | null): Feat[] => (doc?.features ?? []) as unknown as Feat[];
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const set = (id: string, path: string, value: unknown): EditOp => ({ op: 'set', id, path, value } as EditOp);

/** The first feature of this type whose generated faces carry the name (`FL.B0` belongs to feature `FL`). */
const ownerOf = (doc: PartDoc | null, name: string, types: string[]): Feat | null => feats(doc).find((f) => types.includes(f.type) && name.startsWith(f.id + '.')) ?? null;

// ---- fillet / chamfer from an edge or a corner ----

const edgeMid = (e: ViewEdge): Vec3 | null => (e.mid && e.mid.length === 3 ? [e.mid[0], e.mid[1], e.mid[2]] : null);

function roundNew(c: PlanCtx): HandleSession | null {
  const refs = edgeRefs(c.selection, c.edges);
  if (!refs.length || !c.mesh) return null;
  const byKey = new Map(c.edges.filter((e) => e.key).map((e) => [e.key!, e]));
  const corner = c.selection.find((n) => n.startsWith('v:'));
  let origin: Vec3 | null = null;
  let axis: Vec3 | null = null;
  if (corner) {
    const v = corner.slice(2).split(',').map(Number) as Vec3;
    origin = v;
    // every edge that ends at the corner contributes its bisector
    let s: Vec3 = [0, 0, 0];
    for (const e of c.edges) {
      const ends = [e.pts?.[0], e.pts?.[(e.pts?.length ?? 1) - 1]];
      if (!ends.some((p) => p && Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) < 1e-3) || !e.faces) continue;
      const b = bisectorAt(c.mesh, e.faces, v);
      if (b) s = V.add(s, b);
    }
    axis = V.len(s) > 1e-6 ? V.norm(s) : null;
  } else {
    const last = [...c.selection].reverse().map((n) => byKey.get(n)).find((e) => e && e.faces?.length === 2);
    if (last) {
      origin = edgeMid(last);
      if (origin) axis = bisectorAt(c.mesh, last.faces!, origin);
    }
  }
  if (!origin || !axis) return null;
  const spec: HandleSpec = { id: 'round', kind: 'dot', origin, axis, offsetPx: -24, sizePx: 8, unit: 'mm', label: t('handles.round.label') };
  const ops = (q: number): EditOp[] | null => {
    if (Math.abs(q) < MIN_SIZE) return null;
    return q > 0
      ? [{ op: 'add', feature: { type: 'fillet', radius: q, edges: refs } }]
      : [{ op: 'add', feature: { type: 'chamfer', chamferType: 'equal', distance: -q, edges: refs } }];
  };
  return {
    kind: 'round-new', specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: true } : null; },
    format: (_id, q) => (q >= 0 ? t('handles.fillet', { v: fmt(q) }) : t('handles.chamfer', { v: fmt(-q) })),
  };
}

function roundEdit(c: PlanCtx, f: Feat, faceName: string): HandleSession | null {
  if (!c.mesh) return null;
  const isFillet = f.type === 'fillet';
  const field = isFillet ? 'radius' : 'distance';
  const v0 = num(f[field]);
  const info = faceInfo(c.mesh, faceName);
  if (v0 === null || !info) return null;
  const on = surfaceNear(c.mesh, faceName, info.centroid);
  if (!on) return null;
  const spec: HandleSpec = { id: 'round', kind: 'dot', origin: on.point, axis: on.normal, base: v0, scale: 1, sizePx: 8, offsetPx: 0, unit: 'mm', label: t(isFillet ? 'handles.radius.label' : 'handles.distance.label') };
  const ops = (q: number): EditOp[] | null => (q < MIN_SIZE ? null : [set(f.id, field, q)]);
  return {
    kind: 'round-edit', target: f.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t(isFillet ? 'handles.radius' : 'handles.distance', { v: fmt(Math.max(q, 0)) }),
  };
}

// ---- faces ----

function extrudeDepth(c: PlanCtx, f: Feat, name: string): HandleSession | null {
  const d0 = num(f.depth);
  if (!c.mesh || d0 === null || (f.end ?? 'blind') !== 'blind') return null;
  const info = faceInfo(c.mesh, name);
  if (!info || !info.planar) return null;
  // Moving the cap along its outward normal lengthens an added extrude and shortens a cut (the floor of a pocket faces out of the part).
  const sign = f.op === 'cut' ? -1 : 1;
  const spec: HandleSpec = { id: 'depth', kind: 'arrow', origin: info.centroid, axis: info.normal, base: d0, scale: sign, sizePx: 80, unit: 'mm', label: t('handles.depth.label') };
  const max = c.tipLimit?.(f.id);
  // past the tip the depth stays at the tip however far the pointer goes
  const ops = (q0: number): EditOp[] | null => {
    const q = clampToTip(q0, max).value;
    if (Math.abs(q) < MIN_SIZE) return null;
    if (q > 0) return [set(f.id, 'depth', q)];
    // dragged through the sketch plane: the same extrude the other way round
    return [set(f.id, 'depth', -q), set(f.id, 'flip', !f.flip)];
  };
  return {
    kind: 'extrude-depth', target: f.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false, ...(clampToTip(q, max).clamped ? { notice: t('tip.limited', { h: fmt(max!) }) } : {}) } : null; },
    format: (_id, q) => { const c2 = clampToTip(q, max); return t(c2.atTip ? 'handles.depth.tip' : 'handles.depth', { v: fmt(Math.abs(c2.value)) }); },
  };
}

function shellThickness(c: PlanCtx, name: string): HandleSession | null {
  const sh = feats(c.doc).filter((f) => f.type === 'shell' && num(f.thickness) !== null).at(-1);
  if (!sh || !c.mesh || !c.box || !name.includes('~')) return null;
  const info = faceInfo(c.mesh, name);
  // only the inner (cavity) wall: the outer wall stays put when the thickness changes, so dragging it would lie
  if (!info || !info.planar || onHull(info, c.box)) return null;
  const t0 = num(sh.thickness)!;
  const spec: HandleSpec = { id: 'thickness', kind: 'arrow', origin: info.centroid, axis: info.normal, base: t0, scale: 1, sizePx: 80, unit: 'mm', label: t('handles.thickness.label') };
  const ops = (q: number): EditOp[] | null => (q < MIN_SIZE ? null : [set(sh.id, 'thickness', q)]);
  return {
    kind: 'shell-thickness', target: sh.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t('handles.thickness', { v: fmt(Math.max(q, 0)) }),
  };
}


/** The offset wall (`Fn.S.<entity>.W0`) of a thin extrude / revolve: dragging it along its outward normal edits the wall `thickness`
 *  (`mid` grows on both sides, so the face moves half as far as the thickness changes). */
function thinThickness(c: PlanCtx, f: Feat, name: string): HandleSession | null {
  const spec0 = thinOf(f);
  const t0 = spec0 && typeof spec0.thickness === 'number' ? spec0.thickness : null;
  if (!c.mesh || !spec0 || t0 === null) return null;
  const info = faceInfo(c.mesh, name);
  if (!info) return null;
  const on = surfaceNear(c.mesh, name, info.centroid);
  if (!on) return null;
  const spec: HandleSpec = { id: 'thin', kind: 'arrow', origin: on.point, axis: on.normal, base: t0, scale: spec0.side === 'mid' ? 2 : 1, sizePx: 80, unit: 'mm', label: t('handles.thin.label') };
  const ops = (q: number): EditOp[] | null => (q < MIN_SIZE ? null : [set(f.id, 'thin', { ...(f.thin as object), thickness: Math.round(q * 100) / 100 })]);
  return {
    kind: 'thin-thickness', target: f.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t('handles.thin', { v: fmt(Math.max(q, 0)) }),
  };
}

function holeDiameterGesture(c: PlanCtx, h: Feat, name: string): HandleSession | null {
  if (!c.mesh || kindOf(h) !== 'simple') return null;
  const d0 = holeDiameter(h);
  const info = faceInfo(c.mesh, name);
  if (d0 === null || !info) return null;
  const on = surfaceNear(c.mesh, name, info.centroid);
  if (!on) return null;
  // the wall's normal points into the hole; the handle slides into the material, where the wall goes when the hole grows
  const spec: HandleSpec = { id: 'diameter', kind: 'dot', origin: on.point, axis: V.mul(on.normal, -1), base: d0, scale: 2, sizePx: 8, offsetPx: 0, unit: 'mm', label: t('handles.diameter.label') };
  const ops = (q: number): EditOp[] | null => (q < MIN_SIZE ? null : [set(h.id, 'diameter', q)]);
  return {
    kind: 'hole-diameter', target: h.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t('handles.diameter', { v: fmt(Math.max(q, 0)) }),
  };
}

/** A round face (a cylinder or a sphere) that no feature handle claims: an arrow along its outward normal pushes or pulls it. The distance is the
 *  kernel's `moveFace` offset (a cylinder's radius grows by it); dragging the same face again edits that feature instead of stacking another. */
function pushPull(c: PlanCtx, name: string): HandleSession | null {
  if (!c.mesh) return null;
  const info = faceInfo(c.mesh, name);
  if (!info || info.planar) return null;
  const cyl = cylinderOfFace(name, c.edges);
  if (cyl ? cyl.internal === true : !sphereOf(c.mesh, name)) return null;   // a hole wall has its own handle; anything but a cylinder or sphere is not offered
  const on = surfaceNear(c.mesh, name, info.centroid);
  if (!on) return null;
  const spec: HandleSpec = { id: 'pushpull', kind: 'arrow', origin: on.point, axis: on.normal, base: 0, scale: 1, sizePx: 80, unit: 'mm', label: t('handles.pushPull.label') };
  const ops = (q: number): EditOp[] | null => faceMoveOps(c.doc, [name], false, on.normal, q);
  return {
    kind: 'push-pull', specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t('handles.pushPull', { v: (q >= 0 ? '+' : '') + fmt(q) }),
  };
}

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** The handle session for the selection, or null (nothing selected, a sketch or the Editor open, handles off, or no gesture for this selection). */
export function planHandles(c: PlanCtx): HandleSession | null {
  if (c.enabled && !c.sketching && c.editingId && c.thread && c.thread.id === c.editingId) return threadLengthSession(c.thread);
  if (c.enabled && !c.sketching && c.editingId && c.depthArrow && c.depthArrow.id === c.editingId) return depthArrowSession(c.depthArrow);
  if (!c.enabled || c.sketching || c.editingId || !c.doc || !c.mesh || !c.selection.length) return null;
  if (c.selection.includes(BODY)) return c.placement ? placementSession(c.placement, c.box) : null;

  if (c.mode === 'edge' || c.mode === 'vertex') {
    // an edge of a fillet or chamfer face edits that feature
    const refs = c.selection.map((n) => c.edges.find((e) => e.key === n)).filter((e): e is ViewEdge => !!e);
    for (const e of refs) for (const fn of e.faces ?? []) {
      const owner = ownerOf(c.doc, fn, ['fillet', 'chamfer']);
      if (owner) return roundEdit(c, owner, fn);
    }
    return roundNew(c);
  }

  const faces = faceNames(c.selection);
  if (c.mode === 'face' && faces.length === 1) {
    const name = faces[0];
    const round = ownerOf(c.doc, name, ['fillet', 'chamfer']);
    if (round) return roundEdit(c, round, name);
    const ex = feats(c.doc).find((f) => f.type === 'extrude' && name === f.id + '.C1');
    if (ex) return extrudeDepth(c, ex, name);
    const thin = feats(c.doc).find((f) => (f.type === 'extrude' || f.type === 'revolve') && thinOf(f) && name.startsWith(f.id + '.S.') && /\.W0(~\d+)?$/.test(name));
    if (thin) return thinThickness(c, thin, name);
    const hole = feats(c.doc).find((f) => f.type === 'hole' && name.startsWith(f.id + '.S.h'));
    if (hole) return holeDiameterGesture(c, hole, name);
    return shellThickness(c, name) ?? pushPull(c, name);
  }
  return null;
}
