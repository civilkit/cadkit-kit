// The fields each sheet metal feature's form owns (the generic editor hides them), and the pure patches the forms make. No DOM.
import type { PartDoc } from '@ck/part-model';
import { rulesOf } from './model';

type Wire = Record<string, unknown>;

export const CORNER_RELIEF_SHAPES = ['notch', 'round', 'rectangular', 'tear'] as const;
export const HEIGHT_FROM = ['outer', 'inner', 'tangent'] as const;
export const FLANGE_POSITIONS = ['inside', 'outside', 'middle'] as const;
export const FOLD_POSITIONS = ['centerline', 'start', 'end', 'mould'] as const;
/** The kernel allows at most this many chained bends after a flange. */
export const MAX_THEN = 16;

/** The fields the form of a sheet feature type draws; the generic editor draws the rest (the sketch and edges pickers). */
export function sheetManagedPaths(type: string): Set<string> {
  switch (type) {
    case 'sheetRules': return new Set(['thickness', 'kFactor', 'bendRadius', 'reliefWidth', 'reliefDepth', 'cornerRelief', 'cornerReliefShape', 'hemGap', 'gap', 'active']);
    case 'baseFlange': return new Set(['rule', 'flip']);
    case 'contourFlange': return new Set(['curves', 'distance', 'rule', 'flip', 'reverse']);
    case 'edgeFlange': return new Set(['height', 'angle', 'radius', 'heightFrom', 'position', 'flip', 'then', 'start', 'length', 'from', 'to', 'profile', 'holes', 'relief']);
    case 'hem': return new Set(['length', 'gap', 'flip', 'start', 'from', 'to', 'relief']);
    case 'fold': return new Set(['angle', 'radius', 'position', 'flip', 'line', 'points', 'fixed', 'panel']);
    case 'sheetConvert': return new Set(['thickness', 'rule']);
    case 'sheetCut': return new Set(['regions']);
    case 'sheetCorner': return new Set(['corners', 'mode', 'radius', 'distance', 'size']);
    default: return new Set();
  }
}

/** The names of the rules in the part, for the Rule list of a base or contour flange. */
export const ruleNames = (doc: PartDoc | null | undefined): string[] => rulesOf(doc).map((r) => String(r.name ?? r.id));

/** A chained bend of an edge flange (`then` item). */
export interface ThenBend { angle?: number | string; height?: number | string; flip?: boolean }
export const thenOf = (eff: Wire): ThenBend[] => (Array.isArray(eff.then) ? (eff.then as ThenBend[]) : []);
/** The `then` list with a bend added (the last bend's size repeated, else 90 degrees and 10 mm), up to MAX_THEN. */
export function addThen(eff: Wire): Wire {
  const list = thenOf(eff);
  if (list.length >= MAX_THEN) return {};
  const last = list[list.length - 1];
  return { then: [...list, { angle: last?.angle ?? 90, height: last?.height ?? 10 }] };
}
export function removeThen(eff: Wire, i: number): Wire {
  const list = thenOf(eff).filter((_, j) => j !== i);
  return { then: list.length ? list : null };
}
export function patchThen(eff: Wire, i: number, patch: Partial<ThenBend>): Wire {
  return { then: thenOf(eff).map((b, j) => (j === i ? { ...b, ...patch } : b)) };
}

/** The lines of a sketch of the document (id and a short name), for a fold line or the chain of a contour flange. */
export function sketchLines(doc: PartDoc | null | undefined, sketchId: unknown): string[] {
  const s = (doc?.features ?? []).find((f) => f.id === sketchId) as unknown as { entities?: Array<{ id: string; type: string }> } | undefined;
  return (s?.entities ?? []).filter((e) => e.type === 'line').map((e) => e.id);
}
export const foldLineOf = (eff: Wire): { sketch: string; curve: string } | null => {
  const l = eff.line as { sketch?: unknown; curve?: unknown } | undefined;
  return l && typeof l.sketch === 'string' && typeof l.curve === 'string' ? { sketch: l.sketch, curve: l.curve } : null;
};
/** Patch for choosing the fold's sketch: its first line becomes the curve. The two-point form (`points`) is dropped. */
export function patchFoldSketch(doc: PartDoc | null | undefined, sketch: string): Wire {
  return { line: { sketch, curve: sketchLines(doc, sketch)[0] ?? '' }, points: null };
}
export const patchFoldCurve = (eff: Wire, curve: string): Wire => ({ line: { sketch: foldLineOf(eff)?.sketch ?? '', curve }, points: null });

