import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { sketchShapes } from '../shapes';
import { petalSketch, PETAL_AREA } from './petals-fixture';
import { closeSessions, sessions } from './kernel-fixtures';

afterEach(closeSessions);

async function run(extrude: Record<string, unknown>, extra: Record<string, unknown>[] = []) {
  const doc = { ...emptyPart('Flower'), features: [petalSketch(5), { type: 'extrude', op: 'add', sketch: 'F1', end: 'blind', depth: 5, id: 'F2', ...extrude }, ...extra], seq: 9 } as unknown as PartDoc;
  const s = await Session.open(doc);
  sessions.push(s);
  const r = await s.preview([], { sketchStatus: true });
  const facts = await s.facts();
  return { errors: r.errors, facts };
}

describe('a flower of petals sharing one origin point, in the real kernel', { skip: !process.env.CK_WASM }, () => {
  const near = (got: number | null | undefined, want: number) => expect(Math.abs((got ?? 0) - want) / want).toBeLessThan(0.002);
  it('the shapes the kit offers are the regions the kernel extrudes: each petal alone, a subset, and all of them', async () => {
    const shapes = sketchShapes(petalSketch(5) as never);
    expect(shapes).toHaveLength(5);
    const one = await run({ regions: [shapes[2].id] });
    expect(one.errors).toEqual([]);
    near(one.facts.volume, PETAL_AREA * 5);
    const three = await run({ regions: [shapes[0].id, shapes[1].id, shapes[3].id] });
    expect(three.errors).toEqual([]);
    near(three.facts.volume, PETAL_AREA * 5 * 3);
    const all = await run({ regions: shapes.map((s) => s.id) });
    expect(all.errors).toEqual([]);
    near(all.facts.volume, PETAL_AREA * 5 * 5);
    const none = await run({});   // no selection = every region
    expect(none.errors).toEqual([]);
    near(none.facts.volume, PETAL_AREA * 5 * 5);
  }, 240000);
  it('a cut by one petal removes one petal from a block', async () => {
    const shapes = sketchShapes(petalSketch(5) as never);
    const block = { type: 'sketch', id: 'F3', plane: { kind: 'std', id: 'top' }, points: [{ id: 'a', x: -50, y: -50 }, { id: 'b', x: 50, y: -50 }, { id: 'c', x: 50, y: 50 }, { id: 'd', x: -50, y: 50 }],
      entities: [{ id: 'b1', type: 'line', p1: 'a', p2: 'b' }, { id: 'b2', type: 'line', p1: 'b', p2: 'c' }, { id: 'b3', type: 'line', p1: 'c', p2: 'd' }, { id: 'b4', type: 'line', p1: 'd', p2: 'a' }], constraints: [] };
    const doc = { ...emptyPart('Block'), features: [block, { type: 'extrude', op: 'add', sketch: 'F3', end: 'blind', depth: 10, id: 'F4' }, petalSketch(5), { type: 'extrude', op: 'cut', sketch: 'F1', end: 'blind', depth: 5, flip: true, id: 'F5', regions: [shapes[1].id] }], seq: 9 } as unknown as PartDoc;
    const s = await Session.open(doc);
    sessions.push(s);
    const res = await s.preview([], { sketchStatus: true });
    expect(res.errors).toEqual([]);
    near((await s.facts()).volume, 100 * 100 * 10 - PETAL_AREA * 5);
  }, 240000);
});
