// The runner: evaluates the script text in a restricted scope, then applies the recorded steps through a host (the app's Controller or a Session).
import { makeApi, setLineOffset, type Ctx, type EditOp, type ScriptState, type Step } from './recorder';
import { SelectorError, type Geometry } from './selectors';

export interface EditResultLike { ok: boolean; errors?: Array<[string, { code?: string; message?: string }] | { feature?: string; code?: string; message?: string }>; schemaError?: string; added?: string[] }
/** What the runner needs from the app: a way to open a document, edit it, and read the current body. */
export interface ScriptHost {
  load(doc: Record<string, unknown>): Promise<void>;
  edit(ops: EditOp[], reason?: string): Promise<EditResultLike>;
  geometry(): Geometry;
  /**
   * Optional: build `doc` headless, on a scratch kernel state that is not the open document. Without `view` the kernel skips
   * the display work (tessellation, edges, silhouettes, mesh transfer) and only reports errors; with `view` it also returns the
   * body for the selectors. A host that has this gets the batched run: the document is loaded ONCE, at the end.
   */
  build?(doc: Record<string, unknown>, view: boolean): Promise<BuildReply>;
  /** Optional: free the scratch state after the run (finished, failed or cancelled). */
  release?(): Promise<void>;
}
export interface BuildReply { errors: Array<[string, { code?: string; message?: string }]>; geometry?: Geometry }
export interface Progress { phase: 'building' | 'loading'; done: number; total: number; elapsedMs: number }
export interface RunOptions {
  /** Force the old path (one edit per step, a view per step) for comparison. Default: batched when the host can build. */
  batched?: boolean;
  /** Steps compiled between two headless builds (progress, early errors, cancel points). Infinity: one build for everything. */
  flushEvery?: number;
  signal?: { aborted: boolean };
  onProgress?(p: Progress): void;
  /** Let the UI breathe between chunks (default: a macrotask). */
  yieldToUi?(): Promise<void>;
  /**
   * Attach mode: features already in the open document. The script's steps are built AFTER them (selectors see their body,
   * ids continue from `seq`), the host is never asked to load or edit (the caller applies the returned ops itself) and
   * `result.document.features` is the prefix followed by the script's features.
   */
  prefix?: { features: Array<Record<string, unknown>>; seq: number };
}
export interface RunStats { batched: boolean; steps: number; builds: number; viewBuilds: number; buildMs: number; loadMs: number; totalMs: number }
export interface ScriptError { line: number; message: string; feature?: string }
export interface ScriptResult {
  ops: EditOp[];
  /** The document the script built (features as the kernel kept them is up to the host; this is the recorded one), with `script` set. */
  document: Record<string, unknown> | null;
  errors: ScriptError[];
  /** True when the run was cancelled: nothing was loaded, the document that was open is untouched. */
  cancelled?: boolean;
  stats?: RunStats;
}

const DENIED = ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'globalThis', 'self', 'parent', 'top', 'localStorage', 'sessionStorage', 'indexedDB', 'Worker', 'importScripts', 'Function', 'process', 'require', 'navigator', 'location', 'setTimeout', 'setInterval', 'queueMicrotask'];
export const MAX_SOURCE = 40000;
export const MAX_STEPS = 2000;

/** Evaluate only: the recorded steps, variables and the part name. Never touches a kernel. */
export function evaluate(code: string): { state: ScriptState; errors: ScriptError[] } {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const errors: ScriptError[] = [];
  if (code.length > MAX_SOURCE) return { state, errors: [{ line: 1, message: `script is longer than ${MAX_SOURCE} characters` }] };
  const api = makeApi(state);
  const names = Object.keys(api);
  // an iteration budget: a `while`/`for` loop in user code is rewritten to count its turns (cheap protection against an endless loop)
  const guarded = guardLoops(code);
  try {
    // header offset: `new Function` puts two lines before the body
    setLineOffset(2);
    const fn = new Function(...names, ...DENIED, `"use strict"; let __fuel = 0; ${guarded}\n//# sourceURL=kit-script`);
    fn(...names.map((n) => (api as Record<string, unknown>)[n]), ...DENIED.map(() => undefined));
  } catch (e) {
    errors.push(toError(e));
  }
  if (!errors.length && !state.parts.length) errors.push({ line: 1, message: 'the script builds no part: start with part("Name")' });
  return { state, errors };
}

function guardLoops(code: string): string {
  return code.replace(/\b(while|for)\s*\([^)]*\)\s*\{/g, (m) => `${m} if (++__fuel > 100000) throw new Error('loop limit exceeded');`);
}

