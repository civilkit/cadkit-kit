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
  /** A dimension's drawing, in sketch coordinates: extension lines, an offset dimension line, an arc or a leader; with the arrowheads and the text position and slope. */
  shape?: DimShape;
}

/** An arrowhead: its tip and the unit direction it points (outward along the line it ends). */
export interface Arrow { at: Pt; dir: Pt }
/** How a dimension is drawn. `text` is where its label sits (the middle of the dimension line), `slope` the reading angle of the text in radians (kept within -90..90 degrees). */
export type DimShape =
  | { kind: 'linear'; ext: Array<[Pt, Pt]>; line: [Pt, Pt]; arrows: Arrow[]; text: Pt; slope: number }
  | { kind: 'angle'; c: Pt; r: number; a0: number; a1: number; arrows: Arrow[]; text: Pt; slope: number; /** a right angle drawn as a small square corner instead of an arc */ square?: boolean }
  | { kind: 'leader'; line: [Pt, Pt]; arrows: Arrow[]; text: Pt; slope: number };

export interface AnnotateOptions {
  /** Sketch units per screen pixel: dimension lines sit a fixed number of pixels off the geometry. Without it the offset is a fraction of the length. */
  upp?: number;
  /** Draw a right angle as a square corner mark (default on). */
  squareRight?: boolean;
  /** Also mark coincident constraints (a dot chip where the points meet). Off by default: they are the shared points themselves. */
  coincident?: boolean;
}
/** How far a dimension line sits off the measured geometry, in pixels. */
export const DIM_OFFSET_PX = 26;

