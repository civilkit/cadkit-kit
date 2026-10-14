import { describe, expect, it } from 'vitest';
import { SelModel } from './model';
import { box, boxData, roundedData, twoBoxes } from './fixtures';

describe('bodies', () => {
  it('a box is one body of six faces', () => {
    const m = new SelModel(boxData());
    expect(m.bodies()).toHaveLength(1);
    expect(m.bodies()[0].faces).toHaveLength(6);
    expect(m.bodies()[0].name).toBe('@body:B+x');
  });
  it('two separate boxes are two bodies, named by their smallest face', () => {
    const m = new SelModel(twoBoxes());
    expect(m.bodies().map((b) => b.name)).toEqual(['@body:A+x', '@body:C+x']);
    expect(m.bodyOfFace('C+z')!.name).toBe('@body:C+x');
  });
  it('a body whose faces are in surfaceOf is a surface body', () => {
    const d = twoBoxes();
    const m = new SelModel({ ...d, surfaceOf: (n) => (n.startsWith('C') ? 'F9' : null) });
    expect(m.bodies().map((b) => b.surface)).toEqual([false, true]);
  });
});

describe('measures', () => {
  const m = new SelModel(boxData([0, 0, 0], [10, 6, 4]));
  it('face areas from the triangles', () => {
    expect(m.area('B+z')).toBeCloseTo(60);
    expect(m.area('B+x')).toBeCloseTo(24);
  });
  it('edge length and kind', () => {
    expect(m.edgeLength('Bx00|0')).toBeCloseTo(10);
    expect(m.edgeKind('Bx00|0')).toMatchObject({ type: 'line' });
    expect(m.faceKind('B+z')).toMatchObject({ type: 'plane' });
  });
});

describe('parallel and similar', () => {
  const m = new SelModel(boxData([0, 0, 0], [10, 6, 4]));
  it('parallel faces: the opposite face too, nothing else', () => {
    expect(m.parallel(['B+z'], 'face').sort()).toEqual(['B+z', 'B-z']);
  });
  it('parallel edges: the four edges along x', () => {
    expect(m.parallel(['Bx00|0'], 'edge').sort()).toEqual(['Bx00|0', 'Bx01|0', 'Bx10|0', 'Bx11|0']);
  });
  it('similar faces: same type and area (top and bottom, not the sides)', () => {
    expect(m.similar(['B+z'], 'face').sort()).toEqual(['B+z', 'B-z']);
    expect(m.similar(['B+y'], 'face').sort()).toEqual(['B+y', 'B-y']);
  });
  it('similar edges: same type and length', () => {
    expect(m.similar(['Bz00|0'], 'edge')).toHaveLength(4);
    expect(m.similar(['By00|0'], 'edge')).toHaveLength(4);
  });
  it('a cube has three families of similar faces joined: all six', () => {
    const c = new SelModel(boxData([0, 0, 0], [5, 5, 5]));
    expect(c.similar(['B+z'], 'face')).toHaveLength(6);
  });
  it('similar across two boxes only matches the same size', () => {
    const t = new SelModel(twoBoxes());
    expect(t.similar(['A+z'], 'face').sort()).toEqual(['A+z', 'A-z']);
    expect(t.similar(['C+z'], 'face')).toHaveLength(6);
  });
});

describe('loop and connected', () => {
  const m = new SelModel(boxData());
  it('the loop of a face is its four edges', () => {
    expect(m.loopsOfFaces(['B+z']).sort()).toEqual(['Bx01|0', 'Bx11|0', 'By01|0', 'By11|0']);
  });
  it('the loop of an edge runs along the smaller side face', () => {
    const l = m.loopOfEdge('Bx00|0');   // faces -y (10x4=40) and -z (10x6=60): the smaller is -y
    expect(l.sort()).toEqual(['Bx00|0', 'Bx01|0', 'Bz00|0', 'Bz10|0']);
  });
  it('the loop along a chosen face', () => {
    expect(m.loopOfEdge('Bx00|0', 'B-z').sort()).toEqual(['Bx00|0', 'Bx10|0', 'By00|0', 'By10|0']);
  });
  it('connected faces give the whole body, only that body', () => {
    const t = new SelModel(twoBoxes());
    expect(t.connectedFaces(['A+x'])).toHaveLength(6);
    expect(t.connectedFaces(['C+x']).every((f) => f.startsWith('C'))).toBe(true);
  });
  it('connected edges follow shared corners', () => {
    const t = new SelModel(twoBoxes());
    expect(t.connectedEdges(['Ax00|0'])).toHaveLength(12);
  });
});

