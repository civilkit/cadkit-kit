// More feature-creation commands (reference plane and axis, draft, rib, lip, mirror, helix, pipe cut, delete body, and the simple
// surface tools). Same pattern as featureCommands.ts: pure functions turn the document, the selection and the body on screen into
// ONE edit, `creatorCommands` registers them as palette and ribbon commands, and the app opens the Editor on the new feature.
// moveFace and moveBody are made by the positioning ball (triball/ops.ts) and scale by add-scale below. dome, fillpattern, spattern,
// splitLine, surfaceOffset and cutWithSurface have no command yet; see docs/feature-commands.md.
import { groundPlaneId, isPlaneId } from './planeNames';
import type { Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { SURFACE_TYPES } from '@kit/viewdata';
import { DEFAULT_GEAR, defaultPair, gearCommitOps, type GearParams } from './gearData';
import { defaultSplitPlane } from './splitRules';
import { isOpenSketch, isClosedSketch, isPointSketch, hasCurves, isSurfaceFeature, entitiesOf, hasCircle, type Ent, type Feat } from './sketchKinds';
import { hasAutoName, featureLabel, refLabel, planeDefaultName } from './featureLabels';
export { isOpenSketch, isClosedSketch, isPointSketch, hasCurves, isSurfaceFeature, hasAutoName, featureLabel, refLabel, planeDefaultName };
import { combineBodyOps, refOf as bodyRefOf, type BodyTarget } from './bodyOps';
import { axisLine, edgeRefs, faceNames, niceSize, patternSeed, type Box, type Ctx, type FeatureActions, type ViewEdge } from './featureCommands';


const feats = (c: Ctx): Feat[] => (c.doc?.features ?? []) as unknown as Feat[];
const hasSolid = (c: Ctx): boolean => !!c.box;
const faceMode = (c: Ctx): string[] => (c.mode === 'face' ? faceNames(c.selection) : []);

// ---- sketches by what they hold ----

/** A surface of revolution takes an open profile too (a curve beside the axis), so it needs only a curve and a construction line to turn about. */
const hasProfileAndAxis = (s: Feat): boolean => hasCurves(s) && axisLine(s) !== null;

/** The sketch a command uses: the one selected in the tree if it fits, else the last that fits. */
export function sketchWhere(c: Ctx, fits: (s: Feat) => boolean, with3d = false): Feat | null {
  const list = feats(c).filter((f) => (f.type === 'sketch' || (with3d && f.type === 'sketch3d')) && fits(f));
  return list.find((f) => f.id === c.selectedId) ?? list[list.length - 1] ?? null;
}

// ---- surface features ----

/** Feature types that leave a surface body registered under their id. */
export { SURFACE_TYPES };
const surfaceFeatures = (c: Ctx): Feat[] => feats(c).filter(isSurfaceFeature);
/** Surface features that own the faces / edges in the viewport selection (names are `<feature>.…`), in selection order. */
export function surfacesInSelection(c: Ctx): Feat[] {
  const all = surfaceFeatures(c);
  const out: Feat[] = [];
  for (const n of c.selection) {
    const f = all.find((x) => n.startsWith(x.id + '.'));
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}
/** The surface to work on: the one selected in the tree, else the first one a picked face or edge belongs to, else the last surface feature. */
export function surfaceTarget(c: Ctx, not?: string): Feat | null {
  const list = surfaceFeatures(c).filter((f) => f.id !== not);
  return list.find((f) => f.id === c.selectedId) ?? surfacesInSelection(c).find((f) => f.id !== not) ?? list[list.length - 1] ?? null;
}
const planeFeatures = (c: Ctx): Feat[] => feats(c).filter((f) => f.type === 'plane');

// ---- the edits (each is ONE edit) ----

/**
 * The ops that keep the STORED name of a generated Plane / Sketch true after an edit of an offset, base or plane (the tree shows
 * the live name already; the stored one is what a saved file, a script and an agent read). Only runs for edits that touch those fields.
 */
export function syncNameOps(features: Array<Record<string, unknown>>, ops: EditOp[], apply: (f: Array<Record<string, unknown>>, o: never) => Array<Record<string, unknown>> | null): EditOp[] {
  const rec = (o: EditOp) => o as unknown as Record<string, unknown>;
  const touched = (o: EditOp) => (rec(o).op === 'set' && ['offset', 'base', 'base2', 'mode', 'plane'].includes(String(rec(o).path))) || rec(o).op === 'replace' || rec(o).op === 'add';
  if (!ops.some(touched)) return ops;
  const cand = apply(features, ops as never);
  if (!cand) return ops;
  const doc = { features: cand };
  const named = (f: Feat) => (f.type === 'plane' || f.type === 'sketch') && hasAutoName(f as never);
  // a feature added by this edit has no id yet (the kernel gives it one): its name goes into the op itself
  const added = ops.map((o) => (rec(o).op === 'add' ? o : null));
  let k = features.length;
  const out = ops.map((o, i) => {
    if (!added[i]) return o;
    const f = rec(o).feature as Feat, c = cand[k++] as unknown as Feat;
    if (!c || !named(f)) return o;
    const want = featureLabel(doc, c);
    return want && want !== f.name ? ({ ...rec(o), feature: { ...f, name: want } } as unknown as EditOp) : o;
  });
  for (const f of features as unknown as Feat[]) {
    const c = (cand as unknown as Feat[]).find((x) => x.id === f.id);
    if (!c || typeof c.id !== 'string' || !named(c)) continue;
    const want = featureLabel(doc, c);
    if (want && want !== c.name) out.push({ op: 'set', id: c.id, path: 'name', value: want } as EditOp);
  }
  return out;
}
/** The base a new plane offsets from: a picked planar face, else a Plane feature selected in the tree, else the Front / Top / Right plane chosen, else Front. */
export function planeBase(c: Ctx): { kind: string; id: string } {
  const faces = faceMode(c);
  if (faces.length) return { kind: 'face', id: faces[0] };
  const pf = planeFeatures(c).find((f) => f.id === c.selectedId);
  if (pf) return { kind: 'feature', id: pf.id };
  if (isPlaneId(c.refPlane)) return { kind: 'std', id: c.refPlane };
  return { kind: 'std', id: 'front' };
}
/** A reference plane. Two faces: the plane midway between them. Otherwise offset 10 from the base the selection names (a face, a Plane feature, a standard plane; Front when nothing is picked). */
export function planeOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  if (faces.length >= 2) {
    const f = { type: 'plane', mode: 'mid', base: { kind: 'face', id: faces[0] }, base2: { kind: 'face', id: faces[1] } };
    return [{ op: 'add', feature: { ...f, name: planeDefaultName(c.doc, f), autoName: true } }];
  }
  const f = { type: 'plane', mode: 'offset', base: planeBase(c), offset: 10 };
  return [{ op: 'add', feature: { ...f, name: planeDefaultName(c.doc, f), autoName: true } }];
}
/** A reference axis: along the cylinder of one face, or where two faces' planes meet. Nothing picked: the line where the front and top planes meet. */
export function axisOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c).slice(0, 2);
  const refs = faces.length ? faces.map((id) => ({ kind: 'face', id })) : [{ kind: 'std', id: 'front' }, { kind: 'std', id: 'top' }];
  return [{ op: 'add', feature: { type: 'axis', refs } }];
}
/** A Mate Connector: a named coordinate frame anchored to the picked face, selected connector/plane, chosen reference plane, or Front plane. */
export function connectorOps(c: Ctx): EditOp[] | null {
  if (!c.doc) return null;
  const faces = faceMode(c);
  const anchor = faces.length
    ? { kind: 'face', id: faces[0] }
    : feats(c).find((f) => f.type === 'connector' && f.id === c.selectedId)
      ? { kind: 'connector', id: c.selectedId! }
      : planeBase(c);
  return [{ op: 'add', feature: { type: 'connector', anchor } }];
}
/** The plane the first sketch sits on (the base of the first boss): faces tilt about its intersection with them. */
function neutralPlane(c: Ctx): unknown {
  const first = feats(c).find((f) => f.type === 'sketch');
  const p = first?.plane as { kind?: string } | undefined;
  return p && typeof p === 'object' && p.kind ? p : { kind: 'std', id: 'front' };
}
export function draftOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  if (!faces.length) return null;
  return [{ op: 'add', feature: { type: 'draft', neutral: neutralPlane(c), faces, angle: 3, flip: false } }];
}
export function ribOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, isOpenSketch);
  return sk ? [{ op: 'add', feature: { type: 'rib', sketch: sk.id, thickness: niceSize(c.box, 0.1) } }] : null;
}
/** A lip along every edge of the picked rim faces. */
export function lipOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  const keys = c.edges.filter((e) => e.key && e.faces?.some((f) => faces.includes(f))).map((e) => e.key!);
  const edges = edgeRefs(keys, c.edges);
  if (!faces.length || !edges.length) return null;
  const size = niceSize(c.box, 0.05);
  return [{ op: 'add', feature: { type: 'lip', kind: 'lip', faces, edges, width: size, height: size } }];
}
/** The feature (the one selected in the tree, else the last) mirrored about a picked planar face, else about the right plane. */
export function mirrorOps(c: Ctx): EditOp[] | null {
  const seed = patternSeed(c);
  if (!seed) return null;
  const faces = faceMode(c);
  const plane = faces.length === 1 ? { kind: 'face', id: faces[0] } : { kind: 'std', id: 'right' };
  return [{ op: 'add', feature: { type: 'mirror', seeds: [seed.id], plane, body: false } }];
}
/** Length of a sketch's open chain of lines and arcs (an arc runs anticlockwise from p1 to p2, as the kernel reads it); null with a spline. */
export function chainLength(s: Feat): number | null {
  const pts = new Map(((s.points as Array<{ id: string; x: number; y: number }> | undefined) ?? []).map((q) => [q.id, q]));
  let len = 0;
  for (const e of entitiesOf(s) as Array<Ent & { c?: string }>) {
    const a = pts.get(e.p1 ?? ''), b = pts.get(e.p2 ?? '');
    if (e.type === 'line' && a && b) len += Math.hypot(b.x - a.x, b.y - a.y);
    else if (e.type === 'arc' && a && b) {
      const c = pts.get(e.c ?? '');
      if (!c) return null;
      let ang = Math.atan2(b.y - c.y, b.x - c.x) - Math.atan2(a.y - c.y, a.x - c.x);
      ang = ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      len += Math.hypot(a.x - c.x, a.y - c.y) * (ang < 1e-12 ? 2 * Math.PI : ang);
    } else if (e.type !== 'point') return null;
  }
  return len > 0 ? len : null;
}
/** The feature (the one selected in the tree, else the last) repeated 3 times along the newest open sketch, spread over its whole length. */
export function pathPatternOps(c: Ctx): EditOp[] | null {
  const seed = patternSeed(c);
  const path = sketchWhere(c, isOpenSketch, true);
  if (!seed || !path) return null;
  const len = chainLength(path);
  const spread = len !== null ? { distanceType: 'extent', extent: +len.toFixed(6) } : { spacing: niceSize(c.box, 0.2) };
  return [{ op: 'add', feature: { type: 'curvepattern', seeds: [seed.id], path: { kind: 'sketch', id: path.id }, count: 3, ...spread } }];
}
/** Press Pull / Offset Face: the picked faces pushed out by a small distance along their normals (planes slide, cylinders change radius); the options panel or the positioning ball sets the distance. */
export function pressPullOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length && c.box ? [{ op: 'add', feature: { type: 'moveFace', faces, mode: 'offset', distance: niceSize(c.box, 0.1) } }] : null;
}
/** Wrap: the closed profiles or lettering of a sketch laid onto the one picked cylinder face and cut into it (the editor switches to raise). Needs a body, a face and a sketch of closed shapes or text.
 *  Depth is a fiftieth of the smallest side, rounded, so the first result is a visible engraving rather than a through cut. */
