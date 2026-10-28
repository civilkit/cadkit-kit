import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import type { PartDoc } from '@ck/part-model';
import { followSketches } from './follow';

type R = Record<string, any>;
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
const build = async (features: R[]) => {
  const s = await Session.open({ format: 'ck-part', version: 1, name: 'p', features, seq: 1 } as unknown as PartDoc);
  sessions.push(s);
  return { errors: (await s.verify()).regen.errors, facts: await s.facts() };
};
const plate: R[] = [
  { type: 'sketch', id: 'F1', name: 'Plan', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: 0, y: 0 }, { id: 'p2', x: 40, y: 0 }, { id: 'p3', x: 40, y: 20 }, { id: 'p4', x: 0, y: 20 }],
    entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [] },
  { type: 'extrude', id: 'F2', op: 'newBody', body: 'Plate', sketch: 'F1', end: 'blind', depth: 10 },
];

// The check: extrude the display copy of the sketch as a body of its own. If its frame is at the pose of the body, that second body fills the first exactly
// (same box, and the part holds two lumps with twice the volume).
describe('the sketch copy of a moved body lies at the body (kernel)', { skip: !process.env.CK_WASM, timeout: 60_000 }, () => {
  const check = async (moves: R[], flip = false) => {
    const feats = [...plate, ...moves];
    const base = await build(feats);
    expect(base.errors).toEqual([]);
    const copies = followSketches(feats, (() => { let n = 50; return () => `F${++n}`; })());
    const shown = copies.find((f) => f.type === 'sketch')!;
    const both = await build([...feats, ...copies, { type: 'extrude', id: 'F99', op: 'newBody', body: 'Ghost', sketch: shown.id, end: 'blind', depth: 10, ...(flip ? { flip: true } : {}) }]);
    expect(both.errors).toEqual([]);
    expect(both.facts.solids).toBe(base.facts.solids + 1);
    expect(both.facts.volume!).toBeCloseTo(base.facts.volume! + 8000, 3);
    return { base, both };
  };
  it('a move of 100 mm along x', async () => {
    const { base, both } = await check([{ type: 'moveBody', id: 'F3', bodies: [{ body: 'Plate' }], translate: [100, 0, 0] }]);
    expect(base.facts.box!.min[0]).toBeCloseTo(100, 6);
    expect(both.facts.box).toEqual(base.facts.box);
  });
  it('a turn of 90 degrees about y, then a move', async () => {
    const { base, both } = await check([{ type: 'moveBody', id: 'F3', bodies: [{ body: 'Plate' }], rotate: { axis: [0, 1, 0], origin: [5, 0, 0], angle: 90 }, translate: [0, 7, 30] }]);
    for (const k of [0, 1, 2]) { expect(both.facts.box!.min[k]).toBeCloseTo(base.facts.box!.min[k], 6); expect(both.facts.box!.max[k]).toBeCloseTo(base.facts.box!.max[k], 6); }
  });
  it('a mirror copy (its normal is reversed, so the ghost extrudes the other way)', async () => {
    const { base, both } = await check([{ type: 'moveBody', id: 'F3', copy: true, body: 'Mirror', bodies: [{ body: 'Plate' }], mirror: { kind: 'std', id: 'right' } }], true);
    expect(base.facts.box!.min[0]).toBeCloseTo(-40, 6);
    for (const k of [0, 1, 2]) { expect(both.facts.box!.min[k]).toBeCloseTo(base.facts.box!.min[k], 6); expect(both.facts.box!.max[k]).toBeCloseTo(base.facts.box!.max[k], 6); }
  });
});
