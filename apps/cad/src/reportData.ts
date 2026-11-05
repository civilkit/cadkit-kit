/** The Sketch Report: what a sketch holds and how well the solver has it, from the draft and the solver status the editor already has. Pure. */
import type { SketchSolverStatus } from '@ck/part-model';
import { DIM_TYPES, refDimsOf, sketchOpenChains, sketchShapes, type SketchDraft } from '@kit/sketch';

/** The state in the words of the report: a conflict outranks over-constrained, which outranks the rest. `unknown` before the solver has answered. */
export type ReportState = 'full' | 'under' | 'over' | 'conflict' | 'unsolved' | 'unknown';

export interface ReportIssue {
  /** The constraint id (selecting it highlights what it names). */
  id: string;
  kind: 'conflict' | 'redundant';
  type: string;
  refs: string[];
}

export interface SketchReportData {
  name: string;
  state: ReportState;
  /** Degrees of freedom left (null while unknown). */
  dof: number | null;
  points: number;
  lines: number;
  arcs: number;
  circles: number;
  /** Splines of both kinds (fitted and control point). */
  splines: number;
  /** Any other curve (ellipses, text ...). */
  other: number;
  construction: number;
  constraints: number;
  /** Constraint counts by kind, largest first then by name. */
  byKind: Array<{ type: string; count: number }>;
  /** Dimensions that drive the sketch / reference (driven) ones, measured only. */
  driving: number;
  driven: number;
  /** Closed profiles an extrude can use, and open chains (loose ends). */
  profiles: number;
  openChains: number;
  issues: ReportIssue[];
  /** Coded problems the solver reported (plain words). */
  problems: string[];
}

export function reportState(s: SketchSolverStatus | null): ReportState {
  if (!s) return 'unknown';
  if (s.conflicts.length) return 'conflict';
  if (s.state === 'over') return 'over';
  if (!s.solved) return 'unsolved';
  return s.state === 'full' || s.fullyDefined ? 'full' : 'under';
}

export function sketchReport(draft: SketchDraft, status: SketchSolverStatus | null): SketchReportData {
  const type = (e: SketchDraft['entities'][number]) => String(e.type ?? '');
  const count = (pred: (e: SketchDraft['entities'][number]) => boolean) => draft.entities.filter(pred).length;
  const kinds = new Map<string, number>();
  for (const c of draft.constraints) kinds.set(c.type, (kinds.get(c.type) ?? 0) + 1);
  const byId = new Map(draft.constraints.map((c) => [c.id, c]));
  const issues: ReportIssue[] = [];
  for (const [ids, kind] of [[status?.conflicts ?? [], 'conflict'], [status?.redundant ?? [], 'redundant']] as const) {
    for (const id of ids) { const c = byId.get(id); if (c) issues.push({ id, kind, type: c.type, refs: c.refs ?? [] }); }
  }
  const curves = new Set(['line', 'arc', 'circle', 'spline', 'cvspline']);
  return {
    name: draft.name ?? '',
    state: reportState(status),
    dof: status ? status.dof : null,
    points: draft.points.length,
    lines: count((e) => type(e) === 'line'),
    arcs: count((e) => type(e) === 'arc'),
    circles: count((e) => type(e) === 'circle'),
    splines: count((e) => type(e) === 'spline' || type(e) === 'cvspline'),
    other: count((e) => !curves.has(type(e))),
    construction: count((e) => !!e.construction),
    constraints: draft.constraints.length,
    byKind: [...kinds].map(([k, n]) => ({ type: k, count: n })).sort((a, b) => b.count - a.count || a.type.localeCompare(b.type)),
    driving: draft.constraints.filter((c) => DIM_TYPES.has(c.type) && typeof c.value === 'number').length,
    driven: refDimsOf(draft).length,
    profiles: sketchShapes(draft as never).length,
    openChains: sketchOpenChains(draft as never).length,
    issues,
    problems: (status?.problems ?? []).map((p) => p.message),
  };
}
