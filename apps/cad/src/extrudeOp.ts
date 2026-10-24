// Which operation a new extrude (or revolve) starts with. Nothing is remembered from the last one used: a Cut is only the
// default when the user chose a Cut command on purpose; otherwise a sketch that meets an existing body adds to it, and a
// sketch that does not meet it makes a new body (`op: newBody`, with a name), and the very first solid of a part just adds.
import type { PlaneFrame } from '@kit/sketch';

export type ExtrudeOp = 'new' | 'add' | 'cut';

/** The extrude `op` values the kernel accepts for a solid: `newBody` is a separate body that stays separate where it overlaps another (kernel ADR 0004). */
export const KERNEL_EXTRUDE_OPS: ReadonlyArray<'add' | 'cut' | 'newBody'> = ['add', 'cut', 'newBody'];
export const KERNEL_SUPPORTS_NEW_BODY = true;

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

/** What the Operation control shows for a feature's `op` (the kernel also reads `new` and `separate` for `newBody`). */
export const opChoiceOf = (op: unknown): ExtrudeOp => (op === 'cut' ? 'cut' : op === 'newBody' || op === 'new' || op === 'separate' ? 'new' : 'add');

/** `Body 1`, `Body 2`, ...: the first name no body of the part has. */
export function nextBodyName(used: ReadonlySet<string>): string {
  let n = 1;
  while (used.has(`Body ${n}`)) n++;
  return `Body ${n}`;
}

/** The fields the Operation control sets: a new body gets a name of its own (kept when it has one), the others have no body name. */
export function opPatch(choice: ExtrudeOp, current: { body?: unknown }, used: ReadonlySet<string>): Record<string, unknown> {
  if (choice === 'cut') return { op: 'cut', body: null };
  if (choice === 'new') return { op: 'newBody', flip: null, body: typeof current.body === 'string' && current.body ? current.body : nextBodyName(used) };
  return { op: 'add', flip: null, body: null };
}
