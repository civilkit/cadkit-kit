// The agent link end to end on loopback: the real daemon routes, the real MCP tools and the app's BridgeClient, with a stand-in
// for the app's handlers. No kernel is needed (the daemon gets a fake backend), so this runs without CK_WASM.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BridgeClient, BridgeError, type LinkState } from '@kit/agent-link';
import { startDaemon, type Daemon } from './daemon';
import type { Backend } from './protocol';

const fake: Backend = { tools: () => [{ name: 'noop', description: 'x', inputSchema: { type: 'object' } }], call: async () => ({ content: [{ type: 'text', text: 'noop' }] }), resources: () => [], read: async () => null };
const dirs: string[] = [];
const daemons: Daemon[] = [];
const clients: BridgeClient[] = [];
afterEach(async () => {
  for (const c of clients.splice(0)) await c.disconnect();
  for (const d of daemons.splice(0)) await d.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
async function boot(allowedOrigins?: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'bridge-'));
  dirs.push(dir);
  const d = await startDaemon({ backend: fake, dir, idleMs: 0, allowedOrigins });
  daemons.push(d);
  return d;
}
const rpc = async (d: Daemon, name: string, args: unknown = {}) => {
  const r = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const j = (await r.json()) as { result: { isError?: boolean; content: Array<{ type: string; text?: string; data?: string }> } };
  const first = j.result.content.find((c) => c.type === 'text' && c.text?.startsWith('{')) ?? j.result.content[0];
  return { isError: !!j.result.isError, body: first?.text?.startsWith('{') ? JSON.parse(first.text) : first?.text, content: j.result.content };
};
/** a raw request, so a test can set Host and Origin as a browser would */
const raw = (port: number, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: Record<string, unknown>; text: string }> =>
  new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: o.method ?? 'GET', headers: o.headers }, (res) => { let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: t })); });
    req.on('error', reject); if (o.body) req.write(o.body); req.end();
  });

function appClient(over: { edit?: () => boolean; handle?: (op: string, a: Record<string, unknown>) => Promise<unknown>; states?: LinkState[] } = {}) {
  const c = new BridgeClient({
    app: { name: 'CadKit', version: 'test' }, allowEdit: over.edit ?? (() => false), retryMs: 20,
    handle: (op, args) => (over.handle ?? (async (o) => ({ op: o })))(op, args),
    onState: (s) => over.states?.push(s),
  });
  clients.push(c);
  return c;
}
const pairCode = async (d: Daemon) => (await rpc(d, 'bridge_pair')).body.code as string;

describe('the agent link is opt-in', () => {
  it('without pairing the app_ tools fail and say how to start; nothing is exposed', async () => {
    const d = await boot();
    const st = await rpc(d, 'app_status');
    expect(st.body).toMatchObject({ ok: true, connected: false, edit: false });
    const r = await rpc(d, 'app_state');
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('app_not_connected');
    expect(r.body.error.hint).toMatch(/bridge_pair/);
    // a page that guesses the port gets nothing: there is no code, so hello fails
    const h = await raw(d.port, '/bridge/hello', { method: 'POST', headers: { host: `127.0.0.1:${d.port}`, authorization: 'Bearer AAAAAAAAAAAAAAAA' }, body: '{}' });
    expect(h.status).toBe(400);
    expect(JSON.parse(h.text).error.code).toBe('no_pairing');
  });

  it('pairs with the code, reports connected, and the app can be turned off again', async () => {
    const d = await boot();
    const states: LinkState[] = [];
    const app = appClient({ states });
    await app.connect(await pairCode(d));
    expect((await rpc(d, 'app_status')).body).toMatchObject({ connected: true, edit: false, app: { name: 'CadKit' } });
    await app.disconnect();
    expect((await rpc(d, 'app_status')).body.connected).toBe(false);
    expect(states.map((s) => s.state)).toEqual(['connecting', 'connected', 'off']);
    expect((await rpc(d, 'app_state')).body.error.code).toBe('app_not_connected');
  });

  it('a wrong code does not pair, and the code is single use', async () => {
    const d = await boot();
    const good = await pairCode(d);
    const app = appClient();
    await expect(app.connect(good.slice(0, -4) + 'AAAA')).rejects.toMatchObject({ code: 'bad_code' });
    await app.connect(good);
    const second = appClient();
    await expect(second.connect(good)).rejects.toMatchObject({ code: 'no_pairing' });
    await expect(appClient().connect('not a code')).rejects.toMatchObject({ code: 'bad_code' });
  });

  it('a code with nothing listening reports unreachable and stays off', async () => {
    const app = appClient();
    await expect(app.connect('59999-ABCD-EFGH-JKMN-PQRS')).rejects.toMatchObject({ code: 'unreachable' });
    expect(app.current.state).toBe('error');
  });
});

