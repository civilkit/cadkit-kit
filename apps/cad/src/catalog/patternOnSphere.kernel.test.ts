import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { buildShape, catalogItem, type BuiltShape } from './shapes';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const vol = async (s: Session) => ((await s.massProps()) as { volume: number }).volume;

/** Hollow ball R=37 (wall 2) at the origin, one Round pocket dropped on its surface off the x axis, then a pattern of it about x. */
async function ball(count: number, wall = 2, axis = 'x', cut = 'cut-cylinder', yy = 20) {
  const doc = emptyPart('Ball') as unknown as PartDoc;
  const s = await Session.open(doc); sessions.push(s);
  const b = buildShape(catalogItem('add-sphere')!, { kind: 'ground', point: [0, 0, 0] }, doc.seq, 74, wall) as BuiltShape;
  expect((await s.edit(b.ops as never)).ok).toBe(true);
  const seq = b.ops.length + 1;
  const y = yy, z = Math.sqrt(37 ** 2 - y ** 2);
  const pocket = buildShape(catalogItem(cut)!, { kind: 'face', face: 'F2.S.e1', planar: false, point: [0, y, z], extent: [100, 100], thickness: 74 }, seq, 10) as BuiltShape;
  expect((await s.edit(pocket.ops as never)).ok).toBe(true);
  const base = await vol(s);
  const pat = { type: 'cpattern', id: 'FP', seeds: [pocket.mainId], axis: { kind: 'axis', axis }, count, angle: 360, equal: true };
  const r = await s.edit([{ op: 'add', feature: pat }] as never);
  return { s, r, base, pocket, ids: b.ops.length };
}

// KERNEL BUG, not the kit: the kit sends the same cpattern payload that works on a slab, a cylinder and a revolved cylinder.
// On a sphere face the pattern reports ok but changes nothing (also solid ball, count 2, any axis), and so does a plain second
// round pocket on the same ball ("cutNoEffect": the boolean of a sphere that already has one hole with a second hole tool
// finds no effect). The pattern swallows that because Brep::combine is called with warn_no_effect=false in exec_pattern.
// `it.fails`: green while the bug exists, red as soon as the kernel is fixed (then turn it into a plain `it`).
describe('circular pattern of a Catalog round pocket on a hollow ball', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  it.fails('8 copies about x remove 8 times the volume of one hole', async () => {
    const { s, r, base } = await ball(8);
    const v0 = 4 / 3 * Math.PI * (37 ** 3 - 35 ** 3);
    const one = v0 - base;
    expect(one).toBeGreaterThan(50);
    expect(r.ok).toBe(true);
    expect((await s.verify()).regen.errors).toEqual([]);
    const after = await vol(s);
    expect(v0 - after).toBeGreaterThan(one * 7.5);
  });
});

describe('second hole in a sphere (the kernel bug under the pattern)', { skip: !process.env.CK_WASM, timeout: 180000 }, () => {
  // two plain round cuts from an offset plane (no face reference, no pattern) into a solid ball, at y=+20 and y=-20
  const hole = (n: number, y: number) => [
    { type: 'sketch', id: `S${n}`, plane: { kind: 'feature', id: 'P3' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'c', x: 0, y }], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 5 }], constraints: [] },
    { type: 'extrude', id: `C${n}`, op: 'cut', sketch: `S${n}`, end: 'blind', depth: 10 },
  ];
  it.fails('the second hole removes volume (kernel reports cutNoEffect today)', async () => {
    const doc = emptyPart('Ball') as unknown as PartDoc;
    const b = buildShape(catalogItem('add-sphere')!, { kind: 'ground', point: [0, 0, 0] }, doc.seq, 74, 0) as BuiltShape;
    const feats = [...b.ops.map((o) => (o as unknown as { feature: unknown }).feature), { type: 'plane', id: 'P3', mode: 'offset', base: { kind: 'std', id: 'front' }, offset: 40 }];
    const open = async (extra: unknown[]) => { const s = await Session.open({ ...doc, features: [...feats, ...extra], seq: 50 } as unknown as PartDoc); sessions.push(s); return s; };
    const one = await open(hole(1, 20));
    const two = await open([...hole(1, 20), ...hole(2, -20)]);
    const errors = (await two.verify()).regen.errors.map(([id, e]) => `${id}:${e.code}`);
    expect(await vol(one) - await vol(two)).toBeGreaterThan(100);
    expect(errors).toEqual([]);
  });
});