function toError(e: unknown): ScriptError {
  if (e instanceof SelectorError) return { line: e.line, message: e.message };
  const err = e as Error;
  const m = /kit-script:(\d+):\d+/.exec(err?.stack ?? '');
  const line = m ? Math.max(1, Number(m[1]) - 2) : 0;
  return { line, message: err?.message ?? String(e) };
}

/** Compile the steps to ops against `geo` supplied per step; used by the runner and by tests that have no kernel. */
export async function runScript(code: string, host: ScriptHost, base: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<ScriptResult> {
  const { state, errors } = evaluate(code);
  if (errors.length) return { ops: [], document: null, errors };
  const part = state.parts[state.parts.length - 1];
  if (part.steps.length > MAX_STEPS) return { ops: [], document: null, errors: [{ line: 1, message: `more than ${MAX_STEPS} steps` }] };
  const doc: Record<string, unknown> = { format: 'ck-part', version: 1, name: part.name, features: [], seq: 1, rollback: null, ...base, ...(state.varDefs.length ? { variables: state.varDefs } : {}), script: code };
  if (host.build && opts.batched !== false) return runBatched(part.steps, doc, host, opts);
  const t0 = performance.now();
  await host.load(structuredClone(doc));
  const ops: EditOp[] = [];
  let n = 0;
  const ctx: Ctx = { geo: host.geometry(), nextId: () => `F${++n}`, lastSketch: null, lastFeature: null };
  let stepNo = 0;
  for (const step of part.steps) {
    opts.onProgress?.({ phase: 'building', done: stepNo++, total: part.steps.length, elapsedMs: performance.now() - t0 });
    ctx.geo = host.geometry();
    let stepOps: EditOp[];
    try { stepOps = step.run(ctx); } catch (e) {
      errors.push({ ...toError(e), line: e instanceof SelectorError && e.line ? e.line : step.line });
      break;
    }
    const r = await host.edit(stepOps, step.label);
    ops.push(...stepOps);
    const fid = (stepOps[stepOps.length - 1].feature.id as string | undefined) ?? undefined;
    if (!r.ok) {
      errors.push({ line: step.line, feature: fid, message: r.schemaError ?? firstMessage(r) ?? 'the kernel rejected this step' });
      break;
    }
    // a feature that was kept but failed to regenerate (e.g. a cut that removes nothing) is reported on its line, the run goes on
    for (const e of errorsOf(r)) errors.push({ line: step.line, feature: e.feature ?? fid, message: e.message });
  }
  (doc.features as unknown[]) = ops.map((o) => o.feature);
  doc.seq = n + 1;
  return { ops, document: doc, errors, stats: { batched: false, steps: part.steps.length, builds: 0, viewBuilds: 0, buildMs: 0, loadMs: 0, totalMs: performance.now() - t0 } };
}

/** Thrown inside a step when a selector reads a body that is older than the features recorded since: the runner builds a view and runs the step again. */
class NeedGeometry extends Error { constructor() { super('geometry needed'); } }
export const FLUSH_EVERY = 25;
const macrotask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/**
 * The batched run. The features are recorded into one list; the kernel builds it in chunks on a scratch state WITHOUT the display
 * work (its regen cache makes each chunk cost only its new features), a view is built only when a selector reads the body, and
 * the finished list is loaded into the app in a single step. Nothing of the open document is touched before that, so a cancel
 * needs no undo.
 */
async function runBatched(steps: Step[], doc: Record<string, unknown>, host: ScriptHost, opts: RunOptions): Promise<ScriptResult> {
  const t0 = performance.now();
  const errors: ScriptError[] = [];
  const stats: RunStats = { batched: true, steps: steps.length, builds: 0, viewBuilds: 0, buildMs: 0, loadMs: 0, totalMs: 0 };
  const every = opts.flushEvery ?? FLUSH_EVERY;
  const yieldToUi = opts.yieldToUi ?? macrotask;
  const prefix = opts.prefix?.features ?? [];
  const features: Array<Record<string, unknown>> = [...prefix];
  const stepOfFeature = new Map<string, number>();
  const ops: EditOp[] = [];
  let n = opts.prefix ? opts.prefix.seq - 1 : 0;
  let built = 0;                 // steps whose features the kernel has accepted
  let geo: Geometry = { mesh: null, edges: [], box: null };
  let geoAt = 0;                 // feature count `geo` belongs to
  const current = (): Geometry => { if (geoAt !== features.length) throw new NeedGeometry(); return geo; };
  const lazy: Geometry = {
    get mesh() { return current().mesh; },
    get edges() { return current().edges; },
    get box() { return current().box; },
  };
  const ctx: Ctx = { geo: lazy, nextId: () => `F${++n}`, lastSketch: null, lastFeature: null };
  const progress = (phase: Progress['phase']): void => opts.onProgress?.({ phase, done: built, total: steps.length, elapsedMs: performance.now() - t0 });
  const cancelled = (): boolean => opts.signal?.aborted === true;
  const cancelResult = (): ScriptResult => ({ ops: [], document: null, errors: [], cancelled: true, stats: { ...stats, totalMs: performance.now() - t0 } });
  let keep = -1;                 // steps kept when a build refuses one (-1: all)
  let failed = false;

  /** Build everything recorded so far. Returns false when the kernel refused a step (reported, the run stops). */
  const flush = async (view: boolean, upTo: number): Promise<boolean> => {
    const tb = performance.now();
    const r = await host.build!({ ...doc, features: [...features], seq: n + 1 }, view);
    stats.builds++; if (view) stats.viewBuilds++;
    stats.buildMs += performance.now() - tb;
    if (view) { geo = r.geometry ?? { mesh: null, edges: [], box: null }; geoAt = features.length; }
    if (r.errors.length) {
      // the earliest failing step is the cause; later errors are consequences
      let best = Infinity, fid = r.errors[0][0], msg = '';
      for (const [id, e] of r.errors) {
        const si = stepOfFeature.get(id) ?? upTo - 1;
        if (si < best) { best = si; fid = id; msg = e?.message ?? e?.code ?? ''; }
      }
      errors.push({ line: steps[best].line, feature: fid, message: msg || 'the kernel rejected this step' });
      keep = best; failed = true;
      return false;
    }
    built = upTo;
    progress('building');
    return true;
  };

  try {
    progress('building');
    for (let done = 0; done < steps.length; done++) {
      if (cancelled()) return cancelResult();
      const step = steps[done];
      let stepOps: EditOp[] | null = null;
      for (let attempt = 0; attempt < 2 && !stepOps; attempt++) {
        const save = { n, ls: ctx.lastSketch, lf: ctx.lastFeature };
        try { stepOps = step.run(ctx); } catch (e) {
          if (e instanceof NeedGeometry && attempt === 0) {
            n = save.n; ctx.lastSketch = save.ls; ctx.lastFeature = save.lf;
            if (!(await flush(true, done))) break;
            await yieldToUi();
            if (cancelled()) return cancelResult();
            continue;
          }
          errors.push({ ...toError(e), line: e instanceof SelectorError && e.line ? e.line : step.line });
          failed = true; break;
        }
      }
      if (failed || !stepOps) break;
      for (const o of stepOps) {
        stepOfFeature.set(o.feature.id as string, done);
        if (o.index !== undefined && o.index < features.length) features.splice(o.index, 0, o.feature); else features.push(o.feature);
      }
      ops.push(...stepOps);
      if (done + 1 - built >= every) {
        if (!(await flush(false, done + 1))) break;
        await yieldToUi();
      }
    }
    if (!failed && built < steps.length) await flush(false, steps.length);
    if (cancelled()) return cancelResult();
    // what the app gets: everything up to (not including) the step the kernel refused
    const kept = keep >= 0 ? ops.filter((o) => (stepOfFeature.get(o.feature.id as string) ?? 0) < keep) : ops;
    if (opts.prefix) {
      return { ops: kept, document: { ...doc, features: [...prefix, ...kept.map((o) => o.feature)], seq: n + 1 }, errors, stats: { ...stats, totalMs: performance.now() - t0 } };
    }
    progress('loading');
    await yieldToUi();
    const tl = performance.now();
    // the empty part opens, then ONE edit adds the whole list: one regeneration with a view (the kernel finds the list built) and
    // one undo entry for the run
    await host.load(structuredClone(doc));
    if (kept.length) {
      const r = await host.edit(kept, 'script');
      if (!r.ok) errors.push({ line: 1, message: r.schemaError ?? firstMessage(r) ?? 'the kernel rejected the built list' });
    }
    stats.loadMs = performance.now() - tl;
  } finally {
    await host.release?.().catch(() => {});
  }
  doc.features = ops.map((o) => o.feature);
  doc.seq = n + 1;
  stats.totalMs = performance.now() - t0;
  return { ops, document: doc, errors, stats };
}

function errorsOf(r: EditResultLike): Array<{ feature?: string; message: string }> {
  return (r.errors ?? []).map((e) => {
    if (Array.isArray(e)) return { feature: e[0], message: e[1]?.message ?? e[1]?.code ?? 'error' };
    return { feature: e.feature, message: e.message ?? e.code ?? 'error' };
  });
}
const firstMessage = (r: EditResultLike): string | undefined => errorsOf(r)[0]?.message;