export function wrapOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  const sk = sketchWhere(c, (s) => isClosedSketch(s) || hasCircle(s));
  if (faces.length !== 1 || !c.box || !sk) return null;
  return [{ op: 'add', feature: { type: 'wrap', sketch: sk.id, face: faces[0], op: 'cut', depth: niceSize(c.box, 0.02), method: 'auto', alongAxis: 0, around: 0, rotation: 0, taper: 0, flip: false, tolerance: 0.001 } }];
}
/** Combine: the body under the first picked face joined with the bodies under the other picked faces (the editor switches to cut, intersect or split). Needs faces on two bodies. */
export function combineOps(c: Ctx): EditOp[] | null {
  const rows = c.bodyRows?.() ?? [];
  const seen = new Map<number, BodyTarget>();
  for (const f of faceMode(c)) {
    const i = rows.findIndex((r) => r.faces.includes(f));
    if (i >= 0 && !seen.has(i)) seen.set(i, { ...(rows[i].docName ? { docName: rows[i].docName } : {}), face: f });
  }
  const bodies = [...seen.values()];
  return bodies.length >= 2 ? combineBodyOps('union', bodies[0], bodies.slice(1)) : null;
}
// ---- solids from numbers, split face, offset surface (kernel features torus, pipe, coil, boundingSolid, dome, splitLine, surfaceOffset) ----

