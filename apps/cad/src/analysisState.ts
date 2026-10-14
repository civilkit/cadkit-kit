// Surface analysis state (zebra, curvature maps, draft colours, curvature comb): viewer-only like the look, kept for the session
// and never saved in the part. `legend` is what the viewport reports it is drawing, for the colour bar on screen.
import { signal } from '@preact/signals-core';
import { DEFAULT_ANALYSIS, sanitizeAnalysis, type AnalysisMode, type AnalysisOptions, type Legend } from '@kit/viewport';

export const PULL_DIRECTIONS: Array<{ id: string; v: [number, number, number] }> = [
  { id: '+x', v: [1, 0, 0] }, { id: '-x', v: [-1, 0, 0] }, { id: '+y', v: [0, 1, 0] }, { id: '-y', v: [0, -1, 0] }, { id: '+z', v: [0, 0, 1] }, { id: '-z', v: [0, 0, -1] },
];
export const pullId = (v: readonly number[]): string => PULL_DIRECTIONS.find((p) => p.v[0] === v[0] && p.v[1] === v[1] && p.v[2] === v[2])?.id ?? '+y';

export function createAnalysisStore() {
  const opts = signal<AnalysisOptions>(DEFAULT_ANALYSIS);
  const legend = signal<Legend | null>(null);
  return {
    opts, legend,
    set(patch: Partial<AnalysisOptions>) { opts.value = sanitizeAnalysis({ ...opts.value, ...patch }); },
    /** Choose a mode; choosing the one already on turns it off. */
    toggleMode(mode: AnalysisMode) { opts.value = sanitizeAnalysis({ ...opts.value, mode: opts.value.mode === mode ? 'off' : mode }); },
    toggleComb() { opts.value = sanitizeAnalysis({ ...opts.value, comb: !opts.value.comb }); },
  };
}
export type AnalysisStore = ReturnType<typeof createAnalysisStore>;
