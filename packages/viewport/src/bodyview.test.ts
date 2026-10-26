import { describe, expect, it } from 'vitest';
import { backToFront, hiddenSets, pickThrough, rangeCentre, transparentBodies, withoutFaces, PICK_OPACITY, type BodyViewSpec } from './bodyview';
import { groupByFace } from './meshgeom';

const tri = (z: number): number[] => [0, 0, z, 1, 0, z, 0, 1, z];
// four faces on four z levels; A = {f0, f1}, B = {f2}, C = {f3}
const mesh = () => ({ positions: Float32Array.from([...tri(0), ...tri(1), ...tri(2), ...tri(3)]), normals: new Float32Array(36), triFace: Int32Array.from([0, 1, 2, 3]), faceIds: ['f0', 'f1', 'f2', 'f3'] });
const spec = (looks: BodyViewSpec['looks'], hidden: string[] = []): BodyViewSpec => ({ bodies: [{ key: 'A', faces: ['f0', 'f1'], edges: ['e0'] }, { key: 'B', faces: ['f2'] }, { key: 'C', faces: ['f3'] }], looks, hidden });

describe('transparent pass membership', () => {
  it('lists visible bodies below full opacity, in body order, and ranks their faces from 1', () => {
    const t = transparentBodies(spec({ B: { opacity: 0.2 }, C: { opacity: 0.5 }, A: { opacity: 1 } }));
    expect(t.keys).toEqual(['B', 'C']);
    expect([...t.rank]).toEqual([['f2', 1], ['f3', 2]]);
  });
  it('a hidden transparent body is not drawn at all', () => {
    expect(transparentBodies(spec({ B: { opacity: 0.2 } }, ['B'])).keys).toEqual([]);
  });
  it('groups each transparent body into one contiguous range after the opaque faces', () => {
    const t = transparentBodies(spec({ A: { opacity: 0.3 }, C: { opacity: 0.3 } }));
    const g = groupByFace(mesh(), (n) => t.rank.get(n) ?? 0);
    expect(g.ranges.map((r) => r.name)).toEqual(['f2', 'f0', 'f1', 'f3']);   // opaque B first, then A's two faces together, then C
    expect(g.ranges.map((r) => r.start)).toEqual([0, 3, 6, 9]);
  });
});

describe('hidden bodies', () => {
  it('take their faces and edge keys with them and leave the rest of the mesh intact', () => {
    const h = hiddenSets(spec({}, ['A']));
    expect([...h.faces]).toEqual(['f0', 'f1']);
    const out = withoutFaces(mesh(), [{ key: 'e0' }, { key: 'e9' }, {}], h.faces, h.edges);
    expect(out.mesh.triFace.length).toBe(2);
    expect(out.mesh.faceIds).toHaveLength(4);
    expect(Array.from(out.mesh.triFace)).toEqual([2, 3]);
    expect(out.edges).toEqual([{ key: 'e9' }, {}]);
  });
  it('returns the same mesh when nothing is hidden', () => {
    const m = mesh();
    expect(withoutFaces(m, [], new Set(), new Set()).mesh).toBe(m);
  });
});

describe('draw order and picking', () => {
  it('orders transparent bodies farthest from the camera first, ties in list order', () => {
    const centres = [[0, 0, 5], [0, 0, 1], [0, 0, 9], [0, 0, 1]] as const;
    expect(backToFront(centres, [0, 0, 0])).toEqual([2, 0, 1, 3]);
    expect(backToFront(centres, [0, 0, 10])).toEqual([1, 3, 0, 2]);
  });
  it('centres a range of vertices', () => {
    expect(rangeCentre(Float32Array.from([...tri(0), ...tri(2)]), 3, 3)).toEqual([1 / 3, 1 / 3, 2]);
  });
  it('a click passes through a body below the pick threshold when something lies behind it', () => {
    expect(PICK_OPACITY).toBe(0.35);
    expect(pickThrough([{ opacity: 0.18 }, { opacity: 1 }])).toBe(1);
    expect(pickThrough([{ opacity: 0.18 }, { opacity: 0.2 }, { opacity: 0.6 }])).toBe(2);
  });
  it('takes the clear body when it is the only hit, and a denser body in front', () => {
    expect(pickThrough([{ opacity: 0.1 }])).toBe(0);
    expect(pickThrough([{ opacity: 0.1 }, { opacity: 0.2 }])).toBe(0);
    expect(pickThrough([{ opacity: 0.5 }, { opacity: 1 }])).toBe(0);
    expect(pickThrough([])).toBe(-1);
  });
});

describe('metallic and roughness of a look', () => {
  it('the PBR values replace the finish\'s, one at a time', async () => {
    const { lookMaterial, looksTinted } = await import('./bodyview');
    expect(lookMaterial(undefined)).toEqual({ roughness: null, metalness: null });
    expect(lookMaterial({ finish: 'chrome' })).toEqual({ roughness: 0.06, metalness: 1 });
    expect(lookMaterial({ finish: 'chrome', roughness: 0.5 })).toEqual({ roughness: 0.5, metalness: 1 });
    expect(lookMaterial({ metallic: 0.2 })).toEqual({ roughness: null, metalness: 0.2 });
    expect(looksTinted({ opacity: 0.5 })).toBe(false);
    expect(looksTinted({ roughness: 0.3 })).toBe(true);
  });
});
