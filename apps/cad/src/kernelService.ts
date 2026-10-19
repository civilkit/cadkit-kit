// Which kernel the app talks to: the built-in one (wasm in a worker) or a local native kernel service (docs/local-kernel-service.md).
//
// The router owns the choice, the connection and the fallback:
//  - `transport()` is the kernel the next session is opened on; it connects lazily, checks the service's version against what this
//    app was built with, and uses the built-in kernel when the service is missing or from another build (and says so).
//  - A service that fails in the middle of work (gone, token rejected, session expired, no reply) is reported once; the router
//    switches to the built-in kernel, tells the user, and asks the app to reopen the document there (`reopen`). Two kernels are never
//    mixed inside one document: the session that was talking to the service is replaced, not continued.
//  - The token lives in localStorage only. It is sent as a request header by NativeKernel and appears in no message, URL or log.
import { signal, type Signal } from '@preact/signals-core';
import type { KernelTransport } from '@ck/driver-verify';
import { t } from './i18n';
import { NativeKernel, NativeConnectError, normalizeServiceUrl, probeService, KERNEL_PROTOCOL, type NativeFailure, type NativeOptions, type ServiceVersion } from '@ck/kernel-client/native';

export type KernelMode = 'builtin' | 'local';
export const DEFAULT_KERNEL_URL = 'http://127.0.0.1:7461';

export interface KernelPrefs { mode: KernelMode; url: string; token: string }
export const DEFAULT_KERNEL_PREFS: KernelPrefs = { mode: 'builtin', url: DEFAULT_KERNEL_URL, token: '' };

const MODE_KEY = 'cad.kernel.mode';
const URL_KEY = 'cad.kernel.url';
const TOKEN_KEY = 'cad.kernel.token';
type KV = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function loadKernelPrefs(kv: KV | null): KernelPrefs {
  try {
    const mode = kv?.getItem(MODE_KEY);
    return {
      mode: mode === 'local' ? 'local' : 'builtin',
      url: kv?.getItem(URL_KEY) || DEFAULT_KERNEL_URL,
      token: kv?.getItem(TOKEN_KEY) ?? '',
    };
  } catch { return DEFAULT_KERNEL_PREFS; }
}
export function saveKernelPrefs(kv: KV | null, p: KernelPrefs): void {
  try {
    kv?.setItem(MODE_KEY, p.mode);
    kv?.setItem(URL_KEY, p.url);
    if (p.token) kv?.setItem(TOKEN_KEY, p.token); else kv?.removeItem(TOKEN_KEY);
  } catch { /* private window: the choice holds for this session only */ }
}

export type FailKind = 'unreachable' | 'unauthorized' | 'expired' | 'timeout' | 'bad-reply' | 'mismatch' | 'invalid';

export type KernelStatus =
  /** the built-in kernel, by choice */
  | { state: 'builtin' }
  | { state: 'connecting' }
  | { state: 'connected'; version: ServiceVersion }
  /** the service could not be used (or stopped working); the built-in kernel is in use instead */
  | { state: 'failed'; kind: FailKind; detail: string; midSession: boolean };

export type TestOutcome = { ok: true; version: ServiceVersion } | { ok: false; kind: FailKind; detail: string };

/** A kernel the router can hand out. The built-in one is the module-worker client; the service one is NativeKernel. */
export interface KernelBackend extends KernelTransport {
  readonly commit: string;
  close(): Promise<void> | void;
  /** drop what is in flight (a cancelled preview) */
  cancel?(): void;
}

export interface RouterDeps {
  kv: KV | null;
  makeBuiltin(): Promise<KernelBackend>;
  /** the handshake; defaults to NativeKernel.connect (tests inject their own) */
  connect?(o: NativeOptions): Promise<NativeKernel>;
  /** a notice for the user (already translated) */
  notify(text: string, level: 'info' | 'warn' | 'error'): void;
  /** the kernel under the open document changed: reopen the document on `transport()` (the app runs its cancel/restore path, which keeps undo history) */
  reopen(): void;
  /** wraps every backend the router hands out (the app adds its cache cap) */
  wrap?<K extends KernelBackend>(k: K): K;
}

