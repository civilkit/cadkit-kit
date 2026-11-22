/**
 * An origin axis as a mirror line. The draft has no axis entities, so "mirror about X / Y" and "symmetric about the
 * X / Y axis" use a construction line lying on the axis with both ends fixed (it is never extruded and the kernel
 * treats it as any other line). An axis line that is already there (same fixed ends, construction) is reused, so
 * asking twice adds nothing. `x` is the horizontal axis (y = 0), `y` the vertical axis (x = 0).
 */
import type { SketchDraft } from '../types';
import { withEntity } from './edit-draft';
import { nextId } from './builders';

export type AxisName = 'x' | 'y';
export const AXIS_KEYS: Record<string, AxisName> = { x: 'x', y: 'y' };

export function axisLine(d: SketchDraft, axis: AxisName): { draft: SketchDraft; id: string } {
  const along = (p: { x: number; y: number }) => (axis === 'x' ? p.x : p.y);
  const across = (p: { x: number; y: number }) => (axis === 'x' ? p.y : p.x);
  for (const e of d.entities) {
    if (e.type !== 'line' || !e.construction) continue;
    const a = d.points.find((p) => p.id === e.p1), b = d.points.find((p) => p.id === e.p2);
    if (a?.fixed && b?.fixed && Math.abs(across(a)) < 1e-9 && Math.abs(across(b)) < 1e-9 && along(a) !== along(b)) return { draft: d, id: e.id };
  }
  const reach = Math.max(50, ...d.points.flatMap((p) => [Math.abs(p.x), Math.abs(p.y)])) * 1.5;
  const mk = (t: number) => (axis === 'x' ? { x: t, y: 0 } : { x: 0, y: t });
  let out = d;
  const ids: string[] = [];
  for (const t of [-reach, reach]) {
    const id = nextId(out, 'p');
    out = { ...out, points: [...out.points, { id, ...mk(t), fixed: true }] };
    ids.push(id);
  }
  const add = withEntity(out, { type: 'line', p1: ids[0], p2: ids[1], construction: true });
  return { draft: add.draft, id: add.id };
}
