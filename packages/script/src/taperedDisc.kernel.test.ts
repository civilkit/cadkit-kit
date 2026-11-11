import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// The tapered spinning disc sample: one lofted wave-section body trimmed by a cylinder, and its optional underside recess (POCKET).
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const disc = () => readFileSync(resolve(process.cwd(), 'docs/examples/tapered-disc.script.ts'), 'utf8');
const sampleFile = () => resolve(process.cwd(), 'apps/cad/public/samples/tapered-disc.ckpart');
const mk = async () => {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  return controller;
};
async function run(code: string) {
  const controller = await mk();
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const r = await runScript(code, h);
  return { r, s: sessions.at(-1)! };
}
const bodies = async (s: Session) => ((await s.massProps({ bodies: true })) as { volume: number; bodies: Array<{ name?: string; volume: number }> });


describe('tapered disc', () => {
  it('is one valid solid of about 79 000 mm3, 120 x 120 x 18, with a plain circular edge', async () => {
    const { r, s } = await run(disc() + `\nP.expectValid().expectBBox({ min: [-60, 0, -60], max: [60, 18, 60] }, { tol: 0.05 });\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const m = await bodies(s);
    expect(m.bodies).toHaveLength(1);                                    // the loft and the cylinder are used up by the intersect
    expect(m.volume).toBeGreaterThan(77000); expect(m.volume).toBeLessThan(81000);
    expect((await s.verify()).regen.errors).toEqual([]);
  }, 300_000);

  it('keeps the original volume (78 968 mm3) within 0.1 % with N=12 K=0.28 R=60 T0=3, and its built-in checks pass', async () => {
    const { r, s } = await run(disc());
    expect(r.errors.map((e) => e.message)).toEqual([]);
    expect(r.checks?.length).toBe(3); expect(r.checks?.every((c) => c.ok)).toBe(true);
    const m = await bodies(s);
    expect(Math.abs(m.volume - 78968) / 78968).toBeLessThan(1e-3);
  }, 300_000);

  // R = 49 and 50 (and 40, 100) are known to fail the validity check: TESSELLATION_OPEN on the trimmed side wall's seam edge, with the body and its volume right
  it('regenerates with other numbers of ridges and other radii', async () => {
    for (const [from, to] of [['N: 12', 'N: 8'], ['N: 12', 'N: 16'], ['R: 60', 'R: 55'], ['R: 60', 'R: 80']]) {
      const { r, s } = await run(disc().replace(from, to) + `\nP.expectValid();\n`);
      expect(r.errors.map((e) => e.message), to).toEqual([]);
      expect((await bodies(s)).bodies, to).toHaveLength(1);
      expect((await s.verify()).regen.errors, to).toEqual([]);
    }
  }, 900_000);

  it('POCKET = 1 hollows the underside (about half the material) and stays one valid solid; the skin keeps it closed', async () => {
    for (const [from, to] of [['POCKET: 0', 'POCKET: 1'], ['N: 12, K: 0.28, R: 60, T0: 3, POCKET: 0', 'N: 8, K: 0.28, R: 70, T0: 3, POCKET: 1']]) {
      const solid = (await bodies((await run(disc().replace(from, to.replace('POCKET: 1', 'POCKET: 0')))).s)).volume;
      const { r, s } = await run(disc().replace(from, to) + `\nP.expectValid();\n`);
      expect(r.errors.map((e) => e.message), to).toEqual([]);
      const m = await bodies(s);
      expect(m.bodies, to).toHaveLength(1);
      expect(m.volume, to).toBeLessThan(solid * 0.6);
      expect(m.volume, to).toBeGreaterThan(solid * 0.2);
      expect((await s.verify()).regen.errors, to).toEqual([]);
    }
  }, 900_000);

  it('the bundled sample is the script as it stands now and opens without errors', async () => {
    const doc = JSON.parse(readFileSync(sampleFile(), 'utf8')) as PartDoc & { script: string };
    expect(doc.script).toBe(disc());
    const { r } = await run(disc());
    expect(JSON.stringify((r.document as unknown as { features: unknown }).features)).toBe(JSON.stringify(doc.features));
    const controller = await mk();
    await controller.load(doc);
    expect((await sessions.at(-1)!.verify()).regen.errors).toEqual([]);
  }, 300_000);
});
