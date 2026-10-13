/**
 * Shared logic of the constraint tools and the smart dimension tool: what was picked, which constraint those
 * picks make (type, `refs` order, extra fields), whether it would add nothing, and how to read the solver status.
 * The verified `refs` conventions live in CONSTRAINTS.md and are proven against the real kernel in
 * constraints.kernel.test.ts. All text is an i18n key, never display text.
 */
import type { SketchSolverStatus } from '@ck/part-model';
import type { DraftConstraint, DraftEntity, SketchDraft } from '../index';
import { nextId } from './builders';
import type { Pt, SnapHit } from './types';

// ---- picks ---------------------------------------------------------------------------------------------------

export type PickKind = 'point' | 'line' | 'circle' | 'arc' | 'other';
/** One thing the user clicked: a sketch point or a sketch entity. */
export interface Pick { kind: PickKind; id: string }

const entityOf = (d: SketchDraft, id: string): DraftEntity | undefined => d.entities.find((e) => e.id === id);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Classify a point or entity id of the draft. */
export function classify(d: SketchDraft, id: string): Pick | undefined {
  if (d.points.some((p) => p.id === id)) return { kind: 'point', id };
  const e = entityOf(d, id);
  if (!e) return undefined;
  const t = e.type;
  return { kind: t === 'line' || t === 'circle' || t === 'arc' ? t : 'other', id };
}

/** What the pointer is over: an existing point wins over an entity. Undefined over empty space. */
export function pickOf(d: SketchDraft, snap?: SnapHit): Pick | undefined {
  if (snap?.pointId && d.points.some((p) => p.id === snap.pointId)) return { kind: 'point', id: snap.pointId };
  if (snap?.entityId) return classify(d, snap.entityId);
  return undefined;
}

export const xy = (d: SketchDraft, id: string): Pt | undefined => {
  const p = d.points.find((q) => q.id === id);
  return p ? { x: p.x, y: p.y } : undefined;
};
export function lineEnds(d: SketchDraft, id: string): [string, string] | undefined {
  const e = entityOf(d, id);
  return e?.type === 'line' ? [str(e.p1), str(e.p2)] : undefined;
}
/** The point a reference stands for: a point is itself, a circle or arc is its centre (as the kernel does). */
export function centerId(d: SketchDraft, id: string): string | undefined {
  if (d.points.some((p) => p.id === id)) return id;
  const e = entityOf(d, id);
  return e && (e.type === 'circle' || e.type === 'arc') ? str(e.c) : undefined;
}
export function radiusOf(d: SketchDraft, id: string): number | undefined {
  const e = entityOf(d, id);
  if (e?.type === 'circle') return Number(e.r);
  if (e?.type === 'arc') {
    const c = xy(d, str(e.c)), a = xy(d, str(e.p1));
    return c && a ? Math.hypot(a.x - c.x, a.y - c.y) : undefined;
  }
  return undefined;
}
const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
const isCurve = (p: Pick) => p.kind === 'circle' || p.kind === 'arc';

// ---- the constraint a set of picks makes -----------------------------------------------------------------------

export type ConstraintKind =
  | 'horizontal' | 'vertical' | 'coincident' | 'equal' | 'parallel' | 'perpendicular'
  | 'collinear' | 'midpoint' | 'tangent' | 'symmetric' | 'fix' | 'concentric';

/** A constraint ready to append: kernel `type`, ordered `refs`, optional `value` and extra kernel fields. */
export interface Spec { type: string; refs: string[]; value?: number | number[]; extra?: Record<string, unknown> }

export type Resolved = { spec: Spec } | { more: true } | { hint: string };

export const HINT = {
  invalid: 'app.sketch.hint.pick.invalid',
  same: 'app.sketch.hint.pick.same',
  none: 'app.sketch.hint.pick.none',
  exists: 'app.sketch.hint.constraint.exists',
  redundant: 'app.sketch.hint.constraint.redundant',
  conflict: 'app.sketch.hint.constraint.conflict',
} as const;

