// The stdio shim: speaks MCP on stdin/stdout and forwards every JSON-RPC message to the daemon (started on demand).
import { closeSync, existsSync, openSync, rmSync, statSync } from 'node:fs';
import type { Readable, Writable } from 'node:stream';
import { request } from 'node:http';
import { lockFile, readState, stateDir, type DaemonState } from './state';
import { serveStdio } from './stdio';
import type { JsonRpcResponse } from './protocol';

export function httpJson(st: Pick<DaemonState, 'port' | 'token'>, method: string, path: string, body?: string, timeoutMs = 10 * 60 * 1000): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: st.port, path, method, headers: { authorization: `Bearer ${st.token}`, ...(body !== undefined ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}) }, timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy(new Error('daemon request timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export async function daemonAlive(st: DaemonState | null): Promise<boolean> {
  if (!st) return false;
  try { return (await httpJson(st, 'GET', '/health', undefined, 3000)).status === 200; } catch { return false; }
}

/** Find a running daemon or start one (`spawnDaemon` must start it detached); several shims starting together start one. */
export async function ensureDaemon(spawnDaemon: () => void, dir = stateDir(), waitMs = 40000): Promise<DaemonState> {
  const t0 = Date.now();
  for (;;) {
    const st = readState(dir);
    if (await daemonAlive(st)) return st!;
    const lock = lockFile(dir);
    let mine = false;
    try {
      if (existsSync(lock) && Date.now() - statSync(lock).mtimeMs > 60000) rmSync(lock, { force: true });
      closeSync(openSync(lock, 'wx', 0o600));
      mine = true;
    } catch { /* another shim is starting it */ }
    if (mine) { try { spawnDaemon(); } catch (e) { rmSync(lock, { force: true }); throw e; } }
    // wait for a live daemon
    for (; Date.now() - t0 < waitMs; await new Promise((r) => setTimeout(r, 150))) {
      const s2 = readState(dir);
      if (s2 && s2.token !== st?.token && await daemonAlive(s2)) { if (mine) rmSync(lock, { force: true }); return s2; }
      if (s2 && !st && await daemonAlive(s2)) { if (mine) rmSync(lock, { force: true }); return s2; }
    }
    if (mine) rmSync(lock, { force: true });
    throw new Error('the ck-cad daemon did not start in time');
  }
}

export async function runShim(opts: { input: Readable; output: Writable; spawnDaemon: () => void; dir?: string }): Promise<void> {
  let st: DaemonState | null = null;
  const get = async () => (st ??= await ensureDaemon(opts.spawnDaemon, opts.dir));
  const forward = async (line: string): Promise<JsonRpcResponse | JsonRpcResponse[] | null> => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const s = await get();
        const r = await httpJson(s, 'POST', '/rpc', line);
        if (r.status === 204) return null;
        if (r.status === 401 || r.status === 403) { st = null; continue; }
        return JSON.parse(r.text);
      } catch (e) {
        st = null;                       // the daemon may have idled out: start a new one once
        if (attempt === 1) return { jsonrpc: '2.0', id: idOf(line), error: { code: -32603, message: `ck-cad daemon unavailable: ${(e as Error).message}` } };
      }
    }
    return { jsonrpc: '2.0', id: idOf(line), error: { code: -32603, message: 'ck-cad daemon rejected the request' } };
  };
  await serveStdio(forward, opts.input, opts.output);
}

function idOf(line: string): string | number | null {
  try { const m = JSON.parse(line) as { id?: string | number }; return m.id ?? null; } catch { return null; }
}
