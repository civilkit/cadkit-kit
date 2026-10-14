// The length handle of the Thread editor: a dot at the far end of the thread, on the axis (start + dir * length). Dragging
// it along the axis sets the thread `length` live through the preview path (the same ops the editor's own draft sends,
// built by `ops`); the value is held between one pitch and the face length. Releasing does NOT edit the document: it
// hands the value to the open editor as a draft patch (`HandleCommit.draft`), the editor's tick commits as usual.
import type { EditOp } from '@ck/session';
import { type HandleSpec, type Vec3 } from '@kit/viewport';
import { clampLength } from '../threadData';
import { t } from '../i18n';
import type { HandleSession } from './session';

/** The thread entry of the regen result, the fields the handle needs. */
export interface ThreadEntryLike { id: string; start: number[]; dir: number[]; length: number; pitch?: number; major?: number }

export interface ThreadHandleCtx {
  /** The feature id being edited. */
  id: string;
  entry: ThreadEntryLike;
  /** The face length along the axis in mm (null: unknown, the kernel clamps). */
  maxLength: number | null;
  /** The ops that preview this length together with the rest of the editor's draft. */
  ops(length: number | 'full'): EditOp[];
}

/** The value the feature gets for a dragged quantity: a number, or 'full' once it reaches the face. */
export function lengthValue(q: number, max: number | null, pitch = 0.1): number | 'full' {
  const v = clampLength(q, max, pitch);
  return max !== null && v >= max - 1e-6 ? 'full' : Math.round(v * 1000) / 1000;
}

export function threadLengthSession(c: ThreadHandleCtx): HandleSession | null {
  const e = c.entry;
  if (!e.start || e.start.length !== 3 || !e.dir || e.dir.length !== 3 || !(e.length > 0)) return null;
  const n = Math.hypot(e.dir[0], e.dir[1], e.dir[2]);
  if (n < 1e-9) return null;
  const axis: Vec3 = [e.dir[0] / n, e.dir[1] / n, e.dir[2] / n];
  const origin: Vec3 = [e.start[0] + axis[0] * e.length, e.start[1] + axis[1] * e.length, e.start[2] + axis[2] * e.length];
  const pitch = e.pitch ?? 0.1;
  const spec: HandleSpec = { id: 'length', kind: 'dot', origin, axis, base: e.length, scale: 1, sizePx: 8, offsetPx: 0, unit: 'mm', label: t('handles.threadLength.label') };
  const value = (q: number) => lengthValue(q, c.maxLength, pitch);
  return {
    kind: 'thread-length', target: c.id, specs: [spec],
    preview: (_id, q) => c.ops(value(q)),
    commit: (_id, q) => ({ ops: [], create: false, draft: { length: value(q) } }),
    format: (_id, q) => t('handles.threadLength', { v: String(Math.round(clampLength(q, c.maxLength, pitch) * 100) / 100) }),
  };
}
