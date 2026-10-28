/**
 * The overall length of a slot, measured across its two end caps.
 *
 * The kernel measures a distance between centres only, so a dimension on the two cap arcs is stored as the centre
 * distance (what the solver enforces) and flagged `overall: true`. What the sketch shows and what the user types is the
 * overall length, the centre distance plus the two cap radii. The conversion lives here so every place that shows or
 * edits such a dimension agrees:
 *
 *   capsOverall      the overall length of two arcs that are a slot's caps, or undefined when they are not
 *   shownValue       the number to display for a dimension constraint (the overall length for an `overall` one)
 *   storedValue      the centre distance that gives a typed overall length (undefined when it would not be positive)
 *
 * Two arcs are caps when they are half circles of the same radius, each bulging away from the other along the line
 * between their centres (so the far ends of the arcs on that line are the ends of the slot). The radii are read from
 * the present geometry, so a later change of the slot's width changes the overall length the label shows while the
 * stored centre distance stays what was dimensioned.
 */
import type { DraftConstraint, SketchDraft } from './index';
import { angleOf, dist, sweepCcw } from './tools/builders-arcs';
import type { Pt } from './tools/types';

interface Cap { c: Pt; r: number; mid: Pt }

function cap(d: SketchDraft, id: string): Cap | undefined {
  const e = d.entities.find((x) => x.id === id);
  if (e?.type !== 'arc') return undefined;
  const pt = (k: unknown) => d.points.find((p) => p.id === k);
  const c = pt(e.c), p1 = pt(e.p1), p2 = pt(e.p2);
  if (!c || !p1 || !p2) return undefined;
  const r = dist(c, p1);
  const a0 = angleOf(c, p1), sweep = sweepCcw(a0, angleOf(c, p2));
  if (r < 1e-9 || Math.abs(sweep - Math.PI) > 0.02) return undefined;
  const m = a0 + sweep / 2;
  return { c: { x: c.x, y: c.y }, r, mid: { x: Math.cos(m), y: Math.sin(m) } };
}

/** The overall length across two slot caps (arc ids), or undefined when the arcs are not the two caps of a slot. */
export function capsOverall(d: SketchDraft, aId: string, bId: string): number | undefined {
  const a = cap(d, aId), b = cap(d, bId);
  if (!a || !b || Math.abs(a.r - b.r) > 1e-6 * Math.max(1, a.r)) return undefined;
  const between = dist(a.c, b.c);
  if (between < 1e-9) return undefined;
  const u = { x: (a.c.x - b.c.x) / between, y: (a.c.y - b.c.y) / between };   // from b to a
  // each cap bulges away from the other one: a's middle points along u, b's against it
  if (a.mid.x * u.x + a.mid.y * u.y < 0.999 || b.mid.x * u.x + b.mid.y * u.y > -0.999) return undefined;
  return between + a.r + b.r;
}

/** The radii of the caps an `overall` dimension spans (0 when the refs are not arcs any more). */
function capRadii(d: SketchDraft, c: { refs?: string[] }): number {
  const r = (id: string | undefined) => { const e = d.entities.find((x) => x.id === id); const cc = e?.type === 'arc' ? d.points.find((p) => p.id === e.c) : undefined; const p1 = e?.type === 'arc' ? d.points.find((p) => p.id === e.p1) : undefined; return cc && p1 ? dist(cc, p1) : 0; };
  return r(c.refs?.[0]) + r(c.refs?.[1]);
}

/** The number a dimension shows: its value, or for an `overall` one the centre distance plus the cap radii. */
export function shownValue(d: SketchDraft, c: DraftConstraint): number | undefined {
  if (typeof c.value !== 'number') return undefined;
  return c.overall === true ? c.value + capRadii(d, c) : c.value;
}

/** The centre distance that gives `shown` as the overall length of the dimension `c` (or of the caps `refs`), or undefined when it would not be positive. */
export function storedValue(d: SketchDraft, c: { refs?: string[]; overall?: unknown }, shown: number): number | undefined {
  if (c.overall !== true) return shown;
  const v = shown - capRadii(d, c);
  return v > 1e-9 ? v : undefined;
}
