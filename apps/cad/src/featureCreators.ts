// More feature-creation commands (reference plane and axis, draft, rib, lip, mirror, helix, pipe cut, delete body, and the simple
// surface tools). Same pattern as featureCommands.ts: pure functions turn the document, the selection and the body on screen into
// ONE edit, `creatorCommands` registers them as palette and ribbon commands, and the app opens the Editor on the new feature.
// Features the kernel does not implement yet (moveFace, dome, scale, fillpattern, spattern, curvepattern, splitLine, surfaceOffset,
// cutWithSurface) have no command; see docs/feature-commands.md.
import type { Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import { t } from './i18n';
import { DEFAULT_GEAR, defaultPair, gearOps, type GearParams } from './gearData';
import { axisLine, edgeRefs, faceNames, niceSize, patternSeed, type Box, type Ctx, type FeatureActions, type ViewEdge } from './featureCommands';

type Feat = { id: string; type: string; [k: string]: unknown };
type Ent = { id: string; type: string; p1?: string; p2?: string; pts?: string[]; construction?: boolean; closed?: boolean };

const feats = (c: Ctx): Feat[] => (c.doc?.features ?? []) as unknown as Feat[];
const hasSolid = (c: Ctx): boolean => !!c.box;
const faceMode = (c: Ctx): string[] => (c.mode === 'face' ? faceNames(c.selection) : []);

// ---- sketches by what they hold ----

const entitiesOf = (s: Feat): Ent[] => ((s.entities as Ent[] | undefined) ?? []).filter((e) => !e.construction);
/** Endpoints of the open-able entities (line, arc, spline), counted per point. */
function degrees(ents: Ent[]): Map<string, number> {
  const d = new Map<string, number>();
  const bump = (p?: string) => { if (p) d.set(p, (d.get(p) ?? 0) + 1); };
  for (const e of ents) {
    if (e.type === 'line' || e.type === 'arc') { bump(e.p1); bump(e.p2); }
    else if ((e.type === 'spline' || e.type === 'cvspline') && e.pts && e.pts.length > 1) {
      // a closed spline is a loop: both ends are one point, so it counts twice and never reads as an open chain
      const k = e.closed === true ? 2 : 1;
      for (let i = 0; i < k; i++) { bump(e.pts[0]); bump(e.pts[e.pts.length - 1]); }
    }
  }
  return d;
}
const chainEntities = (ents: Ent[]) => ents.filter((e) => e.type === 'line' || e.type === 'arc' || e.type === 'spline' || e.type === 'cvspline');
const hasCircle = (s: Feat): boolean => entitiesOf(s).some((e) => e.type === 'circle' || e.type === 'ellipse');
/** A chain of lines / arcs with two loose ends (what a rib is drawn from). */
export const isOpenSketch = (s: Feat): boolean => {
  const ents = entitiesOf(s);
  const chain = chainEntities(ents);
  return chain.length > 0 && !hasCircle(s) && [...degrees(ents).values()].some((n) => n === 1);
};
/** Something that bounds a region: a circle / ellipse, or lines and arcs that all meet in pairs. */
export const isClosedSketch = (s: Feat): boolean => {
  const ents = entitiesOf(s);
  if (hasCircle(s)) return true;
  const d = degrees(ents);
  return chainEntities(ents).length > 0 && d.size > 0 && [...d.values()].every((n) => n >= 2);
};
export const hasCurves = (s: Feat): boolean => hasCircle(s) || chainEntities(entitiesOf(s)).length > 0;
const hasAxisLine = (s: Feat): boolean => isClosedSketch(s) && axisLine(s) !== null;

/** The sketch a command uses: the one selected in the tree if it fits, else the last that fits. */
export function sketchWhere(c: Ctx, fits: (s: Feat) => boolean): Feat | null {
  const list = feats(c).filter((f) => f.type === 'sketch' && fits(f));
  return list.find((f) => f.id === c.selectedId) ?? list[list.length - 1] ?? null;
}

// ---- surface features ----

/** Feature types that leave a surface body registered under their id. */
export const SURFACE_TYPES = ['surfacePlanar', 'surfaceExtrude', 'surfaceRevolve', 'surfaceOffset', 'trimSurface', 'fill', 'extend', 'pipeCut'];
/** Whether this feature leaves a surface body: the types above, a Knit that is not a solid, a Sweep or Loft asked for a surface. */
export const isSurfaceFeature = (f: Feat): boolean =>
  SURFACE_TYPES.includes(f.type) || (f.type === 'knit' && f.solid !== true) || ((f.type === 'loft' || f.type === 'sweep') && f.surface === true);
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

/** A reference plane. Two faces: the plane midway between them. One face: offset 10 from it. Nothing picked: offset 10 from the front plane. */
export function planeOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c);
  if (faces.length >= 2) return [{ op: 'add', feature: { type: 'plane', mode: 'mid', base: { kind: 'face', id: faces[0] }, base2: { kind: 'face', id: faces[1] } } }];
  const base = faces.length ? { kind: 'face', id: faces[0] } : { kind: 'std', id: 'front' };
  return [{ op: 'add', feature: { type: 'plane', mode: 'offset', base, offset: 10 } }];
}
/** A reference axis: along the cylinder of one face, or where two faces' planes meet. Nothing picked: the line where the front and top planes meet. */
export function axisOps(c: Ctx): EditOp[] | null {
  const faces = faceMode(c).slice(0, 2);
  const refs = faces.length ? faces.map((id) => ({ kind: 'face', id })) : [{ kind: 'std', id: 'front' }, { kind: 'std', id: 'top' }];
  return [{ op: 'add', feature: { type: 'axis', refs } }];
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
  return [{ op: 'add', feature: { type: 'draft', neutral: neutralPlane(c), faces, angle: 3 } }];
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
  const sk = sketchWhere(c, hasAxisLine);
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
  return s ? [{ op: 'add', feature: { type: 'thicken', surface: s.id, thickness: niceSize(c.box, 0.1) } }] : null;
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
const freeSketches = (c: Ctx, fits: (s: Feat) => boolean): Feat[] => {
  const used = usedSketches(c);
  return feats(c).filter((f) => f.type === 'sketch' && fits(f) && !used.has(f.id));
};
/**
 * A loft's profiles: the sketches selected in the tree (in selection order) when two or more fit; else every unused fitting
 * sketch drawn since the last loft / extrude / revolve / sweep, in tree order; else the two newest unused ones.
 */
export function loftProfileIds(c: Ctx, surface = false): string[] {
  const fits = surface ? hasCurves : isClosedSketch;
  const picked = (c.selectedIds ?? []).map((id) => feats(c).find((f) => f.id === id)).filter((f): f is Feat => !!f && f.type === 'sketch' && fits(f));
  if (picked.length >= 2) return picked.map((s) => s.id);
  let list = freeSketches(c, fits);
  if (surface && list.length) { const open = isOpenSketch(list[list.length - 1]); list = list.filter((s) => isOpenSketch(s) === open); }
  if (list.length < 2) return [];
  const all = feats(c);
  const lastBody = all.map((f, i) => (['loft', 'extrude', 'revolve', 'sweep'].includes(f.type) ? i : -1)).reduce((m, i) => Math.max(m, i), -1);
  const since = list.filter((s) => all.indexOf(s) > lastBody);
  return (since.length >= 2 ? since : list.slice(-2)).map((s) => s.id);
}
/** A loft through the profiles `loftProfileIds` picks (a surface loft also takes open ones, all of one kind). */
export function loftOps(c: Ctx, surface = false): EditOp[] | null {
  const ids = loftProfileIds(c, surface);
  if (ids.length < 2) return null;
  return [{ op: 'add', feature: { type: 'loft', op: 'add', sketches: ids, ...(surface ? { surface: true } : {}) } }];
}
/** A sweep of the newest unused closed sketch along the newest unused open one. */
export function sweepOps(c: Ctx): EditOp[] | null {
  const profile = freeSketches(c, isClosedSketch).at(-1);
  const path = freeSketches(c, isOpenSketch).at(-1);
  return profile && path ? [{ op: 'add', feature: { type: 'sweep', op: 'add', sketch: profile.id, path: { kind: 'sketch', id: path.id } } }] : null;
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

/** The plane a new gear sits on: the one picked planar face, else the selected reference plane, else the top plane. */
export function gearPlane(c: Ctx): { kind: string; id: string } {
  const faces = faceMode(c);
  if (faces.length === 1) return { kind: 'face', id: faces[0] };
  const pl = planeFeatures(c).find((f) => f.id === c.selectedId);
  return pl ? { kind: 'feature', id: pl.id } : { kind: 'std', id: 'top' };
}
/** A 20 tooth spur gear (module 2), or with `pair` that gear and a 40 tooth mate at the centre distance: all its features in ONE edit. */
export function gearCreateOps(c: Ctx, pair = false): EditOp[] | null {
  if (!c.doc) return null;
  const base: GearParams = { ...DEFAULT_GEAR, plane: gearPlane(c) };
  return gearOps(c.doc as never, pair ? defaultPair(base) : base);
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
  { id: 'add-draft', tab: 'Features', group: 'Modify', keys: 'Shift+G', enabled: (c) => hasSolid(c) && faceMode(c).length > 0, ops: draftOps },
  { id: 'add-rib', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && ok((x) => sketchWhere(x, isOpenSketch))(c), ops: ribOps },
  { id: 'add-lip', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && lipOps(c) !== null, ops: lipOps },
  { id: 'add-mirror', tab: 'Features', group: 'Modify', keys: 'Shift+M', enabled: (c) => hasSolid(c) && patternSeed(c) !== null, ops: mirrorOps },
  { id: 'add-gear', tab: 'Features', group: 'Create', keys: 'Shift+Y', enabled: doc, ops: (c) => gearCreateOps(c) },
  { id: 'add-gear-pair', tab: 'Features', group: 'Create', enabled: doc, ops: (c) => gearCreateOps(c, true) },
  { id: 'add-helix', tab: 'Features', group: 'Curves', enabled: ok((c) => sketchWhere(c, hasCircle)), ops: helixOps },
  { id: 'add-pipe-cut', tab: 'Features', group: 'Modify', enabled: (c) => hasSolid(c) && pipeCutOps(c) !== null, ops: pipeCutOps },
  { id: 'add-delete-body', tab: 'Features', group: 'Bodies', enabled: (c) => hasSolid(c) && faceMode(c).length > 0, ops: deleteBodyOps },
  { id: 'add-surface-planar', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, isClosedSketch)), ops: surfacePlanarOps },
  { id: 'add-surface-extrude', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, hasCurves)), ops: surfaceExtrudeOps },
  { id: 'add-surface-revolve', tab: 'Surfaces', group: 'Create', tip: true, enabled: ok((c) => sketchWhere(c, hasAxisLine)), ops: surfaceRevolveOps },
  { id: 'add-trim-surface', tab: 'Surfaces', group: 'Edit', tip: true, enabled: (c) => doc(c) && trimSurfaceOps(c) !== null, ops: trimSurfaceOps },
  { id: 'add-knit', tab: 'Surfaces', group: 'Edit', tip: true, enabled: ok((c) => (surfaceFeatures(c).length ? true : null)), ops: knitOps },
  { id: 'add-thicken', tab: 'Surfaces', group: 'Edit', tip: true, enabled: ok((c) => surfaceTarget(c)), ops: thickenOps },
  { id: 'add-loft', tab: 'Surfaces', group: 'Create', keys: 'Shift+O', tip: true, enabled: (c) => doc(c) && loftOps(c) !== null, ops: (c) => loftOps(c) },
  { id: 'add-sweep', tab: 'Surfaces', group: 'Create', keys: 'Shift+W', tip: true, enabled: (c) => doc(c) && sweepOps(c) !== null, ops: sweepOps },
  { id: 'add-surface-loft', tab: 'Surfaces', group: 'Create', tip: true, enabled: (c) => doc(c) && loftOps(c, true) !== null, ops: (c) => loftOps(c, true) },
  { id: 'add-fill', tab: 'Surfaces', group: 'Edit', keys: 'Shift+I', tip: true, enabled: (c) => doc(c) && fillOps(c) !== null, ops: fillOps },
  { id: 'add-extend', tab: 'Surfaces', group: 'Edit', keys: 'Shift+X', tip: true, enabled: (c) => doc(c) && extendOps(c) !== null, ops: extendOps },
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
