// Pure rules of the Project curve, Edit curve and Freeform forms (FeatureOptions.tsx): which fields each form owns, which
// sources and curves it offers, and the draft patches its controls make. No DOM, so they are tested without a browser
// (curveRules.test.ts) and against the kernel (curveCommands.kernel.test.ts). A patch value of null removes the field.
import type { PartDoc } from '@ck/part-model';
import { t } from './i18n';
import { curveEntities, removeAt, replaceAt, sketchInfos } from './surfaceRules';
import { hasCurves } from './featureCreators';

type Wire = Record<string, unknown>;
type Feat = { id: string; type: string; name?: string; [k: string]: unknown };
const feats = (doc: PartDoc | null | undefined): Feat[] => ((doc?.features ?? []) as unknown as Feat[]);
const labelOf = (f: Feat): string => (f.name ? `${f.name} (${f.id})` : f.id);

/** The fields these forms own; the generic editor hides them. */
export function curveManaged(type: string): Set<string> {
  switch (type) {
    case 'projectCurve': return new Set(['sketch', 'curve', 'faces', 'degree', 'tolerance', 'direction']);
    case 'editCurve': return new Set(['curves', 'method', 'degree', 'count', 'tolerance', 'keepEnds', 'keepTangents', 'keepCorners', 'planar', 'plane', 'entries']);
    case 'freeform': return new Set(['faces', 'degreeU', 'degreeV', 'spansU', 'spansV', 'edits']);
    default: return new Set();
  }
}

// ---- shared ----

/** The curve features a later curve feature can take as input (their result is a curve in `curves[]`). */
export const CURVE_FEATURES = ['editCurve', 'projectCurve'] as const;
/** The Plane features before `selfId` (a curve or face edit may reference them), as `[value, label]`; `std:` planes first. */
export function planeChoices(doc: PartDoc | null | undefined, selfId: string, current: unknown): Array<[string, string]> {
  const out: Array<[string, string]> = [['std:front', t('app.ref.front')], ['std:top', t('app.ref.top')], ['std:right', t('app.ref.right')]];
  for (const f of feats(doc)) {
    if (f.id === selfId) break;
    if (f.type === 'plane') out.push([`feature:${f.id}`, labelOf(f)]);
  }
  const c = current as { kind?: string; id?: string } | null | undefined;
  if (c?.kind && c.id && !out.some(([v]) => v === `${c.kind}:${c.id}`)) out.push([`${c.kind}:${c.id}`, c.kind === 'face' ? t('opt.plane.face', { id: c.id }) : c.id]);
  return out;
}
export const planeValue = (ref: unknown): string => {
  const c = ref as { kind?: string; id?: string } | null | undefined;
  return c?.kind && c.id ? `${c.kind}:${c.id}` : '';
};
export const planeRef = (value: string): { kind: string; id: string } => {
  const i = value.indexOf(':');
  return { kind: value.slice(0, i), id: value.slice(i + 1) };
};
const numberOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

// ---- Project curve ----

export const PROJECT_DIRECTIONS = ['both', 'forward', 'reverse'] as const;
export type ProjectDirection = (typeof PROJECT_DIRECTIONS)[number];
export const directionOf = (eff: Wire): ProjectDirection => ((PROJECT_DIRECTIONS as readonly string[]).includes(String(eff.direction)) ? (eff.direction as ProjectDirection) : 'both');
/** The kernel accepts a degree from 2 to 9 (`editCurveDegree` otherwise). */
export const DEGREE_RANGE = { min: 2, max: 9 } as const;
export const degreeOutOfRange = (v: unknown): boolean => typeof v === 'number' && (v < DEGREE_RANGE.min || v > DEGREE_RANGE.max);

/** What a projection starts from: `sketch:S1` or `curve:F5` (a `curve` wins in the kernel when both are given). '' for neither. */
export const sourceValue = (eff: Wire): string =>
  typeof eff.curve === 'string' && eff.curve ? `curve:${eff.curve}` : typeof eff.sketch === 'string' && eff.sketch ? `sketch:${eff.sketch}` : '';
