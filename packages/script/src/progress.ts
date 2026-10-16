// Progress and cancel for a script run, kept free of the UI so they can be tested alone.
import type { Progress } from './run';

/** A run's cancel switch: the runner polls `signal.aborted` between steps and chunks. */
export function createRunControl(): { signal: { aborted: boolean }; cancel(): void } {
  const signal = { aborted: false };
  return { signal, cancel() { signal.aborted = true; } };
}

/**
 * Passes progress on to the UI at most every `ms` milliseconds or `steps` steps (the first and last reports, and a change of phase,
 * always go through), so a 600-step run does not re-render the panel and the tree 600 times.
 */
export function throttleProgress(emit: (p: Progress) => void, o: { ms?: number; steps?: number; now?: () => number } = {}): (p: Progress) => void {
  const ms = o.ms ?? 250, steps = o.steps ?? 25, now = o.now ?? (() => performance.now());
  let lastAt = -Infinity, lastDone = 0, lastPhase: Progress['phase'] | null = null;
  return (p) => {
    const t = now();
    const final = p.done >= p.total;
    if (lastPhase === null || p.phase !== lastPhase || final || t - lastAt >= ms || p.done - lastDone >= steps) {
      lastAt = t; lastDone = p.done; lastPhase = p.phase;
      emit(p);
    }
  };
}

/** 71 s -> "1:11", 4 s -> "0:04". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
