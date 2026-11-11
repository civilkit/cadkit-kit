// The app's side of the agent link: pair with the daemon on loopback, then long-poll for requests and answer them. Browser code
// (fetch only). The user starts it by pasting a code and stops it with `disconnect()`; nothing here starts by itself.
import { BridgeError, EDIT_OPS, parseCode, type AppInfo, type BridgeOp, type BridgeReply, type BridgeRequest, type HelloReply } from './wire';

export type LinkState =
  | { state: 'off' }
  | { state: 'connecting' }
  | { state: 'connected'; since: number; calls: number }
  | { state: 'error'; code: string; message: string };

export interface ClientOptions {
  app: AppInfo;
  /** Runs one request in the app. Throws BridgeError (or any Error) to answer with a failure. */
  handle(op: BridgeOp, args: Record<string, unknown>): Promise<unknown>;
  /** The user's current permission to change the document, read at each poll and before each edit. */
  allowEdit(): boolean;
  onState?(s: LinkState): void;
  /** Called after each request, for a visible trace in the app. */
  onCall?(op: BridgeOp, ok: boolean): void;
  fetch?: typeof fetch;
  /** Wait between retries after a network failure (tests shorten it). */
  retryMs?: number;
  now?(): number;
}

const base = (port: number) => `http://127.0.0.1:${port}`;

export class BridgeClient {
  private state: LinkState = { state: 'off' };
  private ctl: AbortController | null = null;
  private session: string | null = null;
  private port = 0;
  private calls = 0;
  private since = 0;
  private done: Promise<void> = Promise.resolve();
  private pollCtl: AbortController | null = null;
  constructor(private readonly o: ClientOptions) {}
  get current(): LinkState { return this.state; }
  private set(s: LinkState): void { this.state = s; this.o.onState?.(s); }
  private f(): typeof fetch { return this.o.fetch ?? globalThis.fetch.bind(globalThis); }

  /** Pair with the code the user pasted and start serving requests. Resolves once paired (or throws and stays off). */
  async connect(pasted: string): Promise<void> {
    if (this.ctl) await this.disconnect();
    const p = parseCode(pasted);
    if (!p) { const e = new BridgeError('bad_code', 'that is not a pairing code', 'it looks like 52311-ABCD-EFGH-JKMN-PQRS'); this.set({ state: 'error', code: e.code, message: e.message }); throw e; }
    this.set({ state: 'connecting' });
    const ctl = new AbortController();
    try {
      const r = await this.f()(`${base(p.port)}/bridge/hello`, {
        method: 'POST', signal: ctl.signal, headers: { authorization: `Bearer ${p.code}`, 'content-type': 'application/json' },
        body: JSON.stringify({ app: this.o.app, edit: this.o.allowEdit() }),
      });
      const body = await r.json().catch(() => ({})) as Partial<HelloReply> & { error?: { code?: string; message?: string } };
      if (!r.ok || !body.session) throw new BridgeError(body.error?.code ?? `http_${r.status}`, body.error?.message ?? `the agent server refused (${r.status})`);
      this.session = body.session; this.port = p.port; this.ctl = ctl; this.calls = 0; this.since = (this.o.now ?? Date.now)();
    } catch (e) {
      const be = e instanceof BridgeError ? e : new BridgeError('unreachable', 'could not reach the agent server on this computer', 'check that the MCP server is running and the code is the latest one');
      this.set({ state: 'error', code: be.code, message: be.message });
      throw be;
    }
    this.set({ state: 'connected', since: this.since, calls: 0 });
    this.done = this.loop(ctl);
  }

  /** The user turns the link off: tell the daemon, stop polling. */
  async disconnect(): Promise<void> {
    const ctl = this.ctl, token = this.session, port = this.port;
    this.ctl = null; this.session = null;
    if (ctl && token) {
      try { await this.f()(`${base(port)}/bridge/bye`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, keepalive: true }); } catch { /* the daemon is gone: nothing to tell */ }
    }
    ctl?.abort();
    await Promise.race([this.done.catch(() => {}), new Promise((r) => setTimeout(r, 300))]);   // a handler stuck mid-request must not hold the switch
    if (this.state.state !== 'error') this.set({ state: 'off' });
  }

  /** The user ticked or cleared the edit box: tell the daemon now instead of at the end of the current long poll. */
  permissionChanged(): void { this.pollCtl?.abort(); }

  private async loop(ctl: AbortController): Promise<void> {
    let failures = 0;
    const auth = () => ({ authorization: `Bearer ${this.session}`, 'content-type': 'application/json' });
    while (this.ctl === ctl && !ctl.signal.aborted) {
      let reqs: BridgeRequest[];
      try {
        const pc = new AbortController();
        this.pollCtl = pc;
        ctl.signal.addEventListener('abort', () => pc.abort(), { once: true });
        const r = await this.f()(`${base(this.port)}/bridge/poll?edit=${this.o.allowEdit() ? 1 : 0}`, { signal: pc.signal, headers: auth() });
        if (r.status === 401) return this.end(ctl, 'session_ended', 'the agent ended the link (or asked for a new code)');
        if (!r.ok) throw new Error(`poll ${r.status}`);
        reqs = ((await r.json()) as { requests?: BridgeRequest[] }).requests ?? [];
        failures = 0;
      } catch {
        if (ctl.signal.aborted || this.ctl !== ctl) return;
        if (this.pollCtl?.signal.aborted) continue;          // only the permission changed: poll again at once
        if (++failures >= 3) return this.end(ctl, 'lost', 'lost the agent server on this computer');
        await new Promise((r) => setTimeout(r, this.o.retryMs ?? 1500));
        continue;
      }
      for (const q of reqs) {
        if (this.ctl !== ctl) return;
        const reply = await this.run(q);
        try { await this.f()(`${base(this.port)}/bridge/reply`, { method: 'POST', signal: ctl.signal, headers: auth(), body: JSON.stringify(reply) }); } catch { /* the next poll finds out */ }
        this.calls++;
        this.set({ state: 'connected', since: this.since, calls: this.calls });
      }
    }
  }

  private async run(q: BridgeRequest): Promise<BridgeReply> {
    try {
      // the app's own gate, whatever the daemon believes: an edit needs the box ticked NOW
      if (EDIT_OPS.has(q.op) && !this.o.allowEdit()) throw new BridgeError('edit_not_allowed', 'the user has not allowed the agent to change this document', 'ask the user to tick "Allow the agent to change this document"');
      const result = await this.o.handle(q.op, q.args ?? {});
      this.o.onCall?.(q.op, true);
      return { id: q.id, ok: true, result };
    } catch (e) {
      this.o.onCall?.(q.op, false);
      const be = e instanceof BridgeError ? e : new BridgeError('app_error', String((e as Error)?.message ?? e));
      return { id: q.id, ok: false, error: { code: be.code, message: be.message, ...(be.hint ? { hint: be.hint } : {}) } };
    }
  }

  private end(ctl: AbortController, code: string, message: string): void {
    if (this.ctl !== ctl) return;
    this.ctl = null; this.session = null;
    this.set({ state: 'error', code, message });
  }
}
