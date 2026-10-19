// Which operation a new extrude (or revolve) starts with. Nothing is remembered from the last one used: a Cut is only the
// default when the user chose a Cut command on purpose; otherwise a sketch that meets an existing body adds to it, and a
// sketch in empty space makes a new body when the kernel can (it cannot yet: the extrude `op` is `add` or `cut`).
import type { PlaneFrame } from '@kit/sketch';

export type ExtrudeOp = 'new' | 'add' | 'cut';

/** The extrude `op` values the kernel accepts. `new` (a separate body) and `intersect` are not among them (spec-agent-interface). */
export const KERNEL_EXTRUDE_OPS: ReadonlyArray<'add' | 'cut'> = ['add', 'cut'];
export const KERNEL_SUPPORTS_NEW_BODY = false;

type Box = { min: number[]; max: number[] };

/** Whether the sketch plane passes through (or touches) the body's bounding box: the sketch can reach the body from there. */
export function planeTouchesBox(frame: PlaneFrame | null, box: Box | null, tol = 1e-6): boolean {
  if (!frame || !box) return false;
  const c = [0, 1, 2].map((i) => (box.min[i] + box.max[i]) / 2);
  const h = [0, 1, 2].map((i) => (box.max[i] - box.min[i]) / 2);
  const d = [0, 1, 2].reduce((s, i) => s + (c[i] - frame.o[i]) * frame.z[i], 0);
  const reach = [0, 1, 2].reduce((s, i) => s + Math.abs(frame.z[i]) * h[i], 0);
  return Math.abs(d) <= reach + tol;
}

export function defaultExtrudeOp(o: { explicitCut?: boolean; touchesBody: boolean; supportsNew?: boolean }): ExtrudeOp {
  if (o.explicitCut) return 'cut';
  if (o.touchesBody) return 'add';
  return o.supportsNew ? 'new' : 'add';
}

/** The ops the card offers: New only when the kernel has it. */
export function opChoices(supportsNew = KERNEL_SUPPORTS_NEW_BODY): Array<'new' | 'add' | 'cut'> {
  return supportsNew ? ['new', 'add', 'cut'] : ['add', 'cut'];
}
