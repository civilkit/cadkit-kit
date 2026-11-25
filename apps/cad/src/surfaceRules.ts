// Pure rules of the surface editors (loft, sweep, fill, extend, knit, trim): which sketches and surfaces a form offers and the
// draft patches its controls make. No DOM, so they are tested without a browser. A patch value of null removes the field.
import type { PartDoc } from '@ck/part-model';
import { isClosedSketch, isOpenSketch, isPointSketch, isSurfaceFeature } from './sketchKinds';

type Wire = Record<string, unknown>;
type Feat = { id: string; type: string; name?: string; [k: string]: unknown };

export interface SketchInfo { id: string; name: string; closed: boolean; open: boolean; point: boolean; /** a 3D sketch: only a sweep or path-pattern path can use it (guides and loft curves are 2D sketch curves) */ d3?: boolean }
export interface SurfaceInfo { id: string; name: string }

const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]);
const nameOf = (f: Feat): string => (f.name ? `${f.name} (${f.id})` : f.id);

/** Every sketch of the document with what it holds (a closed outline or circle, an open chain). A 3D sketch is listed `open` when it is one spline, the path the kernel sweeps. */
export function sketchInfos(doc: PartDoc | null | undefined): SketchInfo[] {
  return feats(doc).filter((f) => f.type === 'sketch' || f.type === 'sketch3d').map((f) => ({ id: f.id, name: nameOf(f), closed: isClosedSketch(f), open: isOpenSketch(f), point: isPointSketch(f), ...(f.type === 'sketch3d' ? { d3: true } : {}) }));
}
/** The surface bodies of the document (not `except`: a Knit cannot join itself). */
export function surfaceInfos(doc: PartDoc | null | undefined, except?: string): SurfaceInfo[] {
  return feats(doc).filter((f) => isSurfaceFeature(f) && f.id !== except).map((f) => ({ id: f.id, name: nameOf(f) }));
}

// ---- ordered lists (loft profiles and guides) ----

