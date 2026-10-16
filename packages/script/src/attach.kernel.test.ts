import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const slabDoc = (): PartDoc => ({
  ...emptyPart('Slab'),
  variables: [{ name: 'depth', expr: '20' }],
  features: [
    { type: 'sketch', id: 'F1', plane: { kind: 'std', id: 'front' }, points: [{ id: 'O', x: 0, y: 0, fixed: true }, { id: 'p1', x: -50, y: -50 }, { id: 'p2', x: 50, y: -50 }, { id: 'p3', x: 50, y: 50 }, { id: 'p4', x: -50, y: 50 }],
      entities: [['e1', 'p1', 'p2'], ['e2', 'p2', 'p3'], ['e3', 'p3', 'p4'], ['e4', 'p4', 'p1']].map(([id, a, b]) => ({ id, type: 'line', p1: a, p2: b })), constraints: [] },
    { type: 'extrude', id: 'F2', op: 'add', sketch: 'F1', end: 'blind', depth: '=depth' },
  ],
  seq: 3,
}) as unknown as PartDoc;

async function attach(code: string) {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const doc = slabDoc();
  await controller.load(doc);
  const host: ScriptHost = {
    load: async () => {}, edit: async () => ({ ok: true }), geometry: () => ({ mesh: null, edges: [], box: null }),
    build: (d, view) => controller.scratchBuild(d as never, view) as never, release: () => controller.scratchRelease(), facts: (need) => controller.scratchFacts(need),
  };
  const r = await runScript(code, host, { variables: (doc as unknown as { variables: unknown[] }).variables }, { prefix: { features: doc.features as never, seq: doc.seq } });
  return r;
}

describe('attach mode', () => {
  it('a loft between a face and an at(face, h) plane builds (the helpers share the sketch() plane builder)', async () => {
    const r = await attach(`part('P').loft([
  { on: face('F2.C1'), draw: (s) => s.rect(40, 30, [10, -5]) },
  { on: at(face('F2.C1'), 25), draw: (s) => s.rect(20, 15, [10, -5]) },
]);`);
    expect(r.errors).toEqual([]);
    expect(r.ops.map((o) => o.feature.type)).toEqual(['sketch', 'plane', 'sketch', 'loft']);
  });
  it('the open document\'s variables stay defined while the script builds and are kept next to the script\'s own', async () => {
    const r = await attach(`variables({ h2: 4 }); part('P').sketch(face('F2.C1'), (s) => s.rect(10, 10)).extrude(expr('h2 * 2'));`);
    expect(r.errors).toEqual([]);
    expect((r.document as { variables: Array<{ name: string }> }).variables.map((v) => v.name)).toEqual(['depth', 'h2']);
  });
  it('computed arc end points close the profile (sketch points keep their precision)', async () => {
    for (const ang of [58.6, 33.3, 121.7, 7.1]) {
      const r = await attach(`const a = ${ang} * Math.PI / 180, R = 16.8; const e = [R * Math.cos(a), R * Math.sin(a)];
part('P').sketch(face('F2.C1'), (s) => s.line([0, 0], [R, 0]).arc([0, 0], [R, 0], e).line(e, [0, 0])).extrude(3);`);
      expect(r.errors, String(ang)).toEqual([]);
    }
  });
});
