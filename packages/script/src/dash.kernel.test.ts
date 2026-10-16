import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';
import { dashScript } from './dash';

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
  return { h, session: () => sessions.at(-1)! };
}

describe('speedboat dash', () => {
  it('builds', async () => {
    const only = (process.env.DASH_ONLY ?? '').split(',').filter(Boolean);
    const { h, session } = await host();
    const t0 = Date.now();
    const r = await runScript(dashScript({ ...(only.length ? { only } : {}), lens: !process.env.DASH_NOLENS }), h);
    const mp = (await session().massProps()) as { volume: number };
    const val = (await (session() as unknown as { validate(): Promise<unknown> }).validate?.()) as unknown;
    console.log('DASH', JSON.stringify(r.errors).slice(0, 800), 'features', (r.document as { features: unknown[] }).features.length, 'vol', mp.volume.toFixed(1), Date.now() - t0, 'ms', JSON.stringify(val).slice(0, 300));
    if (process.env.DASH_OUT) writeFileSync(process.env.DASH_OUT, JSON.stringify(r.document, null, 1));
    expect(r.errors).toEqual([]);
    expect((val as { ok: boolean }).ok).toBe(true);
    if (!only.length && !process.env.DASH_NOLENS) {
      expect(mp.volume).toBeGreaterThan(300000);   // panel ~259.7k mm3 + 4 bezels, dials, lenses, screws, lamps ~ 49.6k
      expect(mp.volume).toBeLessThan(320000);
      expect((r.document as { features: unknown[] }).features.length).toBeLessThan(200);
      expect(Date.now() - t0).toBeLessThan(60000);
    }
  }, 900000);
});