/** How many picks each tool can ever use (a tool is complete as soon as `resolve` returns a spec). */
export function resolve(kind: ConstraintKind, d: SketchDraft, picks: readonly Pick[]): Resolved {
  const last = picks[picks.length - 1];
  if (!last) return { more: true };
  const bad = { hint: HINT.invalid };
  if (picks.slice(0, -1).some((p) => p.id === last.id)) return { hint: HINT.same };
  const [a, b] = picks;
  switch (kind) {
    case 'horizontal':
    case 'vertical':
      if (a.kind === 'line') return picks.length === 1 ? { spec: { type: kind, refs: [a.id] } } : bad;
      if (a.kind !== 'point') return bad;
      if (picks.length === 1) return { more: true };
      return b.kind === 'point' ? { spec: { type: kind, refs: [a.id, b.id] } } : bad;
    case 'fix': {
      if (a.kind !== 'point') return bad;
      const p = xy(d, a.id);
      return p ? { spec: { type: 'fix', refs: [a.id], value: [p.x, p.y] } } : bad;
    }
    case 'coincident':
      if (a.kind !== 'point') return bad;
      if (picks.length === 1) return { more: true };
      return b.kind === 'point' ? { spec: { type: 'coincident', refs: [a.id, b.id] } } : bad;
    case 'concentric': {
      if (a.kind !== 'point' && !isCurve(a)) return bad;
      if (picks.length === 1) return { more: true };
      if (b.kind !== 'point' && !isCurve(b)) return bad;
      return isCurve(a) || isCurve(b) ? { spec: { type: 'concentric', refs: [a.id, b.id] } } : bad;
    }
    case 'equal': {
      if (a.kind !== 'line' && !isCurve(a)) return bad;
      if (picks.length === 1) return { more: true };
      const ok = a.kind === 'line' ? b.kind === 'line' : isCurve(b);
      return ok ? { spec: { type: 'equal', refs: [a.id, b.id] } } : bad;
    }
    case 'parallel':
    case 'perpendicular':
    case 'collinear':
      if (a.kind !== 'line') return bad;
      if (picks.length === 1) return { more: true };
      return b.kind === 'line' ? { spec: { type: kind, refs: [a.id, b.id] } } : bad;
    case 'midpoint': {
      if (a.kind !== 'point' && a.kind !== 'line') return bad;
      if (picks.length === 1) return { more: true };
      const pt = a.kind === 'point' ? a : b, ln = a.kind === 'line' ? a : b;
      if (pt.kind !== 'point' || ln.kind !== 'line') return bad;
      if (lineEnds(d, ln.id)?.includes(pt.id)) return bad; // an end point of the line cannot be its midpoint
      return { spec: { type: 'midpoint', refs: [pt.id, ln.id] } };
    }
    case 'tangent': {
      const ok = (p: Pick) => p.kind === 'line' || isCurve(p);
      if (!ok(a)) return bad;
      if (picks.length === 1) return { more: true };
      if (!ok(b) || (a.kind === 'line' && b.kind === 'line')) return bad;
      return { spec: tangentSpec(d, a, b) };
    }
    case 'symmetric': {
      if (last.kind !== 'point' && last.kind !== 'line') return bad;
      const pts = picks.filter((p) => p.kind === 'point'), lines = picks.filter((p) => p.kind === 'line');
      if (pts.length > 2 || lines.length > 1) return bad;
      if (picks.length < 3) return { more: true };
      const ends = lineEnds(d, lines[0].id) ?? ['', ''];
      if (pts.some((p) => ends.includes(p.id))) return bad; // a point on the axis cannot mirror anything
      return { spec: { type: 'symmetric', refs: [pts[0].id, pts[1].id, lines[0].id] } };
    }
  }
}

/** `[a, b]` as picked; `internal` is set when two circles nest, `at` names a shared end point. */
function tangentSpec(d: SketchDraft, a: Pick, b: Pick): Spec {
  const extra: Record<string, unknown> = {};
  const ends = (p: Pick) => (p.kind === 'line' ? lineEnds(d, p.id) : p.kind === 'arc' ? [str(entityOf(d, p.id)?.p1), str(entityOf(d, p.id)?.p2)] : []) ?? [];
  const ea = ends(a), eb = ends(b);
  const shared = ea.find((q) => q && eb.includes(q));
  if (shared) extra.at = shared;
  else if (isCurve(a) && isCurve(b)) {
    const ca = xy(d, centerId(d, a.id) ?? ''), cb = xy(d, centerId(d, b.id) ?? '');
    const ra = radiusOf(d, a.id), rb = radiusOf(d, b.id);
    if (ca && cb && ra !== undefined && rb !== undefined) {
      const dd = dist(ca, cb);
      if (Math.abs(dd - Math.abs(ra - rb)) < Math.abs(dd - (ra + rb))) extra.internal = true;
    }
  }
  return { type: 'tangent', refs: [a.id, b.id], ...(Object.keys(extra).length ? { extra } : {}) };
}

// ---- angle between two lines -----------------------------------------------------------------------------------

export interface AngleSpec { refs: [string, string]; extra: Record<string, unknown>; measured: number }

/**
 * The `angle` constraint (refs [lineA, lineB], degrees) fixes the counter-clockwise turn from line A to line B,
 * each read along p1 -> p2, or reversed when its `s1`/`s2` is -1. This picks refs order and signs so that the
 * shown number is the angle between the lines AT their shared vertex when they share one (both read away from it,
 * the interior angle), else along the stored directions, and so that the current turn is counter-clockwise
 * (0..180): the solver has two roots, `value` and `value + 180`, and converges to the one nearer the current one.
 */
