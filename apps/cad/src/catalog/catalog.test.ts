import { describe, expect, it, vi } from 'vitest';
import { en } from '../locales/en';
import { circleCentre, faceInfos, rayFrontPlane, raycast, snapCandidates, snapTo, type MeshArrays } from './geometry';
import { CATALOG, buildShape, catalogItem, defaultSize, holeSizeFor } from './shapes';
import { Placer, type PlacerDeps } from './placer';
import { onShapeSelected, selectShapeFeature, setShapeSelector } from './state';

/** A 10 x 10 flat face at z = 10 (two triangles, normal +z), plus a curved "face" C whose vertex normals differ. */
const mesh = (): MeshArrays => ({
  positions: new Float32Array([0, 0, 10, 10, 0, 10, 10, 10, 10, 0, 0, 10, 10, 10, 10, 0, 10, 10, 20, 0, 0, 21, 0, 0, 20, 1, 0]),
  normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0.8, 0.6, 0, 0.8, -0.6, 0]),
  triFace: new Int32Array([0, 0, 1]),
  faceIds: ['T', 'C'],
});
const edges = [
  { key: 'e1', faces: ['T', 'S'], mid: [5, 0, 10], pts: [[0, 0, 10], [10, 0, 10]] },
  { key: 'e2', faces: ['T', 'S2'], mid: [10, 5, 10], pts: [[10, 0, 10], [10, 10, 10]] },
];

describe('catalog geometry', () => {
  it('face facts: flat and curved faces, centre and extent', () => {
    const f = faceInfos(mesh());
    expect(f.get('T')).toMatchObject({ planar: true, normal: [0, 0, 1] });
    expect(f.get('T')!.centroid.map(Math.round)).toEqual([5, 5, 10]);
    expect(f.get('T')!.extent.map(Math.round)).toEqual([10, 10]);
    expect(f.get('C')!.planar).toBe(false);
  });
  it('a ray finds the first face and its point', () => {
    const h = raycast(mesh(), [2, 3, 50], [0, 0, -1])!;
    expect(h.face).toBe('T');
    expect(h.point).toEqual([2, 3, 10]);
    expect(raycast(mesh(), [-5, -5, 50], [0, 0, -1])).toBeNull();
  });
  it('snaps to a corner, a midpoint, the centre; the stronger kind wins a tie; nothing beyond the tolerance', () => {
    const c = snapCandidates(faceInfos(mesh()).get('T')!, edges);
    expect(snapTo([0.3, 0.2, 10], c, 1)?.kind).toBe('vertex');
    expect(snapTo([5.2, 0.3, 10], c, 1)).toMatchObject({ kind: 'midpoint', point: [5, 0, 10] });
    expect(snapTo([5.3, 4.8, 10], c, 1)?.kind).toBe('center');
    expect(snapTo([3, 3, 10], c, 1)).toBeNull();
  });
  it('the centre of a circular edge (a hole rim) is a snap point', () => {
    const pts = Array.from({ length: 33 }, (_, i) => [5 + 2 * Math.cos((i / 32) * 2 * Math.PI), 5 + 2 * Math.sin((i / 32) * 2 * Math.PI), 10]);
    expect(circleCentre(pts)!.map((v) => Math.round(v * 1000) / 1000)).toEqual([5, 5, 10]);
    expect(circleCentre([[0, 0, 0], [1, 0, 0], [2, 0, 0]])).toBeNull();
  });
  it('ground: a ray meets the Front plane', () => {
    expect(rayFrontPlane([1, 2, 10], [0, 0, -1])).toEqual([1, 2, 0]);
    expect(rayFrontPlane([1, 2, 10], [0, 0, 1])).toBeNull();
  });
});

describe('catalog shapes', () => {
  it('every item has a name, a tip and a unique id; adds first, removes second', () => {
    expect(new Set(CATALOG.map((c) => c.id)).size).toBe(CATALOG.length);
    for (const c of CATALOG) { expect(en['catalog.item.' + c.id]).toBeTruthy(); expect(en['catalog.tip.' + c.id]).toBeTruthy(); }
    const ops = CATALOG.map((c) => c.op);
    expect(ops.indexOf('cut')).toBe(ops.filter((o) => o === 'add').length);
  });
  it('size follows the face: 40% of its smaller side, 30 for the ground', () => {
    expect(defaultSize({ kind: 'face', extent: [80, 60] })).toBe(25);
    expect(defaultSize({ kind: 'face', extent: [10, 10] })).toBe(4);
    expect(defaultSize({ kind: 'ground' })).toBe(30);
    expect(holeSizeFor('simple', 25)).toBe('M6');
  });
  it('the ids are chosen up front: a sketch then the shape feature; a curved face adds a tangent plane first', () => {
    const flat = buildShape(catalogItem('add-block')!, { kind: 'face', face: 'F2.C1', planar: true, frame: { o: [0, 0, 20], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }, point: [10, 20, 20], extent: [80, 60] }, 3);
    expect('error' in flat).toBe(false);
    if ('error' in flat) return;
    expect(flat.ops.map((o) => (o as unknown as { feature: { type: string; id: string } }).feature.id)).toEqual(['F3', 'F4']);
    expect(flat.mainId).toBe('F4');
    const sk = (flat.ops[0] as unknown as { feature: { plane: unknown; points: Array<{ id: string; x: number; y: number }> } }).feature;
    expect(sk.plane).toEqual({ kind: 'face', id: 'F2.C1' });
    expect(sk.points.find((p) => p.id === 'p1')).toMatchObject({ x: -2.5, y: 7.5 });   // 10 - 25/2, 20 - 25/2
    const curved = buildShape(catalogItem('hole')!, { kind: 'face', face: 'F2.S.e1', planar: false, point: [1, 2, 3], extent: [80, 60] }, 3);
    if ('error' in curved) throw new Error('unexpected');
    expect(curved.ops.map((o) => (o as unknown as { feature: { type: string } }).feature.type)).toEqual(['plane', 'sketch', 'hole']);
  });
  it('removing shapes need a body; a flat face without a frame is refused', () => {
    expect(buildShape(catalogItem('cut-pocket')!, { kind: 'ground', point: [0, 0, 0] }, 1)).toEqual({ error: 'needsBody' });
    expect(buildShape(catalogItem('add-block')!, { kind: 'face', face: 'F', planar: true, point: [0, 0, 0] }, 1)).toEqual({ error: 'noFrame' });
  });
});