describe('what the page can and cannot reach', () => {
  it('the daemon token does not open /bridge, and a session token does not open the rest of the daemon', async () => {
    const d = await boot();
    const app = appClient();
    await app.connect(await pairCode(d));
    const session = (app as unknown as { session: string }).session;
    const h = { host: `127.0.0.1:${d.port}` };
    expect((await raw(d.port, '/bridge/poll', { headers: { ...h, authorization: `Bearer ${d.token}` } })).status).toBe(401);
    for (const path of ['/health', '/document', '/events']) expect((await raw(d.port, path, { headers: { ...h, authorization: `Bearer ${session}` } })).status).toBe(401);
    const rpcTry = await raw(d.port, '/rpc', { method: 'POST', headers: { ...h, authorization: `Bearer ${session}` }, body: '{}' });
    expect(rpcTry.status).toBe(401);
  });

  it('origins: a foreign page is refused, a loopback page and a listed origin are let in, the rest of the daemon still refuses every Origin', async () => {
    const d = await boot(['https://app.example.com']);
    const code = (await rpc(d, 'bridge_pair')).body.code as string;
    const hello = (origin?: string) => raw(d.port, '/bridge/hello', { method: 'POST', headers: { host: `127.0.0.1:${d.port}`, authorization: `Bearer ${code.split('-').slice(1).join('')}`, ...(origin ? { origin } : {}) }, body: JSON.stringify({ app: { name: 'x' } }) });
    expect((await raw(d.port, '/bridge/poll', { headers: { host: `127.0.0.1:${d.port}`, origin: 'https://evil.example.net' } })).status).toBe(403);
    expect((await raw(d.port, '/bridge/poll', { headers: { host: `evil.example.net:${d.port}` } })).status).toBe(403);   // DNS rebinding
    const pre = await raw(d.port, '/bridge/hello', { method: 'OPTIONS', headers: { host: `127.0.0.1:${d.port}`, origin: 'http://localhost:5173' } });
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(pre.headers['access-control-allow-private-network']).toBe('true');
    expect((await raw(d.port, '/bridge/hello', { method: 'OPTIONS', headers: { host: `127.0.0.1:${d.port}`, origin: 'https://evil.example.net' } })).status).toBe(403);
    const ok = await hello('https://app.example.com');
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://app.example.com');
    // the daemon proper: even with the right token, a browser origin that is not listed is refused (as before)
    expect((await raw(d.port, '/health', { headers: { host: `127.0.0.1:${d.port}`, authorization: `Bearer ${d.token}`, origin: 'http://localhost:5173' } })).status).toBe(403);
  });
});