/** The longest side of the body on screen (40 with no body): sizes for a solid made from numbers. */
const spanOf = (c: Ctx): number => (c.box ? Math.max(...[0, 1, 2].map((i) => c.box!.max[i] - c.box!.min[i]), 1e-9) : 40);
/** A size that is `fraction` of the longest side, rounded to a nice number. */
const sizeOf = (c: Ctx, fraction: number): number => niceSize({ min: [0, 0, 0], max: [spanOf(c), spanOf(c), spanOf(c)] }, fraction);
/** A ring about the Z axis at the origin: the tube is a fifth of the ring radius. */
export function torusOps(c: Ctx): EditOp[] | null {
  if (!c.doc) return null;
  const major = sizeOf(c, 0.3);
  return [{ op: 'add', feature: { type: 'torus', op: 'add', center: [0, 0, 0], axis: 'z', majorRadius: major, minorRadius: +(major / 5).toPrecision(4) } }];
}
/** A round tube along the open sketch (the picked one, else the last): radius 2, solid; the editor sets a wall to hollow it. */
export function pipeOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, isOpenSketch, true);
  return sk ? [{ op: 'add', feature: { type: 'pipe', op: 'add', path: { kind: 'sketch', id: sk.id }, radius: c.box ? niceSize(c.box, 0.1) : 2 } }] : null;
}
/** A spring: a 1 mm wire wound 5 turns round the Z axis at radius 10 and pitch 4. */
export function coilOps(c: Ctx): EditOp[] | null {
  return c.doc ? [{ op: 'add', feature: { type: 'coil', op: 'add', center: [0, 0, 0], axis: 'z', radius: 10, wireRadius: 1, pitch: 4, revolutions: 5, leftHand: false } }] : null;
}
/** The box round the bodies under the picked faces; with no face picked, round every solid body. Always a new body. */
export function boundingSolidOps(c: Ctx): EditOp[] | null {
  if (!c.box) return null;
  const rows = c.bodyRows?.() ?? [];
  const seen = new Map<number, BodyTarget>();
  for (const f of faceMode(c)) {
    const i = rows.findIndex((r) => r.faces.includes(f));
    if (i >= 0 && !seen.has(i)) seen.set(i, { ...(rows[i].docName ? { docName: rows[i].docName } : {}), face: f });
  }
  const bodies = [...seen.values()].map(bodyRefOf);
  return [{ op: 'add', feature: { type: 'boundingSolid', ...(bodies.length ? { bodies } : {}), padding: 0 } }];
}
/** A dome on the picked flat round face (one face only): a fifth of the smallest side high; a negative height is a dimple. */
export function domeOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length === 1 && c.box && !notRound(c, faces[0]) ? [{ op: 'add', feature: { type: 'dome', face: faces[0], height: niceSize(c.box, 0.2) } }] : null;
}
/** True when the edges of this face are known and are not one closed round outline: the kernel only domes a flat face bounded by one circle (anything else is refused with invalidValue). Unknown edges: not judged (false). */
export function notRound(c: Ctx, face: string): boolean {
  const own = c.edges.filter((e) => e.faces?.includes(face));
  if (!own.length || own.some((e) => !e.pts)) return false;
  if (own.length !== 1 || own[0].pts!.length < 4) return true;   // several edges, or one straight edge: not a single circle
  const pts = own[0].pts!;
  const n = pts.length, first = pts[0], last = pts[n - 1];
  const gap = Math.hypot(first[0] - last[0], first[1] - last[1], first[2] - last[2]);
  const ring = gap < 1e-6 ? pts.slice(0, -1) : pts;
  const ctr = [0, 1, 2].map((k) => ring.reduce((a, p) => a + p[k], 0) / ring.length);
  const r = ring.map((p) => Math.hypot(p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]));
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const closed = gap <= 1e-3 * mean + 1e-6;
  return !closed || r.some((x) => Math.abs(x - mean) > 0.02 * mean);
}
/** Split the picked flat faces by the plane across the middle of the body's longest side (the editor moves or changes the plane). */
export function splitFaceOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  if (!faces.length || !c.box) return null;
  const d = [0, 1, 2].map((i) => c.box!.max[i] - c.box!.min[i]);
  const i = d.indexOf(Math.max(...d));
  const offset = +((c.box.min[i] + c.box.max[i]) / 2).toPrecision(8);
  return [{ op: 'add', feature: { type: 'splitLine', faces, plane: { kind: 'std', id: (['right', 'top', 'front'] as const)[i] }, ...(offset !== 0 ? { offset } : {}) } }];
}
/** A new surface body offset from the picked faces (or from the surface in the tree): 1/20 of the smallest side out; the source stays. */
export function offsetSurfaceOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  const distance = niceSize(c.box, 0.05);
  if (faces.length) return [{ op: 'add', feature: { type: 'surfaceOffset', faces, distance } }];
  const sf = surfaceTarget(c);
  return sf ? [{ op: 'add', feature: { type: 'surfaceOffset', surface: sf.id, distance } }] : null;
}

