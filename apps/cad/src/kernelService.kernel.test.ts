// @vitest-environment node
// The app against a (mock) local kernel service with the real kernel behind it, and the fallback to the built-in kernel (needs CK_WASM).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startMockService, type MockService } from '@ck/kernel-client/mock';
import { createWorkerKernel } from '@ck/kernel-client/node';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from './controller';
import { createKernelRouter, saveKernelPrefs, type KernelBackend } from './kernelService';

const WASM = process.env.CK_WASM!;
const sq = (id: string, w: number) => ({ type: 'sketch', id, plane: { kind: 'std', id: 'front' },
  points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: w, y: 0 }, { id: 'p3', x: w, y: w }, { id: 'p4', x: 0, y: w }],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] });
const doc = (): PartDoc => ({ ...emptyPart('Cube'), features: [sq('F1', 10), { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }], seq: 3 }) as unknown as PartDoc;

let svc: MockService | null = null;
const closers: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const c of closers.splice(0)) await c(); await svc?.stop(); svc = null; });

describe('app on a local kernel service', { skip: !WASM, timeout: 120000 }, () => {
  it('opens and edits on the service, then moves to the built-in kernel when the service dies, keeping the document and its history', async () => {
    const probe = await createWorkerKernel(WASM);
    const commit = probe.commit;
    await probe.close();
    svc = await startMockService({ wasmPath: WASM, version: { build: commit, git: commit } });
    const kv = new Map<string, string>();
    const storage = { getItem: (k: string) => kv.get(k) ?? null, setItem: (k: string, v: string) => void kv.set(k, v), removeItem: (k: string) => void kv.delete(k) };
    saveKernelPrefs(storage, { mode: 'local', url: svc.url, token: svc.token });
    const notices: string[] = [];
    const sessions: Session[] = [];
    let controller!: Controller;
    const router = createKernelRouter({
      kv: storage,
      makeBuiltin: async () => { const k = await createWorkerKernel(WASM); closers.push(() => k.close()); return k as unknown as KernelBackend; },
      notify: (text) => notices.push(text),
      reopen: () => { void controller.cancel(); },
    });
    closers.push(() => router.dispose());
    const kernel: KernelFactory = { async open(d) { const s = new Session(d, await router.transport(), 'user'); sessions.push(s); return s; }, cancel: () => router.cancel() };
    controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });

    await controller.load(doc());
    expect(router.status.value.state).toBe('connected');
    expect(svc.sessions.size).toBe(1);
    const r1 = await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 20 }]);
    expect(r1.ok).toBe(true);
    expect(controller.history()).toHaveLength(1);
    const rpcs = svc.requests.filter((r) => r.path.endsWith('/rpc')).length;
    expect(rpcs).toBeGreaterThan(0);   // the kernel work went through the service

    await svc.stop();
    const r2 = await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 30 }]);
    expect(r2.ok).toBe(false);
    await vi.waitFor(() => expect(router.active.value).toBe('builtin'));
    await vi.waitFor(() => expect(sessions.length).toBeGreaterThanOrEqual(2));
    await vi.waitFor(() => expect(controller.history()).toHaveLength(1));
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/reopened on the built-in kernel/);
    expect(router.status.value).toMatchObject({ state: 'failed', midSession: true });

    // the document is what it was before the failed edit, and the built-in kernel carries on from there
    const f2 = (controller.document()!.features as unknown as Array<{ id: string; depth?: number }>).find((f) => f.id === 'F2')!;
    expect(f2.depth).toBe(20);
    const r3 = await controller.edit([{ op: 'set', id: 'F2', path: 'depth', value: 5 }]);
    expect(r3.ok).toBe(true);
    expect(controller.history()).toHaveLength(2);
    expect(sessions.at(-1)).toBe((controller as unknown as { session: Session }).session);
  });
});