describe('tangent chains', () => {
  const m = new SelModel(roundedData());
  it('edges: line, arc and line join; the sharp edge at the corner does not', () => {
    const got = m.tangentEdges(['TF|b#2']).sort();
    expect(got).toEqual(['RF|b#3', 'TF|b#2', 'WF|b#4']);
  });
  it('edges: starting from the arc finds the same chain', () => {
    expect(m.tangentEdges(['RF|b#3']).sort()).toEqual(['RF|b#3', 'TF|b#2', 'WF|b#4']);
  });
  it('faces: the top, the round and the wall are smooth neighbours; the front plate is a sharp one', () => {
    expect(m.tangentFaces(['T']).sort()).toEqual(['R', 'T', 'W']);
    expect(m.tangentFaces(['F'])).toEqual(['F']);
  });
  it('a box has no tangent neighbours', () => {
    const b = new SelModel(boxData());
    expect(b.tangentFaces(['B+z'])).toEqual(['B+z']);
    expect(b.tangentEdges(['Bx00|0'])).toEqual(['Bx00|0']);
  });
});

describe('cylinders', () => {
  it('a round hole wall is a cylinder; same radius is similar, a different radius is not', () => {
    // two cylinders as quads with a circle rim each (the rim edges are circles about z)
    const circle = (cx: number, r: number, z: number) => Array.from({ length: 25 }, (_, i) => [cx + r * Math.cos((i / 24) * 2 * Math.PI), r * Math.sin((i / 24) * 2 * Math.PI), z]);
    const positions: number[] = [], normals: number[] = [], triFace: number[] = [];
    const defs = [['H1', 0, 2], ['H2', 20, 2], ['H3', 40, 3]] as const;
    defs.forEach(([, cx, r], fi) => {
      for (let i = 0; i < 24; i++) {
        const a0 = (i / 24) * 2 * Math.PI, a1 = ((i + 1) / 24) * 2 * Math.PI;
        const v = (a: number, z: number) => ({ p: [cx + r * Math.cos(a), r * Math.sin(a), z], n: [Math.cos(a), Math.sin(a), 0] });
        for (const t of [[v(a0, 0), v(a1, 0), v(a1, 5)], [v(a0, 0), v(a1, 5), v(a0, 5)]]) { for (const q of t) { positions.push(...q.p); normals.push(...q.n); } triFace.push(fi); }
      }
    });
    const mesh = { positions: Float32Array.from(positions), normals: Float32Array.from(normals), triFace: Int32Array.from(triFace), faceIds: ['H1', 'H2', 'H3'] };
    const quads = defs.map(([id]) => ({ id }));
    const edges = quads.flatMap((q, i) => {
      const cx = [0, 20, 40][i], r = [2, 2, 3][i];
      return [{ key: `${q.id}a|x#${i * 2}`, faces: [q.id, 'TOP'], pts: circle(cx, r, 0) }, { key: `${q.id}b|x#${i * 2 + 1}`, faces: [q.id, 'BOT'], pts: circle(cx, r, 5) }];
    });
    const m = new SelModel({ mesh, edges });
    expect(m.faceKind('H1')).toMatchObject({ type: 'cylinder', radius: expect.closeTo(2, 2) });
    expect(m.similar(['H1'], 'face').sort()).toEqual(['H1', 'H2']);
    expect(m.parallel(['H1'], 'face').sort()).toEqual(['H1', 'H2', 'H3']);
  });
});

describe('box helper sanity', () => {
  it('a box has 12 edges and 6 quads', () => {
    const b = box('X', [0, 0, 0], [1, 1, 1]);
    expect(b.edges).toHaveLength(12);
    expect(b.quads).toHaveLength(6);
  });
});
