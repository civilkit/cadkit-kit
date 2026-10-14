// Feature-creation commands: fillet, chamfer, shell, hole, revolve and the two patterns. The functions that decide
// what a new feature contains are pure (they take the document, the selection and the body on screen), so they are
// tested against the real kernel without a DOM; `featureCommands` turns them into palette and ribbon commands.
import type { Command } from '@kit/ui';
import type { EditOp } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { BODY } from '@kit/store';
import { t } from './i18n';
import { newHole, type HolePrefs } from './holeData';
import { cylindersOfFaces, sameSizeFaces } from './threadData';

export interface Box { min: number[]; max: number[] }
export interface EdgeRef { faces: string[]; at: number[] }
export interface ViewEdge { key?: string; faces?: string[]; mid?: number[]; /** world-space polyline of the edge */ pts?: number[][] }
type Feat = { id: string; type: string; [k: string]: unknown };

/** A size for a new feature: about 5% of the smallest box dimension, rounded to 1, 2, 2.5 or 5 times a power of ten. */
export function niceSize(box: Box | null, fraction = 0.05): number {
  if (!box) return 1;
  const dims = [0, 1, 2].map((i) => box.max[i] - box.min[i]).filter((d) => d > 1e-9);
  if (!dims.length) return 1;
  const raw = Math.min(...dims) * fraction;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const m = raw / mag;
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].reduce((best, x) => (Math.abs(Math.log(x / m)) < Math.abs(Math.log(best / m)) ? x : best));
  return +(nice * mag).toPrecision(6);
}

/** Reference fields that take several names; the editor keeps following the selection for these. */
export const LIST_PATHS = new Set(['edges', 'faces']);

const isEdgeName = (n: string): boolean => n.includes('|');

/** The selected edges as kernel edge references (the two faces and a point on the edge). Names that are not edges of the body are skipped. */
export function edgeRefs(selection: string[], edges: ViewEdge[]): EdgeRef[] {
  const byKey = new Map(edges.filter((e) => e.key).map((e) => [e.key!, e]));
  const out: EdgeRef[] = [];
  const seen = new Set<string>();
  const add = (e: ViewEdge | undefined) => {
    if (e?.faces && e.faces.length === 2 && e.mid && !seen.has(e.key ?? '')) { seen.add(e.key ?? ''); out.push({ faces: [...e.faces], at: [...e.mid] }); }
  };
  for (const name of selection) {
    if (name.startsWith('v:')) {
      // a corner stands for every edge that ends there (rounding a cube corner rounds its three edges)
      const v = name.slice(2).split(',').map(Number);
      const near = (p?: number[]) => !!p && Math.hypot(p[0] - v[0], p[1] - v[1], p[2] - v[2]) < 1e-3;
      for (const e of edges) if (near(e.pts?.[0]) || near(e.pts?.[(e.pts?.length ?? 1) - 1])) add(e);
    } else add(byKey.get(name));
  }
  return out;
}

/** The selected faces, by name. */
export const faceNames = (selection: string[]): string[] => selection.filter((n) => !isEdgeName(n) && n !== BODY);

/** What a reference field takes from the current selection: the edge references, the face names, or the first name. Null when nothing fits. */
export function pickValue(path: string, selection: string[], edges: ViewEdge[]): unknown {
  if (path === 'edges') { const r = edgeRefs(selection, edges); return r.length ? r : null; }
  if (path === 'faces') { const r = faceNames(selection); return r.length ? r : null; }
  // a plane or neutral-plane field takes a face as a reference object (the kernel rejects a bare name)
  if (path === 'neutral' || path === 'plane') { const f = faceNames(selection)[0]; return f ? { kind: 'face', id: f } : null; }
  return selection[0] ?? null;
}

export interface Ctx {
  doc: PartDoc | null;
  selection: string[];
  mode: string;
  box: Box | null;
  edges: ViewEdge[];
  /** Id of the feature highlighted in the tree, if any. */
  selectedId?: string | null;
}

const feats = (doc: PartDoc | null): Feat[] => (doc?.features ?? []) as unknown as Feat[];