export interface KernelRouter {
  readonly status: Signal<KernelStatus>;
  readonly prefs: Signal<KernelPrefs>;
  /** which kernel the open sessions use right now */
  readonly active: Signal<KernelMode>;
  /** the kernel to open the next session on */
  transport(): Promise<KernelBackend>;
  /** a cancelled preview: drop in-flight work and start from a clean kernel state (same as restarting the wasm worker) */
  cancel(): void;
  /** change the choice; a change of mode, address or token reconnects and has the app reopen the document */
  setPrefs(patch: Partial<KernelPrefs>): void;
  /** try the service with these values (default: the saved ones) without switching to it */
  test(p?: Partial<Pick<KernelPrefs, 'url' | 'token'>>): Promise<TestOutcome>;
  /** try the service again after a fallback */
  retry(): void;
  /** the page is closing: delete the session on the service */
  dispose(): void;
}

const kindOf = (k: string): FailKind => (['unreachable', 'unauthorized', 'expired', 'timeout', 'bad-reply', 'mismatch', 'invalid'] as const).find((x) => x === k) ?? 'unreachable';

export function createKernelRouter(d: RouterDeps): KernelRouter {
  const wrap = d.wrap ?? (<K extends KernelBackend>(k: K) => k);
  const connect = d.connect ?? ((o: NativeOptions) => NativeKernel.connect(o));
  const prefs = signal<KernelPrefs>(loadKernelPrefs(d.kv));
  const status = signal<KernelStatus>(prefs.value.mode === 'local' ? { state: 'connecting' } : { state: 'builtin' });
  const active = signal<KernelMode>('builtin');

  let builtinP: Promise<KernelBackend> | null = null;
  const builtin = (): Promise<KernelBackend> => (builtinP ??= d.makeBuiltin().then(wrap));
  /** the service backend in use, with what is needed to start a fresh session on the same service */
  let native: { k: NativeKernel; opts: NativeOptions; wrapped: KernelBackend } | null = null;
  let current: Promise<KernelBackend> | null = null;
  /** after a failure the router stays on the built-in kernel until the user retries or changes the settings */
  let fellBack = false;
  let epoch = 0;

  const nativeOptions = (p: KernelPrefs, build: string, onFailure: (f: NativeFailure) => void): NativeOptions =>
    ({ url: p.url, token: p.token, expect: { protocol: KERNEL_PROTOCOL, ...(build ? { build } : {}) }, onFailure });

  async function create(): Promise<KernelBackend> {
    const p = prefs.value;
    const my = epoch;
    if (p.mode !== 'local' || fellBack) {
      active.value = 'builtin';
      if (p.mode !== 'local') status.value = { state: 'builtin' };
      return builtin();
    }
    status.value = { state: 'connecting' };
    const fallback = (kind: FailKind, detail: string): Promise<KernelBackend> => {
      if (my !== epoch) return builtin();
      active.value = 'builtin';
      fellBack = true;
      status.value = { state: 'failed', kind, detail, midSession: false };
      d.notify(t('kernel.notice.refused', { reason: failText(kind, detail) }), 'warn');
      return builtin();
    };
    if (!p.token) return fallback('unauthorized', '');
    try { normalizeServiceUrl(p.url); } catch (e) { return fallback('invalid', (e as Error).message); }
    let build = '';
    try { build = (await builtin()).commit; } catch { /* the service may still be usable; the build is then not compared */ }
    const failure = (f: NativeFailure) => onNativeFailure(my, f);
    const opts = nativeOptions(p, build, failure);
    try {
      const k = await connect(opts);
      if (my !== epoch) { void k.close(); return builtin(); }
      const wrapped = wrap(k as unknown as KernelBackend);
      native = { k, opts, wrapped };
      active.value = 'local';
      status.value = { state: 'connected', version: k.version! };
      return wrapped;
    } catch (e) {
      const kind = e instanceof NativeConnectError ? kindOf(e.kind) : 'unreachable';
      return fallback(kind, e instanceof NativeConnectError ? e.message : '');
    }
  }

  /** The service stopped working under an open document. */
  function onNativeFailure(forEpoch: number, f: NativeFailure): void {
    if (forEpoch !== epoch || fellBack) return;
    fellBack = true;
    active.value = 'builtin';
    const old = native; native = null;
    void old?.k.close();
    status.value = { state: 'failed', kind: kindOf(f.kind), detail: f.message, midSession: true };
    current = builtin();
    d.notify(t('kernel.notice.fallback', { reason: failText(kindOf(f.kind), f.message) }), 'warn');
    d.reopen();
  }

  const reset = () => {
    epoch++;
    const old = native; native = null;
    void old?.k.close();
    current = null;
  };

  const router: KernelRouter = {
    status, prefs, active,
    transport: () => (current ??= create()),
    cancel() {
      if (!current) return;   // nothing handed out yet (the settings just changed): the next open starts clean anyway
      if (native) {
        // a clean state on the same service: close the old session (aborts what is in flight) and let the next open start a new one
        const { k, opts } = native;
        void k.close();
        const fresh = new NativeKernel(opts);
        fresh.version = k.version;
        const wrapped = wrap(fresh as unknown as KernelBackend);
        native = { k: fresh, opts, wrapped };
        current = Promise.resolve(wrapped);
        return;
      }
      const old = builtinP; builtinP = null; current = null;
      void old?.then((k) => k.close());
    },
    setPrefs(patch) {
      const before = prefs.value;
      const next = { ...before, ...patch };
      if (next.url !== before.url) next.url = next.url.trim();
      prefs.value = next;
      saveKernelPrefs(d.kv, next);
      const changed = next.mode !== before.mode || (next.mode === 'local' && (next.url !== before.url || next.token !== before.token));
      if (!changed) return;
      fellBack = false;
      reset();
      if (next.mode === 'builtin') { const old = builtinP; builtinP = null; void old?.then((k) => k.close()); }   // a clean built-in kernel for the document
      status.value = next.mode === 'local' ? { state: 'connecting' } : { state: 'builtin' };
      active.value = 'builtin';
      d.reopen();
    },
    async test(p) {
      const cur = prefs.value;
      const url = p?.url ?? cur.url, token = p?.token ?? cur.token;
      let build = '';
      try { build = (await builtin()).commit; } catch { /* compare the protocol only */ }
      const r = await probeService({ url, token, expect: { protocol: KERNEL_PROTOCOL, ...(build ? { build } : {}) } });
      return r.ok ? { ok: true, version: r.version } : { ok: false, kind: kindOf(r.kind), detail: r.message };
    },
    dispose() { const old = native; native = null; void old?.k.close(); },
    retry() {
      if (prefs.value.mode !== 'local') return;
      fellBack = false;
      reset();
      status.value = { state: 'connecting' };
      d.reopen();
    },
  };
  return router;
}

