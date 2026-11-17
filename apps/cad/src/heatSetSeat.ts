// Heat-set seat on an existing hole: the picked hole (as read by readFastenHole) gives the insert wizard its start: the insert goes in at the hole's mouth, along the
// hole's axis into the part, and the size is the table row whose hole is closest to this one. The wizard (with its live preview) does the rest. Where the existing
// hole is already as wide as the insert's hole nothing is cut (the insert sits in the hole as it is); a narrower hole is opened up to the insert's hole.
// Pure functions: no DOM, no kernel.
import type { FastenHole } from './fastenHole';
import { DEFAULT_INSERT, INSERT_SIZE_NAMES, insertDefaults, type FastenerAxis, type InsertParams } from './fasteners';
import { INSERT_SIZES } from '@kit/script';

export type SeatRefusal = 'axis' | 'diameter';

const AXES: Array<[FastenerAxis, [number, number, number]]> = [['nz', [0, 0, -1]], ['pz', [0, 0, 1]], ['nx', [-1, 0, 0]], ['px', [1, 0, 0]], ['ny', [0, -1, 0]], ['py', [0, 1, 0]]];
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0;

/** The insert size whose hole is nearest to a hole of this diameter, mm. */
export function nearestInsertSize(diameter: number): string {
  let best = INSERT_SIZE_NAMES[0], gap = Infinity;
  for (const n of INSERT_SIZE_NAMES) { const d = Math.abs(INSERT_SIZES[n].hole - diameter); if (d < gap - 1e-9) { gap = d; best = n; } }
  return best;
}

export function seatParams(hole: Pick<FastenHole, 'mouth' | 'out' | 'diameter'>, size?: string): { ok: true; params: InsertParams } | { ok: false; reason: SeatRefusal } {
  if (!(hole.diameter > 0)) return { ok: false, reason: 'diameter' };
  const into: [number, number, number] = [-hole.out[0], -hole.out[1], -hole.out[2]];
  const len = Math.hypot(...into) || 1;
  const found = AXES.find(([, v]) => (v[0] * into[0] + v[1] * into[1] + v[2] * into[2]) / len > 0.9999);
  if (!found) return { ok: false, reason: 'axis' };
  const sz = size && INSERT_SIZES[size] ? size : nearestInsertSize(hole.diameter);
  const d = insertDefaults(sz);
  return {
    ok: true,
    params: { ...DEFAULT_INSERT, size: sz, ...d, hole: hole.diameter < d.holeDiameter - 0.01, origin: hole.mouth.map(r4) as [number, number, number], axis: found[0] },
  };
}