/** The list moved by `d` places from `i` (a no-op at either end). */
export function move<T>(list: T[], i: number, d: number): T[] {
  const j = i + d;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
export const removeAt = <T,>(list: T[], i: number): T[] => list.filter((_, k) => k !== i);
export const replaceAt = <T,>(list: T[], i: number, v: T): T[] => list.map((x, k) => (k === i ? v : x));
/** The first of `all` not in `list`, or null. */
export const nextFree = (all: string[], list: string[]): string | null => all.find((x) => !list.includes(x)) ?? null;

/** Loft profile sketch ids. */
export const loftProfiles = (eff: Wire): string[] => (Array.isArray(eff.sketches) ? (eff.sketches as unknown[]).filter((x): x is string => typeof x === 'string') : []);
/** Loft guide sketch ids (the kernel takes a bare id or `{sketch}`). */
export const loftGuides = (eff: Wire): string[] =>
  (Array.isArray(eff.guides) ? (eff.guides as unknown[]) : []).map((g) => (typeof g === 'string' ? g : (g as { sketch?: string } | null)?.sketch)).filter((x): x is string => !!x);
export const guidesPatch = (ids: string[]): Wire => ({ guides: ids.length ? ids.map((sketch) => ({ sketch })) : null });

/** Loft end tension: the kernel reads `startNormal` / `endNormal` as a number above zero (true is 1). 0 means free. */
export const tensionOf = (eff: Wire, key: 'startNormal' | 'endNormal'): number => {
  const v = eff[key];
  return typeof v === 'number' && v > 0 ? v : v === true ? 1 : 0;
};
export const tensionPatch = (key: 'startNormal' | 'endNormal', v: number): Wire => ({ [key]: v > 0 ? v : null });

/** A loft end condition, in Fusion's terms: how the loft leaves the first or the last profile. Angle is measured from the profile plane (90 = straight out along its normal). */
export type LoftCondType = 'free' | 'directional' | 'tangent' | 'curvature';
export interface LoftCond { type: LoftCondType; angle: number; weight: number }
export const LOFT_COND_TYPES: readonly LoftCondType[] = ['free', 'directional', 'tangent', 'curvature'];
/** Conditions this app and the kernel can apply today; Tangent and Curvature are listed but refused by the kernel until it has them. */
export const LOFT_COND_LIVE: readonly LoftCondType[] = ['free', 'directional'];
const legacyKey = (i: number, n: number): 'startNormal' | 'endNormal' | null => (i === 0 ? 'startNormal' : i === n - 1 ? 'endNormal' : null);
const condList = (eff: Wire, n: number): Array<Record<string, unknown> | null> =>
  Array.from({ length: n }, (_, i) => { const c = Array.isArray(eff.conditions) ? (eff.conditions as unknown[])[i] : null; return c && typeof c === 'object' ? (c as Record<string, unknown>) : null; });
/** The condition at profile `i` of `n`: a `conditions` entry, else the old start / end tension (directional, 90 degrees, the tension as weight), else free. */
export function loftCondition(eff: Wire, n: number, i: number): LoftCond {
  const c = condList(eff, n)[i];
  if (c && LOFT_COND_TYPES.includes(c.type as LoftCondType)) {
    return { type: c.type as LoftCondType, angle: typeof c.angle === 'number' ? c.angle : 90, weight: typeof c.weight === 'number' && c.weight > 0 ? c.weight : 1 };
  }
  const k = legacyKey(i, n);
  const w = k ? tensionOf(eff, k) : 0;
  return w > 0 ? { type: 'directional', angle: 90, weight: w } : { type: 'free', angle: 90, weight: 1 };
}
/** The patch that sets profile `i`'s condition. Free, and a directional one at 90 degrees, are written in the old startNormal / endNormal form (so the file still opens in older versions); the rest go in `conditions`. */
export function loftConditionPatch(eff: Wire, n: number, i: number, c: LoftCond): Wire {
  const list = condList(eff, n);
  const k = legacyKey(i, n);
  const patch: Wire = {};
  const plain = c.type === 'free' || (c.type === 'directional' && c.angle === 90 && k !== null);
  if (plain && k) { list[i] = null; patch[k] = c.type === 'free' ? null : c.weight; }
  else {
    list[i] = { type: c.type, angle: c.angle, weight: c.weight };
    if (k) patch[k] = null;
  }
  patch.conditions = list.some((x) => x) ? list : null;
  return patch;
}

/** The loft centre line: the id of the sketch (a planar open chain) the sections follow, or ''. */
export const centreLineOf = (eff: Wire): string => ((eff.centreLine as { sketch?: unknown } | null | undefined)?.sketch as string | undefined) ?? '';
export const centreLinePatch = (sketch: string): Wire => ({ centreLine: sketch ? { sketch } : null });

/** Loft connectors, one per profile: the fraction (0 to 1) of a closed profile's length where its start point sits, null = chosen by the kernel. */
export function connectorsOf(eff: Wire, n: number): Array<number | null> {
  const a = Array.isArray(eff.connectors) ? (eff.connectors as unknown[]) : [];
  return Array.from({ length: n }, (_, i) => (typeof a[i] === 'number' && Number.isFinite(a[i] as number) ? (a[i] as number) : null));
}
/** Sets the connector of profile `i`; none left set removes the field. */
export function connectorPatch(eff: Wire, n: number, i: number, value: number | null): Wire {
  const c = connectorsOf(eff, Math.max(n, i + 1));
  c[i] = value === null || !Number.isFinite(value) ? null : Math.min(1, Math.max(0, value));
  return { connectors: c.some((x) => x !== null) ? c : null };
}

// ---- thicken ----

/** The ramp of a variable thicken: thickness = interpolation of `stops` [s, t] at s = point . along (docs/spec-agent-interface.md "Variable thickness"). */
export const MAX_STOPS = 6;
export const thickenVariable = (eff: Wire): boolean => !!eff.thicknessAt && typeof eff.thicknessAt === 'object';
type Ramp = { along?: unknown; stops?: unknown };
export function alongOf(eff: Wire): [number, number, number] {
  const a = (eff.thicknessAt as Ramp | undefined)?.along;
  const n = (i: number) => (Array.isArray(a) && typeof a[i] === 'number' ? (a[i] as number) : 0);
  return Array.isArray(a) ? [n(0), n(1), n(2)] : [0, 0, 1];
}
export function stopsOf(eff: Wire): Array<[number, number]> {
  const a = (eff.thicknessAt as Ramp | undefined)?.stops;
  return (Array.isArray(a) ? a : []).map((x) => (Array.isArray(x) ? [Number(x[0]), Number(x[1])] as [number, number] : [0, 1]));
}
const constantOf = (eff: Wire): number => (typeof eff.thickness === 'number' && eff.thickness > 0 ? eff.thickness : 1);
/** Variable thickness on or off. On starts a two-stop ramp from the constant thickness to half of it along Z; off keeps the first stop as the constant one. */
export function patchThickenVariable(eff: Wire, on: boolean): Wire {
  if (on) { const t = constantOf(eff); return { thickness: null, thicknessAt: { along: [0, 0, 1], stops: [[0, t], [10, t / 2]] } }; }
  return { thicknessAt: null, thickness: stopsOf(eff)[0]?.[1] ?? constantOf(eff) };
}
export const THICKEN_AXES: Array<[string, number[]]> = [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]];
/** The axis name of `along` when it is X, Y or Z, else 'custom'. */
export const thickenAxisOf = (eff: Wire): string => THICKEN_AXES.find(([, v]) => v.every((x, i) => x === alongOf(eff)[i]))?.[0] ?? 'custom';
export const patchThickenAxis = (eff: Wire, axis: string): Wire => {
  const v = THICKEN_AXES.find(([k]) => k === axis)?.[1];
  return v ? { thicknessAt: { along: v, stops: stopsOf(eff) } } : {};
};
export function patchStop(eff: Wire, i: number, which: 0 | 1, value: number): Wire {
  const stops = stopsOf(eff).map((s) => [...s] as [number, number]);
  if (stops[i]) stops[i][which] = value;
  return { thicknessAt: { along: alongOf(eff), stops } };
}
export function addStop(eff: Wire): Wire {
  const stops = stopsOf(eff);
  if (stops.length >= MAX_STOPS) return {};
  const [s1, t1] = stops[stops.length - 1] ?? [0, constantOf(eff)];
  const step = stops.length > 1 ? s1 - stops[stops.length - 2][0] : 10;
  return { thicknessAt: { along: alongOf(eff), stops: [...stops, [s1 + (step > 0 ? step : 10), t1]] } };
}
export function removeStop(eff: Wire, i: number): Wire {
  const stops = stopsOf(eff);
  if (stops.length <= 2) return {};
  return { thicknessAt: { along: alongOf(eff), stops: stops.filter((_, k) => k !== i) } };
}