/** The choice list: the sketches that hold a curve, then the curve features before this one; the current source is kept even when it no longer fits. */
export function sourceChoices(doc: PartDoc | null | undefined, selfId: string, eff: Wire): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const sk = sketchInfos(doc);
  for (const s of sk) if (hasCurves(feats(doc).find((f) => f.id === s.id) as never)) out.push([`sketch:${s.id}`, s.name]);
  for (const f of feats(doc)) {
    if (f.id === selfId) break;
    if ((CURVE_FEATURES as readonly string[]).includes(f.type)) out.push([`curve:${f.id}`, `${t('feature.' + f.type, undefined, f.type)}: ${labelOf(f)}`]);
  }
  const cur = sourceValue(eff);
  if (cur && !out.some(([v]) => v === cur)) out.unshift([cur, cur.slice(cur.indexOf(':') + 1)]);
  return out;
}
export function sourcePatch(value: string): Wire {
  const i = value.indexOf(':');
  const kind = value.slice(0, i), id = value.slice(i + 1);
  return kind === 'curve' ? { curve: id, sketch: null } : { sketch: id, curve: null };
}
export const faceList = (eff: Wire): string[] => (Array.isArray(eff.faces) ? (eff.faces as unknown[]).filter((x): x is string => typeof x === 'string') : []);

// ---- Edit curve ----

export const EDIT_METHODS = ['count', 'tolerance'] as const;
export type EditMethod = (typeof EDIT_METHODS)[number];
export const methodOf = (eff: Wire): EditMethod => (eff.method === 'tolerance' ? 'tolerance' : 'count');
export const degreeOf = (eff: Wire): number => numberOr(eff.degree, 5);
export function patchMethod(eff: Wire, m: EditMethod): Wire {
  return m === 'tolerance'
    ? { method: 'tolerance', count: null, tolerance: numberOr(eff.tolerance, 0.01) }
    : { method: null, tolerance: null, count: numberOr(eff.count, degreeOf(eff) + 1) };
}
/** `keepEnds` is on unless it says false. */
export const keepEndsOn = (eff: Wire): boolean => eff.keepEnds !== false;
export const keepEndsPatch = (on: boolean): Wire => ({ keepEnds: on ? null : false });
export const planarOn = (eff: Wire): boolean => eff.planar === true;
/** Planar projection needs a plane (`editCurveNoPlane`): switching it on gives the Front plane; off drops both. */
export const planarPatch = (eff: Wire, on: boolean): Wire =>
  on ? { planar: true, plane: eff.plane && typeof eff.plane === 'object' ? eff.plane : { kind: 'std', id: 'front' } } : { planar: null, plane: null };

export const curveRefs = (eff: Wire): Wire[] => (Array.isArray(eff.curves) ? (eff.curves as Wire[]).filter((c) => c && typeof c === 'object') : []);
export const curvesPatch = (refs: Wire[]): Wire => ({ curves: refs });
/** A curve reference in words. */
export function curveRefLabel(doc: PartDoc | null | undefined, r: Wire): string {
  if (r.kind === 'sketchCurve') {
    const s = feats(doc).find((f) => f.id === r.sketch);
    return t('opt.editCurve.ref.sketch', { entity: String(r.entity), sketch: s ? labelOf(s) : String(r.sketch) });
  }
  if (r.kind === 'edge') return t('opt.editCurve.ref.edge', { faces: Array.isArray(r.faces) ? (r.faces as string[]).join(' | ') : '' });
  if (r.kind === 'curve') { const f = feats(doc).find((x) => x.id === r.id); return f ? `${t('feature.' + f.type, undefined, f.type)}: ${labelOf(f)}` : String(r.id); }
  return '';
}
/** The curves still on offer to add: sketch entities not in the list, then earlier curve features not in it. */
export function addableCurves(doc: PartDoc | null | undefined, selfId: string, refs: Wire[]): Wire[] {
  const out: Wire[] = [];
  for (const f of feats(doc)) {
    if (f.id === selfId) break;
    if (f.type === 'sketch') for (const entity of curveEntities(doc, f.id)) { if (!refs.some((r) => r.kind === 'sketchCurve' && r.sketch === f.id && r.entity === entity)) out.push({ kind: 'sketchCurve', sketch: f.id, entity }); }
    if ((CURVE_FEATURES as readonly string[]).includes(f.type) || f.type === 'helix') { if (!refs.some((r) => r.kind === 'curve' && r.id === f.id)) out.push({ kind: 'curve', id: f.id }); }
  }
  return out;
}
/** A sketch curve row moved to another sketch or entity (the first entity of a new sketch). */
export function retargetSketchCurve(doc: PartDoc | null | undefined, refs: Wire[], i: number, patch: { sketch?: string; entity?: string }): Wire[] {
  const cur = refs[i];
  const sketch = patch.sketch ?? String(cur.sketch);
  const entity = patch.entity ?? (patch.sketch ? curveEntities(doc, sketch)[0] ?? String(cur.entity) : String(cur.entity));
  return replaceAt(refs, i, { kind: 'sketchCurve', sketch, entity });
}
export const removeCurve = (refs: Wire[], i: number): Wire[] => removeAt(refs, i);

