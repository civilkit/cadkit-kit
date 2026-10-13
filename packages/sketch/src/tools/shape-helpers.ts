/** Helpers shared by the shape tools (centre rectangle, point, centreline, ellipse, polygon, slot). Not part of builders.ts. */
import type { DraftEntity, SketchDraft } from '../index';
import { nextId } from './builders';
import type { Pt, PreviewShape } from './types';

/** Add any entity; its id is allocated here. Extra fields (e.g. `construction: true`) ride along. */
export function addEntity(draft: SketchDraft, entity: Omit<DraftEntity, 'id'>): { draft: SketchDraft; id: string } {
  const id = nextId(draft, 'e');
  return { draft: { ...draft, entities: [...draft.entities, { id, ...entity } as DraftEntity] }, id };
}

/** Counter-clockwise arc about `c` from `p1` to `p2` (the kernel sweeps (0, 2pi] CCW from p1 to p2). */
export function addArc(draft: SketchDraft, c: string, p1: string, p2: string): { draft: SketchDraft; id: string } {
  return addEntity(draft, { type: 'arc', c, p1, p2 });
}

export type Locks<K extends string> = Partial<Record<K, number>>;

/**
 * Apply a typed field event to a pair of lock maps. `commit` locks, no commit previews, `null` clears.
 * With `positive` a value <= 0 clears instead (sizes cannot be zero or negative).
 */
export function applyLock<K extends string>(
  locked: Locks<K>, live: Locks<K>, key: K, ev: { value: number | null; commit?: boolean }, positive = true,
): { locked: Locks<K>; live: Locks<K> } {
  const l = { ...locked };
  const v = { ...live };
  if (ev.value === null || !Number.isFinite(ev.value) || (positive && ev.value <= 0)) { delete l[key]; delete v[key]; }
  else if (ev.commit) { l[key] = ev.value; delete v[key]; }
  else v[key] = ev.value;
  return { locked: l, live: v };
}

export const hasValues = (...maps: object[]) => maps.some((m) => Object.keys(m).length > 0);

/** A polyline of preview lines (closed when `close`), used where the preview type has no arc or ellipse. */
export function polyline(pts: Pt[], close = false): PreviewShape[] {
  const out: PreviewShape[] = [];
  for (let i = 0; i + 1 < pts.length; i++) out.push({ kind: 'line', a: pts[i], b: pts[i + 1] });
  if (close && pts.length > 2) out.push({ kind: 'line', a: pts[pts.length - 1], b: pts[0] });
  return out;
}

/** Points along a circular arc about `c`, from angle `a0` sweeping `sweep` radians (counter-clockwise when positive). */
export function arcPoints(c: Pt, r: number, a0: number, sweep: number, segs = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= segs; i++) { const t = a0 + (sweep * i) / segs; out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }); }
  return out;
}
