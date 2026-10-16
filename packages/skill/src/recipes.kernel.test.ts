import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from '../../script/src/index';
import { RECIPES } from './recipes';

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
  return { h, controller, session: () => sessions.at(-1)! };
}

export const measured: Record<string, unknown> = {};
describe('recipes run on the real kernel', () => {
  for (const r of RECIPES.filter((x) => x.kind !== 'guide')) {
    it(`${r.id}: volume, validity and feature count`, async () => {
      const { h, controller, session } = await host();
      if (r.kind === 'script') {
        const res = await runScript(r.code, h);
        expect(res.errors, JSON.stringify(res.errors)).toEqual([]);
      } else {
        const features = new Function(`return ${r.code}`)() as Array<Record<string, unknown>>;
        await controller.load({ ...emptyPart(r.id), features, seq: features.length + 1 } as unknown as PartDoc);
      }
      const s = session();
      const volume = ((await s.massProps()) as { volume: number }).volume;
      const valid = ((await s.validate()) as { ok: boolean }).ok;
      const nFeat = (controller.document() as { features: unknown[] }).features.length;
      console.log('RECIPE', r.id, 'volume', volume, 'valid', valid, 'features', nFeat);
      expect(valid).toBe(true);
      if (r.id === 'boat-hull-loft') {
        // independent check: the volume integrated from the areas of 80 sections along the hull agrees with the exact volume
        const sec = (await s.sections({ axis: 'x', n: 80 })) as { volume: number };
        expect(Math.abs(sec.volume - volume) / volume).toBeLessThan(5e-3);
      }
      const e = r.expected!;
      expect(nFeat).toBe(e.features);
      if (e.volume) expect(Math.abs(volume - e.volume) / e.volume).toBeLessThan(e.volumeTol);
      else expect(volume).toBeGreaterThan(0);
    }, 120000);
  }
});
