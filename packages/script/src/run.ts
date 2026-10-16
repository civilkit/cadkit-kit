// The runner: evaluates the script text in a restricted scope, then applies the recorded steps through a host (the app's Controller or a Session).
import { makeApi, setLineOffset, type Ctx, type EditOp, type FactNeed, type Facts, type ReadRuntime, type ScriptState, type Step } from './recorder';
import { faceInfos, SelectorError, type Geometry, type Vec } from './selectors';

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
  /**
   * Optional: kernel answers about the document built last (the scratch state after build(), or the open document without build()):
   * mass properties (volume, area, centre of mass) and/or the validity check. Without it the read-back methods fail with an error.
   */
  facts?(need: { mass?: boolean; validate?: boolean; describe?: string[] }): Promise<KernelFacts>;
}
export interface KernelFacts {
  volume?: number | null; area?: number | null; com?: number[] | null; valid?: boolean | null; issues?: Array<{ code: string; entity: string; detail: string }>;
  /** per face name: the kernel's exact surface type, area and radius (the display mesh only approximates the area) */
  faces?: Array<{ name: string; surface?: string; area?: number; radius?: number }>;
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
export interface ScriptWarning { line: number; message: string }
export interface ScriptResult {
  ops: EditOp[];
  /** Things the runner resolved for the script that it may not have meant (an ambiguous face('>Z'), a cut direction flipped automatically). Never stops the run. */
  warnings?: ScriptWarning[];
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

const AsyncFunction = Object.getPrototypeOf(async function () { /* constructor probe */ }).constructor as new (...args: string[]) => (...a: unknown[]) => Promise<unknown>;

/**
 * Start the script. A script without `await` runs to its end here (everything is recorded when this returns). A script that
 * awaits a read-back (`await part.volume()`) runs as an async function: it records up to the first read and suspends;
 * `finished` settles when it ends, and the runner resolves each read in turn (see runScript).
 */
export function launch(code: string): { state: ScriptState; errors: ScriptError[]; finished: Promise<void> | null; flags: { done: boolean } } {
  const state: ScriptState = { parts: [], vars: {}, varDefs: [] };
  const errors: ScriptError[] = [];
  const flags = { done: false };
  if (code.length > MAX_SOURCE) return { state, errors: [{ line: 1, message: `script is longer than ${MAX_SOURCE} characters` }], finished: null, flags };
  const api = makeApi(state);
  const names = Object.keys(api);
  // an iteration budget: a `while`/`for` loop in user code is rewritten to count its turns (cheap protection against an endless loop)
  const guarded = guardLoops(code);
  let finished: Promise<void> | null = null;
  try {
    // header offset: `new Function` puts two lines before the body (an async function too)
    setLineOffset(2);
    const body = `"use strict"; let __fuel = 0; ${guarded}\n//# sourceURL=kit-script`;
    if (/\bawait\b/.test(code)) {
      const fn = new AsyncFunction(...names, ...DENIED, body);
      finished = fn(...names.map((n) => (api as Record<string, unknown>)[n]), ...DENIED.map(() => undefined)).then(() => { flags.done = true; }, (e) => { errors.push(toError(e)); flags.done = true; });
    } else {
      const fn = new Function(...names, ...DENIED, body);
      fn(...names.map((n) => (api as Record<string, unknown>)[n]), ...DENIED.map(() => undefined));
      flags.done = true;
    }
  } catch (e) {
    errors.push(toError(e));
    flags.done = true;
  }
  if (!errors.length && !state.parts.length) errors.push({ line: 1, message: 'the script builds no part: start with part("Name")' });
  return { state, errors, finished, flags };
}

/** Evaluate only: the recorded steps, variables and the part name. Never touches a kernel; a script that awaits a read-back records only up to the first read. */
export function evaluate(code: string): { state: ScriptState; errors: ScriptError[] } {
  const { state, errors } = launch(code);
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

/** Facts about the body from the live geometry (faces with fitted kinds, bbox, edge counts). */
function geoFacts(geo: Geometry): Pick<Facts, 'bbox' | 'faceCount' | 'edgeCount' | 'faces' | 'edges'> {
  const infos = geo.mesh ? faceInfos(geo.mesh) : [];
  const len = (pts: number[][] | undefined): number => { let l = 0; const p = pts ?? []; for (let i = 0; i + 1 < p.length; i++) l += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return l; };
  return {
    bbox: geo.box ? { min: [...geo.box.min] as Vec, max: [...geo.box.max] as Vec } : null,
    faceCount: infos.length,
    edgeCount: geo.edges.length,
    faces: infos.map((f) => ({ name: f.id, kind: f.kind, area: f.area, normal: f.planar ? f.normal : null, center: f.centroid, ...(f.radius !== undefined ? { radius: f.radius } : {}), feature: f.owner })),
    edges: geo.edges.map((e) => ({ key: e.key ?? '', mid: (e.mid ?? [0, 0, 0]) as Vec, length: len(e.pts), faces: [...(e.faces ?? [])] })),
  };
}
/** Replace the mesh-fitted area / kind / radius of faces by the kernel's exact values where it answered. */
function exactFaces(faces: Facts['faces'], exact: NonNullable<KernelFacts['faces']>): Facts['faces'] {
  const by = new Map(exact.map((f) => [f.name, f]));
  return faces.map((f) => {
    const e = by.get(f.name);
    if (!e) return f;
    const kind = e.surface === 'plane' || e.surface === 'cylinder' || e.surface === 'sphere' || e.surface === 'cone' || e.surface === 'torus' ? e.surface : e.surface ? 'other' : f.kind;
    return { ...f, kind, ...(e.area !== undefined ? { area: e.area } : {}), ...(e.radius !== undefined ? { radius: e.radius } : {}) };
  });
}
const EMPTY_FACTS: Facts = { volume: null, area: null, com: null, valid: null, issues: [], bbox: null, faceCount: 0, edgeCount: 0, faces: [], edges: [] };

/** Waits for the script to record more steps (or finish) after the runner caught up with it: true when it is worth looking again. */
async function awaitScript(finished: Promise<void> | null, flags: { done: boolean }, steps: Step[], errors: ScriptError[]): Promise<boolean> {
  if (!finished || flags.done) return false;
  const before = steps.length;
  for (let i = 0; i < 200; i++) {
    await Promise.race([finished, macrotask()]);
    if (flags.done || steps.length !== before) return true;
  }
  errors.push({ line: 0, message: 'the script is waiting for something that never completes (only await the part.volume() style read-backs)' });
  return false;
}

/** Compile the steps to ops against `geo` supplied per step; used by the runner and by tests that have no kernel. */
export async function runScript(code: string, host: ScriptHost, base: Record<string, unknown> = {}, opts: RunOptions = {}): Promise<ScriptResult> {
  const { state, errors, finished, flags } = launch(code);
  // an async script that threw before its first await reports through its promise: let it settle first
  if (finished) await macrotask();
  if (errors.length) return { ops: [], document: null, errors };
  const part = state.parts[state.parts.length - 1];
  if (part.steps.length > MAX_STEPS) return { ops: [], document: null, errors: [{ line: 1, message: `more than ${MAX_STEPS} steps` }] };
  const doc: Record<string, unknown> = { format: 'ck-part', version: 1, name: part.name, features: [], seq: 1, rollback: null, ...base, ...(state.varDefs.length ? { variables: [...(Array.isArray(base.variables) ? (base.variables as unknown[]) : []), ...state.varDefs] } : {}), script: code };
  const warnings: ScriptWarning[] = [];
  const warn = (message: string, line: number): void => { if (!warnings.some((w) => w.message === message && w.line === line)) warnings.push({ line, message }); };
  if (host.build && opts.batched !== false) return runBatched(part.steps, doc, host, opts, { errors, warnings, warn, finished, flags });
  const t0 = performance.now();
  await host.load(structuredClone(doc));
  const ops: EditOp[] = [];
  let n = 0;
  const autoFlip = new Set<string>();
  const ctx: Ctx = { geo: host.geometry(), nextId: () => `F${++n}`, lastSketch: null, lastFeature: null, warn, autoFlip };
  const stepsOf = part.steps;
  const rt: ReadRuntime = {
    facts: async (need: FactNeed) => {
      if ((need.mass || need.validate) && !host.facts) throw new SelectorError('this host cannot read volume or validity back (it has no facts())', 0);
      const k = need.mass || need.validate ? await host.facts!({ mass: need.mass, validate: need.validate }) : {};
      const g = geoFacts(host.geometry());
      if (need.geometry && host.facts && g.faces.length > 0 && g.faces.length <= 600) g.faces = exactFaces(g.faces, (await host.facts({ describe: g.faces.map((f) => f.name) }).catch(() => ({} as KernelFacts))).faces ?? []);
      return { ...EMPTY_FACTS, ...g, volume: k.volume ?? null, area: k.area ?? null, com: (k.com as Vec | null | undefined) ?? null, valid: k.valid ?? null, issues: k.issues ?? [] };
    },
    fail: (message, line) => { errors.push({ line, message }); },
  };
  let stepNo = 0;
  for (;;) {
    if (stepNo >= stepsOf.length) { if (await awaitScript(finished, flags, stepsOf, errors)) continue; break; }
    const step = stepsOf[stepNo];
    opts.onProgress?.({ phase: 'building', done: stepNo, total: stepsOf.length, elapsedMs: performance.now() - t0 });
    stepNo++;
    if (stepsOf.length > MAX_STEPS) { errors.push({ line: 1, message: `more than ${MAX_STEPS} steps` }); break; }
    ctx.geo = host.geometry();
    if (step.read) {
      try { await step.read(rt); } catch (e) { errors.push({ ...toError(e), line: e instanceof SelectorError && e.line ? e.line : step.line }); break; }
      continue;
    }
    let stepOps: EditOp[];
    try { stepOps = step.run(ctx); } catch (e) {
      errors.push({ ...toError(e), line: e instanceof SelectorError && e.line ? e.line : step.line });
      break;
    }
    if (!stepOps.length) continue;
    let r = await host.edit(stepOps, step.label);
    // a cut left on direction 'auto' that found nothing to cut is rejected by the kernel: flip it once and add it again
    const flips = !r.ok ? errorsOf(r).filter((x) => x.code === 'cutNoEffect' && x.feature && autoFlip.has(x.feature)) : [];
    if (flips.length) {
      for (const e of flips) { autoFlip.delete(e.feature!); const f = stepOps.find((o) => o.feature.id === e.feature)?.feature; if (f) f.flip = !f.flip; }
      r = await host.edit(stepOps, step.label);
      warn('cut direction flipped automatically', step.line);
    }
    ops.push(...stepOps);
    const fid = (stepOps[stepOps.length - 1].feature.id as string | undefined) ?? undefined;
    if (!r.ok) {
      errors.push({ line: step.line, feature: fid, message: r.schemaError ?? firstMessage(r) ?? 'the kernel rejected this step' });
      break;
    }
    // a feature that was kept but failed to regenerate is reported on its line, the run goes on
    for (const e of errorsOf(r)) errors.push({ line: step.line, feature: e.feature ?? fid, message: e.message });
  }
  (doc.features as unknown[]) = ops.map((o) => o.feature);
  doc.seq = n + 1;
  return { ops, document: doc, errors, warnings, stats: { batched: false, steps: stepsOf.length, builds: 0, viewBuilds: 0, buildMs: 0, loadMs: 0, totalMs: performance.now() - t0 } };
}

/** Thrown inside a step when a selector reads a body that is older than the features recorded since: the runner builds a view and runs the step again. */
class NeedGeometry extends Error { constructor() { super('geometry needed'); } }
/** Thrown by a read-back when the build it needed was refused: the error is already reported, the run stops. */
class ReadAborted extends Error { constructor() { super('read aborted'); } }
export const FLUSH_EVERY = 25;
const macrotask = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

interface Live { errors: ScriptError[]; warnings: ScriptWarning[]; warn(message: string, line: number): void; finished: Promise<void> | null; flags: { done: boolean } }

/**
 * The batched run. The features are recorded into one list; the kernel builds it in chunks on a scratch state WITHOUT the display
 * work (its regen cache makes each chunk cost only its new features), a view is built only when a selector reads the body, and
 * the finished list is loaded into the app in a single step. Nothing of the open document is touched before that, so a cancel
 * needs no undo. A script that awaits read-backs is still running while this loop works: the loop processes the steps recorded
 * so far, answers the read (a build of everything before it, then the kernel's answer), and waits for the script to record more.
 */
async function runBatched(steps: Step[], doc: Record<string, unknown>, host: ScriptHost, opts: RunOptions, live: Live): Promise<ScriptResult> {
  const t0 = performance.now();
  const { errors, warnings, warn } = live;
  const stats: RunStats = { batched: true, steps: steps.length, builds: 0, viewBuilds: 0, buildMs: 0, loadMs: 0, totalMs: 0 };
  const every = opts.flushEvery ?? FLUSH_EVERY;
  const yieldToUi = opts.yieldToUi ?? macrotask;
  const prefix = opts.prefix?.features ?? [];
  const features: Array<Record<string, unknown>> = [...prefix];
  const stepOfFeature = new Map<string, number>();
  const featureOf = new Map<string, Record<string, unknown>>();
  const autoFlip = new Set<string>();
  const ops: EditOp[] = [];
  let n = opts.prefix ? opts.prefix.seq - 1 : 0;
  let built = 0;                 // steps whose features the kernel has accepted
  let lastBuilt = { n: -1, view: false };   // feature count / kind of the latest successful build
  let geo: Geometry = { mesh: null, edges: [], box: null };
  let geoAt = 0;                 // feature count `geo` belongs to
  const current = (): Geometry => { if (geoAt !== features.length) throw new NeedGeometry(); return geo; };
  const lazy: Geometry = {
    get mesh() { return current().mesh; },
    get edges() { return current().edges; },
    get box() { return current().box; },
  };
  const ctx: Ctx = { geo: lazy, nextId: () => `F${++n}`, lastSketch: null, lastFeature: null, warn, autoFlip };
  const progress = (phase: Progress['phase']): void => opts.onProgress?.({ phase, done: built, total: steps.length, elapsedMs: performance.now() - t0 });
  const cancelled = (): boolean => opts.signal?.aborted === true;
  const cancelResult = (): ScriptResult => ({ ops: [], document: null, errors: [], cancelled: true, stats: { ...stats, totalMs: performance.now() - t0 } });
  let keep = -1;                 // steps kept when a build refuses one (-1: all)
  let failed = false;

  /** Build everything recorded so far. Returns false when the kernel refused a step (reported, the run stops). */
  const flush = async (view: boolean, upTo: number): Promise<boolean> => {
    let r: BuildReply;
    for (;;) {
      const tb = performance.now();
      r = await host.build!({ ...doc, features: [...features], seq: n + 1 }, view);
      stats.builds++; if (view) stats.viewBuilds++;
      stats.buildMs += performance.now() - tb;
      // a cut left on direction 'auto' that found nothing to cut is flipped once and the list is built again
      const flips = r.errors.filter(([id, e]) => autoFlip.has(id) && e?.code === 'cutNoEffect');
      if (!flips.length) break;
      for (const [id] of flips) {
        autoFlip.delete(id);
        const f = featureOf.get(id);
        if (!f) continue;
        f.flip = !f.flip;
        warn('cut direction flipped automatically', steps[stepOfFeature.get(id) ?? 0]?.line ?? 0);
      }
    }
    if (view) { geo = r.geometry ?? { mesh: null, edges: [], box: null }; geoAt = features.length; }
    if (r.errors.length) {
      // the earliest failing step is the cause; later errors are consequences
      let best = Infinity, fid = r.errors[0][0], msg = '';
      for (const [id, e] of r.errors) {
        const si = stepOfFeature.get(id) ?? upTo - 1;
        if (si < best) { best = si; fid = id; msg = e?.message ?? e?.code ?? ''; }
      }
      errors.push({ line: steps[Math.max(0, best)].line, feature: fid, message: msg || 'the kernel rejected this step' });
      keep = best; failed = true;
      return false;
    }
    built = upTo;
    lastBuilt = { n: features.length, view };
    progress('building');
    return true;
  };

  // read-backs: answers are cached until the next feature is recorded
  let cache: { n: number; mass?: KernelFacts; validate?: KernelFacts; describe?: NonNullable<KernelFacts['faces']> } = { n: -1 };
  let curStep = 0;
  const rt: ReadRuntime = {
    facts: async (need: FactNeed) => {
      if ((need.mass || need.validate) && !host.facts) throw new SelectorError('this host cannot read volume or validity back (it has no facts())', 0);
      const wantView = !!need.geometry;
      if (lastBuilt.n !== features.length || (wantView && geoAt !== features.length)) {
        if (!(await flush(wantView, curStep))) throw new ReadAborted();
      }
      if (cache.n !== features.length) cache = { n: features.length };
      if (need.mass && !cache.mass) cache.mass = await host.facts!({ mass: true });
      if (need.validate && !cache.validate) cache.validate = await host.facts!({ validate: true });
      const g = wantView ? geoFacts(geo) : null;
      if (g && host.facts && g.faces.length > 0 && g.faces.length <= 600 && !cache.describe) cache.describe = (await host.facts({ describe: g.faces.map((f) => f.name) }).catch(() => ({} as KernelFacts))).faces ?? [];
      if (g && cache.describe) g.faces = exactFaces(g.faces, cache.describe);
      const m = cache.mass ?? {}, v = cache.validate ?? {};
      return { ...EMPTY_FACTS, ...g, volume: m.volume ?? null, area: m.area ?? null, com: (m.com as Vec | null | undefined) ?? null, valid: v.valid ?? null, issues: v.issues ?? [] };
    },
    fail: (message, line) => { errors.push({ line, message }); },
  };

  try {
    progress('building');
    for (let done = 0; ; done++) {
      if (cancelled()) return cancelResult();
      if (done >= steps.length) {
        // caught up with the script: it may be suspended on a read-back we have not been asked yet, or about to record more
        if (await awaitScript(live.finished, live.flags, steps, errors)) { done--; continue; }
        break;
      }
      if (steps.length > MAX_STEPS) { errors.push({ line: 1, message: `more than ${MAX_STEPS} steps` }); failed = true; break; }
      curStep = done;
      const step = steps[done];
      if (step.read) {
        try { await step.read(rt); } catch (e) {
          if (!(e instanceof ReadAborted)) errors.push({ ...toError(e), line: e instanceof SelectorError && e.line ? e.line : step.line });
          failed = true; break;
        }
        await yieldToUi();
        continue;
      }
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
        featureOf.set(o.feature.id as string, o.feature);
        if (o.index !== undefined && o.index < features.length) features.splice(o.index, 0, o.feature); else features.push(o.feature);
      }
      ops.push(...stepOps);
      if (done + 1 - built >= every) {
        if (!(await flush(false, done + 1))) break;
        await yieldToUi();
      }
    }
    stats.steps = steps.length;
    if (!failed && lastBuilt.n !== features.length) await flush(false, steps.length);
    if (cancelled()) return cancelResult();
    // what the app gets: everything up to (not including) the step the kernel refused
    const kept = keep >= 0 ? ops.filter((o) => (stepOfFeature.get(o.feature.id as string) ?? 0) < keep) : ops;
    if (opts.prefix) {
      return { ops: kept, document: { ...doc, features: [...prefix, ...kept.map((o) => o.feature)], seq: n + 1 }, errors, warnings, stats: { ...stats, totalMs: performance.now() - t0 } };
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
  return { ops, document: doc, errors, warnings, stats };
}

function errorsOf(r: EditResultLike): Array<{ feature?: string; message: string; code?: string }> {
  return (r.errors ?? []).map((e) => {
    if (Array.isArray(e)) return { feature: e[0], message: e[1]?.message ?? e[1]?.code ?? 'error', code: e[1]?.code };
    return { feature: e.feature, message: e.message ?? e.code ?? 'error', code: e.code };
  });
}
const firstMessage = (r: EditResultLike): string | undefined => errorsOf(r)[0]?.message;
