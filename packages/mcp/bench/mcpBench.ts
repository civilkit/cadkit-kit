// A reproducible measurement of what a fixed task costs through the MCP tool layer: the number of calls, the characters sent
// (request arguments) and received (text content of the result), and the wall time. Characters, not tokens: nothing here counts tokens.
//
// The task: a part of 26 features (13 bodies) is open in the app; the agent reads its state, finds a body, checks the clearance between two
// bodies, makes one edit and reads the state again. The app is a stand-in whose handlers (the real `makeAppHandler`) read the same kernel
// session the headless tools use, so the replies have the shape the real app gives.
//
// Run: CK_WASM=<ck_wasm.wasm> CK_BENCH_OUT=<file.json> npx vitest run packages/mcp/src/tokenBench.kernel.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentSession, readbackHost } from '@kit/agent-tools';
import { BridgeClient } from '@kit/agent-link';
import { makeAppHandler, type AppDeps } from '../../../apps/cad/src/agentLink/appHandlers';
import { startDaemon, type Daemon } from '../src/daemon';

export interface CallMetric { step: string; tool: string; requestChars: number; responseChars: number; imageChars: number; ms: number; isError: boolean }
export interface BenchResult { profile: string; calls: number; requestChars: number; responseChars: number; totalChars: number; ms: number; perCall: CallMetric[] }

/** `bodies` bodies of one sketch and one extrude each (13 bodies: 26 features, the default task). */
export const benchScript = (bodies = 13): string => `const p = part('Bench');
for (let i = 0; i < ${bodies}; i++) p.sketch('front', (s) => s.rect(20, 20, [i * 40, 0])).extrude(10, { newBody: 'B' + i });`;

export interface BenchEnv {
  a: AgentSession;
  daemon: Daemon;
  app: BridgeClient;
  call(step: string, tool: string, args?: Record<string, unknown>): Promise<{ json: any; text: string; isError: boolean }>;
  metrics: CallMetric[];
  /** The folder the stand-in app may open files from (the asset root). */
  workspace: string;
  close(): Promise<void>;
}

/** The baseline: the fixed task through the tools as they stood before this branch (commit 45b32348, `runLegacyTask`), in characters. Measured once; the old tools are not kept in the code. */
export const BASELINE = { 26: { calls: 5, requestChars: 159, responseChars: 7958, totalChars: 8117 }, 200: { calls: 5, requestChars: 159, responseChars: 43240, totalChars: 43399 } } as const;

/** What a stand-in app adds to the handler deps (later items add more). */
export type DepsExtra = (a: AgentSession) => Partial<AppDeps>;

export async function startBench(opts: { wasmPath?: string; extra?: DepsExtra; env?: Record<string, string>; bodies?: number } = {}): Promise<BenchEnv> {
  const a = await AgentSession.open({ wasmPath: opts.wasmPath ?? process.env.CK_WASM });
  const built = await a.runScript(benchScript(opts.bodies), 'new', { name: 'Bench' });
  if (!built.ok) throw new Error('bench part did not build: ' + JSON.stringify(built.errors));
  const dir = mkdtempSync(join(tmpdir(), 'mcp-bench-'));
  const workspace = join(dir, 'workspace');
  mkdirSync(workspace);
  const saved = { ...process.env };
  Object.assign(process.env, { CK_MCP_ASSET_ROOTS: workspace }, opts.env ?? {});
  const daemon = await startDaemon({ session: a, dir, idleMs: 0 });
  const deps: AppDeps = {
    document: () => a.doc as never, selection: () => [], facts: () => ({ faces: 0, triangles: 0, rebuildMs: null }), status: () => [],
    hasSolid: () => true, allowEdit: () => true, render: async () => null,
    runScript: async (code) => { const r = await a.runScript(code, 'attach', { replace: 'none' }); return { ok: r.ok, errors: r.errors.map((e) => ({ line: e.line, message: e.message })), created: r.created, featureCount: a.doc.features.length }; },
    undo: async () => { await a.undo(); }, redo: async () => { await a.redo(); },
    readback: async () => readbackHost(a),
    revision: () => a.version, documentId: () => 'bench', bounds: () => null,
    edit: async (expected, ops) => {
      if (expected !== a.version) return { ok: false, stale: true, revision: a.version };
      const r = await a.applyEdit(ops as never, 'bench edit');
      return r.ok ? { ok: true } : { ok: false, errors: (r.errors ?? []).map(([feature, e]) => ({ feature, code: e.code ?? 'error' })) };
    },
    fetchAsset: (h) => app.fetchAsset(h),
    // opening a part file replaces the stand-in's document, as a new tab would show it
    openAsset: async (f) => {
      await a.setDocument(JSON.parse(new TextDecoder().decode(f.bytes)), 'open ' + f.name);
      return { documentId: 'bench-' + a.version, revision: a.version, counts: { features: a.doc.features.length, faces: 0 }, errorCount: 0 };
    },
    ...(opts.extra?.(a) ?? {}),
  };
  const app: BridgeClient = new BridgeClient({ app: { name: 'bench' }, allowEdit: () => true, handle: makeAppHandler(deps), retryMs: 20 });
  const pairRes = await rpcRaw(daemon, 'bridge_pair', {});
  await app.connect(JSON.parse(pairRes.content[0].text).code);
  app.permissionChanged();
  await new Promise((r) => setTimeout(r, 120));
  const metrics: CallMetric[] = [];
  const call: BenchEnv['call'] = async (step, tool, args = {}) => {
    const t0 = performance.now();
    const r = await rpcRaw(daemon, tool, args);
    const texts = r.content.filter((c: any) => c.type === 'text').map((c: any) => String(c.text));
    const text = texts.join('\n');
    const json = (() => { for (const t of texts) { try { return JSON.parse(t); } catch { /* next */ } } return null; })();
    const m: CallMetric = { step, tool, requestChars: JSON.stringify(args).length, responseChars: text.length, imageChars: r.content.filter((c: any) => c.type === 'image').reduce((n: number, c: any) => n + String(c.data).length, 0), ms: Math.round(performance.now() - t0), isError: !!r.isError };
    metrics.push(m);
    return { json, text, isError: !!r.isError };
  };
  return {
    a, daemon, app, call, metrics, workspace,
    async close() {
      await app.disconnect(); await daemon.close(); await a.close();
      rmSync(dir, { recursive: true, force: true });
      for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
      Object.assign(process.env, saved);
    },
  };
}

