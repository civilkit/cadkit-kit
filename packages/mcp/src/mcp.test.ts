import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { AgentSession, createTools } from '@kit/agent-tools';
import { agentBackend, McpProtocol, type Backend } from './protocol';
import { startDaemon } from './daemon';
import { runShim } from './shim';
import { readState } from './state';

const WASM = process.env.CK_WASM!;
const SCRATCH = tmpdir();
const BIN = join(process.cwd(), 'packages/mcp/bin/ck-mcp.mjs');
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(SCRATCH, 'mcp-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) { for (const f of readdirSync(d)) rmSync(join(d, f), { force: true }); rmdirSync(d); } });

describe('MCP over stdio (--stdio-direct)', () => {
  it('speaks JSON-RPC: initialize, tools/list, tools/call run_script, resources', async () => {
    const child = spawn(process.execPath, [BIN, '--stdio-direct'], { env: { ...process.env, CK_WASM: WASM }, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines: string[] = [];
    let buf = '';
    child.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(buf.slice(0, i)); buf = buf.slice(i + 1); } });
    const send = (m: unknown) => child.stdin.write(`${JSON.stringify(m)}\n`);
    const wait = async (n: number) => { for (let i = 0; i < 600 && lines.length < n; i++) await new Promise((r) => setTimeout(r, 50)); return lines.map((l) => JSON.parse(l)); };

    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_script', arguments: { code: "part('Block').sketch('front', (s) => s.rect(20, 10)).extrude(5)", mode: 'new' } } });
    send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_script', arguments: { code: 3, mode: 'new' } } });
    send({ jsonrpc: '2.0', id: 5, method: 'resources/read', params: { uri: 'ck://docs/guide' } });
    send({ jsonrpc: '2.0', id: 6, method: 'nonsense' });
    send({ jsonrpc: '2.0', id: 7, method: 'ping' });
    const out = await wait(7);
    child.stdin.end();
    await new Promise((r) => child.once('exit', r));

    const byId = new Map(out.map((m) => [m.id, m]));
    expect(byId.get(1).result.protocolVersion).toBe('2025-06-18');
    expect(byId.get(1).result.serverInfo.name).toBe('ck-cad');
    expect(byId.get(1).result.capabilities.tools).toBeTruthy();
    const names = byId.get(2).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['run_script', 'tree', 'snapshot', 'probe', 'ask_user']));
    expect(byId.get(2).result.tools[0].inputSchema.type).toBe('object');
    const run = byId.get(3).result;
    expect(run.isError).toBeFalsy();
    const body = JSON.parse(run.content[1].text);
    expect(body.ok).toBe(true);
    expect(body.volume).toBe(1000);
    expect(byId.get(4).result.isError).toBe(true);
    expect(JSON.parse(byId.get(4).result.content[0].text).error.code).toBe('bad_input');
    expect(byId.get(5).result.contents[0].text).toContain('Script API');
    expect(byId.get(6).error.code).toBe(-32601);
    expect(byId.get(7).result).toEqual({});
    expect(out.length).toBe(7);                         // the notification got no answer
  }, 60000);

  it('protocol: parse errors, batches, unknown tools', async () => {
    const a = await AgentSession.open({ wasmPath: WASM });
    const p = new McpProtocol(agentBackend(a));
    expect(((await p.handleText('{nope')) as { error: { code: number } }).error.code).toBe(-32700);
    const batch = await p.handle([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'zzz' } }]);
    expect(Array.isArray(batch) && batch.length).toBe(2);
    expect((batch as Array<{ result: { isError?: boolean } }>)[1].result.isError).toBe(true);
    const r = await p.handle({ jsonrpc: '2.0', id: 9, method: 'resources/read', params: { uri: 'ck://recipes/bracket' } });
    expect((r as { result: { contents: Array<{ text: string }> } }).result.contents[0].text).toContain('Bracket');
    await a.close();
  }, 30000);
});

function http(port: number, opts: { path: string; method?: string; headers?: Record<string, string>; body?: string }): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: opts.path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let t = ''; res.on('data', (c) => (t += c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, text: t }));
    });
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

