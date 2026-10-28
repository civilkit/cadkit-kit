/**
 * What to draw on a sketch to show its dimensions and constraints. Pure: given the draft it returns, for each
 * constraint, where it belongs on the plane (a point in sketch coordinates), what to show there and which
 * entities and points it refers to (so hovering it can highlight them).
 *   dimensions   a number (distance, radius, diameter, angle, hdist, vdist, pldist): a label with the value,
 *                editable by double-click
 *   marks        a symbol for a geometric constraint (H, V, =, tangent ...), placed on the shape it constrains
 * Coincident constraints are listed but not drawn: they are the shared points themselves.
 */
import type { DraftConstraint, DraftEntity, SketchDraft } from './index';
import { shownValue, storedValue } from './slotLength';
import type { Pt } from './tools/types';

export interface Annotation {
  /** The constraint id. */
  id: string;
  type: string;
  kind: 'dimension' | 'mark';
  /** What to show: a formatted value for a dimension, a symbol for a mark. */
  text: string;
  /** Where, in sketch-plane coordinates. */
  at: Pt;
  value?: number;
  /** The expression a dimension is linked to (variables), without the leading =. */
  expr?: string;
  /** A reference (driven) dimension: shown in brackets, not editable, constrains nothing. */
  driven?: boolean;
  /** Entity and point ids the constraint refers to. */
  refs: string[];
}

export const GLYPHS: Record<string, string> = {
  horizontal: 'H', vertical: 'V', equal: '=', parallel: '∥', perpendicular: '⊥', collinear: '≡',
  midpoint: 'M', tangent: 'T', symmetric: '⇄', fix: '⚓', concentric: '◎', pointOnLine: '⌖', pointOnCircle: '⌖',
};
const DIM_TYPES = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function annotate(draft: SketchDraft): Annotation[] {
  const pts = new Map<string, Pt>(draft.points.map((p) => [p.id, { x: p.x, y: p.y }]));
  const ents = new Map<string, DraftEntity>(draft.entities.map((e) => [e.id, e]));

  /** A representative point of an id (a point, or the middle of an entity). */
  const anchorOf = (id: string): Pt | null => {
    const p = pts.get(id);
    if (p) return p;
    const e = ents.get(id);
    if (!e) return null;
    if (e.type === 'line') { const a = pts.get(String(e.p1)), b = pts.get(String(e.p2)); return a && b ? mid(a, b) : null; }
    if (e.type === 'circle') { const c = pts.get(String(e.c)); return c ? { x: c.x + Number(e.r) * Math.SQRT1_2, y: c.y + Number(e.r) * Math.SQRT1_2 } : null; }
    if (e.type === 'arc') {
      const c = pts.get(String(e.c)), p1 = pts.get(String(e.p1)), p2 = pts.get(String(e.p2));
      if (!c || !p1 || !p2) return null;
      const r = Math.hypot(p1.x - c.x, p1.y - c.y);
      const a0 = Math.atan2(p1.y - c.y, p1.x - c.x);
      let sweep = Math.atan2(p2.y - c.y, p2.x - c.x) - a0;
      sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
      return { x: c.x + r * Math.cos(a0 + sweep / 2), y: c.y + r * Math.sin(a0 + sweep / 2) };
    }
    if (e.type === 'point') return pts.get(String(e.p)) ?? null;
    return null;
  };

  const sharedPoint = (a: DraftEntity, b: DraftEntity): Pt | null => {
    const ends = (e: DraftEntity) => [e.p1, e.p2].filter((x): x is string => typeof x === 'string');
    const hit = ends(a).find((id) => ends(b).includes(id));
    return hit ? pts.get(hit) ?? null : null;
  };

  const out: Annotation[] = [];
  for (const c of draft.constraints) {
    if (c.hidden === true) continue;   // placed by a tool (patterns) and not worth a label; the constraint list still shows it
    const refs = c.refs ?? [];
    const base = { id: c.id, type: c.type, refs };
    const shown = shownValue(draft, c);
    if (DIM_TYPES.has(c.type) && shown !== undefined) {
      let at: Pt | null = null;
      if (c.type === 'angle' && refs.length === 2) {
        const a = ents.get(refs[0]), b = ents.get(refs[1]);
        at = (a && b && sharedPoint(a, b)) || null;
      } else if (c.type === 'pldist' && refs.length === 2) {
        at = anchorOf(refs[0]);
      } else if (refs.length >= 2) {
        const a = anchorOf(refs[0]), b = anchorOf(refs[1]);
        at = a && b ? mid(a, b) : a ?? b;
      } else if (refs.length === 1) at = anchorOf(refs[0]);
      if (!at) continue;
      const prefix = c.type === 'radius' ? 'R' : c.type === 'diameter' ? 'Ø' : c.type === 'angle' ? '∠' : '';
      out.push({ ...base, kind: 'dimension', text: `${prefix}${fmt(shown)}${c.type === 'angle' ? '°' : ''}`, at, value: shown, ...(typeof c.expr === 'string' && c.expr ? { expr: c.expr } : {}) });
      continue;
    }
    const glyph = GLYPHS[c.type];
    if (!glyph) continue;
    let at: Pt | null = null;
    if (c.type === 'tangent' && refs.length === 2) {
      const a = ents.get(refs[0]), b = ents.get(refs[1]);
      const named = typeof (c as DraftConstraint).at === 'string' ? pts.get((c as DraftConstraint).at as string) : undefined;
      at = named ?? (a && b ? sharedPoint(a, b) : null) ?? anchorOf(refs[0]);
    } else if (c.type === 'horizontal' || c.type === 'vertical') {
      at = refs.length === 1 ? anchorOf(refs[0]) : refs.length === 2 ? (() => { const a = anchorOf(refs[0]), b = anchorOf(refs[1]); return a && b ? mid(a, b) : null; })() : null;
    } else at = refs.length ? anchorOf(refs[0]) : null;
    if (at) out.push({ ...base, kind: 'mark', text: glyph, at });
  }
  return out;
}