export function angleSpec(d: SketchDraft, aId: string, bId: string): AngleSpec | undefined {
  const ea = lineEnds(d, aId), eb = lineEnds(d, bId);
  if (!ea || !eb) return undefined;
  const pa = ea.map((i) => xy(d, i)), pb = eb.map((i) => xy(d, i));
  if (pa.some((p) => !p) || pb.some((p) => !p)) return undefined;
  const v = ea.find((i) => eb.includes(i));
  const sign = (e: [string, string]) => (v && v === e[1] ? -1 : 1); // away from v means p1 -> p2 only when v is p1
  const [sa, sb] = [sign(ea), sign(eb)];
  const dirOf = (p: Array<Pt | undefined>, s: number) => ({ x: (p[1]!.x - p[0]!.x) * s, y: (p[1]!.y - p[0]!.y) * s });
  const da = dirOf(pa, sa), db = dirOf(pb, sb);
  const signed = (Math.atan2(da.x * db.y - da.y * db.x, da.x * db.x + da.y * db.y) * 180) / Math.PI;
  const flip = signed < 0;
  const [s1, s2] = flip ? [sb, sa] : [sa, sb];
  return {
    refs: flip ? [bId, aId] : [aId, bId],
    extra: { ...(s1 !== 1 ? { s1 } : {}), ...(s2 !== 1 ? { s2 } : {}) },
    measured: Math.abs(signed),
  };
}

// ---- appending -----------------------------------------------------------------------------------------------

/** Append a constraint (immutable). `extra` fields such as `internal`, `at`, `s1` are written onto it. */
export function appendSpec(d: SketchDraft, s: Spec): SketchDraft {
  const c: DraftConstraint = { id: nextId(d, 'k'), type: s.type, refs: [...s.refs], ...(s.value !== undefined ? { value: s.value } : {}), ...(s.extra ?? {}) };
  return { ...d, constraints: [...d.constraints, c] };
}

// ---- "would this add nothing?" -------------------------------------------------------------------------------

export type Refusal = 'exists' | 'redundant' | 'conflict';

class Groups {
  private up = new Map<string, string>();
  find(a: string): string { let r = a; while (this.up.has(r)) r = this.up.get(r)!; return r; }
  join(a: string, b: string) { const [x, y] = [this.find(a), this.find(b)]; if (x !== y) this.up.set(x, y); }
  same(a: string, b: string) { return this.find(a) === this.find(b); }
}

