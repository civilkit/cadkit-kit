/**
 * Equation curves in the sketch editor (docs/equation-curve.md in the kernel repo, guide/src/sketching/equation-curves.md here).
 *
 * An equation curve is a `spline` entity with `equation: {x, y, t:[start, end], tol}`: formulas of `t` (degrees for trigonometry,
 * the part's variables allowed). The kernel evaluates them on every regen and writes the spline's points as fixed sketch points
 * named `<id>_start`, `<id>_p1`.., `<id>_end`; the editor only writes the formulas and takes the points from the solved sketch
 * (`foldSolution`). The panel previews a change with the kernel's `equationCurve` query and applies it only when it fits. No DOM,
 * no kernel calls here.
 */
import type { DraftEntity, SketchDraft } from './index';
import { nextId } from './tools/builders';
import type { Pt } from './tools/types';

export const EQUATION_DEFAULT_TOL = 0.01;

/** What the panel edits: the two formulas, the ends of t as typed (a number or a formula), the tolerance in mm. */
export interface EquationFields { x: string; y: string; t0: string; t1: string; tol: number }
/** The kernel's `equation` object. */
export interface EquationSpec { x: string; y: string; t: [number | string, number | string]; tol: number }
/** The `equationCurve` reply, or the error string the kernel sent. */
export type EquationResult =
  | { pts: number[][]; closed: boolean; count: number; deviation: number; tol: number; warnings: Array<{ code: string; detail: string }> }
  | { error: string };

export const isEquation = (e: { [k: string]: unknown } | undefined | null): boolean => e?.type === 'spline' && !!e.equation && typeof e.equation === 'object';

/** The generated point ids of entity `id` (the kernel's names). */
export const isEquationPoint = (id: string, pointId: string): boolean => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(start|end|p\\d+)$`).test(pointId);

const fmt = (v: number): string => String(Math.round(v * 1e6) / 1e6);
const shift = (c: number): string => (c === 0 ? '' : fmt(c) + ' + ');

/** Ready-made curves for the panel's list (degrees). */
export const EQUATION_PRESETS: Array<{ id: string; fields: EquationFields }> = [
  { id: 'wave', fields: { x: 't/9', y: '5*sin(t)', t0: '0', t1: '360', tol: EQUATION_DEFAULT_TOL } },
  { id: 'circle', fields: { x: '20*cos(t)', y: '20*sin(t)', t0: '0', t1: '360', tol: EQUATION_DEFAULT_TOL } },
  { id: 'ellipse', fields: { x: '30*cos(t)', y: '12*sin(t)', t0: '0', t1: '360', tol: EQUATION_DEFAULT_TOL } },
  { id: 'spiral', fields: { x: 't/36*cos(t)', y: 't/36*sin(t)', t0: '0', t1: '1080', tol: EQUATION_DEFAULT_TOL } },
  { id: 'involute', fields: { x: '20*(cos(t) + t*pi/180*sin(t))', y: '20*(sin(t) - t*pi/180*cos(t))', t0: '0', t1: '40', tol: EQUATION_DEFAULT_TOL } },
  { id: 'lissajous', fields: { x: '20*sin(3*t + 90)', y: '15*sin(2*t)', t0: '0', t1: '360', tol: EQUATION_DEFAULT_TOL } },
];

/** A plain number stays a number; anything else is sent as a formula (`=` added). */
const end = (s: string): number | string => {
  const v = s.trim();
  return /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(v) ? Number(v) : v.startsWith('=') ? v : '=' + v;
};
export const equationSpec = (f: EquationFields): EquationSpec => ({ x: f.x, y: f.y, t: [end(f.t0), end(f.t1)], tol: f.tol });

/** Add an equation curve: a wave of length 40 starting at `at` (the panel then edits it). Returns the new draft and the entity id. */
export function addEquation(draft: SketchDraft, at: Pt, fields?: EquationFields): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'e');
  const f = fields ?? { ...EQUATION_PRESETS[0].fields, x: shift(at.x) + 't/9', y: shift(at.y) + '5*sin(t)' };
  const e: DraftEntity = { id, type: 'spline', pts: [], equation: equationSpec(f) };
  return { draft: { ...draft, entities: [...draft.entities, e] }, id };
}

/** The panel's fields for an equation curve, defaults filled in; null when `id` is not one. */
export function equationFields(draft: SketchDraft, id: string): EquationFields | null {
  const e = draft.entities.find((x) => x.id === id);
  if (!e || !isEquation(e)) return null;
  const q = e.equation as Partial<EquationSpec>;
  const t = Array.isArray(q.t) ? q.t : [];
  const str = (v: unknown, d: string) => (typeof v === 'number' ? fmt(v) : typeof v === 'string' ? v : d);
  return { x: String(q.x ?? ''), y: String(q.y ?? ''), t0: str(t[0], '0'), t1: str(t[1], '360'), tol: typeof q.tol === 'number' ? q.tol : EQUATION_DEFAULT_TOL };
}

/** Replace the formulas of an equation curve (immutable). The points follow when the kernel answers. */
export function patchEquation(draft: SketchDraft, id: string, f: EquationFields): SketchDraft {
  const i = draft.entities.findIndex((x) => x.id === id);
  if (i < 0) return draft;
  const entities = draft.entities.slice();
  entities[i] = { ...entities[i], equation: equationSpec(f) };
  return { ...draft, entities };
}

/** Fold the solved sketch's equation curves into the draft: their generated points (and only those) are replaced by the kernel's, with `pts` and `closed`. */
export function foldEquations(draft: SketchDraft, solved: { points: Array<{ id: string; x: number; y: number }>; entities: Array<{ id: string }> }): SketchDraft {
  const eqs = draft.entities.filter(isEquation);
  if (!eqs.length) return draft;
  let points = draft.points;
  let entities = draft.entities;
  for (const e of eqs) {
    const s = solved.entities.find((x) => x.id === e.id) as { pts?: unknown; closed?: unknown } | undefined;
    if (!s || !Array.isArray(s.pts)) continue;
    const ids = (s.pts as unknown[]).filter((p): p is string => typeof p === 'string');
    const gen = solved.points.filter((p) => isEquationPoint(e.id, p.id)).map((p) => ({ id: p.id, x: p.x, y: p.y, fixed: true }));
    points = [...points.filter((p) => !isEquationPoint(e.id, p.id)), ...gen];
    entities = entities.map((x) => (x.id === e.id ? { ...x, pts: ids, closed: s.closed === true } : x));
  }
  return { ...draft, points, entities };
}

/** What the panel says about a kernel reply: an error by its code, or the point count (and closed) then the warnings. */
export function equationNotes(r: EquationResult | null | undefined): Array<{ key: string; params?: Record<string, string> }> {
  if (!r) return [];
  if ('error' in r) {
    const m = /^(equation\w+): ([\s\S]*)$/.exec(r.error);
    return m ? [{ key: 'app.sketch.equation.err.' + m[1], params: { detail: m[2] } }] : [{ key: 'app.sketch.equation.err.other', params: { detail: r.error } }];
  }
  const info = { key: 'app.sketch.equation.info.' + (r.closed ? 'closed' : 'open'), params: { count: String(r.count), deviation: String(Math.round(r.deviation * 1e4) / 1e4) } };
  return [info, ...r.warnings.map((w) => ({ key: 'app.sketch.equation.warn.' + w.code, params: { detail: w.detail } }))];
}