/** The whole part scaled to twice its size about its centre of mass: the options panel sets the factor (one number, or one per axis), the centre and which bodies. */
export function scaleOps(c: Ctx): EditOp[] | null {
  return c.doc ? [{ op: 'add', feature: { type: 'scale', factor: 2 } }] : null;
}
/** The plane a split starts from: a picked planar face, else the middle of the body across its smallest side. */
function splitPlane(c: Ctx): Record<string, unknown> {
  const faces = faceMode(c);
  if (faces.length === 1) return { plane: { kind: 'face', id: faces[0] } };
  const d = defaultSplitPlane(c.box);
  return { plane: d.plane, ...(d.offset !== 0 ? { offset: d.offset } : {}) };
}
/** Split the body by a plane into two named bodies (Base and Lid). */
export function splitOps(c: Ctx): EditOp[] | null {
  return c.box ? [{ op: 'add', feature: { type: 'split', ...splitPlane(c), names: [t('app.split.below'), t('app.split.above')] } }] : null;
}
/** The same split with a centred tongue on the base and a groove 0.2 mm wider and deeper in the lid: the editor sets height, width and clearance. */
export function lipJointOps(c: Ctx): EditOp[] | null {
  if (!c.box) return null;
  // The tongue's width as a share of the wall needs a wall: on a hollow part (a Shell before it) that is the default; on a solid body the kernel refuses it, so the width and the inset are millimetres there
  const hollow = feats(c).some((f) => f.type === 'shell');
  const w = niceSize(c.box, 0.1);
  const size = hollow ? { widthRatio: 0.5 } : { width: w, inset: +(w / 2).toPrecision(6) };
  return [{ op: 'add', feature: { type: 'lipJoint', ...splitPlane(c), names: [t('app.split.below'), t('app.split.above')], height: niceSize(c.box, 0.15), ...size, clearance: 0.2 } }];
}
export function helixOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, hasCircle);
  if (!sk) return null;
  return [{ op: 'add', feature: { type: 'helix', sketch: sk.id, definedBy: 'pitchRevs', pitch: niceSize(c.box, 0.1), revolutions: 5, height: 10, startAngle: 0, leftHand: false } }];
}
/** Pipe cut along the picked edges (edge mode) or the rim edges of the picked faces (face mode). The solid becomes a surface body. */
export function pipeCutOps(c: Ctx): EditOp[] | null {
  const radius = niceSize(c.box, 0.1);
  const faces = faceMode(c);
  if (faces.length) return [{ op: 'add', feature: { type: 'pipeCut', radius, edges: [], faces } }];
  const edges = c.mode === 'edge' ? edgeRefs(c.selection, c.edges) : [];
  return edges.length ? [{ op: 'add', feature: { type: 'pipeCut', radius, edges, faces: [] } }] : null;
}
/** What to tell the user after a pipe cut: it turns a solid into a surface body, and when no face changed it did nothing. `diff` is the edit result's body diff. */
export function pipeCutNotice(diff: { faces: { added: string[]; removed: string[] }; solids: { before: number; after: number }; volume: { before: number | null; after: number | null } } | undefined): 'surface' | 'nothing' | null {
  if (!diff) return null;
  if (diff.solids.after < diff.solids.before) return 'surface';
  if (!diff.faces.added.length && !diff.faces.removed.length && diff.volume.before === diff.volume.after) return 'nothing';
  return null;
}
/** Delete the bodies that hold the picked faces. */
export function deleteBodyOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length ? [{ op: 'add', feature: { type: 'deleteBody', mode: 'delete', bodies: faces.map((face) => ({ face })) } }] : null;
}
export function deleteFaceOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length ? [{ op: 'add', feature: { type: 'deleteFace', mode: 'delete', faces, edges: [] } }] : null;
}
export function surfacePlanarOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, isClosedSketch);
  return sk ? [{ op: 'add', feature: { type: 'surfacePlanar', sketch: sk.id } }] : null;
}
export function surfaceExtrudeOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, (s) => isClosedSketch(s)) ?? sketchWhere(c, hasCurves);
  return sk ? [{ op: 'add', feature: { type: 'surfaceExtrude', sketch: sk.id, end: 'blind', depth: 10 } }] : null;
}
export function surfaceRevolveOps(c: Ctx): EditOp[] | null {
  const sk = sketchWhere(c, hasProfileAndAxis);
  const axis = sk ? axisLine(sk) : null;
  return sk && axis ? [{ op: 'add', feature: { type: 'surfaceRevolve', sketch: sk.id, axis, end: 'blind', angle: 360 } }] : null;
}
/** What trims the surface: a second picked surface, else a picked face of a solid (its plane), else another surface, else the last reference plane. */
function trimTool(c: Ctx, target: Feat): Record<string, unknown> | null {
  const picked = surfacesInSelection(c).find((f) => f.id !== target.id);
  if (picked) return { toolSurface: picked.id };
  const own = (n: string) => n.startsWith(target.id + '.');
  const faces = faceMode(c).filter((n) => !own(n) && !surfacesInSelection(c).some((f) => n.startsWith(f.id + '.')));
  if (faces.length) return { plane: { kind: 'face', id: faces[0] } };
  const other = surfaceTarget(c, target.id);
  if (other) return { toolSurface: other.id };
  const pl = planeFeatures(c).at(-1);
  return pl ? { plane: { kind: 'feature', id: pl.id } } : null;
}
export function trimSurfaceOps(c: Ctx): EditOp[] | null {
  const target = surfaceTarget(c);
  const tool = target ? trimTool(c, target) : null;
  return target && tool ? [{ op: 'add', feature: { type: 'trimSurface', surface: target.id, mutual: false, flip: false, ...tool } }] : null;
}
/** Knit the surfaces a picked face or edge belongs to, else the one selected in the tree, else every surface made so far. */
export function knitOps(c: Ctx): EditOp[] | null {
  const all = surfaceFeatures(c);
  const picked = surfacesInSelection(c);
  const sel = all.find((f) => f.id === c.selectedId);
  const ids = (picked.length ? picked : sel ? [sel] : all).map((f) => f.id);
  return ids.length ? [{ op: 'add', feature: { type: 'knit', surfaces: ids, solid: false } }] : null;
}
export function thickenOps(c: Ctx): EditOp[] | null {
  const s = surfaceTarget(c);
  return s ? [{ op: 'add', feature: { type: 'thicken', surface: s.id, thickness: niceSize(c.box, 0.1), side: 'front' } }] : null;
}

// ---- loft, sweep, fill, extend ----

/** Sketch ids that another feature already uses (as profile, section, path, guide or centre line). */
export function usedSketches(c: Ctx): Set<string> {
  const used = new Set<string>();
  for (const f of feats(c)) {
    if (f.type === 'sketch' || f.type === 'sketch3d') continue;
    if (typeof f.sketch === 'string') used.add(f.sketch);
    for (const k of ['sketches', 'guides'] as const) for (const g of (f[k] as unknown[] | undefined) ?? []) {
      const id = typeof g === 'string' ? g : (g as { sketch?: string } | null)?.sketch;
      if (id) used.add(id);
    }
    const path = f.path as { id?: string } | undefined;
    if (path?.id) used.add(path.id);
    for (const g of (f.guides as Array<{ sketch?: string }> | undefined) ?? []) if (g && typeof g === 'object' && g.sketch) used.add(g.sketch);
  }
  return used;
}
const freeSketches = (c: Ctx, fits: (s: Feat) => boolean, with3d = false): Feat[] => {
  const used = usedSketches(c);
  return feats(c).filter((f) => (f.type === 'sketch' || (with3d && f.type === 'sketch3d')) && fits(f) && !used.has(f.id));
};

