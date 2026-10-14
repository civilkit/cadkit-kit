import { describe, expect, it } from 'vitest';
import { fetchSurfaces, hasSurfaceFeatures, makesSurface, mergedView, surfaceNames, toViewSurfaces, withSurfaces } from './surfaceView';

const body = (faces: string[], tris: number[]) => ({
  faces: faces.map((id) => ({ id })),
  edges: [{ key: `${faces[0]}|x#0`, pts: [[0, 0, 0], [1, 0, 0]] }],
  box: { min: [0, 0, 5], max: [2, 2, 6] },
  mesh: { positions: { data: new Float32Array(tris.length * 9) }, normals: { data: new Float32Array(tris.length * 9) }, triFace: { data: Int32Array.from(tris) } },
});

describe('which features make a surface body', () => {
  it('the surface features do; solids, sketches and a solid knit do not', () => {
    for (const type of ['surfacePlanar', 'surfaceExtrude', 'surfaceRevolve', 'surfaceOffset', 'trimSurface', 'fill', 'extend', 'pipeCut', 'deleteFace']) expect(makesSurface({ type })).toBe(true);
    expect(makesSurface({ type: 'knit', solid: false })).toBe(true);
    expect(makesSurface({ type: 'knit', solid: true })).toBe(false);
    expect(makesSurface({ type: 'sweep', surface: true })).toBe(true);
    for (const type of ['sketch', 'extrude', 'fillet', 'thread', 'sweep', 'loft']) expect(makesSurface({ type })).toBe(false);
    expect(hasSurfaceFeatures([{ type: 'sketch' }, { type: 'extrude' }])).toBe(false);
    expect(hasSurfaceFeatures([{ type: 'sketch' }, { type: 'surfacePlanar' }])).toBe(true);
  });
});

describe('toViewSurfaces', () => {
  it('turns the kernel pairs (with decoded buffers) into view surfaces', () => {
    const [s] = toViewSurfaces([['F4', body(['F4.S.a', 'F4.S.b'], [0, 1, 1])]]);
    expect(s.id).toBe('F4');
    expect(s.mesh.faceIds).toEqual(['F4.S.a', 'F4.S.b']);
    expect(s.mesh.triFace.length).toBe(3);
    expect(s.mesh.positions.length).toBe(27);
    expect(s.box).toEqual({ min: [0, 0, 5], max: [2, 2, 6] });
  });
  it('skips junk instead of throwing', () => {
    expect(toViewSurfaces(undefined)).toEqual([]);
    expect(toViewSurfaces([['F1'], [3, {}], ['F2', null], 'x'])).toEqual([]);
  });
});

describe('fetchSurfaces', () => {
  it('asks for a regen on the given tag (and upTo) and reads surfaces from the reply', async () => {
    const seen: unknown[] = [];
    const k = { async request(m: unknown) { seen.push(m); return { ok: true, result: { errors: [], surfaces: [['F4', body(['F4.S.a'], [0])]] } }; } };
    const out = await fetchSurfaces(k, { features: [] }, 't-surf', 3);
    expect(out.map((x) => x.id)).toEqual(['F4']);
    expect(seen[0]).toMatchObject({ type: 'regen', tag: 't-surf', opts: { upTo: 3 } });
  });
  it('gives [] when the kernel fails, throws or is missing', async () => {
    expect(await fetchSurfaces({ async request() { return { ok: false }; } }, {}, 't')).toEqual([]);
    expect(await fetchSurfaces({ async request() { throw new Error('trap'); } }, {}, 't')).toEqual([]);
    expect(await fetchSurfaces(undefined, {}, 't')).toEqual([]);
  });
});

describe('withSurfaces / mergedView', () => {
  const solid = { mesh: { positions: new Float32Array(9), normals: new Float32Array(9), triFace: Int32Array.of(0), faceIds: ['A'] }, edges: [{ key: 'A|B#0', pts: [[0, 0, 0], [1, 0, 0]] }], box: { min: [0, 0, 0], max: [1, 1, 1] } };
  const sheets = toViewSurfaces([['F4', body(['F4.S.a', 'F4.S.b'], [0, 1, 1])]]);
  it('without sheets the body is unchanged', () => {
    expect(withSurfaces(solid, [])).toBe(solid);
    expect(withSurfaces(null, sheets)).toBeNull();
  });
  it('attaches the sheets and widens the box; the merged view lists every face and edge', () => {
    const b = withSurfaces(solid, sheets)!;
    expect(b.surfaces).toBe(sheets);
    expect(b.box).toEqual({ min: [0, 0, 0], max: [2, 2, 6] });
    const m = mergedView(b);
    expect(m.mesh.faceIds).toEqual(['A', 'F4.S.a', 'F4.S.b']);
    expect(m.edges.length).toBe(2);
    expect(surfaceNames(b).get('F4.S.b')).toBe('F4');
  });
});
