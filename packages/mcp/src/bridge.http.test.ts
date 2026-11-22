// The agent link end to end on loopback: the real daemon routes, the real MCP tools and the app's BridgeClient, with a stand-in
// for the app's handlers. No kernel is needed (the daemon gets a fake backend), so this runs without CK_WASM.
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  return { isError: !!j.result.isError, body: first?.text?.startsWith('{') ? JSON.parse(first.text) : first?.text, content: j.result.content, raw: first?.text ?? '' };
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

  it('app_plugin_list and app_plugin_run reach the app; the run needs the edit permission and carries its parameters', async () => {
    const d = await boot();
    const seen: Array<[string, Record<string, unknown>]> = [];
    let edit = false;
    const app = appClient({
      edit: () => edit,
      handle: async (op, args) => {
        seen.push([op, args]);
        if (op === 'plugin_list') return { plugins: [{ id: 'tomasdjo.woodwork', name: 'Woodwork', version: '0.1.3', builtin: false, generators: [{ plugin: 'tomasdjo.woodwork', generator: 'cabinet', title: 'Cabinet', parameters: { type: 'object' } }] }] };
        if (op === 'plugin_run') return { ok: true, group: 'Cabinet', created: 30 };
        return {};
      },
    });
    await app.connect(await pairCode(d));
    const list = await rpc(d, 'app_plugin_list');
    expect(list.body).toMatchObject({ ok: true, plugins: [{ id: 'tomasdjo.woodwork', generators: [{ generator: 'cabinet' }] }] });
    const refused = await rpc(d, 'app_plugin_run', { plugin: 'tomasdjo.woodwork', generator: 'cabinet', params: { doors: 2 } });
    expect(refused.isError).toBe(true);
    expect(refused.body.error.code).toBe('edit_not_allowed');
    expect(seen.map((s) => s[0])).toEqual(['plugin_list']);   // the app never saw the refused run
    edit = true;
    app.permissionChanged();
    await new Promise((r) => setTimeout(r, 100));
    const run = await rpc(d, 'app_plugin_run', { plugin: 'tomasdjo.woodwork', generator: 'cabinet', params: { doors: 2, place_x: 800 } });
    expect(run.body).toMatchObject({ ok: true, group: 'Cabinet', created: 30 });
    expect(seen[1]).toEqual(['plugin_run', { plugin: 'tomasdjo.woodwork', generator: 'cabinet', params: { doors: 2, place_x: 800 } }]);
    const bad = await rpc(d, 'app_plugin_run', { generator: 'cabinet' });
    expect(bad.isError).toBe(true);
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

describe('the measurement tools reach the open app', () => {
  it('app_measure and the others are listed, read without the edit permission, and come back as MCP results with a summary line', async () => {
    const d = await boot();
    const seen: Array<[string, Record<string, unknown>]> = [];
    const app = appClient({
      edit: () => false,
      handle: async (op, args) => { seen.push([op, args]); return { summary: `${op} done`, distance: 15, op }; },
    });
    await app.connect(await pairCode(d));
    const listed = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const names = ((await listed.json()) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
    for (const n of ['app_bodies', 'app_measure', 'app_clearance', 'app_interference', 'app_thickness', 'app_draft', 'app_dfm', 'app_section', 'app_interfaces']) expect(names, n).toContain(n);
    const m = await rpc(d, 'app_measure', { a: 'Base', b: 'Peg' });
    expect(m.isError).toBe(false);
    expect(m.body).toMatchObject({ ok: true, distance: 15, op: 'measure' });
    expect(m.body.summary).toBeUndefined();
    expect(m.content[0]).toMatchObject({ type: 'text', text: 'measure done' });
    for (const [tool, args] of [['app_clearance', { required: 0.2 }], ['app_interference', {}], ['app_thickness', { min: 1 }], ['app_draft', { pull: '+Z' }], ['app_dfm', { process: 'injection' }], ['app_bodies', {}], ['app_interfaces', { kinds: ['holes'], component: 'Base', precision: 2 }]] as const) {
      const r = await rpc(d, tool, args);
      expect(r.isError, tool).toBe(false);
    }
    expect(seen.map((x) => x[0])).toEqual(['measure', 'clearance', 'interference', 'thickness', 'draft', 'dfm', 'bodies', 'interfaces']);
    expect(seen[0][1]).toEqual({ a: 'Base', b: 'Peg' });
  });

  it('bad input is refused before the app is asked, and an app error keeps its code', async () => {
    const d = await boot();
    let asked = 0;
    const app = appClient({ handle: async () => { asked++; throw new BridgeError('no_body', 'the open document has no solid to measure', 'build something first'); } });
    await app.connect(await pairCode(d));
    const bad = await rpc(d, 'app_measure', { a: 'Base' });
    expect(bad.isError).toBe(true);
    expect(bad.body.error).toMatchObject({ code: 'bad_input', message: '$.b: is required' });
    expect((await rpc(d, 'app_dfm', { process: 'welding' })).body.error.code).toBe('bad_input');
    expect(asked).toBe(0);
    const r = await rpc(d, 'app_thickness', {});
    expect(r.body.error).toMatchObject({ code: 'no_body', hint: 'build something first' });
    expect(asked).toBe(1);
  });
});

describe('app_state arguments', () => {
  it('the filter, fields, paging and revision arguments reach the app unchanged; bad ones are refused before it', async () => {
    const d = await boot();
    const seen: Array<Record<string, unknown>> = [];
    const app = appClient({ handle: async (op, args) => { seen.push(args); return { open: true, revision: 4, totalCount: 0, returnedCount: 0, features: [] }; } });
    await app.connect(await pairCode(d));
    const args = { ids: ['F1'], query: 'pad', types: ['extrude'], fields: ['type', 'params'], limit: 10, cursor: 'abc', sinceRevision: 3, includeBlobs: true };
    expect((await rpc(d, 'app_state', args)).body).toMatchObject({ ok: true, revision: 4 });
    expect(seen).toEqual([args]);
    for (const bad of [{ limit: 0 }, { limit: 501 }, { fields: ['colour'] }, { sinceRevision: -1 }, { ids: 'F1' }, { detail: 'huge' }]) {
      const r = await rpc(d, 'app_state', bad);
      expect(r.body.error.code, JSON.stringify(bad)).toBe('bad_input');
    }
    expect(seen).toHaveLength(1);
  });
});

describe('the output budget', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `F${i}`, type: 'extrude', name: `Feature number ${i}` }));
  const huge = { open: true, features: rows(600), name: 'Big' };

  it('a big result comes back as a summary with a handle, not a silent cut; fetch_result and the resource give the rest', async () => {
    const d = await boot();
    const seen: Array<Record<string, unknown>> = [];
    const app = appClient({ handle: async (_op, args) => { seen.push(args); return huge; } });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_state', { detail: 'summary' });
    expect(r.raw.length).toBeLessThanOrEqual(4000);
    expect(r.body).toMatchObject({ ok: true, name: 'Big', _budget: { exceeded: true, maxChars: 4000, fetch: { tool: 'fetch_result' } } });
    const handle = r.body._budget.handle as string;
    expect(seen).toEqual([{ detail: 'summary' }]);                       // maxChars never reaches the app
    // a part of it by path, an array page by items, and the text by characters
    const one = await rpc(d, 'fetch_result', { handle, path: 'features.599' });
    expect(one.body.value).toEqual({ id: 'F599', type: 'extrude', name: 'Feature number 599' });
    const page = await rpc(d, 'fetch_result', { handle, path: 'features', offset: 500, limit: 100, maxChars: 20000 });
    expect(page.body).toMatchObject({ total: 600, offset: 500, returned: 100 });
    const fits = await rpc(d, 'fetch_result', { handle, path: 'features', offset: 0, limit: 100 });     // at the default budget a page is made smaller so it fits, and says where it ends
    expect(fits.raw.length).toBeLessThanOrEqual(4000); expect(fits.body.returned).toBeLessThan(100); expect(fits.body.nextOffset).toBe(fits.body.returned);
    expect(page.body.items[99].id).toBe('F599');
    const text = await rpc(d, 'fetch_result', { handle, offset: 0, limit: 600 });
    expect(text.body.text.startsWith('{')).toBe(true); expect(text.body.nextOffset).toBe(600);
    // the resource
    const res = await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: `ck://result/${handle}` } }) });
    const body = (await res.json()) as { result: { contents: Array<{ text: string }> } };
    expect(JSON.parse(body.result.contents[0].text)).toEqual({ ok: true, ...huge });
    // an unknown handle and a bad path are errors with a hint
    expect((await rpc(d, 'fetch_result', { handle: 'nope' })).body.error.code).toBe('no_such_result');
    expect((await rpc(d, 'fetch_result', { handle, path: 'nothing' })).body.error.code).toBe('bad_path');
  });

  it('maxChars raises or lowers the budget per call within 500..48000, and a result that fits is returned whole', async () => {
    const d = await boot();
    const app = appClient({ handle: async () => ({ open: true, features: rows(120) }) });
    await app.connect(await pairCode(d));
    const dflt = await rpc(d, 'app_state', { detail: 'summary' });
    expect(dflt.body._budget).toMatchObject({ exceeded: true });
    const wide = await rpc(d, 'app_state', { detail: 'summary', maxChars: 48000 });
    expect(wide.body._budget).toBeUndefined();
    expect(wide.body.features).toHaveLength(120);
    expect(JSON.parse((await rpc(d, 'app_state', { detail: 'summary', maxChars: 1000 })).raw).features.length).toBeLessThan(JSON.parse(dflt.raw).features.length);
    for (const bad of [100, 60000]) expect((await rpc(d, 'app_state', { maxChars: bad })).body.error.code).toBe('bad_input');
    expect((await rpc(d, 'app_status', {})).body).toMatchObject({ ok: true });
  });

  it('the tool list carries the budget argument and fetch_result, and is the same list every time', async () => {
    const d = await boot();
    const list = async () => ((await (await fetch(`http://127.0.0.1:${d.port}/rpc`, { method: 'POST', headers: { authorization: `Bearer ${d.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json()) as { result: { tools: Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }> } }).result.tools;
    const a = await list(), b = await list();
    expect(a).toEqual(b);
    expect(a.find((t) => t.name === 'fetch_result')).toBeTruthy();
    expect(a.find((t) => t.name === 'app_state')!.inputSchema.properties).toHaveProperty('maxChars');
    expect(a.find((t) => t.name === 'app_status')!.inputSchema.properties).not.toHaveProperty('maxChars');
  });
});

describe('app_edit', () => {
  const ops = [{ op: 'setParam', id: 'F2', path: 'depth', value: 14 }, { op: 'add', feature: { type: 'extrude' } }];
  it('needs the edit permission (the app never sees the call), validates its input, and passes the transaction and the app\'s errors through', async () => {
    const d = await boot();
    const seen: Array<[string, Record<string, unknown>]> = [];
    let edit = false;
    const app = appClient({
      edit: () => edit,
      handle: async (op, args) => {
        seen.push([op, args]);
        if (args.expectedRevision === 1) throw new BridgeError('stale_revision', 'the document changed', 'read app_state with sinceRevision');
        return { revision: 6, documentId: 'd1', changedIds: ['F2', 'F4'], addedIds: ['F4'], removedIds: [], validation: { errorCount: 0, errors: [], warnings: 0 } };
      },
    });
    await app.connect(await pairCode(d));
    expect((await rpc(d, 'app_edit', { expectedRevision: 5, ops })).body.error.code).toBe('edit_not_allowed');
    expect(seen).toEqual([]);
    edit = true; app.permissionChanged(); await new Promise((r) => setTimeout(r, 100));
    for (const bad of [{ ops }, { expectedRevision: 5 }, { expectedRevision: 5, ops: [] }, { expectedRevision: -1, ops }, { expectedRevision: 5, ops: [{ id: 'F2' }] }, { expectedRevision: 5, ops: [{ op: 'explode' }] }, { expectedRevision: 5, ops: [{ op: 'remove', id: 'F2', colour: 'red' }] }]) {
      expect((await rpc(d, 'app_edit', bad)).body.error.code, JSON.stringify(bad)).toBe('bad_input');
    }
    expect(seen).toEqual([]);
    const ok = await rpc(d, 'app_edit', { expectedRevision: 5, reason: 'longer', ops });
    expect(ok.body).toMatchObject({ ok: true, revision: 6, changedIds: ['F2', 'F4'], addedIds: ['F4'], validation: { errorCount: 0 } });
    expect(seen).toEqual([['edit', { expectedRevision: 5, reason: 'longer', ops }]]);
    const stale = await rpc(d, 'app_edit', { expectedRevision: 1, ops });
    expect(stale.isError).toBe(true);
    expect(stale.body.error).toMatchObject({ code: 'stale_revision', hint: 'read app_state with sinceRevision' });
  });
});

describe('app_batch', () => {
  /** A stand-in app that knows the batch op: it runs each step through `one`, like the real handler does, and counts the requests it was sent. */
  const batching = (one: (op: string, a: Record<string, unknown>) => Promise<unknown>, log: string[] = []) => async (op: string, args: Record<string, unknown>): Promise<unknown> => {
    log.push(op);
    if (op !== 'batch') return one(op, args);
    const results: unknown[] = [];
    let stopped = false;
    for (const st of args.steps as Array<{ op: string; args: Record<string, unknown> }>) {
      if (stopped) { results.push({ ok: false, skipped: true }); continue; }
      try { results.push({ ok: true, result: await one(st.op, st.args) }); }
      catch (e) { results.push({ ok: false, error: { code: (e as BridgeError).code, message: (e as Error).message, ...((e as BridgeError).hint ? { hint: (e as BridgeError).hint } : {}) } }); if (args.stopOnError !== false) stopped = true; }
    }
    return { results };
  };
  const steps = (...s: unknown[]) => ({ steps: s });
  it('refuses an unknown step key before anything runs, and says where parameters go', async () => {
    const d = await boot();
    const seen: string[] = [];
    const app = appClient({ edit: () => true, handle: async (op) => { seen.push(op); return { revision: 1 }; } });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_batch', steps({ tool: 'app_state' }, { tool: 'app_screenshot', view: 'top' }));
    expect(r.isError).toBe(true);
    expect(r.body.error.code).toBe('bad_input');
    expect(r.body.error.message).toMatch(/steps\[1\]\.view: unknown field.*parameters go inside "args"/);
    expect(seen).toEqual([]);
  });
  it('checks every step first: a bad argument in step 2 or an edit without permission runs nothing', async () => {
    const d = await boot();
    const seen: string[] = [];
    const app = appClient({ edit: () => false, handle: async (op) => { seen.push(op); return {}; } });
    await app.connect(await pairCode(d));
    const bad = await rpc(d, 'app_batch', steps({ tool: 'app_state' }, { tool: 'app_state', args: { limit: 0 } }, { tool: 'app_open_asset', args: {} }));
    expect(bad.body.error.message).toMatch(/steps\[1\]\.args\.limit.*steps\[2\]\.tool: app_open_asset cannot be a batch step/);
    const noEdit = await rpc(d, 'app_batch', steps({ tool: 'app_state' }, { tool: 'app_undo' }));
    expect(noEdit.body.error.code).toBe('edit_not_allowed');
    expect(seen).toEqual([]);
  });
  it('runs the steps in order and returns one result each; a failure stops the rest unless stopOnError is false', async () => {
    const d = await boot();
    const seen: Array<[string, Record<string, unknown>]> = [];
    const app = appClient({ edit: () => true, handle: batching(async (op, a) => {
      seen.push([op, a]);
      if (op === 'bodies') throw new BridgeError('no_body', 'no solid', 'build something');
      if (op === 'edit') return { revision: 8 };
      return { revision: 7, open: true };
    }) });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_batch', steps({ tool: 'app_edit', args: { ops: [{ op: 'remove', id: 'F1' }] }, label: 'drop' }, { tool: 'app_bodies', args: {} }, { tool: 'app_undo' }));
    expect(r.isError).toBe(true);
    expect(r.body).toMatchObject({ ok: false, steps: 3, failed: 1, skipped: 1 });
    expect(r.body.results.map((x: { ok: boolean; skipped?: boolean }) => [x.ok, !!x.skipped])).toEqual([[true, false], [false, false], [false, true]]);
    expect(r.body.results[1].error).toMatchObject({ code: 'no_body', hint: 'build something' });
    expect(seen.map(([o]) => o)).toEqual(['edit', 'bodies']);
    seen.length = 0;
    const all = await rpc(d, 'app_batch', { ...steps({ tool: 'app_bodies', args: {} }, { tool: 'app_state' }), stopOnError: false });
    expect(all.body).toMatchObject({ failed: 1 });
    expect(all.body.results[1].ok).toBe(true);
  });
  it('a screenshot step comes back as an image beside the JSON', async () => {
    const d = await boot();
    const app = appClient({ handle: batching(async () => ({ png: 'AAAA', view: 'top', size: 64 })) });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_batch', steps({ tool: 'app_screenshot', args: { view: 'top', size: 64 } }));
    expect(r.body.results[0].result).toMatchObject({ view: 'top', image: 'attached as image 1' });
    expect(r.body.results[0].result.png).toBeUndefined();
    expect(r.content.some((c) => c.type === 'image' && c.data === 'AAAA')).toBe(true);
  });
  it('is ONE request to the app whatever the number of steps', async () => {
    const d = await boot();
    const log: string[] = [];
    const app = appClient({ edit: () => true, handle: batching(async () => ({ revision: 2 }), log) });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_batch', steps({ tool: 'app_state' }, { tool: 'app_undo' }, { tool: 'app_state' }, { tool: 'app_bodies', args: {} }));
    expect(r.body).toMatchObject({ ok: true, steps: 4, failed: 0 });
    expect(log).toEqual(['batch']);
  });
  it('falls back to one request per step for an app that does not know batch', async () => {
    const d = await boot();
    const log: string[] = [];
    const app = appClient({ edit: () => true, handle: async (op) => { log.push(op); if (op === 'batch') throw new BridgeError('unknown_op', 'the app does not know batch'); return { revision: 3 }; } });
    await app.connect(await pairCode(d));
    const r = await rpc(d, 'app_batch', steps({ tool: 'app_state' }, { tool: 'app_state' }));
    expect(r.body).toMatchObject({ ok: true, steps: 2 });
    expect(log).toEqual(['batch', 'state', 'state']);
  });
});

describe('app_batch with a script file', () => {
  it('reads app_run_script {file} from an allowed folder; other places and types are refused before any step runs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'scripts-'));
    dirs.push(root);
    writeFileSync(join(root, 'plate.ckscript'), 'part("P").box(1,2,3)');
    writeFileSync(join(root, 'notes.txt'), 'x');
    const old = process.env.CK_MCP_ASSET_ROOTS;
    process.env.CK_MCP_ASSET_ROOTS = root;
    try {
      const d = await boot();
      const seen: Array<Record<string, unknown>> = [];
      const app = appClient({ edit: () => true, handle: async (op, a) => { seen.push({ op, ...a }); return { results: [{ ok: true, result: { ok: true } }] }; } });
      await app.connect(await pairCode(d));
      expect((await rpc(d, 'app_batch', { steps: [{ tool: 'app_run_script', args: { file: 'plate.ckscript' } }] })).body.ok).toBe(true);
      expect((seen[0].steps as Array<{ args: { code: string } }>)[0].args.code).toBe('part("P").box(1,2,3)');
      seen.length = 0;
      for (const [file, code] of [['notes.txt', 'asset_extension_not_allowed'], ['missing.ckscript', 'asset_not_found'], ['../x.ckscript', 'path_traversal']]) {
        const r = await rpc(d, 'app_batch', { steps: [{ tool: 'app_state' }, { tool: 'app_run_script', args: { file } }] });
        expect(r.body.error.code, file).toBe(code);
      }
      expect((await rpc(d, 'app_batch', { steps: [{ tool: 'app_run_script', args: { file: 'plate.ckscript', code: 'x' } }] })).body.error.code).toBe('bad_input');
      expect(seen).toEqual([]);
    } finally { if (old === undefined) delete process.env.CK_MCP_ASSET_ROOTS; else process.env.CK_MCP_ASSET_ROOTS = old; }
  });
});

describe('app_selection', () => {
  it('reaches the app without the edit permission, validates limit, and works as a batch step', async () => {
    const d = await boot();
    const seen: Array<Record<string, unknown>> = [];
    const app = appClient({ edit: () => false, handle: async (op, a) => { seen.push({ op, ...a }); return { count: 1, items: [{ id: 'F2', kind: 'feature' }] }; } });
    await app.connect(await pairCode(d));
    expect((await rpc(d, 'app_selection', { limit: 5 })).body).toMatchObject({ ok: true, count: 1 });
    expect(seen[0]).toEqual({ op: 'selection', limit: 5 });
    expect((await rpc(d, 'app_selection', { limit: 0 })).body.error.code).toBe('bad_input');
    expect((await rpc(d, 'app_selection', { max: 1 })).body.error.message).toMatch(/unknown field/);
  });
});

describe('app_settings', () => {
  it('reaches the app read-only with query and limit, and refuses a bad limit', async () => {
    const d = await boot();
    const seen: Array<Record<string, unknown>> = [];
    const app = appClient({ edit: () => false, handle: async (op, a) => { seen.push({ op, ...a }); return { count: 1, returned: 1, settings: [{ key: 'nav.zoomSpeed', value: 1 }] }; } });
    await app.connect(await pairCode(d));
    expect((await rpc(d, 'app_settings', { query: 'nav', limit: 10 })).body).toMatchObject({ ok: true, settings: [{ key: 'nav.zoomSpeed', value: 1 }] });
    expect(seen[0]).toEqual({ op: 'settings', query: 'nav', limit: 10 });
    expect((await rpc(d, 'app_settings', { limit: 0 })).body.error.code).toBe('bad_input');
  });
});
