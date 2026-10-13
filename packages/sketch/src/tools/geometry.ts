import type { Modifiers, Pt, ToolSettings } from './types';

const DEG = 180 / Math.PI;
/** Inference tolerance for horizontal and vertical, in degrees. */
export const INFER_DEG = 2;

export interface EndResult { end: Pt; len: number; ang: number; infer?: 'horizontal' | 'vertical' }

/**
 * Where a segment from `a` ends: the pointer position with H/V inference, the Ctrl angle step and any typed
 * length or angle applied. `lock` values always win over the pointer. An explicit `point` (snapped to an
 * existing sketch point) wins unless a typed value pins the length or angle.
 */
export function segmentEnd(
  a: Pt, cursor: Pt, mods: Modifiers, settings: ToolSettings,
  lock: { len?: number; ang?: number }, point?: Pt,
): EndResult {
  const target = point ?? cursor;
  let len = Math.hypot(target.x - a.x, target.y - a.y);
  let ang = Math.atan2(target.y - a.y, target.x - a.x) * DEG;
  let infer: EndResult['infer'];
  if (lock.ang === undefined && !point) {
    if (settings.autoConstraints && !mods.shift) {
      // keep the pointer's own distance along the inferred axis, not the slightly longer diagonal
      if (Math.abs(ang) < INFER_DEG || Math.abs(Math.abs(ang) - 180) < INFER_DEG) { ang = Math.abs(ang) < 90 ? 0 : 180; infer = 'horizontal'; len = Math.abs(target.x - a.x); }
      else if (Math.abs(Math.abs(ang) - 90) < INFER_DEG) { ang = ang > 0 ? 90 : -90; infer = 'vertical'; len = Math.abs(target.y - a.y); }
    }
    if (!infer && mods.ctrl) ang = Math.round(ang / 5) * 5;
  }
  if (lock.ang !== undefined) ang = lock.ang;
  if (lock.len !== undefined) len = lock.len;
  const r = ang / DEG;
  const end = (point && lock.len === undefined && lock.ang === undefined) ? { ...point } : { x: a.x + len * Math.cos(r), y: a.y + len * Math.sin(r) };
  // a typed value that moves the end off an inferred direction cancels the inference
  if (infer === 'horizontal' && Math.abs(Math.sin(ang / DEG)) > 1e-9) infer = undefined;
  if (infer === 'vertical' && Math.abs(Math.cos(ang / DEG)) > 1e-9) infer = undefined;
  return { end, len, ang, infer };
}