describe('daemon', () => {
  const events: string[] = [];
  const slow: Backend = {
    tools: () => [{ name: 'slow', description: 'x', inputSchema: { type: 'object' } }],
    resources: () => [], read: async () => null,
    async call(name, args) {
      const tag = (args as { tag: string }).tag;
      events.push(`start ${tag}`);
      await new Promise((r) => setTimeout(r, 150));
      events.push(`end ${tag}`);
      return { content: [{ type: 'text', text: tag }] };
    },
  };
  const rpc = (tag: string) => JSON.stringify({ jsonrpc: '2.0', id: tag, method: 'tools/call', params: { name: 'slow', arguments: { tag } } });

  it('state file is user-only; token required; Origin and bad Host rejected', async () => {
    const dir = tmp();
    const d = await startDaemon({ dir, backend: slow, idleMs: 0 });
    try {
      const st = readState(dir)!;
      expect(st.port).toBe(d.port);
      expect(st.token).toHaveLength(64);
      expect(statSync(join(dir, 'daemon.json')).mode & 0o777).toBe(0o600);
      const auth = { authorization: `Bearer ${d.token}` };
      expect((await http(d.port, { path: '/health' })).status).toBe(401);
      expect((await http(d.port, { path: '/health', headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
      expect((await http(d.port, { path: '/health', headers: auth })).status).toBe(200);
      // a browser page always sends Origin: refused even with a valid token
      expect((await http(d.port, { path: '/health', headers: { ...auth, origin: 'http://evil.example' } })).status).toBe(403);
      expect((await http(d.port, { path: '/rpc', method: 'POST', body: rpc('x'), headers: { ...auth, origin: 'null' } })).status).toBe(403);
      // DNS rebinding: a foreign Host name is refused
      expect((await http(d.port, { path: '/health', headers: { ...auth, host: 'evil.example' } })).status).toBe(403);
      expect((await http(d.port, { path: '/nothing', headers: auth })).status).toBe(404);
    } finally { await d.close(); }
    expect(readState(dir)).toBeNull();
  });

  it('serialises two concurrent tool calls (queue)', async () => {
    const dir = tmp();
    events.length = 0;
    const d = await startDaemon({ dir, backend: slow, idleMs: 0 });
    try {
      const h = { authorization: `Bearer ${d.token}` };
      const [r1, r2] = await Promise.all([
        http(d.port, { path: '/rpc', method: 'POST', body: rpc('A'), headers: h }),
        http(d.port, { path: '/rpc', method: 'POST', body: rpc('B'), headers: h }),
      ]);
      expect(r1.status).toBe(200); expect(r2.status).toBe(200);
      expect(events).toHaveLength(4);
      // never interleaved: each start is followed by its own end
      expect(events[0].replace('start', 'end')).toBe(events[1]);
      expect(events[2].replace('start', 'end')).toBe(events[3]);
    } finally { await d.close(); }
  });

  it('idle exit, and GUI event stream of document versions', async () => {
    const dir = tmp();
    let idled = false;
    const a = await AgentSession.open({ wasmPath: WASM });
    const d = await startDaemon({ dir, session: a, idleMs: 600, onIdle: () => { idled = true; } });
    const got: string[] = [];
    await new Promise<void>((resolve) => {
      const req = request({ host: '127.0.0.1', port: d.port, path: '/events', headers: { authorization: `Bearer ${d.token}` } }, (res) => {
        res.on('data', (c) => { got.push(String(c)); if (got.join('').includes('event: document')) { req.destroy(); resolve(); } });
      });
      req.end();
      setTimeout(() => void d.protocol.handleText(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { code: "part('E').sketch('front', (s) => s.rect(4, 4)).extrude(2)", mode: 'new' } } })), 200);
    });
    expect(got.join('')).toContain('"features":2');
    const doc = JSON.parse((await http(d.port, { path: '/document', headers: { authorization: `Bearer ${d.token}` } })).text);
    expect(doc.document.features).toHaveLength(2);
    for (let i = 0; i < 40 && !idled; i++) await new Promise((r) => setTimeout(r, 100));
    expect(idled).toBe(true);
    await d.close();
    await a.close();
  }, 30000);

  it('a shim forwards stdio lines to a running daemon', async () => {
    const dir = tmp();
    const a = await AgentSession.open({ wasmPath: WASM });
    const d = await startDaemon({ dir, session: a, idleMs: 0 });
    const input = new PassThrough(), output = new PassThrough();
    const out: string[] = [];
    output.on('data', (c) => out.push(String(c)));
    const done = runShim({ input, output, dir, spawnDaemon: () => { throw new Error('should not spawn'); } });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_script', arguments: { code: "part('S').sketch('front', (s) => s.rect(3, 3)).extrude(3)", mode: 'new' } } })}\n`);
    input.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    input.end();
    await done;
    const res = JSON.parse(out.join('').trim());
    expect(JSON.parse(res.result.content[1].text).volume).toBe(27);
    await d.close();
    await a.close();
  }, 30000);
});
