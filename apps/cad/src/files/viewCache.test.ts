import { describe, expect, it } from 'vitest';
import {
  canonicalJson, createBuildId, createViewCache, decodeSnapshot, embedSnapshot, embeddedSnapshot, encodeSnapshot, findSnapshot, keepSnapshot, takeEmbedded, memoryViewBackend, pruneViews, recipeKey,
  type ViewData, type ViewSnapshot,
} from './viewCache';

/** Two triangles that share an edge, one face each; the shared vertices have the same normal so they weld. */
function mesh() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  return { positions, normals, triFace: new Int32Array([0, 1]), faceIds: ['F1.top', 'F1.top2'] };
}
const data = (): ViewData => ({
  body: { mesh: mesh(), edges: [{ key: 'e1', pts: [[0, 0, 0], [1, 0, 0]] }], box: { min: [0, 0, 0], max: [1, 1, 0] }, sketches: [], curves: [], planes: [], markers: [],
    surfaces: [{ id: 'S1', mesh: mesh(), edges: [], box: null }] },
  status: [{ id: 'F1', ok: true }, { id: 'F2', ok: false, code: 'nothingToCut', hint: 'x' }],
  extras: { threads: [], warnings: [] }, errors: [['F2', { code: 'nothingToCut' }]], diag: { roots: [], consequences: [], blockedBy: {}, all: [] }, limits: [['F1', 3.5]], components: [],
});
const snap = (key = 'k', build = 'b'): ViewSnapshot => ({ key, build, savedAt: 7, data: data() });
const doc = (extra: Record<string, unknown> = {}) => ({ format: 'ck-part', name: 'P', features: [{ id: 'F1', type: 'sketch', w: 1 }], seq: 2, ...extra });

