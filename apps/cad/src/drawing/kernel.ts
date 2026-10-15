// The kernel side of drawings: the `drawing` request for a list of views, hole / thread callout text, and the mass for the title block.
import type { Session } from '@ck/session';
import { sessionQuery } from '../inspect/kernel';
import type { ViewData } from './model';
import type { DrawingQuery } from './layout';
import type { HoleInfo } from './geom';
import { countedLabel, seedCount } from '../patternThreads';

export function drawingQuery(session: Session): DrawingQuery {
  return async (views) => {
    const r = await sessionQuery<{ views: ViewData[] }>(session, { type: 'drawing', views, hidden: true });
    return r?.views ?? null;
  };
}

type Feat = { type: string; id: string; face?: string; standard?: string; size?: string; sketch?: string; kind?: string; end?: string; depth?: number; diameter?: number; fit?: string; name?: string; length?: number | 'full'; class?: string; modeled?: boolean; suppressed?: boolean };

/** Pitch of a thread size, as the thread tables give it. */
export type PitchOf = (standard: string, size: string) => number | null;

const num = (x: number) => String(+x.toFixed(3));

/** `M10x1.5`, `M8`, `1/4-20 UNC` ... from the thread feature. Metric coarse threads keep the pitch too (the drawing states it). */
export function threadLabel(t: Feat, pitchOf?: PitchOf): string {
  const size = t.size ?? '';
  const std = t.standard ?? 'metric';
  if (/^M\d/i.test(size) && !/x/i.test(size)) {
    const p = pitchOf?.(std, size);
    return p ? `${size}x${num(p)}` : size;
  }
  return size;
}

/** Callout text for a hole feature and the thread (if any) on it, e.g. `M8x1.25 ↧ 14` (thread depth), `Ø5.5 THRU`, countersink / bore notes. */
export function holeCallout(h: Feat, thread: Feat | null, pitchOf?: PitchOf): string {
  const depth = h.end === 'through' || h.end === 'thru' ? ' THRU' : typeof h.depth === 'number' ? ` ↧ ${num(h.depth)}` : '';
  let main: string;
  if (thread) main = threadLabel(thread, pitchOf) + (thread.length !== undefined && thread.length !== 'full' && typeof thread.length === 'number' ? ` ↧ ${num(thread.length)}` : depth);
  else main = (h.diameter ? 'Ø' + num(h.diameter) : h.size ? (/^M\d/i.test(h.size) ? h.size + ' CLR' : h.size) : 'HOLE') + depth;
  if (h.kind === 'countersink') main += '\nCSK';
  else if (h.kind === 'counterbore') main += '\nC’BORE';
  return main;
}

/** The hole features and thread features of a document as callout sources: faces they own and the text. */
export function holeInfos(features: Feat[], pitchOf?: PitchOf): Array<HoleInfo & { thread?: boolean }> {
  const out: Array<HoleInfo & { thread?: boolean }> = [];
  const threadsOf = (hid: string) => features.find((f) => f.type === 'thread' && !f.suppressed && typeof f.face === 'string' && f.face.startsWith(hid + '.'));
  for (const f of features) {
    if (f.suppressed) continue;
    if (f.type === 'hole') {
      const th = threadsOf(f.id) ?? null;
      // a patterned threaded hole is called out once for all its copies: `4x M5x0.8`
      const n = th ? seedCount(features as never, f.id) : 1;
      out.push({ feature: f.id, text: countedLabel(n, holeCallout(f, th, pitchOf)), faces: [f.id] });
    }
    else if (f.type === 'thread' && f.face && !features.some((h) => h.type === 'hole' && f.face!.startsWith(h.id + '.'))) out.push({ feature: f.id, text: threadLabel(f, pitchOf) + (typeof f.length === 'number' ? ` ↧ ${num(f.length)}` : ''), faces: [f.face], thread: true });
  }
  return out;
}
