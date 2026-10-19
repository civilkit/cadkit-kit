// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMockService, type MockService } from '@ck/kernel-client/mock';
import { createKernelRouter, loadKernelPrefs, saveKernelPrefs, DEFAULT_KERNEL_URL, chipOf, statusText, type KernelBackend, type KernelRouter } from './kernelService';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), all: () => [...m.entries()] }; };

let services: MockService[] = [];
let routers: KernelRouter[] = [];
afterEach(async () => { routers.forEach((r) => r.dispose()); routers = []; await Promise.all(services.splice(0).map((s) => s.stop())); });

function fixture(opts: { mode?: 'builtin' | 'local'; token?: string; url?: string; svc?: MockService } = {}) {
  const kv = memory();
  const built: KernelBackend[] = [];
  const makeBuiltin = vi.fn(async (): Promise<KernelBackend> => {
    const k: KernelBackend = { commit: 'branch ' + SHA, request: async () => ({ ok: true, result: { from: 'builtin' } }), close: vi.fn() };
    built.push(k);
    return k;
  });
  const notify = vi.fn();
  const reopen = vi.fn();
  if (opts.mode) saveKernelPrefs(kv, { mode: opts.mode, url: opts.url ?? opts.svc?.url ?? DEFAULT_KERNEL_URL, token: opts.token ?? opts.svc?.token ?? '' });
  const router = createKernelRouter({ kv, makeBuiltin, notify, reopen });
  routers.push(router);
  return { kv, router, makeBuiltin, notify, reopen, built };
}
const SHA = '0123456789abcdef0123456789abcdef01234567';
const serve = async (o: Parameters<typeof startMockService>[0] = {}) => { const s = await startMockService({ ...o, version: { build: SHA, git: SHA.slice(0, 12), ...o.version } }); services.push(s); return s; };
const echo = (k: KernelBackend) => k.request({ type: 'who' });

describe('kernel preferences', () => {
  it('default to the built-in kernel and port 7461, and the token is kept apart', () => {
    const kv = memory();
    expect(loadKernelPrefs(kv)).toEqual({ mode: 'builtin', url: 'http://127.0.0.1:7461', token: '' });
    saveKernelPrefs(kv, { mode: 'local', url: 'http://127.0.0.1:9000', token: 'sekrit' });
    expect(loadKernelPrefs(kv)).toEqual({ mode: 'local', url: 'http://127.0.0.1:9000', token: 'sekrit' });
    saveKernelPrefs(kv, { mode: 'local', url: 'http://127.0.0.1:9000', token: '' });
    expect(kv.all().some(([, v]) => v === 'sekrit')).toBe(false);
  });
});