export const canFillet = (c: Ctx): boolean => !!c.doc && (c.mode === 'edge' || c.mode === 'vertex') && edgeRefs(c.selection, c.edges).length > 0;
export const canShell = (c: Ctx): boolean => !!c.doc && c.mode === 'face' && faceNames(c.selection).length > 0;

export const hasPointEntities = (f: { type: string; entities?: unknown }): boolean => f.type === 'sketch' && ((f.entities as Array<{ type: string }> | undefined) ?? []).some((e) => e.type === 'point');
const hasSolid = (c: Ctx): boolean => !!c.box;

/** A sketch of points made earlier: the selected one in the tree, else the last. */
export function pointSketch(c: Ctx): Feat | null {
  const list = feats(c.doc).filter(hasPointEntities);
  return list.find((f) => f.id === c.selectedId) ?? list[list.length - 1] ?? null;
}
/** A thread goes on each of the selected cylindrical faces (the wall of a hole, a shaft) of a body: judged from the circular edges the view has. */
export const canThread = (c: Ctx): boolean => !!c.doc && hasSolid(c) && c.mode === 'face' && cylindersOfFaces(faceNames(c.selection), c.edges) !== null;
/** "Select same size" needs one or more cylinder faces; it selects every cylinder of the same diameter and kind. */
export const canSelectSame = canThread;
export const canHole = (c: Ctx): boolean => !!c.doc && hasSolid(c) && ((c.mode === 'face' && faceNames(c.selection).length === 1) || pointSketch(c) !== null);

/** The construction line of a sketch that serves as the revolve axis (the first one), or null. */
export function axisLine(sketch: Feat): string | null {
  const e = ((sketch.entities as Array<{ id: string; type: string; construction?: boolean }> | undefined) ?? []).find((x) => x.type === 'line' && x.construction);
  return e?.id ?? null;
}
/** The sketch to revolve: the one selected in the tree, else the last sketch of the document. */
export function revolveSketch(c: Ctx): Feat | null {
  const sk = feats(c.doc).filter((f) => f.type === 'sketch');
  return sk.find((f) => f.id === c.selectedId) ?? sk[sk.length - 1] ?? null;
}
export const canRevolve = (c: Ctx): boolean => !!c.doc && revolveSketch(c) !== null;

/** The feature a pattern repeats: the one selected in the tree, else the last one that is not itself a sketch or pattern. */
export function patternSeed(c: Ctx): Feat | null {
  const list = feats(c.doc).filter((f) => !['sketch', 'sketch3d', 'lpattern', 'cpattern', 'plane', 'axis'].includes(f.type));
  return list.find((f) => f.id === c.selectedId) ?? list[list.length - 1] ?? null;
}
export const canPattern = (c: Ctx): boolean => !!c.doc && patternSeed(c) !== null;

// ---- the edits (each is ONE edit) ----