const STD_AXIS: Record<string, number> = { right: 0, top: 1, front: 2 };   // the world axis a standard plane is normal to
/** Where a plane sits along its normal: the axis (0 x, 1 y, 2 z) and the signed distance, through standard planes and chains of offset Plane features; null when it cannot be told (a face, a tangent plane, a tilted one). */
function planePosition(c: Ctx, ref: { kind?: string; id?: string } | undefined, depth = 0): { axis: number; v: number } | null {
  if (!ref?.id || depth > 8) return null;
  if (ref.kind === 'std') return ref.id in STD_AXIS ? { axis: STD_AXIS[ref.id], v: 0 } : null;
  if (ref.kind !== 'feature') return null;
  const f = feats(c).find((x) => x.id === ref.id);
  if (!f || f.type !== 'plane' || (f.mode !== undefined && f.mode !== 'offset')) return null;
  const base = planePosition(c, f.base as never, depth + 1);
  const off = typeof f.offset === 'number' ? f.offset : Number(f.offset);
  return base && Number.isFinite(off) ? { axis: base.axis, v: base.v + off } : null;
}
/**
 * A solid loft may only start or end in a point. When one or two of the sections are point sketches they are moved to the
 * ends: the one lying before the other sections (along the loft direction, read from the planes) first, the one beyond them
 * last. Without readable plane positions the order is kept, so the editor shows the problem instead of a guess.
 */
export function orderPointSections(c: Ctx, ids: string[]): string[] {
  const sk = (id: string) => feats(c).find((f) => f.id === id);
  const points = ids.filter((id) => { const s = sk(id); return !!s && isPointSketch(s); });
  if (!points.length || points.length > 2 || points.length === ids.length) return ids;
  const pos = new Map(ids.map((id) => [id, planePosition(c, sk(id)?.plane as never)] as const));
  if ([...pos.values()].some((p) => !p) || new Set([...pos.values()].map((p) => p!.axis)).size !== 1) return ids;
  const v = (id: string) => pos.get(id)!.v;
  const others = ids.filter((id) => !points.includes(id));
  const dir = others.length >= 2 && v(others[others.length - 1]) < v(others[0]) ? -1 : 1;
  const lo = Math.min(...others.map((id) => v(id) * dir)), hi = Math.max(...others.map((id) => v(id) * dir));
  const head: string[] = [], tail: string[] = [];
  for (const id of [...points].sort((a, b) => (v(a) - v(b)) * dir)) {
    const x = v(id) * dir;
    if (x <= lo || (x < hi && x - lo <= hi - x && !head.length)) head.push(id); else tail.push(id);
  }
  return [...head, ...others, ...tail];
}
/**
 * Whether the profiles of a loft follow each other along the loft axis. Positions come from the sketch planes (standard planes
 * and chains of offset planes); the order is fine when the positions only rise or only fall. Returns the order sorted along the
 * axis (kept in the direction the list already runs, a point section moved to its nearer end) when it is not, else null; null
 * too when a position cannot be read (a face, a tilted plane) or the sections lie on different axes.
 */
export function loftAutoOrder(doc: Ctx['doc'], ids: string[]): string[] | null {
  const c = { doc } as Ctx;
  const sk = (id: string) => feats(c).find((f) => f.id === id);
  const pos = ids.map((id) => planePosition(c, sk(id)?.plane as never));
  if (ids.length < 3 || pos.some((p) => !p) || new Set(pos.map((p) => p!.axis)).size !== 1) return null;
  const v = new Map(ids.map((id, i) => [id, pos[i]!.v] as const));
  const run = ids.map((id) => v.get(id)!);
  const rising = run.every((x, i) => i === 0 || x >= run[i - 1]), falling = run.every((x, i) => i === 0 || x <= run[i - 1]);
  if (rising || falling) return null;
  const dir = run[run.length - 1] < run[0] ? -1 : 1;
  const sorted = [...ids].sort((a, b) => (v.get(a)! - v.get(b)!) * dir);
  const fixed = orderPointSections(c, sorted);
  return fixed.every((id, i) => id === ids[i]) ? null : fixed;
}
/**
 * A loft's profiles: the sketches selected in the tree (in selection order) when two or more fit; else every unused fitting
 * sketch drawn since the last loft / extrude / revolve / sweep, in tree order; else the two newest unused ones.
 */
