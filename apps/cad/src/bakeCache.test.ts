import { describe, expect, it } from 'vitest';
import { BakeCache, bakeKey, type BakeBackend, type BakeRecord, type BakeValue } from './bakeCache';

const STEP = (n: number): BakeValue => ({ step: `ISO-10303-21;${'x'.repeat(n)}` });
const mesh = (tris = 2): BakeValue => ({ mesh: { positions: new Float32Array(tris * 9).fill(1) } });
const doc = { name: 'Knob', features: [{ id: 'F1', type: 'extrude', depth: 12 }], seq: 2 };

function memoryBackend(): BakeBackend & { rows: Map<string, BakeRecord> } {
  const rows = new Map<string, BakeRecord>();
  return {
    rows,
    async get(k) { return rows.get(k); },
    async put(r) { rows.set(r.key, r); },
    async all() { return [...rows.values()].map(({ key, build, at, size }) => ({ key, build, at, size })); },
    async remove(ks) { for (const k of ks) rows.delete(k); },
  };
}

describe('bake cache key', () => {
  it('is the same for equal inputs, whatever the order of the fields', async () => {
    const a = await bakeKey(doc, 'step', 'b1');
    expect(await bakeKey({ seq: 2, features: [{ type: 'extrude', depth: 12, id: 'F1' }], name: 'Knob' }, 'step', 'b1')).toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes with the document, a feature number, the name, what is wanted and the kernel build', async () => {
    const a = await bakeKey(doc, 'step', 'b1');
    const keys = await Promise.all([
      bakeKey({ ...doc, features: [{ id: 'F1', type: 'extrude', depth: 12.5 }] }, 'step', 'b1'),
      bakeKey({ ...doc, features: [...doc.features, { id: 'F2', type: 'cut' }] }, 'step', 'b1'),
      bakeKey({ ...doc, name: 'Other' }, 'step', 'b1'),
      bakeKey({ ...doc, variables: { W: 3 } }, 'step', 'b1'),
      bakeKey(doc, 'mesh', 'b1'),
      bakeKey(doc, 'step', 'b2'),
    ]);
    expect(new Set([a, ...keys]).size).toBe(7);
  });
  it('is null when the kernel build is unknown, so nothing is cached', async () => {
    expect(await new BakeCache({ build: async () => null }).key(doc, 'step')).toBeNull();
    expect(await new BakeCache({ build: async () => { throw new Error('x'); } }).key(doc, 'step')).toBeNull();
  });
});

describe('bake cache memory', () => {
  it('keeps the latest few entries and drops the least recently used', async () => {
    const c = new BakeCache({ build: async () => 'b', memEntries: 3 });
    for (const k of ['a', 'b', 'c']) await c.put(k, STEP(10));
    expect(await c.get('a')).not.toBeNull();   // a is now the most recent
    await c.put('d', STEP(10));
    expect(c.memoryKeys).toEqual(['c', 'a', 'd']);
    expect(await c.get('b')).toBeNull();
  });
  it('keeps within the byte cap but never drops the newest entry', async () => {
    const c = new BakeCache({ build: async () => 'b', memBytes: 1000 });
    await c.put('a', STEP(300));
    await c.put('b', STEP(300));
    expect(c.memoryKeys).toEqual(['b']);
    await c.put('big', STEP(5000));
    expect(c.memoryKeys).toEqual(['big']);
  });
  it('refuses a malformed value (never stores a failure)', async () => {
    const c = new BakeCache({ build: async () => 'b' });
    await c.put('x', {});
    await c.put('y', { step: 'not a step file' });
    await c.put('z', { mesh: { positions: new Float32Array(4) } });
    expect(c.memoryKeys).toEqual([]);
  });
});

describe('bake cache storage', () => {
  it('survives a new cache over the same backend (a reload) and returns the same bytes', async () => {
    const backend = memoryBackend();
    await new BakeCache({ build: async () => 'b', backend }).put('k', mesh(3));
    const again = new BakeCache({ build: async () => 'b', backend });
    expect(again.memoryKeys).toEqual([]);
    expect([...(await again.get('k'))!.mesh!.positions]).toEqual([...mesh(3).mesh!.positions]);
    expect(again.memoryKeys).toEqual(['k']);
  });
  it('drops records of another kernel build, on read and when something is stored', async () => {
    const backend = memoryBackend();
    await new BakeCache({ build: async () => 'old', backend }).put('k', STEP(10));
    expect(await new BakeCache({ build: async () => 'new', backend }).get('k')).toBeNull();
    expect(backend.rows.size).toBe(0);
    await new BakeCache({ build: async () => 'old', backend }).put('k1', STEP(10));
    await new BakeCache({ build: async () => 'new', backend }).put('k2', STEP(10));
    expect([...backend.rows.keys()]).toEqual(['k2']);
  });
  it('caps the stored entries and bytes, oldest first', async () => {
    const backend = memoryBackend();
    let t = 0;
    const c = new BakeCache({ build: async () => 'b', backend, diskEntries: 2, now: () => ++t });
    for (const k of ['a', 'b', 'c']) await c.put(k, STEP(10));
    expect([...backend.rows.keys()].sort()).toEqual(['b', 'c']);
    const d = new BakeCache({ build: async () => 'b', backend: memoryBackend(), diskBytes: 100 });
    await d.put('big', STEP(500));
    expect(await (d as unknown as { o: { backend: BakeBackend } }).o.backend.all()).toEqual([]);
    expect(await d.get('big')).not.toBeNull();   // still in memory
  });
  it('works as memory only when the storage throws', async () => {
    const boom = async () => { throw new Error('storage unavailable'); };
    const backend: BakeBackend = { get: boom, put: boom, all: boom, remove: boom };
    const c = new BakeCache({ build: async () => 'b', backend });
    await expect(c.put('k', STEP(10))).resolves.toBeUndefined();
    expect(await c.get('k')).not.toBeNull();
    expect(await new BakeCache({ build: async () => 'b', backend }).get('k')).toBeNull();
    await expect(c.clear()).resolves.toBeUndefined();
    expect(c.memoryKeys).toEqual([]);
  });
  it('ignores a stored record that is damaged', async () => {
    const backend = memoryBackend();
    backend.rows.set('k', { key: 'k', build: 'b', at: 1, size: 1, value: { step: 'junk' } });
    expect(await new BakeCache({ build: async () => 'b', backend }).get('k')).toBeNull();
  });
});
