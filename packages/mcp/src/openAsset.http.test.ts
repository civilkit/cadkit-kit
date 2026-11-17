// app_open_asset end to end on loopback: the real daemon, the real tool and policy, the app's BridgeClient and the real app handler with a
// stand-in opener. No kernel. What matters: the bytes reach the app without passing through the tool result, and nothing outside the
// allowed folders, of the wrong type, too big, or without the edit permission is ever read.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeClient } from '@kit/agent-link';
import { makeAppHandler, type AppDeps } from '../../../apps/cad/src/agentLink/appHandlers';
import { startDaemon, type Daemon } from './daemon';
import type { Backend } from './protocol';

const fake: Backend = { tools: () => [], call: async () => ({ content: [{ type: 'text', text: 'noop' }] }), resources: () => [], read: async () => null };
let base: string, root: string, outside: string, dir: string;
const daemons: Daemon[] = [];
const clients: BridgeClient[] = [];
const saved = { roots: process.env.CK_MCP_ASSET_ROOTS, mb: process.env.CK_MCP_ASSET_MAX_MB };
const PART = JSON.stringify({ format: 'ck-part', name: 'Plate', features: [{ id: 'F1', type: 'sketch' }] });

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'open-asset-')));
  root = join(base, 'ws'); outside = join(base, 'private'); dir = join(base, 'state');
  for (const d of [root, outside, dir, join(root, 'parts')]) mkdirSync(d, { recursive: true });
  writeFileSync(join(root, 'parts', 'plate.ckpart'), PART);
  writeFileSync(join(root, 'notes.txt'), 'x');
  writeFileSync(join(outside, 'secret.ckpart'), 'secret');
  symlinkSync(join(outside, 'secret.ckpart'), join(root, 'leak.ckpart'));
  process.env.CK_MCP_ASSET_ROOTS = root;
  delete process.env.CK_MCP_ASSET_MAX_MB;
});
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect();
  for (const d of daemons.splice(0)) await d.close();
  rmSync(base, { recursive: true, force: true });
  if (saved.roots === undefined) delete process.env.CK_MCP_ASSET_ROOTS; else process.env.CK_MCP_ASSET_ROOTS = saved.roots;
  if (saved.mb === undefined) delete process.env.CK_MCP_ASSET_MAX_MB; else process.env.CK_MCP_ASSET_MAX_MB = saved.mb;
});

const rpc = async (d: Daemon, name: string, args: unknown = {}) => {
  const r = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const j = (await r.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string }> } };
  const t = j.result.content.find((c) => c.type === 'text' && c.text?.startsWith('{'))?.text ?? '';
  return { isError: !!j.result.isError, body: t ? JSON.parse(t) : null, raw: t };
};
const raw = (port: number, path: string, headers: Record<string, string>): Promise<{ status: number; body: Buffer }> => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => { const c: Buffer[] = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(c) })); });
  req.on('error', reject); req.end();
});

interface Opened { name: string; kind: string; bytes: Uint8Array }
/** A daemon, a linked stand-in app whose handler is the real one, and what it opened. */
async function linked(o: { edit?: boolean; gate?: Promise<void> } = {}) {
  const d = await startDaemon({ backend: fake, dir, idleMs: 0 });
  daemons.push(d);
  const opened: Opened[] = [];
  let app!: BridgeClient;
  const deps: AppDeps = {
    document: () => ({ name: 'Plate', features: [{ id: 'F1', type: 'sketch' }] }), selection: () => [], facts: () => ({ faces: 6, triangles: 12, rebuildMs: 1 }), status: () => [],
    hasSolid: () => true, allowEdit: () => o.edit ?? true, render: async () => null, runScript: async () => ({ ok: true, errors: [], created: [], featureCount: 1 }), undo: async () => {}, redo: async () => {},
    fetchAsset: (h) => app.fetchAsset(h),
    openAsset: async (a) => { if (o.gate) await o.gate; opened.push({ name: a.name, kind: a.kind, bytes: a.bytes }); return { documentId: 'd1-abc', revision: 3, counts: { features: 1, faces: 6 }, errorCount: 0 }; },
  };
  app = new BridgeClient({ app: { name: 'CadKit' }, allowEdit: () => o.edit ?? true, handle: makeAppHandler(deps), retryMs: 20 });
  clients.push(app);
  await app.connect((await rpc(d, 'bridge_pair')).body.code);
  app.permissionChanged();
  await new Promise((r) => setTimeout(r, 100));
  return { d, app, opened };
}

describe('app_open_asset: the happy path', () => {
  it('hands the file to the app by handle: the app gets the exact bytes, the result carries only ids and counts', async () => {
    const { d, opened } = await linked();
    const r = await rpc(d, 'app_open_asset', { path: 'parts/plate.ckpart' });
    expect(r.isError).toBe(false);
    expect(r.body).toMatchObject({ ok: true, documentId: 'd1-abc', revision: 3, counts: { features: 1, faces: 6 }, errorCount: 0, name: 'plate.ckpart', kind: 'part', bytes: PART.length, sha256: createHash('sha256').update(PART).digest('hex'), previewRef: { tool: 'app_screenshot' } });
    expect(r.raw).not.toContain('Plate');        // the content of the file is not in what the model sees
    expect(opened).toHaveLength(1);
    expect(Buffer.from(opened[0].bytes).toString()).toBe(PART);
    expect(opened[0]).toMatchObject({ name: 'plate.ckpart', kind: 'part' });
    // an absolute path inside the root works too
    expect((await rpc(d, 'app_open_asset', { path: join(root, 'parts', 'plate.ckpart') })).body.ok).toBe(true);
  });

  it('a long open does not stall the link: the app keeps answering other calls and the call finishes when the open does', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { d } = await linked({ gate });
    const call = rpc(d, 'app_open_asset', { path: 'parts/plate.ckpart' });
    await new Promise((r) => setTimeout(r, 200));
    // (MCP calls themselves run one at a time in the daemon; the bridge is asked directly here)
    expect(await d.bridge.request('state', { detail: 'summary' })).toMatchObject({ open: true, name: 'Plate' });   // served while the open is still running
    expect(d.bridge.status().connected).toBe(true);
    release();
    expect((await call).body).toMatchObject({ ok: true, documentId: 'd1-abc' });
  });
});

