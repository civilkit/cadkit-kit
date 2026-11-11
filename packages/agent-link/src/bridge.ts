// The daemon's side of the agent link: pairing, one session, and a request queue the app drains by long polling. It has no HTTP in
// it (the daemon routes /bridge/* here), so it is tested without a server or a kernel.
import {
  BridgeError, CODE_TTL_MS, CONNECTED_MS, EDIT_OPS, MAX_BAD_CODES, POLL_MS, REQUEST_TIMEOUT_MS, formatCode, randomCode, randomHex, sameSecret,
  type AppInfo, type BridgeOp, type BridgeReply, type BridgeRequest, type HelloReply,
} from './wire';

export interface BridgeOptions {
  /** The daemon's port, written into the pairing code. */
  port(): number;
  now?(): number;
  requestTimeoutMs?: number;
  pollMs?: number;
  codeTtlMs?: number;
  connectedMs?: number;
}
export interface BridgeStatus {
  connected: boolean;
  /** The user has allowed the agent to change the document (as the app last said). */
  edit: boolean;
  app: AppInfo | null;
  pairing: { open: boolean; expiresAt: number | null };
  lastSeenMsAgo: number | null;
}

interface Session { token: string; app: AppInfo; edit: boolean; lastSeen: number; polling: number; queue: BridgeRequest[]; wake: Array<() => void> }
interface Waiting { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout>; session: Session }

export class Bridge {
  private code: { value: string; expiresAt: number; bad: number } | null = null;
  private session: Session | null = null;
  private waiting = new Map<string, Waiting>();
  private seq = 0;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly ttl: number;
  private readonly connectedMs: number;
  constructor(private readonly o: BridgeOptions) {
    this.now = o.now ?? Date.now;
    this.timeoutMs = o.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
    this.pollMs = o.pollMs ?? POLL_MS;
    this.ttl = o.codeTtlMs ?? CODE_TTL_MS;
    this.connectedMs = o.connectedMs ?? CONNECTED_MS;
  }

  // ---- the user's side: pairing -------------------------------------------------------------------------------------------

  /** A new one-time code. It ends the current session and any earlier code: the user pairs again on purpose. */
  newCode(): { code: string; expiresAt: number } {
    this.dropSession('the agent asked for a new pairing code');
    const value = randomCode();
    const expiresAt = this.now() + this.ttl;
    this.code = { value, expiresAt, bad: 0 };
    return { code: formatCode(this.o.port(), value), expiresAt };
  }

  /** The app presents the code. A good one is used up and a session starts; a wrong one counts, and too many revoke the code. */
  hello(presented: string, info: AppInfo, edit: boolean): HelloReply {
    const c = this.code;
    if (!c) throw new BridgeError('no_pairing', 'no pairing code is open', 'ask the agent for a new one (bridge_pair)');
    if (this.now() > c.expiresAt) { this.code = null; throw new BridgeError('code_expired', 'the pairing code has expired', 'ask the agent for a new one (bridge_pair)'); }
    if (!sameSecret(presented.replace(/[\s-]/g, '').toUpperCase(), c.value)) {
      if (++c.bad >= MAX_BAD_CODES) this.code = null;
      throw new BridgeError('bad_code', 'that code is not right', this.code ? undefined : 'too many wrong codes: ask the agent for a new one');
    }
    this.code = null;                                    // one time only
    this.dropSession('another app paired');
    const s: Session = { token: randomHex(32), app: { name: String(info.name ?? 'app').slice(0, 80), ...(info.version ? { version: String(info.version).slice(0, 40) } : {}) }, edit: !!edit, lastSeen: this.now(), polling: 0, queue: [], wake: [] };
    this.session = s;
    return { session: s.token, pollMs: this.pollMs };
  }

  isSession(token: string): boolean { return !!this.session && sameSecret(token, this.session.token); }

  // ---- the app's side: poll, reply, bye ------------------------------------------------------------------------------------