// ---- sweep ----

/** The curve entities (lines, arcs, splines, circles) of a sketch, for a guide curve reference. */
export function curveEntities(doc: PartDoc | null | undefined, sketch: string): string[] {
  const sk = feats(doc).find((f) => f.id === sketch && f.type === 'sketch');
  return (((sk?.entities as Array<{ id: string; type: string; construction?: boolean }> | undefined) ?? [])
    .filter((e) => !e.construction && e.type !== 'point').map((e) => e.id));
}
export interface CurveRef { sketch: string; entity: string }
export const sweepGuides = (eff: Wire): CurveRef[] =>
  (Array.isArray(eff.guides) ? (eff.guides as Array<Record<string, unknown>>) : [])
    .filter((g) => g && g.kind === 'sketchCurve' && typeof g.sketch === 'string' && typeof g.entity === 'string').map((g) => ({ sketch: g.sketch as string, entity: g.entity as string }));
export const sweepGuidesPatch = (refs: CurveRef[]): Wire => ({ guides: refs.length ? refs.map((r) => ({ kind: 'sketchCurve', sketch: r.sketch, entity: r.entity })) : null, ...(refs.length ? { twist: null } : {}) });
/** A twisted sweep runs only along a straight path (one line, or lines all in one direction): along an arc, a spline or a path of several different pieces the kernel answers notImplemented. A curve-feature path is not offered the twist. */
export function sweepTwistable(doc: PartDoc | null | undefined, eff: Wire): boolean {
  const path = eff.path as { kind?: string; id?: string } | undefined;
  if (!path || !path.id) return true;   // nothing chosen yet: keep the control
  if (path.kind === 'curve') return false;
  const sk = feats(doc).find((f) => f.id === path.id && f.type === 'sketch');
  if (!sk) return true;
  const pts = new Map(((sk.points as Array<{ id: string; x: number; y: number }> | undefined) ?? []).map((q) => [q.id, q] as const));
  const ents = ((sk.entities as Array<{ type: string; p1?: string; p2?: string; construction?: boolean }> | undefined) ?? []).filter((e) => !e.construction && e.type !== 'point');
  if (!ents.length) return true;
  let d0: [number, number] | null = null;
  for (const e of ents) {
    if (e.type !== 'line') return false;
    const a = pts.get(e.p1 ?? ''), b = pts.get(e.p2 ?? '');
    if (!a || !b) return true;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const d: [number, number] = [(b.x - a.x) / len, (b.y - a.y) / len];
    if (!d0) d0 = d; else if (d[0] * d0[0] + d[1] * d0[1] < 0.999999) return false;
  }
  return true;
}
export const pathOf = (eff: Wire): string => ((eff.path as { id?: string } | undefined)?.id ?? '');
export const pathPatch = (id: string): Wire => ({ path: { kind: 'sketch', id } });