describe('app_open_asset: what is refused, and that nothing is read', () => {
  const code = async (args: Record<string, unknown>, o?: Parameters<typeof linked>[0]) => { const { d, opened } = await linked(o); const r = await rpc(d, 'app_open_asset', args); expect(r.isError).toBe(true); expect(opened).toEqual([]); return r.body.error.code as string; };

  it('path traversal', async () => {
    expect(await code({ path: '../private/secret.ckpart' })).toBe('path_traversal');
    expect(await code({ path: 'parts/../../private/secret.ckpart' })).toBe('path_traversal');
  });
  it('an absolute path outside the allowed folder', async () => {
    expect(await code({ path: join(outside, 'secret.ckpart') })).toBe('path_outside_workspace');
    expect(await code({ path: '/etc/hosts' })).toBe('path_outside_workspace');
  });
  it('a symlink inside the folder that points out of it', async () => { expect(await code({ path: 'leak.ckpart' })).toBe('path_outside_workspace'); });
  it('a wrong extension and a missing file', async () => {
    expect(await code({ path: 'notes.txt' })).toBe('asset_extension_not_allowed');
    expect(await code({ path: 'parts/missing.ckpart' })).toBe('asset_not_found');
  });
  it('a file over the size limit', async () => {
    writeFileSync(join(root, 'big.stl'), Buffer.alloc(3 * 1024 * 1024));
    process.env.CK_MCP_ASSET_MAX_MB = '1';
    expect(await code({ path: 'big.stl' })).toBe('asset_too_large');
  });
  it('permission denied: with the edit box off the file is not even read', async () => {
    const { d, opened } = await linked({ edit: false });
    const r = await rpc(d, 'app_open_asset', { path: 'parts/plate.ckpart' });
    expect(r.body.error.code).toBe('edit_not_allowed');
    expect(opened).toEqual([]);
    // and a refused path is reported as the permission, not as a file problem (the permission is checked first)
    expect((await rpc(d, 'app_open_asset', { path: '../private/secret.ckpart' })).body.error.code).toBe('edit_not_allowed');
  });
  it('no folder configured: everything is refused and the error says how to allow one', async () => {
    delete process.env.CK_MCP_ASSET_ROOTS;
    const { d } = await linked();
    const r = await rpc(d, 'app_open_asset', { path: 'parts/plate.ckpart' });
    expect(r.body.error.code).toBe('asset_roots_not_configured');
    expect(r.body.error.hint).toMatch(/CK_MCP_ASSET_ROOTS/);
  });
  it('not linked, and bad input', async () => {
    const d = await startDaemon({ backend: fake, dir, idleMs: 0 });
    daemons.push(d);
    expect((await rpc(d, 'app_open_asset', { path: 'parts/plate.ckpart' })).body.error.code).toBe('app_not_connected');
    const { d: d2 } = await linked();
    expect((await rpc(d2, 'app_open_asset', {})).body.error.code).toBe('bad_input');
    expect((await rpc(d2, 'app_open_asset', { path: 'a', unit: 'furlong' })).body.error.code).toBe('bad_input');
  });
});

describe('the staged file', () => {
  it('is handed over once, to its own session only, and the route needs the session token', async () => {
    const { d, app } = await linked();
    const bytes = Buffer.from('hello');
    const handle = d.bridge.stageAsset(bytes);
    const session = (app as unknown as { session: string }).session;
    expect((await raw(d.port, `/bridge/asset/${handle}`, {})).status).toBe(401);                              // no token
    expect((await raw(d.port, `/bridge/asset/${handle}`, { authorization: `Bearer ${d.token}` })).status).toBe(401);   // the daemon token is not a session
    const ok = await raw(d.port, `/bridge/asset/${handle}`, { authorization: `Bearer ${session}` });
    expect(ok.status).toBe(200); expect(ok.body.toString()).toBe('hello');
    expect((await raw(d.port, `/bridge/asset/${handle}`, { authorization: `Bearer ${session}` })).status).toBe(404);   // once
    expect((await raw(d.port, `/bridge/asset/nonsense`, { authorization: `Bearer ${session}` })).status).toBe(404);
  });
  it('a file whose bytes or checksum do not match what was staged is refused by the app', async () => {
    const { d, app } = await linked();
    const handle = d.bridge.stageAsset(Buffer.from('hello'));
    const h = makeAppHandler({ ...({} as AppDeps), document: () => null, status: () => [], allowEdit: () => true, fetchAsset: (x) => app.fetchAsset(x), openAsset: async () => { throw new Error('must not open'); } } as AppDeps);
    await expect(h('open_asset', { handle, name: 'a.ckpart', kind: 'part', bytes: 5, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'asset_mismatch' });
    const h2 = d.bridge.stageAsset(Buffer.from('hello'));
    await expect(h('open_asset', { handle: h2, name: 'a.ckpart', kind: 'part', bytes: 99, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'asset_mismatch' });
  });
});