  /** Long poll: the requests waiting for the app, or an empty list after `pollMs`. `edit` is the app's current permission. */
  async poll(token: string, edit: boolean, signal?: { aborted: boolean; addEventListener?(t: 'abort', f: () => void): void }): Promise<BridgeRequest[]> {
    const s = this.requireSession(token);
    s.edit = !!edit;
    s.lastSeen = this.now();
    if (signal?.aborted) return [];
    s.polling++;
    try {
      if (!s.queue.length) {
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); s.wake = s.wake.filter((w) => w !== done); resolve(); };
          const timer = setTimeout(done, this.pollMs);
          s.wake.push(done);
          signal?.addEventListener?.('abort', done);
        });
      }
      s.lastSeen = this.now();
      // an aborted poll has no one to read the answer: leave the requests queued for the next one
      return this.session === s && !signal?.aborted ? s.queue.splice(0) : [];
    } finally { s.polling--; }
  }

  reply(token: string, r: BridgeReply): boolean {
    const s = this.requireSession(token);
    s.lastSeen = this.now();
    const w = this.waiting.get(r.id);
    if (!w || w.session !== s) return false;
    this.waiting.delete(r.id);
    clearTimeout(w.timer);
    if (r.ok) w.resolve(r.result);
    else w.reject(new BridgeError(r.error?.code ?? 'app_error', r.error?.message ?? 'the app reported an error', r.error?.hint));
    return true;
  }

  /** The user turned the link off. */
  bye(token: string): void {
    if (this.isSession(token)) this.dropSession('the user turned the agent link off in the app');
  }

  // ---- the agent's side -----------------------------------------------------------------------------------------------------

  status(): BridgeStatus {
    const s = this.session;
    const age = s ? this.now() - s.lastSeen : null;
    return {
      connected: !!s && (s.polling > 0 || age! <= this.connectedMs), edit: !!s?.edit, app: s?.app ?? null,
      pairing: { open: !!this.code && this.now() <= this.code.expiresAt, expiresAt: this.code?.expiresAt ?? null },
      lastSeenMsAgo: age,
    };
  }

  /** Ask the app to do something and wait for its answer. Edits are refused here too when the user has not allowed them. */
  request(op: BridgeOp, args: Record<string, unknown> = {}): Promise<unknown> {
    const st = this.status();
    const s = this.session;
    if (!s || !st.connected) {
      throw new BridgeError('app_not_connected', 'no app is linked', st.pairing.open
        ? 'a pairing code is open: the user pastes it in the app (Settings, Agent link) and turns the link on'
        : 'call bridge_pair, tell the user the code, and ask them to paste it in the app (Settings, Agent link)');
    }
    if (EDIT_OPS.has(op) && !s.edit) {
      throw new BridgeError('edit_not_allowed', 'the user has not allowed the agent to change this document', 'ask the user to tick "Allow the agent to change this document" in Settings, Agent link; reading (app_state, app_screenshot) works without it');
    }
    const id = `r${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        s.queue = s.queue.filter((q) => q.id !== id);
        reject(new BridgeError('app_timeout', `the app did not answer within ${Math.round(this.timeoutMs / 1000)} s`, 'the browser tab may be in the background or busy; try again'));
      }, this.timeoutMs);
      this.waiting.set(id, { resolve, reject, timer, session: s });
      s.queue.push({ id, op, args });
      for (const w of [...s.wake]) w();
    });
  }

  close(): void { this.dropSession('the daemon is stopping'); this.code = null; }

  private requireSession(token: string): Session {
    if (!this.session || !sameSecret(token, this.session.token)) throw new BridgeError('no_session', 'no such session', 'pair again');
    return this.session;
  }
  private dropSession(why: string): void {
    const s = this.session;
    if (!s) return;
    this.session = null;
    for (const [id, w] of this.waiting) if (w.session === s) { clearTimeout(w.timer); this.waiting.delete(id); w.reject(new BridgeError('app_disconnected', `the app link ended: ${why}`)); }
    for (const w of [...s.wake]) w();
  }
}
