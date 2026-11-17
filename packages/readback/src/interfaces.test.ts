import { describe, expect, it } from 'vitest';
import { interfaces, parseDirection, frameAt, ReadbackError, type BodyRef, type ReadbackHost } from './index';

type Item = Record<string, unknown>;
const plane = (name: string, normal: string, area: number, c: number[]): Item => ({ name, found: true, surface: 'plane', area, centroid: c, normal });
const hole = (name: string, r: number, c: number[], axis = '+z'): Item => ({ name, found: true, surface: 'cylinder', area: 2 * Math.PI * r * 10, centroid: c, axis, radius: r, concave: true, hole: true });

function host(bodies: Array<{ body: BodyRef; items: Item[] }>, extra: { distance?: (a: string, b: string) => number; mass?: unknown } = {}): ReadbackHost {
  const byName = new Map(bodies.flatMap((b) => b.items.map((i) => [String(i.name), i] as const)));
  return {
    bodies: async () => bodies.map((b) => b.body),
    interference: async () => null,
    kernel: {
      describe: async (names: unknown[]) => names.map((n) => byName.get(String(n)) ?? { found: false }),
      massProps: async () => extra.mass ?? {},
      distance: async (a: unknown, b: unknown) => ({ distance: (extra.distance ?? (() => 0))(String(a), String(b)) }),
    } as never,
  };
}
const ref = (name: string, items: Item[], volume = 1000): { body: BodyRef; items: Item[] } => ({ body: { name, key: `@body:${name}`, volume, faces: items.map((i) => String(i.name)) }, items });
const run = async (h: ReadbackHost, input: Record<string, unknown> = {}) => (await interfaces.run(input, h)).data as Record<string, any>;

describe('direction parsing', () => {
  it('reads the kernel\'s axis labels as exact unit vectors and its (x, y, z) text as oblique', () => {
    expect(parseDirection('-Z')).toEqual({ v: [0, 0, -1], oblique: false });
    expect(parseDirection('(0.3536, -0.3536, 0.866)')!.oblique).toBe(true);
    expect(parseDirection('(0.3536, -0.3536, 0.866)')!.v[2]).toBeCloseTo(0.866, 2);
    expect(parseDirection('sideways')).toBeNull(); expect(parseDirection(undefined)).toBeNull();
  });
  it('frameAt is a right-handed orthonormal frame for any axis, the same one each time', () => {
    for (const z of [[0, 0, 1], [1, 0, 0], [0.3, -0.5, 0.8], [0, -1, 0]] as number[][]) {
      const f = frameAt([1, 2, 3], z);
      const d = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      expect(d(f.x, f.y)).toBeCloseTo(0, 12); expect(d(f.x, f.z)).toBeCloseTo(0, 12); expect(d(f.x, f.x)).toBeCloseTo(1, 12);
      expect(f.x[1] * f.y[2] - f.x[2] * f.y[1]).toBeCloseTo(f.z[0], 12);      // x cross y = z
      expect(frameAt([1, 2, 3], z)).toEqual(f);
    }
  });
});

describe('holes', () => {
  const plate = ref('Plate', [
    plane('F2.C0', '-z', 2000, [0, 0, 0]), plane('F2.C1', '+z', 2000, [0, 0, 10]),
    hole('F4.S.e1', 3, [-20, -10, 5]), hole('F4.S.e2', 3, [-10, -10, 5]), hole('F4.S.e3', 3, [0, -10, 5]), hole('F4.S.e4', 3, [10, -10, 5]),   // a row of four
    hole('F5.S.e1', 8, [20.123456789, 15, 5]),
    ...[0, 90, 180, 270].map((a, i) => hole(`F6.S.e${i + 1}`, 2, [40 + 15 * Math.cos((a * Math.PI) / 180), 15 * Math.sin((a * Math.PI) / 180), 5])),                                  // a bolt circle
  ]);
  it('lists each unique hole once with exact numbers, a frame on its axis and a rounded label', async () => {
    const r = await run(host([plate]), { kinds: ['holes'], precision: 2 });
    expect(r.holesTotal).toBe(9);
    const big = r.holes.find((h: any) => h.radius === 8);
    expect(big).toMatchObject({ diameter: 16, axis: [0, 0, 1], point: [20.123456789, 15, 5], body: 'Plate' });      // not rounded
    expect(big.label).toContain('at (20.12, 15, 5)');                                                                  // rounded for reading
    expect(big.frame.z).toEqual([0, 0, 1]); expect(big.frame.origin).toEqual([20.123456789, 15, 5]);
    expect(big.length).toBeCloseTo(10, 9);
    expect(r.precision).toMatchObject({ axisAlignedDirections: 'exact', obliqueDirectionDecimals: 4, display: 2 });
  });
  it('recognises the row and the bolt circle as patterns, with pitch, centre and diameter', async () => {
    const r = await run(host([plate]), { kinds: ['holes'] });
    const lin = r.holePatterns.find((p: any) => p.type === 'linear'), circ = r.holePatterns.find((p: any) => p.type === 'circular');
    expect(lin).toMatchObject({ count: 4, radius: 3 }); expect(lin.pitch).toBeCloseTo(10, 6); expect(Math.abs(lin.direction[0])).toBeCloseTo(1, 9);
    expect(circ).toMatchObject({ count: 4, radius: 2 }); expect(circ.pcd).toBeCloseTo(30, 6); expect(circ.center[0]).toBeCloseTo(40, 6); expect(circ.center[1]).toBeCloseTo(0, 6); expect(circ.angularPitch).toBeCloseTo(90, 5);
  });
  it('holes whose barrel is in two faces are one hole; the same line and radius in two bodies stay two; limit cuts the list and the total says so', async () => {
    const two = ref('A', [hole('F1.S.e1', 4, [0, 0, 2.5]), hole('F1.S.e2', 4, [0, 0, 7.5])]);
    const b = ref('B', [hole('F2.S.e1', 4, [0, 0, 5])]);
    const r = await run(host([two, b]), { kinds: ['holes'] });
    expect(r.holesTotal).toBe(2);
    expect(r.holes.find((h: any) => h.body === 'A').faces).toEqual(['F1.S.e1', 'F1.S.e2']);
    expect((await run(host([plate]), { kinds: ['holes'], limit: 3 })).holes).toHaveLength(3);
  });
  it('component limits everything to one body, and an unknown one is refused', async () => {
    const other = ref('Other', [hole('F9.S.e1', 1, [0, 0, 0])]);
    const r = await run(host([plate, other]), { kinds: ['holes'], component: 'Other' });
    expect(r.holesTotal).toBe(1); expect(r.scope).toBe('Other');
    expect((await run(host([plate, other]), { kinds: ['holes'], component: 2 })).holesTotal).toBe(1);
    await expect(interfaces.run({ component: 'Nope' }, host([plate]))).rejects.toBeInstanceOf(ReadbackError);
    await expect(interfaces.run({}, host([]))).rejects.toMatchObject({ code: 'no_body' });
  });
});