function fakeDeps(over: Partial<PlacerDeps> = {}) {
  const frame = { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
  const calls = { preview: [] as unknown[][], commit: [] as unknown[][], cancel: 0, fade: [] as boolean[] };
  const deps: PlacerDeps = {
    document: () => ({ seq: 3, features: [{}, {}] }) as never,
    hasSolid: () => true,
    bodyFaces: () => mesh(),
    bodyEdges: () => edges,
    bodyBox: () => ({ min: [0, 0, 0], max: [10, 10, 10] }),
    preview: async (ops) => { calls.preview.push(ops); return { ok: true, sketches: [{ id: 'F3', frame }] }; },
    cancelPreview: async () => { calls.cancel++; },
    commit: async (ops, reason) => { calls.commit.push([ops, reason]); return { ok: true }; },
    rayAt: (x, y) => ({ o: [x, y, 50], d: [0, 0, -1] }),
    worldPerPixel: () => 0.05,
    setFade: (on) => { calls.fade.push(on); },
    holdView: () => {},
    ...over,
  };
  return { deps, calls };
}
const flush = () => new Promise((r) => setTimeout(r, 10));

describe('Placer', () => {
  it('hover resolves the face, snaps, previews the real features and shows the part translucent', async () => {
    const { deps, calls } = fakeDeps();
    const seen: unknown[] = [];
    const p = new Placer(deps, (s) => seen.push(s));
    p.hover(catalogItem('add-cylinder')!, 0.2, 0.1, false);
    await flush();
    expect(p.status).toMatchObject({ state: 'ready', face: 'T', snap: 'vertex' });
    expect(calls.preview.length).toBe(2);                   // the probe for the face frame, then the shape
    expect(calls.fade).toContain(true);
    p.hover(catalogItem('add-cylinder')!, 0.2, 0.1, false);  // same spot: nothing new
    await flush();
    expect(calls.preview.length).toBe(2);
  });
  it('Alt turns snapping off', async () => {
    const { deps } = fakeDeps();
    const p = new Placer(deps);
    p.hover(catalogItem('add-block')!, 0.2, 0.1, true);
    await flush();
    expect(p.status).toMatchObject({ state: 'ready', snap: null });
  });
  it('drop commits ONE edit with the shape at the snapped spot, and leaves nothing previewed', async () => {
    const { deps, calls } = fakeDeps();
    const p = new Placer(deps);
    const id = await p.drop(catalogItem('hole')!, 5.1, 4.9, false);
    expect(id).toBe('F4');
    expect(calls.commit.length).toBe(1);
    const ops = calls.commit[0][0] as Array<{ feature: { type: string; points?: Array<{ id: string; x: number; y: number }> } }>;
    expect(ops.map((o) => o.feature.type)).toEqual(['sketch', 'hole']);
    expect(ops[0].feature.points!.find((q) => q.id === 'P1')).toMatchObject({ x: 5, y: 5 });   // snapped to the face centre
    expect(String(calls.commit[0][1])).toContain('Hole');
    expect(p.status.state).toBe('idle');
  });
  it('blocked: a cut with no body, a drop beside the part; Esc (end) drops the preview', async () => {
    const none = fakeDeps({ hasSolid: () => false, bodyFaces: () => null });
    const p0 = new Placer(none.deps);
    expect(await p0.drop(catalogItem('hole')!, 1, 1, false)).toBeNull();
    expect(none.calls.commit.length).toBe(0);
    const { deps, calls } = fakeDeps();
    const p = new Placer(deps);
    expect(await p.drop(catalogItem('add-block')!, 99, 99, false)).toBeNull();
    p.hover(catalogItem('add-block')!, 5, 5, false);
    await flush();
    await p.end();
    expect(calls.cancel).toBeGreaterThan(0);
    expect(calls.fade.at(-1)).toBe(false);
  });
  it('the first body: dropped on empty space it goes on the Front plane', async () => {
    const { deps, calls } = fakeDeps({ hasSolid: () => false, bodyFaces: () => null, rayAt: () => ({ o: [4, 6, 50], d: [0, 0, -1] }) });
    const p = new Placer(deps);
    expect(await p.drop(catalogItem('add-block')!, 1, 1, false)).toBe('F4');
    const ops = calls.commit[0][0] as Array<{ feature: { plane?: unknown } }>;
    expect(ops[0].feature.plane).toEqual({ kind: 'std', id: 'front' });
  });
});

describe('selectShapeFeature hook', () => {
  it('calls the registered selector and every listener with the feature id', () => {
    const sel = vi.fn(), l = vi.fn();
    const off = setShapeSelector(sel), off2 = onShapeSelected(l);
    selectShapeFeature('F9');
    expect(sel).toHaveBeenCalledWith('F9');
    expect(l).toHaveBeenCalledWith('F9');
    off(); off2();
    selectShapeFeature('F10');
    expect(sel).toHaveBeenCalledTimes(1);
  });
});