describe('reading and driving the open app', () => {
  it('app_state, app_screenshot and app_run_script reach the app and come back as MCP results', async () => {
    const d = await boot();
    const seen: Array<[string, Record<string, unknown>]> = [];
    const app = appClient({
      edit: () => true,
      handle: async (op, args) => {
        seen.push([op, args]);
        if (op === 'state') return { name: 'Plate', featureCount: 2, selection: ['F2.C1'] };
        if (op === 'screenshot') return { png: 'aGVsbG8=', view: args.view ?? 'iso', size: 256 };
        if (op === 'run_script') return { errors: [], created: ['F3'] };
        return {};
      },
    });
    await app.connect(await pairCode(d));
    const st = await rpc(d, 'app_state', { detail: 'summary' });
    expect(st.body).toMatchObject({ ok: true, name: 'Plate', selection: ['F2.C1'] });
    const shot = await rpc(d, 'app_screenshot', { view: 'front', size: 256 });
    expect(shot.content.find((c) => c.type === 'image')).toMatchObject({ type: 'image', data: 'aGVsbG8=' });
    // the daemon only learns the box is ticked from a poll: permissionChanged() makes that immediate
    app.permissionChanged();
    await new Promise((r) => setTimeout(r, 100));
    const run = await rpc(d, 'app_run_script', { code: "part('X')" });
    expect(run.body).toMatchObject({ ok: true, created: ['F3'] });
    expect(seen.map((s) => s[0])).toEqual(['state', 'screenshot', 'run_script']);
    expect(seen[1][1]).toEqual({ view: 'front', size: 256 });
  });

  it('refuses to change the document while the box is not ticked, and the handler never sees the request', async () => {
    const d = await boot();
    const seen: string[] = [];
    let edit = false;
    const app = appClient({ edit: () => edit, handle: async (op) => { seen.push(op); return {}; } });
    await app.connect(await pairCode(d));
    for (const name of ['app_run_script', 'app_undo', 'app_redo']) {
      const r = await rpc(d, name, name === 'app_run_script' ? { code: 'x' } : {});
      expect(r.isError, name).toBe(true);
      expect(r.body.error.code, name).toBe('edit_not_allowed');
    }
    expect(seen).toEqual([]);
    edit = true;
    app.permissionChanged();
    await new Promise((r) => setTimeout(r, 100));
    expect((await rpc(d, 'app_undo')).isError).toBe(false);
    // the user clears the box: the app refuses on its own even before the daemon hears of it
    edit = false;
    const r = await rpc(d, 'app_undo');
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('edit_not_allowed');
    expect(seen).toEqual(['undo']);
  });

  it('an error in the app comes back as an error with its code and hint', async () => {
    const d = await boot();
    const app = appClient({ handle: async () => { throw new BridgeError('no_body', 'nothing to draw', 'build something first'); } });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_screenshot');
    expect(r.isError).toBe(true);
    expect(r.body.error).toMatchObject({ code: 'no_body', hint: 'build something first' });
  });

  it('bad input is refused before it reaches the app; a new pairing code ends the link', async () => {
    const d = await boot();
    const seen: string[] = [];
    const states: LinkState[] = [];
    const app = appClient({ handle: async (op) => { seen.push(op); return {}; }, states });
    await app.connect(await pairCode(d));
    const bad = await rpc(d, 'app_run_script', { code: 3 });
    expect(bad.body.error.code).toBe('bad_input');
    expect((await rpc(d, 'app_screenshot', { view: 'sideways' })).body.error.code).toBe('bad_input');
    expect(seen).toEqual([]);
    await rpc(d, 'bridge_pair');                    // the agent (or someone) starts again: the old link must not survive
    for (let i = 0; i < 50 && app.current.state === 'connected'; i++) await new Promise((r) => setTimeout(r, 50));
    expect(app.current).toMatchObject({ state: 'error', code: 'session_ended' });
    expect((await rpc(d, 'app_status')).body.connected).toBe(false);
  });

  it('the app going away mid-call fails the call instead of hanging', async () => {
    const d = await boot();
    let release!: () => void;
    const app = appClient({ handle: () => new Promise((r) => { release = () => r({}); }) });
    await app.connect(await pairCode(d));
    const call = rpc(d, 'app_state');
    await new Promise((r) => setTimeout(r, 150));
    await app.disconnect();
    release?.();
    const r = await call;
    expect(r.isError).toBe(true);
    expect(['app_disconnected', 'app_timeout']).toContain(r.body.error.code);
  });
});
