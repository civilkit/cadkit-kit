// Which handle the current selection gets, and what dragging it edits. Pure: the document, the selection and the body on
// screen go in, a HandleSession (the handles to draw and the ops each drag step stands for) comes out, or null.
//
//   edge / corner         dot at the edge: out = fillet radius, in = chamfer distance (one new feature)
//   edge / face of a fillet or chamfer feature: the same dot edits that feature's radius / distance in place
//   end cap (Fn.C1) of a blind extrude: arrow along the normal edits `depth` (a cut deepens when the cap moves into the part)
//   inner wall of a shell: arrow edits the shell `thickness`
//   wall of a plain hole: dot edits the hole `diameter`
//   whole body (Alt+click): the placement gizmo, only when the kernel has moveBody (it does not yet)
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { V, type HandleSpec, type Vec3 } from '@kit/viewport';
import { edgeRefs, faceNames, type Box, type ViewEdge } from '../featureCommands';
import { holeDiameter, kindOf } from '../holeData';
import { t } from '../i18n';
import { bisectorAt, faceInfo, onHull, surfaceNear, type MeshLike } from './geom';
import { MIN_SIZE, type HandleSession } from './session';
import { placementSession, type Placement } from './placement';

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
  const ops = (q: number): EditOp[] | null => {
    if (Math.abs(q) < MIN_SIZE) return null;
    if (q > 0) return [set(f.id, 'depth', q)];
    // dragged through the sketch plane: the same extrude the other way round
    return [set(f.id, 'depth', -q), set(f.id, 'flip', !f.flip)];
  };
  return {
    kind: 'extrude-depth', target: f.id, specs: [spec],
    preview: (_id, q) => ops(q),
    commit: (_id, q) => { const o = ops(q); return o ? { ops: o, create: false } : null; },
    format: (_id, q) => t('handles.depth', { v: fmt(Math.abs(q)) }),
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

const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** The handle session for the selection, or null (nothing selected, a sketch or the Editor open, handles off, or no gesture for this selection). */
export function planHandles(c: PlanCtx): HandleSession | null {
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
    const hole = feats(c.doc).find((f) => f.type === 'hole' && name.startsWith(f.id + '.S.h'));
    if (hole) return holeDiameterGesture(c, hole, name);
    return shellThickness(c, name);
    // Any other face: the kernel has no moveFace / offsetFace yet, so there is nothing to drag.
  }
  return null;
}