describe('kernel router', () => {
  it('uses the built-in kernel and never touches the network by default', async () => {
    const f = await fixture();
    const k = await f.router.transport();
    expect(await echo(k)).toEqual({ ok: true, result: { from: 'builtin' } });
    expect(f.router.status.value).toEqual({ state: 'builtin' });
    expect(f.router.active.value).toBe('builtin');
  });

  it('connects to a matching service and talks to it', async () => {
    const svc = await serve();
    const f = fixture({ mode: 'local', svc });
    const k = await f.router.transport();
    expect(await echo(k)).toEqual({ ok: true, result: { echo: 'who' } });
    expect(f.router.status.value).toMatchObject({ state: 'connected', version: { kernel: '0.0.0-mock', protocol: 1 } });
    expect(f.router.active.value).toBe('local');
    expect(f.notify).not.toHaveBeenCalled();
    expect(chipOf(f.router.status.value)).toMatchObject({ tone: 'ok' });
  });

  it('refuses a service from another protocol or build, says so, and stays on the built-in kernel', async () => {
    const svc = await serve({ version: { protocol: 99 } });
    const f = fixture({ mode: 'local', svc });
    const k = await f.router.transport();
    expect(await echo(k)).toEqual({ ok: true, result: { from: 'builtin' } });
    expect(f.router.status.value).toMatchObject({ state: 'failed', kind: 'mismatch', midSession: false });
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0][0]).toMatch(/not used.*different kernel build.*protocol 99/);
    expect(svc.sessions.size).toBe(0);
    expect(svc.requests.every((r) => r.path === '/version')).toBe(true);

    const other = await serve({ version: { build: 'ffffffffffff', git: 'ffffffffffff' } });
    const g = fixture({ mode: 'local', svc: other });
    await g.router.transport();
    expect(g.router.status.value).toMatchObject({ state: 'failed', kind: 'mismatch' });
  });

  it('accepts a service whose build is the built-in kernel\'s (short hash)', async () => {
    const svc = await serve({ version: { build: '0123456789ab', git: '0123456789ab' } });
    const f = fixture({ mode: 'local', svc });
    await f.router.transport();
    expect(f.router.status.value.state).toBe('connected');
  });

  it('falls back with a notice when the token is missing, wrong, or the service is not running', async () => {
    const svc = await serve();
    const none = fixture({ mode: 'local', svc, token: '' });
    await none.router.transport();
    expect(none.router.status.value).toMatchObject({ state: 'failed', kind: 'unauthorized' });
    expect(none.notify).toHaveBeenCalledTimes(1);

    const wrong = fixture({ mode: 'local', svc, token: 'not-it' });
    await wrong.router.transport();
    expect(wrong.router.status.value).toMatchObject({ state: 'failed', kind: 'unauthorized' });

    const down = fixture({ mode: 'local', url: svc.url, token: svc.token });
    await svc.stop();
    expect(await echo(await down.router.transport())).toEqual({ ok: true, result: { from: 'builtin' } });
    expect(down.router.status.value).toMatchObject({ state: 'failed', kind: 'unreachable' });
  });

  it('when the service dies under an open document: one notice, the built-in kernel takes over, the app is asked to reopen', async () => {
    const svc = await serve();
    const f = fixture({ mode: 'local', svc });
    const k = await f.router.transport();
    expect((await echo(k)).ok).toBe(true);
    await svc.stop();
    const r = await echo(k);
    expect(r.ok).toBe(false);
    expect(r.trap).toMatch(/local kernel service/);
    expect(f.router.status.value).toMatchObject({ state: 'failed', kind: 'unreachable', midSession: true });
    expect(f.router.active.value).toBe('builtin');
    expect(f.notify).toHaveBeenCalledTimes(1);
    expect(f.notify.mock.calls[0][0]).toMatch(/stopped.*reopened on the built-in kernel/);
    expect(f.reopen).toHaveBeenCalledTimes(1);
    await echo(k);   // a second failing request does not repeat the notice
    expect(f.notify).toHaveBeenCalledTimes(1);
    // the document is reopened on the built-in kernel, not on the dead service
    expect(await echo(await f.router.transport())).toEqual({ ok: true, result: { from: 'builtin' } });
    // it stays there until the user retries
    const svc2 = await serve({ port: Number(new URL(svc.url).port) }).catch(() => null);
    if (svc2) expect((await f.router.transport()).commit).toContain('branch');
  });

  it('a cancelled preview gets a clean session on the service (old one deleted), as the wasm worker restarts', async () => {
    const svc = await serve();
    const f = fixture({ mode: 'local', svc });
    const k = await f.router.transport();
    await echo(k);
    f.router.cancel();
    const k2 = await f.router.transport();
    expect(k2).not.toBe(k);
    expect((await echo(k2)).ok).toBe(true);
    await vi.waitFor(() => expect(svc.deleted).toEqual(['s1']));
    expect([...svc.sessions]).toEqual(['s2']);
    expect(f.router.status.value.state).toBe('connected');
    expect(f.reopen).not.toHaveBeenCalled();
  });

  it('cancel on the built-in kernel restarts it', async () => {
    const f = fixture();
    const k = await f.router.transport();
    f.router.cancel();
    await vi.waitFor(() => expect(k.close).toHaveBeenCalled());
    await f.router.transport();
    expect(f.makeBuiltin).toHaveBeenCalledTimes(2);
  });

  it('switching in Settings reconnects, asks the app to reopen the document, and saves the choice; the token is never in a notice or the status', async () => {
    const svc = await serve();
    const f = fixture();
    await f.router.transport();
    f.router.setPrefs({ url: svc.url, token: svc.token });
    expect(f.reopen).not.toHaveBeenCalled();   // still the built-in kernel: nothing to move
    f.router.setPrefs({ mode: 'local' });
    expect(f.reopen).toHaveBeenCalledTimes(1);
    expect(f.router.status.value).toEqual({ state: 'connecting' });
    expect(f.kv.getItem('cad.kernel.mode')).toBe('local');
    const k = await f.router.transport();
    expect(await echo(k)).toEqual({ ok: true, result: { echo: 'who' } });
    f.router.setPrefs({ mode: 'builtin' });
    expect(f.reopen).toHaveBeenCalledTimes(2);
    expect(await echo(await f.router.transport())).toEqual({ ok: true, result: { from: 'builtin' } });
    await vi.waitFor(() => expect(svc.deleted.length).toBe(1));
    // the token only ever travels as a header
    expect(svc.requests.every((r) => !r.path.includes(svc.token) && !r.body.includes(svc.token))).toBe(true);
    const all = JSON.stringify([f.notify.mock.calls, f.router.status.value, statusText(f.router.status.value)]);
    expect(all).not.toContain(svc.token);
  });

  it('retry after a fallback tries the service again', async () => {
    const svc = await serve();
    const f = fixture({ mode: 'local', svc, token: 'wrong' });
    await f.router.transport();
    expect(f.router.status.value.state).toBe('failed');
    f.router.setPrefs({ token: svc.token });
    expect(f.reopen).toHaveBeenCalledTimes(1);
    await f.router.transport();
    expect(f.router.status.value.state).toBe('connected');
    await svc.stop();
    f.router.retry();
    expect(f.reopen).toHaveBeenCalledTimes(2);
  });

  it('Test connection reports the version or why not, without switching', async () => {
    const svc = await serve();
    const f = fixture();
    const ok = await f.router.test({ url: svc.url, token: svc.token });
    expect(ok).toMatchObject({ ok: true, version: { protocol: 1 } });
    expect(await f.router.test({ url: svc.url, token: 'x' })).toMatchObject({ ok: false, kind: 'unauthorized' });
    expect(await f.router.test({ url: 'http://127.0.0.1:1', token: 'x' })).toMatchObject({ ok: false, kind: 'unreachable' });
    expect(f.router.status.value).toEqual({ state: 'builtin' });
    expect(f.router.active.value).toBe('builtin');
    expect(f.reopen).not.toHaveBeenCalled();
  });
});
