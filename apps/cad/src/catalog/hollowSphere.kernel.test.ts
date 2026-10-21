import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { buildShape, catalogItem, type BuiltShape } from './shapes';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const sphereAt = async (size: number, wall: number, point: [number, number, number] = [0, 0, 0]) => {
  const doc = emptyPart('Ball') as unknown as PartDoc;
  const built = buildShape(catalogItem('add-sphere')!, { kind: 'ground', point }, doc.seq, size, wall) as BuiltShape;
  const s = await Session.open(doc); sessions.push(s);
  const r = await s.edit(built.ops as never);
  return { s, r, built };
};
const vol = async (s: Session) => ((await s.massProps()) as { volume: number }).volume;

describe('hollow Catalog sphere against the real kernel', { skip: !process.env.CK_WASM, timeout: 120000 }, () => {
  it('wall 2 on a 74 mm ball: valid, volume = 4/3 pi (R^3 - r^3), still one revolve', async () => {
    const { s, r, built } = await sphereAt(74, 2);
    expect(r.ok).toBe(true);
    expect((await s.verify()).regen.errors).toEqual([]);
    const R = 37, i = 35;
    expect(await vol(s)).toBeCloseTo(4 / 3 * Math.PI * (R ** 3 - i ** 3), 3);
    expect(built.ops.filter((o) => (o as unknown as { feature: { type: string } }).feature.type === 'revolve')).toHaveLength(1);
  });
  it('wall 0 is the solid ball as before; a wall of at least the radius also gives a solid ball', async () => {
    for (const wall of [0, 40]) {
      const { s } = await sphereAt(74, wall);
      expect((await s.verify()).regen.errors).toEqual([]);
      expect(await vol(s)).toBeCloseTo(4 / 3 * Math.PI * 37 ** 3, 3);
    }
  });
  it('hollow ball dropped at a point is centred there', async () => {
    const { s } = await sphereAt(74, 2, [10, 20, 0]);
    const com = ((await s.massProps()) as { com: number[] }).com;
    expect(com[0]).toBeCloseTo(10, 3); expect(com[1]).toBeCloseTo(20, 3); expect(com[2]).toBeCloseTo(0, 3);
  });
  it('on a slab the hemisphere is hollow too', async () => {
    const slab = {
      ...emptyPart('Slab'), seq: 3,
      features: [{ type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -50, y: -50 }, { id: 'p2', x: 50, y: -50 }, { id: 'p3', x: 50, y: 50 }, { id: 'p4', x: -50, y: 50 }],
        entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [] },
      { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 10 }],
    } as unknown as PartDoc;
    const s = await Session.open(slab); sessions.push(s);
    const v0 = await vol(s);
    const frame = { o: [0, 0, 10], x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const built = buildShape(catalogItem('add-sphere')!, { kind: 'face', face: 'F2.C1', planar: true, frame, point: [0, 0, 10] }, slab.seq, 40, 2) as BuiltShape;
    const r = await s.edit(built.ops as never);
    expect(r.ok).toBe(true);
    expect((await s.verify()).regen.errors).toEqual([]);
    expect(await vol(s) - v0).toBeCloseTo(2 / 3 * Math.PI * (20 ** 3 - 18 ** 3), 2);
  });
});
