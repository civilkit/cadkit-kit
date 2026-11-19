// The junction-edge rule against the real kernel: a boss on a block. Skipped without a kernel (CK_WASM).
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory, type ViewSink } from './controller';
import { junctionEdgeKeys, junctionFilletOps, lastFilletRadius } from './junction';
import './locales/en';

const pt = (id: string, x: number, y: number) => ({ id, x, y });
const block = { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, pt('p1', -30, -30), pt('p2', 30, -30), pt('p3', 30, 30), pt('p4', -30, 30)],
  entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([i, a, b]) => ({ id: i, type: 'line', p1: a, p2: b })), constraints: [] };
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function world() {
  const store = createStore();
  const view: ViewSink = { setBody() {}, setHighlight() {}, setSelection() {}, setSketchEdit() {} } as ViewSink;
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view, kernel });
  await controller.load({ ...emptyPart('Block'), features: [block, { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: 20 }], seq: 3 } as unknown as PartDoc);
  return controller;
}
/** The cap face of F2 farthest from the sketch plane (the top of the block). */
const topFace = (c: Controller): string => ['F2.C1', 'F2.C0'].map((f) => ({ f, z: Math.max(...c.bodyEdges().filter((e) => e.faces?.includes(f)).flatMap((e) => (e.pts ?? []).map((p) => Math.abs(p[2])))) })).sort((a, b) => b.z - a.z)[0].f;

describe.skipIf(!process.env.CK_WASM)('junction edges', () => {
  it('a boss on the top face: its junction edges are the ones where the boss meets the block, and a fillet of them builds', async () => {
    const c = await world();
    const top = topFace(c);
    const sk = { type: 'sketch', id: 'F3', plane: { kind: 'face', id: top }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, pt('c', 0, 0)], entities: [{ id: 'k1', type: 'circle', c: 'c', r: 10 }], constraints: [] };
    expect((await c.edit([{ op: 'add', feature: sk as never }])).ok).toBe(true);
    const flip = c.extrudeFlip('F3', 'add');
    const r = await c.edit([{ op: 'add', feature: { type: 'extrude', id: 'F4', op: 'add', sketch: 'F3', end: 'blind', depth: 15, ...(flip ? { flip } : {}) } as never }]);
    expect(r.ok).toBe(true);
    const edges = c.bodyEdges();
    const keys = junctionEdgeKeys('F4', edges);
    expect(keys.length).toBeGreaterThan(0);
    const byKey = new Map(edges.map((e) => [e.key, e]));
    for (const k of keys) {
      const e = byKey.get(k)!;
      expect(e.faces!.filter((f) => f.startsWith('F4.'))).toHaveLength(1);
      expect(e.faces!.some((f) => f === top)).toBe(true);   // the boss meets the top face of the block
    }
    // the free end of the boss is not a junction: its edge joins two faces of the boss
    expect(keys.length).toBeLessThan(edges.filter((e) => e.faces?.some((f) => f.startsWith('F4.'))).length);
    const ops = junctionFilletOps(c.document(), 'F4', edges, c.bodyBox());
    expect(ops).not.toBeNull();
    const fr = await c.edit(ops!);
    expect(fr.ok).toBe(true);
  });
  it('no junction for a feature that touches nothing older, and the radius follows the last fillet', () => {
    expect(junctionEdgeKeys('F9', [{ key: 'a|b', faces: ['F2.C0', 'F2.S0'], mid: [0, 0, 0] }])).toEqual([]);
    expect(lastFilletRadius({ features: [{ type: 'fillet', radius: 3 }, { type: 'extrude' }] } as never)).toBe(3);
    expect(lastFilletRadius({ features: [] } as never)).toBeNull();
    const edges = [{ key: 'k', faces: ['F2.C0', 'F4.S0'], mid: [1, 2, 3] }];
    const ops = junctionFilletOps({ features: [{ type: 'fillet', radius: 3 }] } as never, 'F4', edges, null)!;
    expect((ops[0] as unknown as { feature: { radius: number } }).feature.radius).toBe(3);
  });
});
