// The runner: evaluates the script text in a restricted scope, then applies the recorded steps through a host (the app's Controller or a Session).
import { makeApi, setLineOffset, type Ctx, type EditOp, type ScriptState } from './recorder';
import { SelectorError, type Geometry } from './selectors';

export interface EditResultLike { ok: boolean; errors?: Array<[string, { code?: string; message?: string }] | { feature?: string; code?: string; message?: string }>; schemaError?: string; added?: string[] }
/** What the runner needs from the app: a way to open a document, edit it, and read the current body. */
export interface ScriptHost {
  load(doc: Record<string, unknown>): Promise<void>;
  edit(ops: EditOp[], reason?: string): Promise<EditResultLike>;
  geometry(): Geometry;
}
export interface ScriptError { line: number; message: string; feature?: string }
export interface ScriptResult {
  ops: EditOp[];
  /** The document the script built (features as the kernel kept them is up to the host; this is the recorded one), with `script` set. */
  document: Record<string, unknown> | null;
  errors: ScriptError[];
}

const DENIED = ['window', 'document', 'fetch', 'XMLHttpRequest', 'WebSocket', 'globalThis', 'self', 'parent', 'top', 'localStorage', 'sessionStorage', 'indexedDB', 'Worker', 'importScripts', 'Function', 'process', 'require', 'navigator', 'location', 'setTimeout', 'setInterval', 'queueMicrotask'];
export const MAX_SOURCE = 20000;
export const MAX_STEPS = 500;

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
export async function runScript(code: string, host: ScriptHost, base: Record<string, unknown> = {}): Promise<ScriptResult> {
  const { state, errors } = evaluate(code);
  if (errors.length) return { ops: [], document: null, errors };
  const part = state.parts[state.parts.length - 1];
  if (part.steps.length > MAX_STEPS) return { ops: [], document: null, errors: [{ line: 1, message: `more than ${MAX_STEPS} steps` }] };
  const doc: Record<string, unknown> = { format: 'ck-part', version: 1, name: part.name, features: [], seq: 1, rollback: null, ...base, ...(state.varDefs.length ? { variables: state.varDefs } : {}), script: code };
  await host.load(structuredClone(doc));
  const ops: EditOp[] = [];
  let n = 0;
  const ctx: Ctx = { geo: host.geometry(), nextId: () => `F${++n}`, lastSketch: null, lastFeature: null };
  for (const step of part.steps) {
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
  return { ops, document: doc, errors };
}

function errorsOf(r: EditResultLike): Array<{ feature?: string; message: string }> {
  return (r.errors ?? []).map((e) => {
    if (Array.isArray(e)) return { feature: e[0], message: e[1]?.message ?? e[1]?.code ?? 'error' };
    return { feature: e.feature, message: e.message ?? e.code ?? 'error' };
  });
}
const firstMessage = (r: EditResultLike): string | undefined => errorsOf(r)[0]?.message;