describe('recipe key', () => {
  it('does not depend on key order, undefined fields, the picture or the fonts', async () => {
    const a = await recipeKey({ name: 'P', features: [{ id: 'F1', a: 1, b: 2 }], x: undefined });
    const b = await recipeKey({ features: [{ b: 2, a: 1, id: 'F1' }], name: 'P', thumbnail: 'data:...', fonts: [{ name: 'f' }] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('changes with any recipe change, including one number and the part name', async () => {
    const base = await recipeKey(doc());
    expect(await recipeKey(doc({ features: [{ id: 'F1', type: 'sketch', w: 1.0000001 }] }))).not.toBe(base);
    expect(await recipeKey(doc({ name: 'Q' }))).not.toBe(base);
    expect(await recipeKey(doc({ variables: { a: '1' } }))).not.toBe(base);
  });
  it('agrees with what a JSON round trip of the file gives', async () => {
    const d = { name: 'P', n: -0, big: 1e21, f: [0.1, 1 / 3], nan: Number.NaN, u: [undefined] };
    expect(await recipeKey(d)).toBe(await recipeKey(JSON.parse(JSON.stringify(d))));
    expect(canonicalJson({ b: 1, a: [1, { d: 1, c: 2 }] })).toBe('{"a":[1,{"c":2,"d":1}],"b":1}');
  });
});

/** Encode as a platform without CompressionStream would. */
async function encodePlain(s: ViewSnapshot): Promise<Uint8Array> {
  const g = globalThis as { CompressionStream?: unknown };
  const saved = g.CompressionStream;
  delete g.CompressionStream;
  try { return await encodeSnapshot(s); } finally { g.CompressionStream = saved; }
}

describe('codec', () => {
  it('round trips the view bit for bit, welded and compressed', async () => {
    const bytes = await encodeSnapshot(snap());
    const back = (await decodeSnapshot(bytes))!;
    expect(back.key).toBe('k'); expect(back.build).toBe('b'); expect(back.savedAt).toBe(7);
    const want = data(), got = back.data as ViewData;
    const m = (got.body as { mesh: ReturnType<typeof mesh> }).mesh;
    expect(m.positions).toBeInstanceOf(Float32Array);
    expect([...m.positions]).toEqual([...(want.body as { mesh: ReturnType<typeof mesh> }).mesh.positions]);
    expect([...m.normals]).toEqual([...(want.body as { mesh: ReturnType<typeof mesh> }).mesh.normals]);
    expect(m.triFace).toBeInstanceOf(Int32Array); expect([...m.triFace]).toEqual([0, 1]);
    expect(m.faceIds).toEqual(['F1.top', 'F1.top2']);
    expect(got.status).toEqual(want.status); expect(got.limits).toEqual([['F1', 3.5]]);
    expect((got.body as { surfaces: Array<{ mesh: unknown }> }).surfaces[0].mesh).toMatchObject({ faceIds: ['F1.top', 'F1.top2'] });
  });
  it('welds shared vertices (4 of 6 here) and stays small', async () => {
    const big = mesh();
    const n = 3000, pos = new Float32Array(n * 9), nrm = new Float32Array(n * 9), tf = new Int32Array(n);
    for (let i = 0; i < n / 2; i++) { pos.set(big.positions.map((v, j) => v + (j % 3 === 0 ? i % 50 : 0)), i * 18); nrm.set(big.normals, i * 18); }
    const d = data(); (d.body as { mesh: unknown }).mesh = { positions: pos, normals: nrm, triFace: tf, faceIds: ['A'] };
    const raw = pos.byteLength + nrm.byteLength;
    const bytes = await encodeSnapshot({ key: 'k', build: 'b', savedAt: 1, data: d });
    expect(bytes.length).toBeLessThan(raw / 4);
    const back = (await decodeSnapshot(bytes))!.data.body as { mesh: { positions: Float32Array } };
    expect([...back.mesh.positions]).toEqual([...pos]);
  });
  it('writes a plain record where the platform has no CompressionStream, and reads it', async () => {
    const plain = await encodePlain(snap());
    expect(plain[5]).toBe(0);
    expect((await encodeSnapshot(snap()))[5]).toBe(1);
    expect((await decodeSnapshot(plain))?.key).toBe('k');
  });
  it('returns null, never throws, for corrupt input', async () => {
    const good = await encodeSnapshot(snap());
    const cases: Uint8Array[] = [
      new Uint8Array(), new Uint8Array(20), good.subarray(0, 7), good.subarray(0, good.length >> 1), good.subarray(0, good.length - 3),
      Uint8Array.from(good, (v, i) => (i === 0 ? v ^ 1 : v)),                  // bad magic
      Uint8Array.from(good, (v, i) => (i === 4 ? 99 : v)),                       // unknown version
      Uint8Array.from(good, (v, i) => (i === 5 ? 0 : v)),                        // flagged plain but gzip inside
      Uint8Array.from(good, (v, i) => (i > 20 && i % 7 === 0 ? v ^ 0x55 : v)),  // damage inside the compressed stream
    ];
    for (const c of cases) expect(await decodeSnapshot(c)).toBeNull();
  });
  it('rejects a mesh whose indices or face numbers point outside', async () => {
    const mk = async (patch: (d: ViewData) => void) => {
      const d = data(); patch(d);
      return decodeSnapshot(await encodeSnapshot({ key: 'k', build: 'b', savedAt: 1, data: d }));
    };
    expect(await mk((d) => { (d.body as { mesh: { triFace: Int32Array } }).mesh.triFace = new Int32Array([0, 5]); })).toBeNull();
    expect(await mk(() => {})).not.toBeNull();
    // a plain record cut short: a section runs past the end
    const plain = await encodePlain(snap());
    expect(await decodeSnapshot(plain.subarray(0, plain.length - 8))).toBeNull();
  });
});

describe('cache', () => {
  it('returns the snapshot only for the same recipe key and kernel build', async () => {
    const be = memoryViewBackend(); const c = createViewCache(be, { now: () => 5 });
    await c.save('K1', 'B1', data());
    expect((await c.lookup('K1', 'B1'))?.savedAt).toBe(5);
    expect(await c.lookup('K1', 'B2')).toBeNull();      // another kernel
    expect(await c.lookup('K2', 'B1')).toBeNull();      // another recipe
  });
  it('a record stored under one key but holding another is not trusted, and is dropped', async () => {
    const be = memoryViewBackend(); const c = createViewCache(be);
    be.items.set('K1', { key: 'K1', build: 'B1', savedAt: 1, bytes: await encodeSnapshot(snap('OTHER', 'B1')) });
    expect(await c.lookup('K1', 'B1')).toBeNull();
    expect(be.items.has('K1')).toBe(false);
  });
  it('a corrupt record is ignored and removed; a failing backend is a miss', async () => {
    const be = memoryViewBackend(); const c = createViewCache(be);
    be.items.set('K', { key: 'K', build: 'B', savedAt: 1, bytes: new Uint8Array([1, 2, 3]) });
    expect(await c.lookup('K', 'B')).toBeNull();
    expect(be.items.size).toBe(0);
    const broken = createViewCache({ get: () => Promise.reject(new Error('x')), put: () => Promise.reject(new Error('x')), all: () => Promise.reject(new Error('x')), remove: () => Promise.reject(new Error('x')) });
    expect(await broken.lookup('K', 'B')).toBeNull();
    await expect(broken.save('K', 'B', data())).resolves.toBeUndefined();
    expect(await createViewCache(null).lookup('K', 'B')).toBeNull();
  });
  it('keeps the newest records and drops over-budget old ones', () => {
    const l = Array.from({ length: 12 }, (_, i) => ({ key: `k${i}`, savedAt: i, size: 10 }));
    expect(pruneViews(l, 8, 1e9).sort()).toEqual(['k0', 'k1', 'k2', 'k3']);
    expect(pruneViews([{ key: 'a', savedAt: 1, size: 100 }, { key: 'b', savedAt: 2, size: 100 }], 8, 50)).toEqual(['a']);   // the newest stays even when it alone is over
  });
  it('prunes on save', async () => {
    const be = memoryViewBackend(); let t = 0; const c = createViewCache(be, { now: () => ++t });
    for (let i = 0; i < 11; i++) await c.save(`K${i}`, 'B', data());
    expect(be.items.size).toBe(8); expect(be.items.has('K10')).toBe(true); expect(be.items.has('K0')).toBe(false);
  });
});

describe('findSnapshot / keepSnapshot', () => {
  const build = (id: string | null) => () => Promise.resolve(id);
  it('a stale snapshot is never returned: edited recipe, other kernel, no kernel id', async () => {
    const be = memoryViewBackend(); const c = createViewCache(be);
    const d = doc();
    await keepSnapshot(c, build('wasm:1'), d, data());
    expect((await findSnapshot(c, build('wasm:1'), d))?.data.status.length).toBe(2);
    expect((await findSnapshot(c, build('wasm:1'), { ...d, fonts: [], thumbnail: 'x' }))).not.toBeNull();   // the picture and fonts are not the recipe
    expect(await findSnapshot(c, build('wasm:1'), doc({ features: [{ id: 'F1', type: 'sketch', w: 2 }] }))).toBeNull();
    expect(await findSnapshot(c, build('wasm:2'), d)).toBeNull();
    expect(await findSnapshot(c, build(null), d)).toBeNull();
  });
  it('nothing is stored without a kernel id or a view', async () => {
    const be = memoryViewBackend(); const c = createViewCache(be);
    await keepSnapshot(c, build(null), doc(), data());
    await keepSnapshot(c, build('b'), doc(), null);
    expect(be.items.size).toBe(0);
  });
  it('the build id is the hash of the wasm bytes, asked once; a failed fetch gives null', async () => {
    let n = 0;
    const id = createBuildId(async () => { n++; return new Uint8Array([1, 2, 3]).buffer; });
    const a = await id(); expect(await id()).toBe(a); expect(n).toBe(1);
    expect(a).toMatch(/^wasm-sha256:[0-9a-f]{64}$/);
    expect(await createBuildId(async () => { throw new Error('offline'); })()).toBeNull();
    expect(await createBuildId(async () => new Uint8Array([1, 2, 4]).buffer)()).not.toBe(a);
  });
});

describe('the view inside the file', () => {
  const build = (id: string | null) => () => Promise.resolve(id);
  it('a view written with a part is read back for exactly that recipe and kernel, and survives JSON', async () => {
    const d = doc();
    const field = JSON.parse(JSON.stringify(await embedSnapshot(build('wasm:1'), d, data())));   // as it goes through the file
    expect(field).toMatchObject({ format: 'ck-view', build: 'wasm:1' });
    const file = JSON.parse(JSON.stringify({ ...d, viewCache: field }));
    const { doc: bare, embedded } = takeEmbedded(file);
    expect('viewCache' in bare).toBe(false);
    const s = await embeddedSnapshot(build('wasm:1'), bare, embedded);
    expect(s?.data.status).toEqual(data().status);
    expect((s?.data.body as { mesh: { positions: Float32Array } }).mesh.positions).toEqual(mesh().positions);
  });
  it('is ignored when the part was edited, the kernel differs, or the field is damaged', async () => {
    const d = doc();
    const field = await embedSnapshot(build('wasm:1'), d, data());
    expect(await embeddedSnapshot(build('wasm:1'), doc({ features: [{ id: 'F1', type: 'sketch', w: 2 }] }), field)).toBeNull();
    expect(await embeddedSnapshot(build('wasm:2'), d, field)).toBeNull();
    expect(await embeddedSnapshot(build(null), d, field)).toBeNull();
    expect(await embeddedSnapshot(build('wasm:1'), d, { ...field, data: 'AAAA' })).toBeNull();
    expect(await embeddedSnapshot(build('wasm:1'), d, { ...field, data: '!!not base64' })).toBeNull();
    expect(await embeddedSnapshot(build('wasm:1'), d, 'junk')).toBeNull();
    expect(await embeddedSnapshot(build('wasm:1'), d, undefined)).toBeNull();
  });
  it('nothing is written without a kernel id or a view; a part with no field passes through', async () => {
    expect(await embedSnapshot(build(null), doc(), data())).toBeNull();
    expect(await embedSnapshot(build('b'), doc(), null)).toBeNull();
    const d = doc();
    expect(takeEmbedded(d)).toEqual({ doc: d, embedded: undefined });
  });
});
