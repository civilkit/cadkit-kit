import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, EXAMPLES, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

async function host() {
  const store = createStore();
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store, view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
  };
  return { h, volume: async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume };
}

// BenchCAD ground-truth volumes (tools/bench/benchcad/manifest.json of the kernel repo), CC-BY-4.0
const REF: Record<string, number> = {
  'bc-pulley': 315628.4374, 'bc-washer': 11087.95596, 'bc-hex-nut': 45.891956489991564,
  'bc-enclosure': 100770.1092, 'bc-motor-end-cap': 245873.66139676693,
};
describe('BenchCAD example scripts', () => {
  for (const [id, ref] of Object.entries(REF)) {
    it(`${id} within 1e-3 of the reference volume`, async () => {
      const { h, volume } = await host();
      const r = await runScript(EXAMPLES.find((e) => e.id === id)!.code, h);
      expect(r.errors).toEqual([]);
      const v = await volume();
      console.log(`${id}: ours ${v} ref ${ref} rel ${((v - ref) / ref).toExponential(2)}`);
      expect(Math.abs(v - ref) / ref).toBeLessThan(1e-3);
    }, 60000);
  }
});