/** The reason a service was not used or stopped, in the user's language. `detail` is the service's own words (only the mismatch carries one worth showing). */
export function failText(kind: FailKind, detail = ''): string {
  switch (kind) {
    case 'unreachable': return t('kernel.fail.unreachable');
    case 'unauthorized': return t('kernel.fail.unauthorized');
    case 'expired': return t('kernel.fail.expired');
    case 'timeout': return t('kernel.fail.timeout');
    case 'bad-reply': return t('kernel.fail.badReply');
    case 'mismatch': return t('kernel.fail.mismatch', { detail });
    case 'invalid': return t('kernel.fail.invalid');
  }
}

/** One line for the Settings tab. */
export function statusText(s: KernelStatus): string {
  switch (s.state) {
    case 'builtin': return t('kernel.status.builtin');
    case 'connecting': return t('kernel.status.connecting');
    case 'connected': return t('kernel.status.connected', { version: s.version.kernel || '?', protocol: s.version.protocol, cores: s.version.cores });
    case 'failed': return t(s.midSession ? 'kernel.status.stopped' : 'kernel.status.refused', { reason: failText(s.kind, s.detail) });
  }
}

/** The footer chip: a dot-and-word value and its tone. */
export function chipOf(s: KernelStatus): { value: string; tone: 'ok' | 'warn' | 'err' } {
  switch (s.state) {
    case 'builtin': return { value: '\u25CF ' + t('kernel.chip.builtin'), tone: 'ok' };
    case 'connecting': return { value: '\u25CF ' + t('kernel.chip.connecting'), tone: 'warn' };
    case 'connected': return { value: '\u25CF ' + t('kernel.chip.local', { version: s.version.kernel || '?' }), tone: 'ok' };
    case 'failed': return { value: '\u25CF ' + t('kernel.chip.fallback'), tone: 'err' };
  }
}
