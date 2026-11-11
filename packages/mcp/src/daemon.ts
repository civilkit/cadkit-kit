// The daemon: ONE per machine. Loopback HTTP only (127.0.0.1, random port), a random token in a 0600 state file, no Origin
// header allowed (a web page cannot reach it), one tool call at a time, exits after an idle period. It owns the kernel and the
// AgentSession; the stdio shims are thin forwarders.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { AgentSession } from '@kit/agent-tools';
import { Bridge, BridgeError, MAX_REPLY_BYTES } from '@kit/agent-link';
import { agentBackend, McpProtocol, SERVER_INFO, type Backend } from './protocol';
import { withBridge } from './bridgeTools';
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
  port: number; token: string; server: Server; protocol: McpProtocol; session: AgentSession | null; bridge: Bridge;
  close(): Promise<void>;
}

const isLoopbackOrigin = (o: string): boolean => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/.test(o);
const eq = (a: string, b: string): boolean => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function startDaemon(opts: DaemonOptions = {}): Promise<Daemon> {
  const dir = opts.dir ?? stateDir();
  const token = randomBytes(32).toString('hex');
  const session = opts.backend ? (opts.session ?? null) : (opts.session ?? await AgentSession.open({ wasmPath: opts.wasmPath }));
  let port = 0;
  const bridge = new Bridge({ port: () => port });
  const backend = withBridge(opts.backend ?? agentBackend(session!), bridge);
  const protocol = new McpProtocol(backend);
  const idleMs = opts.idleMs ?? 30 * 60 * 1000;
  const maxBody = opts.maxBodyBytes ?? 16 * 1024 * 1024;
  const sse = new Set<ServerResponse>();
  let idle: NodeJS.Timeout | null = null;
  let closed = false;
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

  const readBody = async (req: IncomingMessage, max: number): Promise<string | null> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) { size += (c as Buffer).length; if (size > max) return null; chunks.push(c as Buffer); }
    return Buffer.concat(chunks).toString('utf8');
  };

  // The agent link (docs/agent-bridge.md): /bridge/* is the ONLY part of the daemon a web page may call. It does not take the daemon
  // token (which would hand the page the whole daemon); it takes the one-time pairing code, then a session token the code bought.
  const bridgeRoute = async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> => {
    const origin = req.headers.origin;
    const fail = (code: number, e: unknown) => {
      const be = e instanceof BridgeError ? e : new BridgeError('internal_error', String((e as Error)?.message ?? e));
      send(res, code, { error: { code: be.code, message: be.message, ...(be.hint ? { hint: be.hint } : {}) } });
    };
    // a page from this computer (any loopback origin) or one the user listed with --allow-origin; no Origin header = not a browser
    if (origin !== undefined && !(opts.allowedOrigins ?? []).includes(origin) && !isLoopbackOrigin(origin)) return send(res, 403, { error: { code: 'origin_not_allowed', message: 'origin not allowed', hint: 'start the MCP server with --allow-origin <the app\'s origin>' } });
    const host = (req.headers.host ?? '').toLowerCase();
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(res, 403, { error: { code: 'bad_host', message: 'bad host' } });
    if (origin !== undefined) { res.setHeader('access-control-allow-origin', origin); res.setHeader('vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-private-network': 'true', 'access-control-max-age': '600', ...(origin !== undefined ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}) });
      return void res.end();
    }
    const bearer = (req.headers.authorization ?? '').startsWith('Bearer ') ? (req.headers.authorization ?? '').slice(7) : '';
    touch();
    try {
      if (req.method === 'POST' && url.pathname === '/bridge/hello') {
        const raw = await readBody(req, 64 * 1024);
        const b = (raw ? JSON.parse(raw) : {}) as { app?: { name?: string; version?: string }; edit?: boolean };
        return send(res, 200, bridge.hello(bearer, { name: b.app?.name ?? 'app', version: b.app?.version }, !!b.edit));
      }
      if (!bridge.isSession(bearer)) return send(res, 401, { error: { code: 'no_session', message: 'no such session' } });
      if (req.method === 'GET' && url.pathname === '/bridge/poll') {
        const ac = new AbortController();
        res.on('close', () => ac.abort());
        const requests = await bridge.poll(bearer, url.searchParams.get('edit') === '1', ac.signal);
        if (res.writableEnded || res.destroyed) return;
        return send(res, 200, { requests });
      }
      if (req.method === 'POST' && url.pathname === '/bridge/reply') {
        const raw = await readBody(req, MAX_REPLY_BYTES);
        if (raw === null) return send(res, 413, { error: { code: 'too_large', message: 'reply too large' } });
        return send(res, 200, { ok: bridge.reply(bearer, JSON.parse(raw)) });
      }
      if (req.method === 'POST' && url.pathname === '/bridge/bye') { bridge.bye(bearer); return send(res, 200, { ok: true }); }
      send(res, 404, { error: { code: 'not_found', message: 'not found' } });
    } catch (e) {
      if (!res.headersSent) fail(e instanceof BridgeError && e.code === 'no_session' ? 401 : e instanceof BridgeError ? 400 : 500, e);
    }
  };

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const pre = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (pre.pathname.startsWith('/bridge/')) return await bridgeRoute(req, res, pre);
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
    port, token, server, protocol, session, bridge,
    async close() {
      if (closed) return;
      closed = true;
      bridge.close();
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