async function rpcRaw(d: Daemon, name: string, args: unknown): Promise<{ isError?: boolean; content: any[] }> {
  const r = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  return ((await r.json()) as { result: { isError?: boolean; content: any[] } }).result;
}

export function summarise(profile: string, metrics: CallMetric[]): BenchResult {
  const requestChars = metrics.reduce((n, m) => n + m.requestChars, 0);
  const responseChars = metrics.reduce((n, m) => n + m.responseChars, 0);
  return { profile, calls: metrics.length, requestChars, responseChars, totalChars: requestChars + responseChars, ms: metrics.reduce((n, m) => n + m.ms, 0), perCall: metrics };
}

/** The task with the OLD call pattern (whole-document state, the body list, one clearance, one appended script, the state again). Run on the baseline commit 45b32348 it gives BASELINE; on this branch it shows what the old pattern costs now. */
export async function runLegacyTask(env: BenchEnv): Promise<BenchResult> {
  env.metrics.length = 0;
  await env.call('state', 'app_state', {});
  await env.call('find body', 'app_bodies', {});
  await env.call('clearance', 'app_clearance', { a: 'B0', b: 'B1', required: 5 });
  await env.call('edit', 'app_run_script', { code: "const p = part('Bench'); p.sketch('front', (s) => s.rect(20, 20, [-60, 0])).extrude(10, { newBody: 'Extra' });" });
  await env.call('state again', 'app_state', {});
  return summarise('legacy', [...env.metrics]);
}

/** Open the bench part by path (item 1): the part is written to the workspace as a .ckpart and opened by app_open_asset. No baseline exists: the bridge could not open a file. */
export async function runOpenStep(env: BenchEnv): Promise<CallMetric> {
  const file = join(env.workspace, 'bench.ckpart');
  writeFileSync(file, JSON.stringify(env.a.doc));
  const n = env.metrics.length;
  const r = await env.call('open', 'app_open_asset', { path: 'bench.ckpart' });
  if (r.isError) throw new Error('open failed: ' + r.text);
  return env.metrics[n];
}

/** The same task with the tools as they stand now: compact paged state, a budgeted body list, and the edit and the re-read as a transaction and a delta. */
export async function runCompactTask(env: BenchEnv): Promise<BenchResult> {
  env.metrics.length = 0;
  const st = await env.call('state', 'app_state', {});
  // find a body: the list comes back within its budget; when the body is not in it the agent fetches that one row
  const bodies = await env.call('find body', 'app_bodies', {});
  const handle = bodies.json?._budget?.handle as string | undefined;
  if (handle && !bodies.text.includes('"B7"') && !bodies.text.includes('"B1"')) await env.call('find body (row)', 'fetch_result', { handle, path: 'bodies.7', maxChars: 1500 });
  await env.call('clearance', 'app_clearance', { a: 'B0', b: 'B1', required: 5 });
  const revision = st.json.revision as number;
  const edit = await env.call('edit', 'app_edit', { expectedRevision: revision, ops: [{ op: 'add', feature: { type: 'sphere', radius: 5 } }] });
  if (edit.isError) throw new Error('edit failed: ' + edit.text);
  await env.call('state again', 'app_state', { sinceRevision: revision });
  return summarise('compact', [...env.metrics]);
}