// ---- fill ----

export const CONTINUITIES = ['G0', 'G1', 'G2', 'G3'] as const;
export const FAIRINGS = ['meowNURBS', 'plate', 'curvature', 'variation'] as const;
export type Continuity = (typeof CONTINUITIES)[number];
export const continuityOf = (eff: Wire): Continuity => (CONTINUITIES.includes(eff.continuity as never) ? (eff.continuity as Continuity) : 'G0');
/** `single` (one planar or ruled face, the default) or `nSided`: N bicubic faces round a centre vertex, G0 or G1 only. */
export const PATCHES = ['single', 'nSided'] as const;
export type FillPatch = (typeof PATCHES)[number];
export const patchOf = (eff: Wire): FillPatch => (eff.patch === 'nSided' ? 'nSided' : 'single');
export const N_SIDED_CONTINUITIES = ['G0', 'G1'] as const;
/** The continuities a patch takes. */
export const continuitiesFor = (p: FillPatch): readonly Continuity[] => (p === 'nSided' ? N_SIDED_CONTINUITIES : CONTINUITIES);
/** The kernel's default `patchTolerance` (mm). */
export const DEFAULT_PATCH_TOLERANCE = 1e-4;
/** Choosing the patch: N-sided keeps G0 or G1 (a G2 or G3 fill falls back to G0, which the kernel would refuse), and drops the fields of the other patch. */
export function patchChoice(eff: Wire, p: FillPatch): Wire {
  if (p === 'nSided') return { patch: 'nSided', ...((N_SIDED_CONTINUITIES as readonly string[]).includes(continuityOf(eff)) ? {} : { continuity: 'G0' }), patchTolerance: typeof eff.patchTolerance === 'number' ? eff.patchTolerance : DEFAULT_PATCH_TOLERANCE };
  return { patch: null, patchTolerance: null };
}
export const fairingOf = (eff: Wire): string => (typeof eff.fairing === 'string' ? eff.fairing : 'meowNURBS');

// ---- knit ----

export const knitIds = (eff: Wire): string[] => (Array.isArray(eff.surfaces) ? (eff.surfaces as unknown[]).filter((x): x is string => typeof x === 'string') : []);
/** Toggle a surface in the knit list, keeping document order; never empties the list. */
export function toggleKnit(all: string[], list: string[], id: string): string[] {
  const set = new Set(list);
  if (set.has(id)) { if (set.size > 1) set.delete(id); } else set.add(id);
  return all.filter((x) => set.has(x));
}