export type EntryFrame = 'world' | 'curve';
export const entries = (eff: Wire): Wire[] => (Array.isArray(eff.entries) ? (eff.entries as Wire[]).filter((e) => e && typeof e === 'object') : []);
/** A new control point edit: the next point after the last edit, no offset yet. */
export const newEntry = (list: Wire[]): Wire => ({ cv: list.length ? numberOr(list[list.length - 1].cv, 0) + 1 : 0, dx: 0, dy: 0, dz: 0 });
export const entryFrameOf = (e: Wire): EntryFrame => (e.frame === 'curve' ? 'curve' : 'world');
export function patchEntry(list: Wire[], i: number, patch: Wire): Wire[] {
  const next: Wire = { ...list[i], ...patch };
  for (const k of Object.keys(next)) if (next[k] === null) delete next[k];
  return replaceAt(list, i, next);
}
export const entriesPatch = (list: Wire[]): Wire => ({ entries: list.length ? list : null });

// ---- Freeform ----

export const FREEFORM_FRAMES = ['world', 'surface', 'plane'] as const;
export type FreeformFrame = (typeof FREEFORM_FRAMES)[number];
export const frameOf = (e: Wire): FreeformFrame => (e.frame === 'surface' || e.frame === 'plane' ? e.frame : 'world');
/** The control net of a rebuilt face has `spans + degree` points each way. */
export function netSize(eff: Wire): [number, number] {
  const n = (k: string, d: number) => Math.max(1, Math.round(numberOr(eff[k], d)));
  return [n('spansU', 2) + n('degreeU', 3), n('spansV', 2) + n('degreeV', 3)];
}
export const edits = (eff: Wire): Wire[] => (Array.isArray(eff.edits) ? (eff.edits as Wire[]).filter((e) => e && typeof e === 'object') : []);
/** "1,2; 3,4" to [[1,2],[3,4]]; null when any pair is not two whole numbers from 0 up. */
export function parsePoints(text: string): number[][] | null {
  const out: number[][] = [];
  for (const part of text.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
    const m = /^\(?\s*(\d+)\s*[, ]\s*(\d+)\s*\)?$/.exec(part);
    if (!m) return null;
    out.push([Number(m[1]), Number(m[2])]);
  }
  return out;
}
export const pointsText = (points: unknown): string =>
  (Array.isArray(points) ? points : []).map((p) => (Array.isArray(p) ? `${p[0]},${p[1]}` : '')).filter(Boolean).join('; ');
/** A new edit: the middle point of the net, moved by nothing yet, in the surface's own frame (the offset is along the face normal). */
export const newEdit = (eff: Wire): Wire => {
  const [nu, nv] = netSize(eff);
  return { points: [[Math.floor(nu / 2), Math.floor(nv / 2)]], frame: 'surface', dx: 0, dy: 0, dz: 0 };
};
/** Switching the frame: `plane` needs a plane reference, the others carry none. */
export function patchFrame(e: Wire, frame: FreeformFrame): Wire {
  return frame === 'plane' ? { frame, plane: e.plane && typeof e.plane === 'object' ? e.plane : { kind: 'std', id: 'front' } } : { frame: frame === 'world' ? null : frame, plane: null };
}
/** Control point edits work on exactly one face (`freeformOneFace`). */
export const editsNeedOneFace = (eff: Wire): boolean => edits(eff).length > 0 && faceList(eff).length !== 1;
