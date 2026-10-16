// The daemon: ONE per machine. Loopback HTTP only (127.0.0.1, random port), a random token in a 0600 state file, no Origin
// header allowed (a web page cannot reach it), one tool call at a time, exits after an idle period. It owns the kernel and the
// AgentSession; the stdio shims are thin forwarders.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AgentSession } from '@kit/agent-tools';
import { agentBackend, McpProtocol, SERVER_INFO, type Backend } from './protocol';
import { clearState, stateDir, writeState } from './state';

export interface DaemonOptions {
  /** Where the state file lives (default ~/.ck-cad or CK_MCP_HOME). */
  dir?: string;
  /** Exit after this many ms without a request (default 30 minutes; 0 = never). */
  idleMs?: number;
  wasmPath?: string;
  /** Use this backend instead of a kernel (tests). */
  backend?: Backend;
  session?: AgentSession;
  /** Origins that MAY call the daemon (the GUI bridge). Default none: any request with an Origin header is refused. */
  allowedOrigins?: string[];
  port?: number;
  onIdle?(): void;
  maxBodyBytes?: number;
}
export interface Daemon {
  port: number; token: string; server: Server; protocol: McpProtocol; session: AgentSession | null;
  close(): Promise<void>;
}

const eq = (a: string, b: string): boolean => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  const dir = opts.dir ?? stateDir();
  const token = randomBytes(32).toString('hex');
  const session = opts.backend ? (opts.session ?? null) : (opts.session ?? await AgentSession.open({ wasmPath: opts.wasmPath }));
  const backend = opts.backend ?? agentBackend(session!);
  const protocol = new McpProtocol(backend);
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  const maxBody = opts.maxBodyBytes ?? 16 * 1024 * 1024;
  const sse = new Set<ServerResponse>();
  let idle: NodeJS.Timeout | null = null;
  let closed = false;
  let port = 0;
  const touch = () => {
    if (idle) clearTimeout(idle);
    if (idleMs > 0) idle = setTimeout(() => { if (protocol.queue.pending === 0) { opts.onIdle?.(); void daemon.close(); } else touch(); }, idleMs);
    idle?.unref?.();
  };

  const send = (res: ServerResponse, code: number, body: unknown, type = 'application/json') => {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      // 1. no Origin header at all (a browser page always sends one on cross-origin requests), unless opted in
      const origin = req.headers.origin;
      if (origin !== undefined && !(opts.allowedOrigins ?? []).includes(origin)) return send(res, 403, { error: 'origin not allowed' });
      // 2. Host must be the loopback name we listen on (DNS rebinding)
      const host = (req.headers.host ?? '').toLowerCase();
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: 'bad host' });
      // 3. the token
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const auth = req.headers.authorization ?? '';
      const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!given || !eq(given, token)) return send(res, 401, { error: 'token required' });
      touch();
      if (origin !== undefined) res.setHeader('access-control-allow-origin', origin);
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true, pid: process.pid, server: SERVER_INFO, version: session?.version ?? 0, pending: protocol.queue.pending });
      }
      if (req.method === 'GET' && url.pathname === '/document') {
        return send(res, 200, { version: session?.version ?? 0, document: session?.doc ?? null });
      }
      if (req.method === 'GET' && url.pathname === '/events') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
        res.write(`event: hello\ndata: ${JSON.stringify({ version: session?.version ?? 0 })}\n\n`);
        sse.add(res);
        req.on('close', () => sse.delete(res));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/shutdown') {
        send(res, 200, { ok: true });
        setTimeout(() => void daemon.close(), 10);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/rpc') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) { size += (c as Buffer).length; if (size > maxBody) return send(res, 413, { error: 'body too large' }); chunks.push(c as Buffer); }
        const out = await protocol.handleText(Buffer.concat(chunks).toString('utf8'));
        if (out === null) { res.writeHead(204); return void res.end(); }
        return send(res, 200, out);
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      if (!res.headersSent) send(res, 500, { error: String((e as Error)?.message ?? e) });
    }
  });

  const unsub = session?.onChange((e) => {
    // a document version event: what the GUI bridge mirrors (the document itself is fetched with GET /document)
    const line = `event: document\ndata: ${JSON.stringify({ version: e.version, label: e.label, features: e.doc.features.length, name: e.doc.name })}\n\n`;
    for (const r of sse) r.write(line);
  });

  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(opts.port ?? 0, '127.0.0.1', resolve); });
  port = (server.address() as AddressInfo).port;
  if (opts.dir !== null) writeState({ port, token, pid: process.pid, startedAt: Date.now(), version: SERVER_INFO.version }, dir);
  touch();

  const daemon: Daemon = {
    port, token, server, protocol, session,
    async close() {
      if (closed) return;
      closed = true;
      if (idle) clearTimeout(idle);
      unsub?.();
      for (const r of sse) r.end();
      clearState(dir, token);
      await new Promise<void>((r) => { server.close(() => r()); server.closeAllConnections?.(); });
      if (!opts.session) await session?.close();
    },
  };
  return daemon;
}