/** 'h' / 'v' for every line the existing constraints force to that orientation (propagated through parallel and perpendicular). */
export function orientations(d: SketchDraft): Map<string, 'h' | 'v'> {
  const m = new Map<string, 'h' | 'v'>();
  const lineBetween = (a: string, b: string) => d.entities.find((e) => e.type === 'line' && ((e.p1 === a && e.p2 === b) || (e.p1 === b && e.p2 === a)))?.id;
  for (const c of d.constraints) {
    if (c.type !== 'horizontal' && c.type !== 'vertical') continue;
    const refs = c.refs ?? [];
    const line = refs.length === 1 ? refs[0] : refs.length === 2 ? lineBetween(refs[0], refs[1]) : undefined;
    if (line) m.set(line, c.type === 'horizontal' ? 'h' : 'v');
  }
  for (let again = true; again;) {
    again = false;
    for (const c of d.constraints) {
      if ((c.type !== 'parallel' && c.type !== 'perpendicular') || !c.refs || c.refs.length < 2) continue;
      const [a, b] = c.refs;
      const flip = (o: 'h' | 'v') => (c.type === 'parallel' ? o : o === 'h' ? 'v' : 'h');
      if (m.has(a) && !m.has(b)) { m.set(b, flip(m.get(a)!)); again = true; }
      else if (m.has(b) && !m.has(a)) { m.set(a, flip(m.get(b)!)); again = true; }
    }
  }
  return m;
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
const has = (d: SketchDraft, type: string, refs: readonly string[], ordered = false) =>
  d.constraints.some((c) => c.type === type && (ordered ? (c.refs ?? []).join('|') === refs.join('|') : sameSet(c.refs ?? [], refs)));

/** Would appending `s` add nothing ('exists', 'redundant') or contradict what is there ('conflict')? */
export function refusal(d: SketchDraft, s: Spec): Refusal | undefined {
  const [a, b] = s.refs;
  const pointGroups = new Groups();
  for (const c of d.constraints) {
    if ((c.type !== 'coincident' && c.type !== 'concentric') || !c.refs || c.refs.length < 2) continue;
    const [x, y] = [centerId(d, c.refs[0]), centerId(d, c.refs[1])];
    if (x && y) pointGroups.join(x, y);
  }
  const orient = orientations(d);
  switch (s.type) {
    case 'coincident':
    case 'concentric': {
      const [x, y] = [centerId(d, a), centerId(d, b)];
      return x && y && pointGroups.same(x, y) ? 'exists' : undefined;
    }
    case 'horizontal':
    case 'vertical': {
      const want = s.type === 'horizontal' ? 'h' : 'v';
      if (s.refs.length === 1) {
        const have = orient.get(a);
        return have === undefined ? undefined : have === want ? 'exists' : 'conflict';
      }
      if (has(d, s.type, s.refs)) return 'exists';
      if (has(d, s.type === 'horizontal' ? 'vertical' : 'horizontal', s.refs)) return 'conflict';
      if (pointGroups.same(a, b)) return 'redundant'; // the same place: nothing to align
      return undefined;
    }
    case 'parallel':
    case 'perpendicular': {
      if (has(d, s.type, s.refs)) return 'exists';
      if (has(d, s.type === 'parallel' ? 'perpendicular' : 'parallel', s.refs)) return 'conflict';
      const [oa, ob] = [orient.get(a), orient.get(b)];
      if (oa && ob) return (oa === ob) === (s.type === 'parallel') ? 'redundant' : 'conflict';
      if (s.type === 'parallel') {
        const g = new Groups();
        for (const c of d.constraints) if ((c.type === 'parallel' || c.type === 'collinear') && c.refs && c.refs.length >= 2) g.join(c.refs[0], c.refs[1]);
        if (g.same(a, b)) return 'redundant';
      }
      return undefined;
    }
    case 'collinear': {
      if (has(d, 'collinear', s.refs)) return 'exists';
      const g = new Groups();
      for (const c of d.constraints) if (c.type === 'collinear' && c.refs && c.refs.length >= 2) g.join(c.refs[0], c.refs[1]);
      return g.same(a, b) ? 'redundant' : undefined;
    }
    case 'equal': {
      if (has(d, 'equal', s.refs)) return 'exists';
      const g = new Groups();
      for (const c of d.constraints) if (c.type === 'equal' && c.refs && c.refs.length >= 2) g.join(c.refs[0], c.refs[1]);
      return g.same(a, b) ? 'redundant' : undefined;
    }
    case 'midpoint': return has(d, 'midpoint', s.refs, true) ? 'exists' : undefined;
    case 'tangent': return has(d, 'tangent', s.refs) ? 'exists' : undefined;
    case 'symmetric': return d.constraints.some((c) => c.type === 'symmetric' && c.refs?.[2] === s.refs[2] && sameSet(c.refs.slice(0, 2), s.refs.slice(0, 2))) ? 'exists' : undefined;
    case 'fix': {
      const p = centerId(d, a) ?? a;
      return d.points.find((q) => q.id === p)?.fixed || d.constraints.some((c) => c.type === 'fix' && c.refs?.[0] && (centerId(d, c.refs[0]) ?? c.refs[0]) === p) ? 'exists' : undefined;
    }
    default: // dimensions: one driving dimension per kind and set of refs
      return d.constraints.some((c) => c.type === s.type && sameSet(c.refs ?? [], s.refs)) ? 'exists' : undefined;
  }
}

export const refusalHint = (r: Refusal): string => HINT[r];

// ---- reading the solver status -----------------------------------------------------------------------------------

export interface StatusReport {
  level: 'under' | 'full' | 'redundant' | 'conflict' | 'unsolved';
  /** i18n key for the status line; none when the sketch is simply still under-defined. */
  hint?: string;
  /** Offending constraint ids (conflicts, else redundant). */
  ids: string[];
  /** True when the constraint just added is one of them, so the caller can offer to undo it. */
  blamesAdded: boolean;
}

/**
 * Summarise the `status` of `Session.preview([], { sketchStatus: true })` after a constraint was added.
 * The solver blames the LATER of two clashing constraints, so a freshly appended constraint is the one reported.
 */
export function reportStatus(status: SketchSolverStatus, addedId?: string): StatusReport {
  const mk = (level: StatusReport['level'], hint: string | undefined, ids: string[]): StatusReport =>
    ({ level, ...(hint ? { hint } : {}), ids, blamesAdded: addedId !== undefined && ids.includes(addedId) });
  if (status.conflicts.length) return mk('conflict', 'app.sketch.hint.status.overConstrained', status.conflicts);
  if (!status.solved) return mk('unsolved', 'app.sketch.hint.status.unsolved', []);
  if (status.redundant.length) return mk('redundant', 'app.sketch.hint.status.redundant', status.redundant);
  if (status.state === 'full') return mk('full', 'app.sketch.hint.status.fullyDefined', []);
  return mk('under', undefined, []);
}