export function filletOps(c: Ctx): EditOp[] | null {
  const edges = edgeRefs(c.selection, c.edges);
  if (!edges.length) return null;
  return [{ op: 'add', feature: { type: 'fillet', radius: niceSize(c.box), edges } }];
}
export function chamferOps(c: Ctx): EditOp[] | null {
  const edges = edgeRefs(c.selection, c.edges);
  if (!edges.length) return null;
  return [{ op: 'add', feature: { type: 'chamfer', chamferType: 'equal', distance: niceSize(c.box), edges } }];
}
export function shellOps(c: Ctx): EditOp[] | null {
  const faces = faceNames(c.selection);
  if (!faces.length) return null;
  return [{ op: 'add', feature: { type: 'shell', faces, thickness: niceSize(c.box) } }];
}
/** A hole from a sketch of points. `flip` comes from the sketch's plane against the body (see Controller.extrudeFlip). The type, size and fit are the last ones used (default: simple M6 normal, through). */
export function holeOps(sketchId: string, flip: boolean, prefs?: HolePrefs): EditOp[] {
  return [{ op: 'add', feature: newHole(sketchId, flip, prefs) }];
}
export function revolveOps(sketch: Feat): EditOp[] | null {
  const axis = axisLine(sketch);
  if (!axis) return null;
  return [{ op: 'add', feature: { type: 'revolve', op: 'add', sketch: sketch.id, axis, end: 'blind', angle: 360 } }];
}
/** A world axis picked by the body's size: the longest (a row runs along it) or the shortest (a ring turns about it). */
function worldAxis(box: Box | null, which: 'longest' | 'shortest'): 'x' | 'y' | 'z' {
  if (!box) return which === 'longest' ? 'x' : 'z';
  const d = [0, 1, 2].map((i) => box.max[i] - box.min[i]);
  return (['x', 'y', 'z'] as const)[d.indexOf(which === 'longest' ? Math.max(...d) : Math.min(...d))];
}
export function linearPatternOps(seed: Feat, box: Box | null): EditOp[] {
  const axis = worldAxis(box, 'longest');
  const i = ['x', 'y', 'z'].indexOf(axis);
  const size = box ? box.max[i] - box.min[i] : 30;
  const spacing = Math.max(niceSize({ min: [0], max: [size] }, 0.2), 1);
  return [{ op: 'add', feature: { type: 'lpattern', seeds: [seed.id], dir: { kind: 'axis', axis }, spacing, count: 3 } }];
}
export function circularPatternOps(seed: Feat, box: Box | null): EditOp[] {
  return [{ op: 'add', feature: { type: 'cpattern', seeds: [seed.id], axis: { kind: 'axis', axis: worldAxis(box, 'shortest') }, count: 3, angle: 360, equal: true } }];
}

// ---- commands ----

export interface FeatureActions {
  context(): Ctx;
  /** Run the edit and open the Editor on the new feature. */
  create(ops: EditOp[]): void;
  /** Start a sketch on a face in the Point tool; when it is confirmed, add a hole from it. */
  holeOnFace(face: string): void;
  /** The flip a hole from this sketch needs so it drills into the body. */
  holeFlip(sketchId: string): boolean;
  /** Add a thread on this cylindrical face (needs the thread tables, so it is async) and open the Thread editor. */
  addThread(faces: string[]): void;
  /** Replace the selection (the "Select same size" action). */
  select?(names: string[]): void;
  notify(text: string, level?: 'error' | 'warn' | 'info'): void;
}

export function featureCommands(a: FeatureActions): Command[] {
  const c = () => a.context();
  const run = (f: (c: Ctx) => EditOp[] | null) => () => { const ops = f(c()); if (ops) a.create(ops); };
  const cmd = (id: string, enabled: (c: Ctx) => boolean, go: () => void): Command => ({ id, label: t('cmd.' + id), tab: 'Home', group: 'Features', enabled: () => enabled(c()), run: go });
  return [
    cmd('add-fillet', canFillet, run(filletOps)),
    cmd('add-chamfer', canFillet, run(chamferOps)),
    cmd('add-shell', canShell, run(shellOps)),
    cmd('add-hole', canHole, () => {
      const ctx = c();
      const face = ctx.mode === 'face' ? faceNames(ctx.selection) : [];
      if (face.length === 1) { a.holeOnFace(face[0]); return; }
      const sk = pointSketch(ctx);
      if (sk) a.create(holeOps(sk.id, a.holeFlip(sk.id)));
    }),
    cmd('add-thread', canThread, () => { const f = faceNames(c().selection); if (f.length) a.addThread(f); }),
    cmd('select-same-size', canSelectSame, () => {
      const ctx = c();
      const all = faceNames(ctx.selection).flatMap((f) => sameSizeFaces(f, ctx.edges));
      a.select?.([...new Set(all)]);
    }),
    cmd('add-revolve', canRevolve, () => {
      const sk = revolveSketch(c());
      const ops = sk ? revolveOps(sk) : null;
      if (ops) a.create(ops); else a.notify(t('app.noAxis'), 'error');
    }),
    cmd('add-lpattern', canPattern, () => { const s = patternSeed(c()); if (s) a.create(linearPatternOps(s, c().box)); }),
    cmd('add-cpattern', canPattern, () => { const s = patternSeed(c()); if (s) a.create(circularPatternOps(s, c().box)); }),
  ];
}
