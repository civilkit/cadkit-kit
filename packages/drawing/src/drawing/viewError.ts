// The sentence the user reads when the kernel could not make a view: its own detail and hint when it sent them, our wording of the
// error code otherwise. Takes the translator so that it is a pure function.
import type { DView, ViewFailure } from './model';

type Tr = (key: string, params?: Record<string, string | number>) => string;

export function viewFailureText(f: ViewFailure, kind: DView['kind'] | undefined, tr: Tr): string {
  const what = tr('drawing.kind.' + (kind ?? 'std'));
  // a section the kernel could not cut says why; without detail the cut line simply misses the part
  if (f.error === 'cutNoEffect' && !f.detail && !f.hint) return tr('drawing.msg.sectionMisses');
  const code = tr('drawing.msg.err.' + f.error);
  const reason = code === 'drawing.msg.err.' + f.error ? tr('drawing.msg.err.other', { error: f.error }) : code;
  const parts = [tr('drawing.msg.viewFailed', { view: what, reason })];
  if (f.detail) parts.push(/[.!?]$/.test(f.detail) ? f.detail : f.detail + '.');
  if (f.hint) parts.push(f.hint);
  return parts.join(' ');
}