export function loftProfileIds(c: Ctx, surface = false): string[] {
  const fits = surface ? hasCurves : (s: Feat) => isClosedSketch(s) || isPointSketch(s);
  const picked = (c.selectedIds ?? []).map((id) => feats(c).find((f) => f.id === id)).filter((f): f is Feat => !!f && f.type === 'sketch' && fits(f));
  const ordered = (ids: string[]) => { const o = orderPointSections(c, ids); return surface ? o : loftAutoOrder(c.doc, o) ?? o; };
  if (picked.length >= 2) return ordered(picked.map((s) => s.id));
  let list = freeSketches(c, fits);
  if (surface && list.length) { const open = isOpenSketch(list[list.length - 1]); list = list.filter((s) => isOpenSketch(s) === open); }
  if (list.length < 2) return [];
  const all = feats(c);
  const lastBody = all.map((f, i) => (['loft', 'extrude', 'revolve', 'sweep', 'sphere'].includes(f.type) ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
  const since = list.filter((s) => all.indexOf(s) > lastBody);
  return ordered((since.length >= 2 ? since : list.slice(-2)).map((s) => s.id));
}
/**
 * The rule for point sections of a solid loft: a point may only be the first or the last section, and not both. Returns the
 * message key of the first broken rule, else null. `isPoint` says whether a profile id is a point sketch.
 */
export function loftPointIssue(ids: string[], isPoint: (id: string) => boolean): 'loftPointMiddle' | 'loftPointBoth' | null {
  const pts = ids.map((id, i) => (isPoint(id) ? i : -1)).filter((i) => i >= 0);
  if (pts.length >= 2 && pts.every((i) => i === 0 || i === ids.length - 1) && ids.length >= 2) return 'loftPointBoth';
  if (pts.some((i) => i !== 0 && i !== ids.length - 1)) return 'loftPointMiddle';
  return null;
}
/**
 * A loft can only use sketches that come before it. When the profiles chosen include a later sketch, the loft moves to just
 * after the last one it uses: returns the `move` op and the id of that sketch (for the notice `Loft moved after ...`), else null.
 */
export function loftMoveAfter(features: Array<{ id: string }>, loftId: string, sketches: string[]): { op: EditOp; after: string } | null {
  const at = features.findIndex((f) => f.id === loftId);
  if (at < 0) return null;
  let last = -1, after = '';
  for (const id of sketches) { const i = features.findIndex((f) => f.id === id); if (i > last) { last = i; after = id; } }
  return last > at ? { op: { op: 'move', id: loftId, to: last }, after } : null;
}
/** A loft through the profiles `loftProfileIds` picks (a surface loft also takes open ones, all of one kind). */
export function loftOps(c: Ctx, surface = false): EditOp[] | null {
  const ids = loftProfileIds(c, surface);
  if (ids.length < 2) return null;
  return [{ op: 'add', feature: { type: 'loft', op: 'add', sketches: ids, ...(surface ? { surface: true } : {}) } }];
}
/** A sweep of the newest unused closed sketch along a curve feature selected in the tree, else the newest unused open sketch, else the last curve feature no sweep uses (the kernel's `{kind: 'curve'}` path). */
export function sweepOps(c: Ctx): EditOp[] | null {
  const profile = freeSketches(c, isClosedSketch).at(-1);
  const curves = curveFeatures(c);
  const picked = curves.find((f) => f.id === c.selectedId);
  const sketch = picked ? undefined : freeSketches(c, isOpenSketch, true).at(-1);   // a path may be a 3D sketch with one spline
  // the fallback curve is one no sweep runs along yet (as the sketches are the unused ones)
  const used = new Set(feats(c).filter((f) => f.type === 'sweep').map((f) => (f.path as { kind?: string; id?: string } | undefined)).filter((p) => p?.kind === 'curve').map((p) => p!.id));
  const curve = picked ?? (sketch ? undefined : curves.filter((f) => !used.has(f.id)).at(-1));
  const path = sketch ? { kind: 'sketch', id: sketch.id } : curve ? { kind: 'curve', id: curve.id } : null;
  return profile && path ? [{ op: 'add', feature: { type: 'sweep', op: 'add', sketch: profile.id, path } }] : null;
}

/** Sweep a profile along a path as a surface (a sheet kept as its definition). The path is the open sketch or curve feature selected in the tree, else the last open sketch, else the last curve feature; the profile is the selected or last closed sketch (else any sketch with a curve) that is not the path. Tangent frame, no caps: the form changes that. */
export function sweepSurfaceOps(c: Ctx): EditOp[] | null {
  const curves = curveFeatures(c);
  const sel = c.selectedId;
  const openSketches = feats(c).filter((f) => f.type === 'sketch' && isOpenSketch(f));
  const path: Feat | null = curves.find((f) => f.id === sel) ?? openSketches.find((f) => f.id === sel)
    ?? openSketches.at(-1) ?? curves.at(-1) ?? null;
  if (!path) return null;
  const sketches = feats(c).filter((f) => f.type === 'sketch' && f.id !== path.id && hasCurves(f));
  const profile = sketches.find((f) => f.id === sel && isClosedSketch(f)) ?? sketches.filter(isClosedSketch).at(-1) ?? sketches.at(-1) ?? null;
  return profile ? [{ op: 'add', feature: { type: 'sweepSurface', profile: profile.id, path: path.id, frame: 'tangent', tolerance: 0.001 } }] : null;
}
/** The default radius of a new blend: a tenth of the smallest dimension of the model, rounded. */
const blendRadius = (c: Ctx): number => niceSize(c.box ?? surfaceBox(c), 0.1);
/** A rolling-ball blend between two picked faces (of the part or of a sheet); the radius, the side of each face and the span are set in the form. */
export function blendSurfaceOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length >= 2 ? [{ op: 'add', feature: { type: 'blendSurface', faces: faces.slice(0, 2), radius: blendRadius(c), tolerance: 0.001 } }] : null;
}

const near = (a?: number[], b?: number[], tol = 1e-3): boolean => !!a && !!b && Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < tol;
const ends = (e: ViewEdge): number[][] => (e.pts && e.pts.length ? [e.pts[0], e.pts[e.pts.length - 1]] : []);
/** Edge references a surface feature takes: the two faces of an inner edge, or the one face of an open boundary edge, and a point on it. */
export function boundaryRefs(keys: string[], edges: ViewEdge[]): Array<{ faces: string[]; at: number[] }> {
  const byKey = new Map(edges.filter((e) => e.key).map((e) => [e.key!, e]));
  const out: Array<{ faces: string[]; at: number[] }> = [];
  for (const k of keys) {
    const e = byKey.get(k);
    if (e?.faces && (e.faces.length === 1 || e.faces.length === 2) && e.mid) out.push({ faces: [...e.faces], at: [...e.mid] });
  }
  return out;
}
/** The open boundary edges (one face) of a surface body made by feature `id`. */
export const openEdgesOf = (id: string, edges: ViewEdge[]): ViewEdge[] => edges.filter((e) => e.key && e.faces?.length === 1 && e.faces[0].startsWith(id + '.'));
/** The boundary edges chained end to end from the first one: one loop (or open run) of a sheet's border. */
export function boundaryLoop(open: ViewEdge[]): ViewEdge[] {
  if (!open.length) return [];
  const loop = [open[0]];
  const rest = open.slice(1);
  for (let grew = true; grew;) {
    grew = false;
    for (let i = 0; i < rest.length; i++) {
      if (loop.some((l) => ends(l).some((p) => ends(rest[i]).some((q) => near(p, q))))) { loop.push(rest.splice(i, 1)[0]); grew = true; break; }
    }
  }
  return loop;
}
const refOf = (e: ViewEdge) => ({ faces: [...(e.faces ?? [])], at: [...(e.mid ?? [])] });
/** The edges a surface edit works on: the picked edges, else the open border of the surface in the tree (its first loop, or only its first edge). */
function surfaceEdges(c: Ctx, take: 'loop' | 'first'): Array<{ faces: string[]; at: number[] }> {
  const picked = c.mode === 'edge' ? boundaryRefs(c.selection, c.edges) : [];
  if (picked.length) return picked;
  const target = surfaceTarget(c);
  if (!target) return [];
  const open = openEdgesOf(target.id, c.edges);
  return (take === 'loop' ? boundaryLoop(open) : open.slice(0, 1)).map(refOf);
}
/** A patch (continuity G0) over the picked boundary edges, else over the first open loop of the surface. */
export function fillOps(c: Ctx): EditOp[] | null {
  const edges = surfaceEdges(c, 'loop');
  return edges.length ? [{ op: 'add', feature: { type: 'fill', edges, merge: true, continuity: 'G0', fairing: 'meowNURBS' } }] : null;
}
/** Extend the picked boundary edges, else the first open edge of the surface in the tree (the kernel extends one border edge per feature: several adjacent ones answer extendNotBoundary). */
export function extendOps(c: Ctx): EditOp[] | null {
  const edges = surfaceEdges(c, 'first');
  return edges.length ? [{ op: 'add', feature: { type: 'extend', edges, distance: niceSize(c.box ?? surfaceBox(c), 0.1), shape: 'same' } }] : null;
}
/** The size of the model for a default distance when only surfaces exist: from the edge points. */
function surfaceBox(c: Ctx): Box | null {
  const pts = c.edges.flatMap((e) => e.pts ?? []);
  if (!pts.length) return null;
  const min = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])));
  return { min, max };
}

// ---- curves: project curve, edit curve, freeform ----