/** The ticked lines of a contour flange: none named means every line. */
export function contourCurves(eff: Wire, all: string[]): string[] {
  return Array.isArray(eff.curves) && (eff.curves as unknown[]).length ? (eff.curves as string[]) : all;
}
/** Patch for ticking a line of a contour flange: all lines ticked is no `curves` field. At least one stays ticked. */
export function patchContourCurve(eff: Wire, all: string[], id: string, on: boolean): Wire {
  const cur = contourCurves(eff, all);
  const next = all.filter((x) => (x === id ? on : cur.includes(x)));
  if (!next.length) return {};
  return { curves: next.length === all.length ? null : next };
}

// ---- panel picks (edge flange, hem, fold on a sheet with more than one panel) ----

/** The side value that means "the edge of the panel's outline, by number" in the wall list. */
export const RING = 'ring';
/** The edge pick for a wall of a panel: the role string `P<k>.<wall>` (`P2.tip`, `P1.side.start`), or `{ edge, panel }` (edge n of the ring of panel k) for `ring`. */
export function panelEdge(panel: number, wall: string, ring = 0): string | { edge: number; panel: number } {
  return wall === RING ? { edge: Math.max(0, Math.round(ring)), panel } : `P${panel}.${wall}`;
}
/** The walls to offer for a panel: the ones the kernel named, else the ones every leg of a flange has. */
export const wallChoices = (walls: string[][], panel: number): string[] => (walls[panel]?.length ? walls[panel] : ['tip', 'side.start', 'side.end']);
/** The edges field with a pick added (once). */
export function addEdgePick(eff: Wire, pick: unknown): Wire {
  const cur = Array.isArray(eff.edges) ? (eff.edges as unknown[]) : [];
  const key = JSON.stringify(pick);
  return cur.some((x) => JSON.stringify(x) === key) ? {} : { edges: [...cur, pick] };
}

// ---- corners (sheetCorner) ----

/** The corner picks of a sheet corner: world points or `{ panel, vertex }`. */
export const cornersOf = (eff: Wire): unknown[] => (Array.isArray(eff.corners) ? (eff.corners as unknown[]) : []);
/** The text of a corner pick: `x, y, z` or `P1 vertex 2`. */
export function cornerText(c: unknown): string {
  if (Array.isArray(c)) return c.map((v) => +(+v).toFixed(2)).join(', ');
  const o = c as { panel?: number; vertex?: number } | null;
  return o && typeof o.panel === 'number' && typeof o.vertex === 'number' ? `P${o.panel} vertex ${o.vertex}` : '';
}
/** The corner points the selected vertices (`v:x,y,z`) give. */
export function cornerPoints(selection: string[]): number[][] {
  const out: number[][] = [];
  for (const n of selection) {
    if (!n.startsWith('v:')) continue;
    const p = n.slice(2).split(',').map(Number);
    if (p.length === 3 && p.every(Number.isFinite)) out.push(p.map((v) => +v.toFixed(6)));
  }
  return out;
}
/** The patch that switches a corner between round and chamfer, keeping its size (radius becomes distance and back). */
export function patchCornerMode(eff: Wire, mode: 'round' | 'chamfer'): Wire {
  const size = mode === 'chamfer' ? eff.radius ?? eff.size : eff.distance ?? eff.size;
  return mode === 'chamfer' ? { mode, distance: size ?? 3, radius: null, size: null } : { mode, radius: size ?? 3, distance: null, size: null };
}
/** The size a corner has now (the radius of a round, the distance of a chamfer; `size` stands for either). */
export const cornerSize = (eff: Wire): unknown => (eff.mode === 'chamfer' ? eff.distance ?? eff.size : eff.radius ?? eff.size);

const near3 = (a: unknown, b: unknown): boolean => Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3 && Math.hypot(+a[0] - +b[0], +a[1] - +b[1], +a[2] - +b[2]) < 1e-4;
/** The corners field after the selection changed while picking: a vertex selected since `prev` is added, a vertex deselected is taken out; corners
 *  that were typed or kept from before (and are not points of the selection) stay. Null when nothing changed. */
export function applyCornerPick(current: unknown[], prev: string[], sel: string[]): unknown[] | null {
  const added = cornerPoints(sel.filter((n) => !prev.includes(n)));
  const gone = cornerPoints(prev.filter((n) => !sel.includes(n)));
  const next = current.filter((c) => !gone.some((g) => near3(c, g)));
  for (const a of added) if (!next.some((c) => near3(c, a))) next.push(a);
  return next.length === current.length && next.every((c, i) => c === current[i]) ? null : next;
}
/** The selection without the corner vertices the field no longer holds (a corner taken out with its chip stops being lit). */
export function cornerSelectionKeep(sel: string[], corners: unknown[]): string[] {
  return sel.filter((n) => !n.startsWith('v:') || cornerPoints([n]).some((p) => corners.some((c) => near3(c, p))));
}
