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
import { annotate, type Annotation } from './annotations';
import { angleSpec } from './tools/constraints';
import { measure } from './tools/transform';

export interface RefDim { id: string; type: string; refs: string[]; s1?: number; s2?: number }
const DIM_TYPES = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);

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
  return measure(d, c, d);
}

/** Add a reference dimension. */
export function addRefDim(d: SketchDraft, type: string, refs: string[], extra: { s1?: number; s2?: number } = {}): SketchDraft {
  const list = refDimsOf(d);
  return withRefs(d, [...list, { id: nextRefId(list), type, refs, ...extra }]);
}

/** A driving dimension becomes a reference one. Null when the constraint is not a dimension. */
export function makeDriven(d: SketchDraft, constraintId: string): SketchDraft | null {
  const c = d.constraints.find((x) => x.id === constraintId);
  if (!c || !DIM_TYPES.has(c.type) || typeof c.value !== 'number') return null;
  const extra: { s1?: number; s2?: number } = {};
  if (typeof c.s1 === 'number') extra.s1 = c.s1;
  if (typeof c.s2 === 'number') extra.s2 = c.s2;
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
  const c: DraftConstraint = { id: `k${n}`, type: r.type, refs: r.refs, value: Math.round(v * 1e6) / 1e6, ...(r.s1 !== undefined ? { s1: r.s1 } : {}), ...(r.s2 !== undefined ? { s2: r.s2 } : {}) };
  return withRefs({ ...d, constraints: [...d.constraints, c] }, list.filter((x) => x.id !== refId));
}

export const removeRefDim = (d: SketchDraft, id: string): SketchDraft => withRefs(d, refDimsOf(d).filter((r) => r.id !== id));

/** Labels for the reference dimensions: the measured value in brackets, in the same places as driving ones. */
export function refAnnotations(d: SketchDraft): Annotation[] {
  const list = refDimsOf(d);
  if (!list.length) return [];
  const fake: DraftConstraint[] = [];
  for (const r of list) {
    const v = measureRef(d, r);
    if (v !== undefined && Number.isFinite(v)) fake.push({ id: r.id, type: r.type, refs: r.refs, value: v });
  }
  return annotate({ ...d, constraints: fake }).map((a) => ({ ...a, text: `(${a.text})`, driven: true }));
}