/** Curve features whose result is a curve a later feature can take (`curves[]` of the kernel result). */
const curveFeatures = (c: Ctx): Feat[] => feats(c).filter((f) => f.type === 'editCurve' || f.type === 'projectCurve' || f.type === 'offsetCurve' || f.type === 'compositeCurve' || f.type === 'helix');
const hasSurfaceBody = (c: Ctx): boolean => surfaceFeatures(c).length > 0;
/** Project a sketch (the one selected in the tree, else the last that holds a curve) or a selected Edit / Project curve onto the picked faces; no face picked projects onto every face of the part. */
export function projectCurveOps(c: Ctx): EditOp[] | null {
  const curve = curveFeatures(c).find((f) => f.id === c.selectedId && f.type !== 'helix');
  const sk = curve ? null : sketchWhere(c, hasCurves);
  const src = curve ? { curve: curve.id } : sk ? { sketch: sk.id } : null;
  return src ? [{ op: 'add', feature: { type: 'projectCurve', ...src, faces: faceMode(c), method: 'project', degree: 3, tolerance: 0.001, direction: 'both' } }] : null;
}
/** What an Offset curve or Composite curve starts from: the picked edges (in the order picked), else the curve feature selected in the tree, else a sketch that holds curves (the selected one, else the last). */
function chainSource(c: Ctx): Record<string, unknown> | null {
  const edges = c.mode === 'edge' ? edgeRefs(c.selection, c.edges) : [];
  if (edges.length) return { curves: edges.map((e) => ({ kind: 'edge', faces: e.faces, at: e.at })) };
  const curve = curveFeatures(c).find((f) => f.id === c.selectedId);
  if (curve) return { curve: curve.id };
  const sk = sketchWhere(c, hasCurves);
  return sk ? { sketch: sk.id } : null;
}
/** Offset the curves of a sketch, a selected curve or the picked edges by 5 mm in their own plane; the distance, the plane or face to offset in and the tolerances are set in the form. */
export function offsetCurveOps(c: Ctx): EditOp[] | null {
  const src = chainSource(c);
  return src ? [{ op: 'add', feature: { type: 'offsetCurve', ...src, distance: 5, tolerance: 0.001 } }] : null;
}
/** Join the curves of a sketch (walked into one chain), a selected curve or the picked edges (in the order picked) into one curve. */
export function compositeCurveOps(c: Ctx): EditOp[] | null {
  const src = chainSource(c);
  return src ? [{ op: 'add', feature: { type: 'compositeCurve', ...src, tolerance: 0.001 } }] : null;
}
/** The curves an Edit curve starts from: the picked edges, else the curve feature selected in the tree, else the curves of the sketch (selected, else last), else the last curve feature. */
export function editCurveOps(c: Ctx): EditOp[] | null {
  // by tolerance, with corners kept: a chain with a corner (two lines, a rounded rectangle) is refused as "not smooth" otherwise, and a count could be too small for it
  const defaults = { method: 'tolerance', degree: 3, tolerance: 0.01, keepEnds: true, keepCorners: true };
  const edges = c.mode === 'edge' ? edgeRefs(c.selection, c.edges) : [];
  if (edges.length) return [{ op: 'add', feature: { type: 'editCurve', curves: edges.map((e) => ({ kind: 'edge', faces: e.faces, at: e.at })), ...defaults } }];
  const picked = curveFeatures(c).find((f) => f.id === c.selectedId);
  const sk = picked ? null : sketchWhere(c, hasCurves);
  const ref = picked ?? (sk ? null : curveFeatures(c).at(-1));
  const curves = sk
    ? entitiesOf(sk).filter((e) => e.type !== 'point').map((e) => ({ kind: 'sketchCurve', sketch: sk.id, entity: e.id }))
    : ref ? [{ kind: 'curve', id: ref.id }] : [];
  return curves.length ? [{ op: 'add', feature: { type: 'editCurve', curves, ...defaults } }] : null;
}
/** Reshape the picked face by the control points of its net: rebuilt as a cubic of 2 x 2 spans (a 5 x 5 net); the moves are added in the Editor. Several faces are rebuilt together but cannot be moved by points (the Editor says so). */
export function freeformOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  return faces.length ? [{ op: 'add', feature: { type: 'freeform', faces, degreeU: 3, degreeV: 3, spansU: 2, spansV: 2, edits: [] } }] : null;
}

/** The plane a new gear sits on: the one picked planar face, else the selected reference plane, else the ground plane (the one lying flat for the current up axis). */
export function gearPlane(c: Ctx): { kind: string; id: string } {
  const faces = faceMode(c);
  if (faces.length === 1) return { kind: 'face', id: faces[0] };
  const pl = planeFeatures(c).find((f) => f.id === c.selectedId);
  return pl ? { kind: 'feature', id: pl.id } : { kind: 'std', id: groundPlaneId() };
}
/** A 20 tooth spur gear (module 2), or with `pair` that gear and a 40 tooth mate at the centre distance: all its features in ONE edit. */
export function gearCreateOps(c: Ctx, pair = false): EditOp[] | null {
  if (!c.doc) return null;
  const base: GearParams = { ...DEFAULT_GEAR, plane: gearPlane(c) };
  return gearCommitOps(c.doc as never, pair ? defaultPair(base) : base);
}

// ---- commands ----

interface Creator {
  id: string;
  tab: 'Features' | 'Surfaces';
  group: string;
  keys?: string;
  /** Has a longer description in the locale (`tip.<id>`), shown in the ribbon tooltip. */
  tip?: boolean;
  enabled(c: Ctx): boolean;
  ops(c: Ctx): EditOp[] | null;
}
const doc = (c: Ctx): boolean => !!c.doc;
const ok = (f: (c: Ctx) => unknown) => (c: Ctx): boolean => !!c.doc && f(c) !== null && f(c) !== false;