describe('planes and contacts', () => {
  const A = ref('A', [plane('F1.C0', '-z', 400, [0, 0, 0]), plane('F1.C1', '+z', 400, [0, 0, 10]), plane('F1.S.e1', '-y', 200, [0, -10, 5]), plane('F1.S.e2', '-y', 100, [30, -10, 5])]);
  const B = ref('B', [plane('F2.C0', '-z', 300, [0, 0, 10]), plane('F2.C1', '+z', 300, [0, 0, 20]), plane('F2.S.e1', '+x', 100, [5, 0, 15])]);
  it('groups coplanar faces into one plane with their total area and the largest face as its anchor', async () => {
    const r = await run(host([A, B]), { kinds: ['planes'], component: 'A' });
    expect(r.planesTotal).toBe(3);
    const front = r.planes.find((p: any) => p.normal[1] === -1);
    expect(front).toMatchObject({ faceCount: 2, area: 300, offset: 10, anchor: [0, -10, 5] }); expect(front.faces).toEqual(['F1.S.e1', 'F1.S.e2']);
  });
  it('finds the faces of two bodies that face each other on one plane, and not the ones that are only parallel', async () => {
    const r = await run(host([A, B], { distance: () => 0 }), { kinds: ['contacts'] });
    expect(r.contacts).toHaveLength(1);
    expect(r.contacts[0]).toMatchObject({ bodies: ['A', 'B'], faces: ['F1.C1', 'F2.C0'], normal: [0, 0, 1], offset: 10, areaUpperBound: 300 });
    const apart = await run(host([A, B], { distance: () => 0.5 }), { kinds: ['contacts'] });     // the kernel says they do not touch
    expect(apart.contacts).toEqual([]);
    expect((await run(host([A, B]), { kinds: ['contacts'], component: 'B' })).contacts).toHaveLength(1);
    expect((await run(host([A]), { kinds: ['contacts'] })).contacts).toEqual([]);
  });
  it('an oblique plane is grouped with a looser tolerance, flagged, and the numbers are as the kernel gave them', async () => {
    const o = ref('O', [{ name: 'F1.C0', found: true, surface: 'plane', area: 50, centroid: [1, 2, 3], normal: '(-0.3536, 0.3536, -0.866)' }]);
    const r = await run(host([o]), { kinds: ['planes'] });
    expect(r.planes[0]).toMatchObject({ oblique: true }); expect(r.planes[0].normal[2]).toBeCloseTo(-0.866, 2);
  });
});

describe('frames', () => {
  it('gives the world frame, each body\'s centre of mass (matched by volume) and the principal axes of the whole', async () => {
    const A = ref('A', [plane('F1.C0', '-z', 1, [0, 0, 0])], 1000), B = ref('B', [plane('F2.C0', '-z', 1, [0, 0, 0])], 250);
    const mass = { com: [1, 2, 3], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], bodies: [{ volume: 250, area: 1, com: [9, 9, 9] }, { volume: 1000.2, area: 1, com: [4.123456789, 5, 6] }] };
    const r = await run(host([A, B], { mass }), { kinds: ['frames'] });
    expect(r.frames.map((f: any) => f.id)).toEqual(['world', 'com:A', 'com:B', 'principal']);
    expect(r.frames[1].origin).toEqual([4.123456789, 5, 6]);       // the volume order of the kernel is not the body list order
    expect(r.frames[2].origin).toEqual([9, 9, 9]);
    expect((await run(host([A, B], { mass }), { kinds: ['frames'], component: 'B' })).frames.map((f: any) => f.id)).toEqual(['world', 'com:B']);
  });
  it('refuses a bad tolerance or kind before running, and a kernel without describe says so', async () => {
    const h = host([ref('A', [plane('F1.C0', '-z', 1, [0, 0, 0])])]);
    await expect(interfaces.run({}, { ...h, kernel: {} as never })).rejects.toMatchObject({ code: 'unsupported' });
  });
});
