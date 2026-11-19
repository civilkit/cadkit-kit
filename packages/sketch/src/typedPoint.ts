/**
 * A first point typed as coordinates: `x,y` (or `@x,y`, the same: the reference is the sketch origin), each coordinate a number, a
 * variable or an expression (`w/2,0`). The tool places the point with an ordinary click at that place; this module then gives the point
 * it made its meaning: a driving `hdist` / `vdist` from the origin per non-zero coordinate, and for a zero coordinate an on-axis
 * constraint (`vertical` for x = 0, `horizontal` for y = 0, `coincident` when both are) instead of a dimension of 0.
 * Pure; the app wires it to the coordinate box (apps/cad/src/CoordBox.tsx).
 */
import type { SketchDraft } from './index';
import { addConstraintOf } from './tools/builders';
import type { Pt } from './tools/types';

export interface TypedPoint { x: number; y: number; xExpr?: string; yExpr?: string }

const EPS = 1e-9;

/** Split `text` at its top-level comma (one not inside brackets); null unless there is exactly one. */
function splitTop(text: string): [string, string] | null {
  let depth = 0, at = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { if (at >= 0) return null; at = i; }
  }
  return at < 0 ? null : [text.slice(0, at), text.slice(at + 1)];
}

/** `x,y` / `@x,y` to a point. `evaluate` turns one coordinate's text into a number (the app's expression evaluator with the sketch's variables), null when it cannot.
 *  A coordinate that is not a plain number keeps its text as the expression the dimension is linked to. */
export function parseTypedPoint(text: string, evaluate: (src: string) => number | null): TypedPoint | null {
  const parts = splitTop(text.trim().replace(/^@/, ''));
  if (!parts) return null;
  const out: TypedPoint = { x: 0, y: 0 };
  for (const [k, raw] of [['x', parts[0]], ['y', parts[1]]] as const) {
    const s = raw.trim();
    if (s === '') return null;
    const v = evaluate(s);
    if (v === null || !Number.isFinite(v)) return null;
    out[k] = v;
    if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) out[k === 'x' ? 'xExpr' : 'yExpr'] = s;
  }
  return out;
}

/** The id of the point `after` has and `before` did not, at `at` (the point a tool just made where the click was). */
export function newPointAt(before: SketchDraft, after: SketchDraft, at: Pt): string | undefined {
  const known = new Set(before.points.map((p) => p.id));
  return after.points.find((p) => !known.has(p.id) && Math.abs(p.x - at.x) < 1e-6 && Math.abs(p.y - at.y) < 1e-6)?.id;
}

/** A dimension measures a distance, so a negative coordinate links to the negated expression (the dimension keeps the side the point is on). */
const distExpr = (expr: string | undefined, v: number): string | undefined => (expr === undefined ? undefined : v < 0 ? `-(${expr})` : expr);

/** Give point `id` (already at the typed place) its constraints against the sketch origin. A draft without an origin, or a fixed point, is returned as it came. */
export function constrainTypedPoint(draft: SketchDraft, id: string, typed: TypedPoint): SketchDraft {
  const p = draft.points.find((q) => q.id === id);
  const o = draft.points.find((q) => q.fixed && q.x === 0 && q.y === 0);
  if (!p || p.fixed || !o) return draft;
  const zx = Math.abs(typed.x) < EPS, zy = Math.abs(typed.y) < EPS;
  if (zx && zy) return addConstraintOf(draft, 'coincident', [id, o.id]);
  let d = draft;
  const dim = (type: 'hdist' | 'vdist', v: number, expr: string | undefined) => {
    d = addConstraintOf(d, type, [o.id, id], Math.abs(v));
    const e = distExpr(expr, v);
    if (e !== undefined) d = { ...d, constraints: d.constraints.map((c, i) => (i === d.constraints.length - 1 ? { ...c, expr: e } : c)) };
  };
  if (zx) d = addConstraintOf(d, 'vertical', [o.id, id]); else dim('hdist', typed.x, typed.xExpr);
  if (zy) d = addConstraintOf(d, 'horizontal', [o.id, id]); else dim('vdist', typed.y, typed.yExpr);
  return d;
}

/** The tools that wait for a first point and may be given it by the coordinate box (ids of their tools). */
export const FIRST_POINT_TOOLS: readonly string[] = ['line', 'circle', 'point', 'rectangle', 'center-rectangle', 'arc-centre', 'ellipse'];

/** Does this key open the coordinate box while a tool waits for its first point and no field has focus? A digit, a minus, a point or `@` starts the text itself; `g` ("go to") opens it empty. */
export function opensCoordBox(key: string, tool: string | null, mod: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}): boolean {
  if (!tool || !FIRST_POINT_TOOLS.includes(tool) || mod.ctrlKey || mod.metaKey || mod.altKey) return false;
  return /^[0-9.\-@]$/.test(key) || key === 'g' || key === 'G';
}

/** Where the coordinate box goes: 16 px below and right of the pointer, flipped to the left / above it when that would leave the
 *  `w` x `h` box outside the `vw` x `vh` area, and clamped so it is always fully inside. */
export function placeCoordBox(x: number, y: number, w: number, h: number, vw: number, vh: number, gap = 16, margin = 4): { left: number; top: number } {
  let left = x + gap, top = y + gap;
  if (left + w > vw - margin) left = x - gap - w;
  if (top + h > vh - margin) top = y - gap - h;
  return { left: Math.max(margin, Math.min(left, vw - w - margin)), top: Math.max(margin, Math.min(top, vh - h - margin)) };
}

/** The text of the coordinate box after another key arrives while it is already open (the input may not have focus yet): the key is appended, never restarts the box. */
export function coordBoxText(current: string | null, key: string): string {
  return (current ?? '') + (/^[gG]$/.test(key) ? '' : key);
}