export const CREATORS: Creator[] = [
  { id: 'add-plane', tab: 'Features', group: 'Reference', keys: 'Shift+N', enabled: doc, ops: planeOps },
  { id: 'add-axis', tab: 'Features', group: 'Reference', keys: 'Shift+A', enabled: doc, ops: axisOps },
  { id: 'add-connector', tab: 'Features', group: 'Reference', tip: true, enabled: doc, ops: connectorOps },
  { id: 'add-draft', tab: 'Features', group: 'Modify', keys: 'Shift+G', enabled: (c) => hasSolid(c) && faceMode(c).length > 0, ops: draftOps },
  { id: 'add-rib', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && ok((x) => sketchWhere(x, isOpenSketch))(c), ops: ribOps },
  { id: 'add-lip', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && lipOps(c) !== null, ops: lipOps },
  { id: 'add-mirror', tab: 'Features', group: 'Modify', keys: 'Shift+M', enabled: (c) => hasSolid(c) && patternSeed(c) !== null, ops: mirrorOps },
  { id: 'add-pathpattern', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => hasSolid(c) && pathPatternOps(c) !== null, ops: pathPatternOps },
  { id: 'add-press-pull', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => pressPullOps(c) !== null, ops: pressPullOps },
  { id: 'add-combine', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => combineOps(c) !== null, ops: combineOps },
  { id: 'add-torus', tab: 'Features', group: 'Create', tip: true, enabled: doc, ops: torusOps },
  { id: 'add-pipe', tab: 'Features', group: 'Create', tip: true, enabled: (c) => doc(c) && pipeOps(c) !== null, ops: pipeOps },
  { id: 'add-coil', tab: 'Features', group: 'Create', tip: true, enabled: doc, ops: coilOps },
  { id: 'add-bounding-solid', tab: 'Features', group: 'Create', tip: true, enabled: (c) => hasSolid(c), ops: boundingSolidOps },
  { id: 'add-dome', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => domeOps(c) !== null, ops: domeOps },
  { id: 'add-wrap', tab: 'Features', group: 'Create', tip: true, enabled: (c) => wrapOps(c) !== null, ops: wrapOps },
  { id: 'add-split-face', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => splitFaceOps(c) !== null, ops: splitFaceOps },
  { id: 'add-offset-surface', tab: 'Surfaces', group: 'Edit', tip: true, enabled: (c) => doc(c) && offsetSurfaceOps(c) !== null, ops: offsetSurfaceOps },
  { id: 'add-scale', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c), ops: scaleOps },
  { id: 'add-split', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => hasSolid(c), ops: splitOps },
  { id: 'add-lip-joint', tab: 'Features', group: 'Modify', tip: true, enabled: (c) => hasSolid(c), ops: lipJointOps },
  { id: 'add-gear', tab: 'Features', group: 'Create', keys: 'Shift+Y', enabled: doc, ops: (c) => gearCreateOps(c) },
  { id: 'add-gear-pair', tab: 'Features', group: 'Create', enabled: doc, ops: (c) => gearCreateOps(c, true) },
  { id: 'add-helix', tab: 'Features', group: 'Curves', enabled: ok((c) => sketchWhere(c, hasCircle)), ops: helixOps },
  { id: 'add-project-curve', tab: 'Features', group: 'Curves', tip: true, enabled: (c) => (hasSolid(c) || hasSurfaceBody(c)) && projectCurveOps(c) !== null, ops: projectCurveOps },
  { id: 'add-edit-curve', tab: 'Features', group: 'Curves', tip: true, enabled: (c) => doc(c) && editCurveOps(c) !== null, ops: editCurveOps },
  { id: 'add-offset-curve', tab: 'Features', group: 'Curves', tip: true, enabled: (c) => doc(c) && offsetCurveOps(c) !== null, ops: offsetCurveOps },
  { id: 'add-composite-curve', tab: 'Features', group: 'Curves', tip: true, enabled: (c) => doc(c) && compositeCurveOps(c) !== null, ops: compositeCurveOps },
  { id: 'add-pipe-cut', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && pipeCutOps(c) !== null, ops: pipeCutOps },
  { id: 'add-delete-body', tab: 'Features', group: 'Bodies', enabled: (c) => hasSolid(c) && faceMode(c).length > 0, ops: deleteBodyOps },
  { id: 'add-surface-planar', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, isClosedSketch)), ops: surfacePlanarOps },
  { id: 'add-surface-extrude', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, hasCurves)), ops: surfaceExtrudeOps },
  { id: 'add-surface-revolve', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, hasProfileAndAxis)), ops: surfaceRevolveOps },
  { id: 'add-trim-surface', tab: 'Surfaces', group: 'Edit', tip: true, enabled: (c) => doc(c) && trimSurfaceOps(c) !== null, ops: trimSurfaceOps },
  { id: 'add-knit', tab: 'Surfaces', group: 'Edit', tip: true, enabled: ok((c) => (surfaceFeatures(c).length ? true : null)), ops: knitOps },
  { id: 'add-thicken', tab: 'Surfaces', group: 'Edit', tip: true, enabled: ok((c) => surfaceTarget(c)), ops: thickenOps },
  { id: 'add-loft', tab: 'Surfaces', group: 'Create', keys: 'Shift+O', tip: true, enabled: (c) => doc(c) && loftOps(c) !== null, ops: (c) => loftOps(c) },
  { id: 'add-sweep', tab: 'Surfaces', group: 'Create', keys: 'Shift+W', tip: true, enabled: (c) => doc(c) && sweepOps(c) !== null, ops: sweepOps },
  { id: 'add-surface-loft', tab: 'Surfaces', group: 'Create', tip: true, enabled: (c) => doc(c) && loftOps(c, true) !== null, ops: (c) => loftOps(c, true) },
  { id: 'add-sweep-surface', tab: 'Surfaces', group: 'Create', tip: true, enabled: (c) => doc(c) && sweepSurfaceOps(c) !== null, ops: sweepSurfaceOps },
  { id: 'add-blend-surface', tab: 'Surfaces', group: 'Create', tip: true, enabled: (c) => doc(c) && blendSurfaceOps(c) !== null, ops: blendSurfaceOps },
  { id: 'add-fill', tab: 'Surfaces', group: 'Edit', keys: 'Shift+I', tip: true, enabled: (c) => doc(c) && fillOps(c) !== null, ops: fillOps },
  { id: 'add-extend', tab: 'Surfaces', group: 'Edit', keys: 'Shift+X', tip: true, enabled: (c) => doc(c) && extendOps(c) !== null, ops: extendOps },
  { id: 'add-freeform', tab: 'Surfaces', group: 'Edit', tip: true, enabled: (c) => (hasSolid(c) || hasSurfaceBody(c)) && faceMode(c).length > 0, ops: freeformOps },
  { id: 'add-delete-face', tab: 'Surfaces', group: 'Edit', enabled: (c) => hasSolid(c) && faceMode(c).length > 0, ops: deleteFaceOps },
];

/** Keys of these commands (merged into SHORTCUTS by commands.ts is not needed: they are set on the command here). */
export function creatorCommands(a: FeatureActions): Command[] {
  return CREATORS.map((k): Command => ({
    id: k.id, label: t('cmd.' + k.id), tab: k.tab, group: k.group, ...(k.keys ? { keys: k.keys } : {}), ...(k.tip ? { tip: t('tip.' + k.id) } : {}),
    enabled: () => k.enabled(a.context()),
    run: () => { const ops = k.ops(a.context()); if (ops) a.create(ops); else a.notify(t('app.creator.nothing'), 'warn'); },
  }));
}
