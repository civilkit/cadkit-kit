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
    const r = await runScript(dashScript({ ...(only.length ? { only } : {}), lens: !process.env.DASH_NOLENS, letters: !process.env.DASH_NOLETTERS }), h);
    expect(r.errors).toEqual([]);
    const mp = (await session().massProps()) as { volume: number };
    const mb = (await session().massProps({ bodies: true })) as { bodies?: { volume: number }[] };
    console.log('LUMPS', mb.bodies?.length, JSON.stringify(mb.bodies?.slice(0, 3)));
    const val = (await (session() as unknown as { validate(): Promise<unknown> }).validate?.()) as unknown;
    console.log('DASH', JSON.stringify(r.errors).slice(0, 800), 'features', (r.document as { features: unknown[] }).features.length, 'vol', mp.volume.toFixed(1), Date.now() - t0, 'ms', JSON.stringify(val).slice(0, 300));
    if (process.env.DASH_OUT) writeFileSync(process.env.DASH_OUT, JSON.stringify(r.document, null, 1));
    expect(r.errors).toEqual([]);
    expect((val as { ok: boolean }).ok).toBe(true);
    if (!only.length && !process.env.DASH_NOLENS) {
      expect(mb.bodies?.length ?? 0).toBeGreaterThanOrEqual(36);   // panel + 4 x (bezel, dial, red inlay x2, needle, cap, lens) + screws, plate, rivets, lamps
      expect(mp.volume).toBeGreaterThan(310000);   
      expect(mp.volume).toBeLessThan(335000);
      expect((r.document as { features: unknown[] }).features.length).toBeLessThan(200);
      const d = r.document as { appearance?: Record<string, { opacity?: number; finish?: string }>; bodyNames?: Record<string, string>; faceAppearance?: Record<string, unknown> };
      expect(Object.values(d.appearance ?? {}).filter((l) => l.finish === 'glass' && (l.opacity ?? 1) <= 0.2)).toHaveLength(4);   // the four gauge lenses (the lamp lenses are denser)
      expect(Object.values(d.bodyNames ?? {})).toEqual(expect.arrayContaining(['Tach lens', 'Dash panel', 'Knots bezel']));
      expect(Object.keys(d.faceAppearance ?? {}).every((k) => /^F\d+\.\*$/.test(k))).toBe(true);
      // lettering: numerals + captions of the four dials are ONE fused emboss with black-ink faces; the nameplate is engraved
      const feats = (r.document as { features: Array<{ name?: string; op?: string; group?: string }> }).features;
      expect(feats.some((f) => f.group === 'Dial lettering' && f.op === 'add')).toBe(true);
      expect(feats.some((f) => f.name === 'Cut Nameplate lettering')).toBe(true);
      expect(Object.values(d.faceAppearance ?? {}).filter((l) => (l as { color?: string }).color === '#17181a').length).toBeGreaterThanOrEqual(5);   // 4 tick sketches + the lettering
      expect(Date.now() - t0).toBeLessThan(60000);
    }
  }, 900000);
});
