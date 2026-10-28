import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../i18n';
import { measure, resolvePick, type Pick as Picked } from './measure';
import { quickLines } from './quick';
import type { InspectHost } from './useInspect';

/** The lines for the current selection. A pick of one or two items asks the same `measure()` the Measure tool does. */
export function useQuickMeasure(host: QuickHost, selection: string[], summary: string, off: boolean): string[] {
  const [lines, setLines] = useState<string[]>([]);
  const seq = useRef(0);
  const key = selection.join('\u0001');
  useEffect(() => {
    const mine = ++seq.current;
    if (off || !selection.length) { setLines([]); return; }
    const edges = host.bodyEdges();
    const picks = selection.map((n) => resolvePick(n, edges)).filter((p): p is Picked => !!p);
    if (picks.length !== selection.length || picks.length > 2) { setLines(quickLines(picks, null, summary)); return; }
    void measure(picks, { edges, mesh: host.bodyFaces(), kernel: (refs) => host.measure(refs) })
      .then((out) => { if (mine === seq.current) setLines(quickLines(picks, out, summary)); });
  }, [key, host.revision, summary, off]);
  return lines;
}
type QuickHost = Pick<InspectHost, 'revision' | 'bodyEdges' | 'bodyFaces' | 'measure'>;

/** A small readout in the corner of the view. It never takes the pointer, so picking through it still works. */
export function QuickMeasure({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return <div class="quick-measure" role="status" aria-label={t('quick.label')}>{lines.map((l) => <div key={l}>{l}</div>)}</div>;
}