/** A number as shown in a dimension: at most two decimals, no trailing zeros, thousands separated by a space ('1 500'). */
export function formatDimNumber(v: number): string {
  const r = Math.round(Math.abs(v) * 100) / 100;
  const [int, frac] = String(r).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${v < 0 && r !== 0 ? '-' : ''}${grouped}${frac ? '.' + frac : ''}`;
}

/** The label of a dimension: '1 500 mm', 'R12 mm', 'Ø8 mm', '110°'. */
export function dimText(type: string, v: number): string {
  const n = formatDimNumber(v);
  return type === 'angle' ? `${n}°` : `${type === 'radius' ? 'R' : type === 'diameter' ? 'Ø' : ''}${n} mm`;
}

const slopeOf = (dx: number, dy: number): number => {
  let a = Math.atan2(dy, dx);
  if (a > Math.PI / 2 + 1e-9) a -= Math.PI; else if (a <= -Math.PI / 2 - 1e-9) a += Math.PI;
  return a;
};
const unit = (a: Pt, b: Pt): Pt | null => { const l = Math.hypot(b.x - a.x, b.y - a.y); return l < 1e-12 ? null : { x: (b.x - a.x) / l, y: (b.y - a.y) / l }; };

/** A length between two points drawn FreeCAD style: extension lines from both points to a dimension line `off` away (to the left of a -> b, or for
 *  horizontal / vertical distances the side that is up / right), with arrowheads inside and the text centred on it. */
export function linearShape(a: Pt, b: Pt, off: number, axis: 'free' | 'h' | 'v' = 'free'): DimShape | null {
  let a2: Pt, b2: Pt;
  if (axis === 'h') { const y = (off >= 0 ? Math.max(a.y, b.y) : Math.min(a.y, b.y)) + off; a2 = { x: a.x, y }; b2 = { x: b.x, y }; }
  else if (axis === 'v') { const x = (off >= 0 ? Math.max(a.x, b.x) : Math.min(a.x, b.x)) + off; a2 = { x, y: a.y }; b2 = { x, y: b.y }; }
  else { const u = unit(a, b); if (!u) return null; const n = { x: -u.y * off, y: u.x * off }; a2 = { x: a.x + n.x, y: a.y + n.y }; b2 = { x: b.x + n.x, y: b.y + n.y }; }
  const u = unit(a2, b2);
  if (!u) return null;
  const over = Math.abs(off) * 0.15;   // the extension lines run a little past the dimension line
  const past = (p: Pt, q: Pt): Pt => { const w = unit(p, q)!; return { x: q.x + w.x * over, y: q.y + w.y * over }; };
  const text = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
  return { kind: 'linear', ext: [[a, past(a, a2)], [b, past(b, b2)]], line: [a2, b2], arrows: [{ at: a2, dir: { x: -u.x, y: -u.y } }, { at: b2, dir: u }], text, slope: slopeOf(u.x, u.y) };
}

/** An angle between two lines meeting at `c`: an arc of radius `r` inside the corner (the smaller way round) with arrowheads at its ends. */
export function angleShape(c: Pt, p: Pt, q: Pt, r: number, square = false): DimShape | null {
  if (!(r > 0)) return null;
  let a0 = Math.atan2(p.y - c.y, p.x - c.x), a1 = Math.atan2(q.y - c.y, q.x - c.x);
  let d = (((a1 - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) { [a0, a1] = [a1, a0]; d = 2 * Math.PI - d; }
  if (d < 1e-9) return null;
  a1 = a0 + d;
  const at = (a: number, k = 1): Pt => ({ x: c.x + Math.cos(a) * r * k, y: c.y + Math.sin(a) * r * k });
  const mid = a0 + d / 2;
  // the arrowheads point along the arc's tangent, outward from its middle
  const arrows: Arrow[] = [{ at: at(a0), dir: { x: Math.sin(a0), y: -Math.cos(a0) } }, { at: at(a1), dir: { x: -Math.sin(a1), y: Math.cos(a1) } }];
  const isSquare = square && Math.abs(d - Math.PI / 2) < 1e-6;
  return { kind: 'angle', c, r, a0, a1, arrows: isSquare ? [] : arrows, text: at(mid, 1.35), slope: 0, ...(isSquare ? { square: true } : {}) };
}

/** A radius or diameter: a leader from the centre (or across it) out through the circle at 45 degrees, ending past it where the text sits. */
export function leaderShape(c: Pt, radius: number, diameter: boolean, extra: number, side: 1 | -1 = 1): DimShape | null {
  if (!(radius > 0)) return null;
  const u = { x: side * Math.SQRT1_2, y: Math.SQRT1_2 };
  const edge: Pt = { x: c.x + u.x * radius, y: c.y + u.y * radius };
  const end: Pt = { x: edge.x + u.x * extra, y: edge.y + u.y * extra };
  const far: Pt = { x: c.x - u.x * radius, y: c.y - u.y * radius };
  const from = diameter ? far : c;
  const arrows: Arrow[] = [{ at: edge, dir: { x: -u.x, y: -u.y } }];
  if (diameter) arrows.push({ at: far, dir: u });
  return { kind: 'leader', line: [from, end], arrows, text: end, slope: 0 };
}

/** Separate labels (screen pixels, centre x / y and size) that overlap: each pair is pushed apart along the axis of least overlap, a few passes, keeping order stable. Pure. */
export function nudgeLabels<T extends { x: number; y: number; w: number; h: number }>(items: T[], passes = 12): T[] {
  const out = items.map((i) => ({ ...i }));
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      const ox = (a.w + b.w) / 2 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 - Math.abs(a.y - b.y);
      if (ox <= 0 || oy <= 0) continue;
      moved = true;
      // vertical separation unless the boxes overlap much more in height than in width (then sideways)
      if (oy <= ox) { const s = a.y <= b.y ? -1 : 1; a.y += s * (oy / 2 + 0.5); b.y -= s * (oy / 2 + 0.5); }
      else { const s = a.x <= b.x ? -1 : 1; a.x += s * (ox / 2 + 0.5); b.x -= s * (ox / 2 + 0.5); }
    }
    if (!moved) break;
  }
  return out;
}

export const GLYPHS: Record<string, string> = {
  horizontal: 'H', vertical: 'V', equal: '=', parallel: '∥', perpendicular: '⊥', collinear: '≡',
  coincident: '●', midpoint: 'M', tangent: 'T', symmetric: '⇄', fix: '⚓', concentric: '◎', pointOnLine: '⌖', pointOnCircle: '⌖',
};
const DIM_TYPES = new Set(['distance', 'hdist', 'vdist', 'pldist', 'radius', 'diameter', 'angle']);

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** How far apart the two things a dimension measures are (or its value): the scale for an offset when the zoom is unknown. */
export function measuredLength(draft: SketchDraft, type: string, refs: string[], value: number): number {
  const e = endsOfRefs(draft, refs);
  if (e && type !== 'radius' && type !== 'diameter' && type !== 'angle') return Math.hypot(e[1].x - e[0].x, e[1].y - e[0].y);
  return Math.abs(value);
}

/** The ends of a line entity ref, or of two point refs. */
function endsOfRefs(draft: SketchDraft, refs: string[]): [Pt, Pt] | null {
  const pts = new Map(draft.points.map((p) => [p.id, p]));
  if (refs.length === 2) { const a = pts.get(refs[0]), b = pts.get(refs[1]); return a && b ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : null; }
  const e = refs.length === 1 ? draft.entities.find((x) => x.id === refs[0]) : undefined;
  if (e?.type === 'line') { const a = pts.get(String(e.p1)), b = pts.get(String(e.p2)); return a && b ? [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] : null; }
  return null;
}

export interface ShapeOptions {
  /** The distance (sketch units) of the first dimension line from the geometry; level n sits at n times it. */
  off: number;
  /** 1 (default), 2, 3 ...: how far out the dimension is placed (extension lines grow with it). */
  level?: number;
  /** Which side of the measured geometry: 1 is to the left of a -> b (up for a horizontal line), -1 the other. */
  side?: 1 | -1;
  /** A right angle becomes a square corner mark. */
  squareRight?: boolean;
}

/** The drawing of one dimension (type, refs, value) at a chosen level and side. Null when the geometry is missing or degenerate (such a dimension keeps a plain label). */
export function dimensionShape(draft: SketchDraft, type: string, refs: string[], value: number, o: ShapeOptions): DimShape | null {
  const pts = new Map<string, Pt>(draft.points.map((p) => [p.id, { x: p.x, y: p.y }]));
  const ents = new Map<string, DraftEntity>(draft.entities.map((e) => [e.id, e]));
  const level = o.level ?? 1, side = o.side ?? 1;
  if (type === 'distance' || type === 'hdist' || type === 'vdist') {
    const e = endsOfRefs(draft, refs);
    return e ? linearShape(e[0], e[1], side * o.off * level, type === 'hdist' ? 'h' : type === 'vdist' ? 'v' : 'free') : null;
  }
  if (type === 'radius' || type === 'diameter') {
    const e = ents.get(refs[0]);
    const extra = o.off * 0.7 * level;
    if (e?.type === 'circle') { const c = pts.get(String(e.c)); return c ? leaderShape(c, Number(e.r), type === 'diameter', extra, side) : null; }
    if (e?.type === 'arc') {
      const c = pts.get(String(e.c)), p1 = pts.get(String(e.p1));
      return c && p1 ? leaderShape(c, Math.hypot(p1.x - c.x, p1.y - c.y), type === 'diameter', extra, side) : null;
    }
    return null;
  }
  if (type === 'angle' && refs.length === 2) {
    const a = ents.get(refs[0]), b = ents.get(refs[1]);
    if (!a || !b || a.type !== 'line' || b.type !== 'line') return null;
    const corner = [a.p1, a.p2].find((id) => id === b.p1 || id === b.p2);
    const c = corner ? pts.get(String(corner)) : undefined;
    const far = (e: DraftEntity) => pts.get(String(e.p1 === corner ? e.p2 : e.p1));
    const pa = far(a), pb = far(b);
    if (!c || !pa || !pb) return null;
    const shorter = Math.min(Math.hypot(pa.x - c.x, pa.y - c.y), Math.hypot(pb.x - c.x, pb.y - c.y));
    return angleShape(c, pa, pb, Math.min(shorter * Math.min(0.9, 0.45 + 0.15 * level), o.off * 1.5 * level), o.squareRight === true);
  }
  return null;
}

export function annotate(draft: SketchDraft, opts: AnnotateOptions = {}): Annotation[] {
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

  const px = (v: number, len: number) => (opts.upp && opts.upp > 0 ? v * opts.upp : len * 0.2);
  const shapeOf = (type: string, refs: string[], value: number): DimShape | null => {
    const len = measuredLength(draft, type, refs, value);
    return dimensionShape(draft, type, refs, value, { off: px(DIM_OFFSET_PX, len), squareRight: opts.squareRight !== false });
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
      const shape = shapeOf(c.type, refs, shown);
      out.push({ ...base, kind: 'dimension', text: dimText(c.type, shown), at, value: shown, ...(shape ? { shape } : {}), ...(typeof c.expr === 'string' && c.expr ? { expr: c.expr } : {}) });
      continue;
    }
    const glyph = GLYPHS[c.type];
    if (!glyph || (c.type === 'coincident' && !opts.coincident)) continue;
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

/** Horizontal / vertical constraints that only lock the sides of a closed rectangle (four lines in a loop, every side locked to an axis).
 *  Such a rectangle would otherwise carry four near-identical glyphs; the chips for these show on hover only. Returns the constraint ids. */
export function rectangleAxisLocks(draft: SketchDraft): Set<string> {
  const lock = new Map<string, string[]>();   // line id -> its H / V constraint ids
  for (const c of draft.constraints) {
    if (c.hidden === true || (c.type !== 'horizontal' && c.type !== 'vertical') || (c.refs ?? []).length !== 1) continue;
    const e = draft.entities.find((x) => x.id === c.refs![0]);
    if (e?.type !== 'line') continue;
    lock.set(e.id, [...(lock.get(e.id) ?? []), c.id]);
  }
  const lines = draft.entities.filter((e) => lock.has(e.id));
  const parent = new Map<string, string>();
  const find = (a: string): string => { let r = a; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(a, r); return r; };
  for (const e of lines) for (const k of [String(e.p1), String(e.p2)]) if (!parent.has(k)) parent.set(k, k);
  for (const e of lines) parent.set(find(String(e.p1)), find(String(e.p2)));
  const groups = new Map<string, DraftEntity[]>();
  for (const e of lines) { const r = find(String(e.p1)); groups.set(r, [...(groups.get(r) ?? []), e]); }
  const out = new Set<string>();
  for (const g of groups.values()) {
    if (g.length !== 4) continue;
    const deg = new Map<string, number>();
    for (const e of g) for (const k of [String(e.p1), String(e.p2)]) deg.set(k, (deg.get(k) ?? 0) + 1);
    if (deg.size !== 4 || [...deg.values()].some((n) => n !== 2)) continue;   // a closed loop of four
    for (const e of g) for (const id of lock.get(e.id)!) out.add(id);
  }
  return out;
}

/** The focus set plus the points of the focused entities (a chip on a point is shown when an entity through it is). */
export function expandFocus(draft: SketchDraft, focus: Iterable<string>): Set<string> {
  const out = new Set(focus);
  for (const e of draft.entities) {
    if (!out.has(e.id)) continue;
    for (const k of ['p1', 'p2', 'c']) if (typeof e[k] === 'string') out.add(e[k] as string);
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
