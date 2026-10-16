// Pure rules of the surface editors (loft, sweep, fill, extend, knit, trim): which sketches and surfaces a form offers and the
// draft patches its controls make. No DOM, so they are tested without a browser. A patch value of null removes the field.
import type { PartDoc } from '@ck/part-model';
import { isClosedSketch, isOpenSketch, isPointSketch, isSurfaceFeature } from './featureCreators';

type Wire = Record<string, unknown>;
type Feat = { id: string; type: string; name?: string; [k: string]: unknown };

export interface SketchInfo { id: string; name: string; closed: boolean; open: boolean; point: boolean }
export interface SurfaceInfo { id: string; name: string }

const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]);
const nameOf = (f: Feat): string => (f.name ? `${f.name} (${f.id})` : f.id);

/** Every sketch of the document with what it holds (a closed outline or circle, an open chain). */
export function sketchInfos(doc: PartDoc | null | undefined): SketchInfo[] {
  return feats(doc).filter((f) => f.type === 'sketch').map((f) => ({ id: f.id, name: nameOf(f), closed: isClosedSketch(f), open: isOpenSketch(f), point: isPointSketch(f) }));
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
export const pathOf = (eff: Wire): string => ((eff.path as { id?: string } | undefined)?.id ?? '');
export const pathPatch = (id: string): Wire => ({ path: { kind: 'sketch', id } });

// ---- fill ----

export const CONTINUITIES = ['G0', 'G1', 'G2', 'G3'] as const;
export const FAIRINGS = ['meowNURBS', 'plate', 'curvature', 'variation'] as const;
export type Continuity = (typeof CONTINUITIES)[number];
export const continuityOf = (eff: Wire): Continuity => (CONTINUITIES.includes(eff.continuity as never) ? (eff.continuity as Continuity) : 'G0');
export const fairingOf = (eff: Wire): string => (typeof eff.fairing === 'string' ? eff.fairing : 'meowNURBS');

// ---- knit ----

export const knitIds = (eff: Wire): string[] => (Array.isArray(eff.surfaces) ? (eff.surfaces as unknown[]).filter((x): x is string => typeof x === 'string') : []);
/** Toggle a surface in the knit list, keeping document order; never empties the list. */
export function toggleKnit(all: string[], list: string[], id: string): string[] {
  const set = new Set(list);
  if (set.has(id)) { if (set.size > 1) set.delete(id); } else set.add(id);
  return all.filter((x) => set.has(x));
}
