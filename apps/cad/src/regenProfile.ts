// A small profiler for loads and regenerations (where the time goes) and the one progress line shown in the Console drawer and on the busy overlay.
// Pure data and a signal: the Controller records phases, main.tsx shows the line, the notice at the end names the slowest phases.
import { signal } from '@preact/signals-core';

export interface PhaseTime { phase: string; ms: number }
export interface RegenProfile { kind: 'load' | 'edit' | 'rebuild'; totalMs: number; features: number; phases: PhaseTime[]; at: number }

/** Phases in the order the Controller runs them; the closing summary lists them slowest first. */
export type Phase = 'kernel' | 'fonts' | 'view' | 'report' | 'checks';

/** Collects the time of each named phase of one job (a phase that runs twice adds up). */
export class Profiler {
  private readonly t0 = performance.now();
  private readonly ms = new Map<string, number>();
  constructor(readonly kind: RegenProfile['kind'], readonly features: number) {}
  add(phase: string, ms: number): void { this.ms.set(phase, (this.ms.get(phase) ?? 0) + ms); }
  async time<T>(phase: string, f: () => Promise<T>): Promise<T> {
    const t = performance.now();
    try { return await f(); } finally { this.add(phase, performance.now() - t); }
  }
  finish(): RegenProfile {
    return { kind: this.kind, features: this.features, totalMs: performance.now() - this.t0, phases: [...this.ms].map(([phase, ms]) => ({ phase, ms })), at: Date.now() };
  }
}

type T = (key: string, params?: Record<string, string | number>) => string;
const secs = (ms: number) => (ms / 1000).toFixed(1);

/** Jobs shorter than this are not worth a console line. */
export const PROFILE_NOTE_MS = 1500;

/** `Rebuilt 480 features in 14.2 s: kernel 11.0, view 2.4, report 0.8` (slowest first; phases under 0.05 s are left out). */
export function profileLine(t: T, p: RegenProfile): string {
  const parts = [...p.phases].filter((x) => x.ms >= 50).sort((a, b) => b.ms - a.ms).map((x) => `${t(`app.profile.phase.${x.phase}`)} ${secs(x.ms)}`);
  return t(`app.profile.${p.kind}`, { count: p.features, total: secs(p.totalMs), phases: parts.join(', ') || '-' });
}

/** The most recent job, for the status line and for tools (the MCP reads it). */
export const lastProfile = signal<RegenProfile | null>(null);

// ---- the live progress line ----
export interface ProgressState { phase: string; done: number; total: number; startedAt: number; elapsedMs: number }
/** Set while a long job runs; null otherwise. One line, updated in place (the console never grows by it). */
export const progress = signal<ProgressState | null>(null);

/** `kernel: 120 / 480 features (14.2 s)`; without a count (the kernel reports none inside a regeneration) `kernel: 480 features (14.2 s)`. */
export function progressText(t: T, p: ProgressState): string {
  const phase = t(`app.profile.phase.${p.phase}`);
  return p.done > 0 ? t('app.progress.counted', { phase, done: p.done, total: p.total, seconds: secs(p.elapsedMs) }) : t('app.progress.total', { phase, total: p.total, seconds: secs(p.elapsedMs) });
}

/** Starts the live line and refreshes its elapsed time twice a second until `end()`. It appears only after `delayMs`, so a quick edit never redraws the app for it.
 *  `phase()` and `count()` move it along. */
export function startProgress(total: number, phase: string, delayMs = 800, now: () => number = () => performance.now()): { phase(p: string): void; count(done: number, total?: number): void; end(): void } {
  const startedAt = now();
  let cur: ProgressState = { phase, done: 0, total, startedAt, elapsedMs: 0 };
  let shown = false;
  const push = () => { if (shown) progress.value = { ...cur, elapsedMs: now() - startedAt }; };
  const wait = setTimeout(() => { shown = true; push(); timer = setInterval(push, 500); }, delayMs);
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    phase(p) { cur = { ...cur, phase: p }; push(); },
    count(done, tot) { cur = { ...cur, done, total: tot ?? cur.total }; push(); },
    end() { clearTimeout(wait); if (timer) clearInterval(timer); if (shown) progress.value = null; shown = false; },
  };
}