/** The entity and point ids a constraint refers to that exist in the draft, for highlighting. */
export function constraintTargets(draft: SketchDraft, constraintId: string): { entities: string[]; points: string[] } {
  const c = draft.constraints.find((x) => x.id === constraintId);
  const entities: string[] = [];
  const points: string[] = [];
  for (const r of c?.refs ?? []) {
    if (draft.entities.some((e) => e.id === r)) entities.push(r);
    else if (draft.points.some((p) => p.id === r)) points.push(r);
  }
  return { entities, points };
}

/** Remove one constraint by id (the constraints panel's delete button). */
export function removeConstraintById(draft: SketchDraft, id: string): SketchDraft {
  return { ...draft, constraints: draft.constraints.filter((c) => c.id !== id) };
}

/** Change the value of a dimension constraint. Null when it does not exist, has no value, or the value is unusable. */
export function setConstraintValue(draft: SketchDraft, id: string, value: number, expr?: string | null): SketchDraft | null {
  const c = draft.constraints.find((x) => x.id === id);
  if (!c || typeof c.value !== 'number' || !Number.isFinite(value)) return null;
  if (c.type !== 'angle' && value <= 0) return null;
  if (c.overall === true) {   // the overall length of a slot: stored as the centre distance, and an expression cannot say that, so it is dropped
    const stored = storedValue(draft, c, value);
    if (stored === undefined) return null;
    return { ...draft, constraints: draft.constraints.map((x) => { if (x.id !== id) return x; const { expr: _old, ...rest } = x; return { ...rest, value: stored }; }) };
  }
  // an expression links the dimension to the variables (the kernel re-solves when they change); a plain number unlinks it
  return { ...draft, constraints: draft.constraints.map((x) => { if (x.id !== id) return x; const { expr: _old, ...rest } = x; return expr ? { ...rest, value, expr: expr.replace(/^\s*=\s*/, '') } : { ...rest, value }; }) };
}
