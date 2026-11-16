import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
const opened: Session[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((s) => s.close().catch(() => {}))); });
async function rig() {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); opened.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('start'));
  const host: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: async (ops, why) => (await controller.edit(ops, why)) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d: Record<string, unknown>, v: boolean) => controller.scratchBuild(d as never, v) as never,
    release: () => controller.scratchRelease(),
    facts: (n: { mass?: boolean; validate?: boolean; describe?: string[] }) => controller.scratchFacts(n),
  };
  return { host };
}
const code = (axis: 'x' | 'y' | 'z', rr: number, R: number, fr: number) => {
  const n = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
  const xd = axis === 'x' ? [0, 1, 0] : [1, 0, 0];
  return `const p = part('T').feature({ type: 'sphere', center: [0,0,0], radius: ${R} })
 .sketch(at({ origin: [0,0,0], normal: ${JSON.stringify(n)}, xdir: ${JSON.stringify(xd)} }), (s) => s.circle(${rr})).extrude(30);
p.fillet(edges({ lengthGreater: ${(2*Math.PI*rr*0.9).toFixed(3)}, lengthLess: ${(2*Math.PI*rr*1.1).toFixed(3)}, inside: [[-${R},-${R},-${R}],[${R},${R},${R}]] }), ${fr});`;
};
describe('rod-sphere fillet', () => {
  for (const axis of ['x', 'y', 'z'] as const) for (const [rr, R, fr] of [[2, 7.5, 1.5], [2, 7.5, 2], [2, 10, 1], [4, 15, 1.5]] as const) {
    it(`${axis} rod ${rr} sphere ${R} fillet ${fr}`, async () => {
      const r = await rig();
      const res = await runScript(code(axis, rr, R, fr), r.host);
      console.log('RSF', axis, rr, R, fr, JSON.stringify(res.errors).slice(0, 300));
    }, 120000);
  }
});
