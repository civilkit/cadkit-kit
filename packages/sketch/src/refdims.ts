/**
 * Reference (driven) dimensions: a measurement shown on the sketch that does not constrain it. The kernel has no such
 * thing, so they are kept in the sketch feature as an extra list, `refDims: [{ id, type, refs, s1?, s2? }]` (the kernel
 * carries unknown sketch fields through, checked in refdims.kernel.test.ts), and are measured from the solved geometry
 * every time they are drawn.
 *
 *   makeDriven    a driving dimension becomes a reference one (the constraint goes, the measurement stays)
 *   makeDriving   a reference dimension becomes a driving one at its present value
 *   refAnnotations  the labels to draw: the value in brackets
 */
import type { DraftConstraint, SketchDraft } from './index';
import { annotate, type AnnotateOptions, type Annotation } from './annotations';
import { angleSpec } from './tools/constraints';
import { measure } from './tools/transform';
import { shownValue, storedValue } from './slotLength';

export interface RefDim { id: string; type: string; refs: string[]; s1?: number; s2?: number; /** the overall length across a slot's caps, see slotLength.ts */ overall?: boolean }
export const DIM_TYPES = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);

export const refDimsOf = (d: SketchDraft): RefDim[] => (Array.isArray(d.extras?.refDims) ? (d.extras!.refDims as RefDim[]) : []);
const withRefs = (d: SketchDraft, list: RefDim[]): SketchDraft => {
  const extras = { ...(d.extras ?? {}) };
  if (list.length) extras.refDims = list; else delete extras.refDims;
  return { ...d, ...(Object.keys(extras).length ? { extras } : { extras: undefined }) };
};
const nextRefId = (list: RefDim[]) => `r${list.reduce((m, r) => Math.max(m, Number(/^r(\d+)$/.exec(r.id)?.[1] ?? 0)), 0) + 1}`;

/** The value of a reference dimension on the present geometry. */
export function measureRef(d: SketchDraft, r: RefDim): number | undefined {
  if (r.type === 'angle') return angleSpec(d, r.refs[0], r.refs[1])?.measured;
  const c: DraftConstraint = { id: r.id, type: r.type, refs: r.refs, value: 0 };
  const v = measure(d, c, d);
  return v !== undefined && r.overall ? shownValue(d, { ...c, value: v, overall: true }) : v;
}

/** Add a reference dimension. */
export function addRefDim(d: SketchDraft, type: string, refs: string[], extra: { s1?: number; s2?: number; overall?: boolean } = {}): SketchDraft {
  const list = refDimsOf(d);
  return withRefs(d, [...list, { id: nextRefId(list), type, refs, ...extra }]);
}

/** A driving dimension becomes a reference one. Null when the constraint is not a dimension. */
export function makeDriven(d: SketchDraft, constraintId: string): SketchDraft | null {
  const c = d.constraints.find((x) => x.id === constraintId);
  if (!c || !DIM_TYPES.has(c.type) || typeof c.value !== 'number') return null;
  const extra: { s1?: number; s2?: number; overall?: boolean } = {};
  if (typeof c.s1 === 'number') extra.s1 = c.s1;
  if (typeof c.s2 === 'number') extra.s2 = c.s2;
  if (c.overall === true) extra.overall = true;
  return addRefDim({ ...d, constraints: d.constraints.filter((x) => x.id !== constraintId) }, c.type, c.refs ?? [], extra);
}

/** A reference dimension becomes a driving one at its present value. Null when it cannot be measured. */
export function makeDriving(d: SketchDraft, refId: string): SketchDraft | null {
  const list = refDimsOf(d);
  const r = list.find((x) => x.id === refId);
  if (!r) return null;
  const v = measureRef(d, r);
  if (v === undefined || !Number.isFinite(v)) return null;
  const ids = new Set(d.constraints.map((c) => c.id));
  let n = d.constraints.reduce((m, c) => Math.max(m, Number(/^k(\d+)$/.exec(c.id)?.[1] ?? 0)), 0) + 1;
  while (ids.has(`k${n}`)) n++;
  const stored = r.overall ? storedValue(d, { refs: r.refs, overall: true }, v) : v;
  if (stored === undefined) return null;
  const c: DraftConstraint = { id: `k${n}`, type: r.type, refs: r.refs, value: Math.round(stored * 1e6) / 1e6, ...(r.s1 !== undefined ? { s1: r.s1 } : {}), ...(r.s2 !== undefined ? { s2: r.s2 } : {}), ...(r.overall ? { overall: true } : {}) };
  return withRefs({ ...d, constraints: [...d.constraints, c] }, list.filter((x) => x.id !== refId));
}

export const removeRefDim = (d: SketchDraft, id: string): SketchDraft => withRefs(d, refDimsOf(d).filter((r) => r.id !== id));

/** Labels for the reference dimensions: the measured value in brackets, in the same places as driving ones. */
export function refAnnotations(d: SketchDraft, opts: AnnotateOptions = {}): Annotation[] {
  const list = refDimsOf(d);
  if (!list.length) return [];
  const fake: DraftConstraint[] = [];
  for (const r of list) {
    const v = measureRef(d, r);
    if (v !== undefined && Number.isFinite(v)) fake.push({ id: r.id, type: r.type, refs: r.refs, value: v });
  }
  return annotate({ ...d, constraints: fake }, opts).map((a) => ({ ...a, text: `(${a.text})`, driven: true }));
}

/** Delete a dimension by id, driving (`k..`) or reference (`r..`). */
export function removeDimension(d: SketchDraft, id: string): SketchDraft {
  return refDimsOf(d).some((r) => r.id === id) ? removeRefDim(d, id) : { ...d, constraints: d.constraints.filter((c) => c.id !== id) };
}

const FLIP: Record<string, string> = { radius: 'diameter', diameter: 'radius' };
/** The kind a radius dimension flips to (and back), or null for any other dimension. */
export const flippedType = (type: string): string | null => FLIP[type] ?? null;
/** The expression of a flipped dimension: `w` becomes `w*2`, `a+b` becomes `(a+b)*2`. */
const scaled = (expr: string, op: '*' | '/'): string => `${/^[A-Za-z0-9_.]+$/.test(expr) ? expr : `(${expr})`}${op}2`;

/** Switch a circle or arc dimension between radius and diameter, keeping the size: the value doubles or halves, and an
 *  expression gets `*2` or `/2` so it still drives the same circle. Works on a driving or a reference dimension.
 *  Null when the dimension is neither a radius nor a diameter. */
export function toggleRadiusDiameter(d: SketchDraft, id: string): SketchDraft | null {
  const ref = refDimsOf(d).find((r) => r.id === id);
  if (ref) {
    const type = flippedType(ref.type);
    return type ? withRefs(d, refDimsOf(d).map((r) => (r.id === id ? { ...r, type } : r))) : null;
  }
  const c = d.constraints.find((x) => x.id === id);
  const type = c ? flippedType(c.type) : null;
  if (!c || !type || typeof c.value !== 'number') return null;
  const toDia = type === 'diameter';
  return {
    ...d,
    constraints: d.constraints.map((x) => {
      if (x.id !== id) return x;
      const { expr, ...rest } = x;
      return { ...rest, type, value: toDia ? c.value as number * 2 : c.value as number / 2, ...(typeof expr === 'string' && expr ? { expr: scaled(expr, toDia ? '*' : '/') } : {}) };
    }),
  };
}
