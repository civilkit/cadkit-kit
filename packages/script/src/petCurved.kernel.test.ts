import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// The PET bottle with curved petal grooves (each groove a round tube swept along a sketch3d spline, cavity cut by the same paths one wall wider)
// and the optional rounded groove floor of the straight-groove bottle (PETAL_FILLET, built by rounding each cutting tool before it cuts).
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const curved = () => readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle-curved.script.ts'), 'utf8');
const grooved = () => readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle.script.ts'), 'utf8');
const sampleFile = () => resolve(process.cwd(), 'apps/cad/public/samples/pet-bottle-curved.ckpart');
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

describe('PET bottle, curved petals', () => {
  it('is a valid solid with the 500 ml size, a bottle and a cap, and a volume close to the straight-groove bottle', async () => {
    const { r, s } = await run(curved() + `\nP.expectValid().expectBBox({ min: [-33, -33, 0], max: [33, 33, 207.4] }, { tol: 0.05 });\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const m = await bodies(s);
    expect(m.bodies).toHaveLength(2);                                   // the bottle (grooves, ribs and cavity are used up) and the cap
    const bottle = m.bodies.find((b) => b.name === 'Upper')!;
    expect(bottle.volume).toBeGreaterThan(14500); expect(bottle.volume).toBeLessThan(15300);   // the straight-groove bottle is 15272
    expect((await s.verify()).regen.errors).toEqual([]);
  }, 300_000);

  it('builds without twist, with other numbers of feet and a thicker wall', async () => {
    for (const [from, to] of [['SWIRL: 15', 'SWIRL: 0'], ['FEET: 5', 'FEET: 3'], ['FEET: 5', 'FEET: 6'], ['WALL: 0.35', 'WALL: 0.5']]) {
      const { r } = await run(curved().replace(from, to).replace('CAP: 1', 'CAP: 0') + `\nP.expectValid();\n`);
      expect(r.errors.map((e) => e.message), to).toEqual([]);
    }
  }, 900_000);

  it('the bundled sample is the script as it stands now and opens without errors', async () => {
    const doc = JSON.parse(readFileSync(sampleFile(), 'utf8')) as PartDoc & { script: string };
    expect(doc.script).toBe(curved());
    const { r } = await run(curved());
    expect(JSON.stringify((r.document as unknown as { features: unknown }).features)).toBe(JSON.stringify(doc.features));
    const controller = await mk();
    await controller.load(doc);
    expect((await sessions.at(-1)!.verify()).regen.errors).toEqual([]);
  }, 300_000);
});

describe('PET bottle with straight grooves: rounded groove floor (PETAL_FILLET)', () => {
  // The kernel cannot fillet the groove edges on the finished cup (blendOverflow / blendFailed / blendUnsupported: see docs/pet-petal-fillet.md),
  // so each groove is cut by its own tool whose top edge is rounded; that needs rounded tips (TIP) so the tool's outline is one tangent chain.
  it('TIP 5 and PETAL_FILLET 2 give a valid bottle of nearly the same volume as the sharp grooves', async () => {
    const plain = await run(grooved().replace('CAP: 1', 'CAP: 0') + `\nP.expectValid();\n`);
    expect(plain.r.errors.map((e) => e.message)).toEqual([]);
    const v0 = (await bodies(plain.s)).bodies.find((b) => b.name === 'Upper')!.volume;
    const round = await run(grooved().replace('TIP: 0, PETAL_FILLET: 0', 'TIP: 5, PETAL_FILLET: 2').replace('CAP: 1', 'CAP: 0') + `\nP.expectValid();\n`);
    expect(round.r.errors.map((e) => e.message)).toEqual([]);
    const m = await bodies(round.s);
    expect(m.bodies).toHaveLength(1);
    expect(Math.abs(m.bodies[0].volume - v0) / v0).toBeLessThan(0.01);
  }, 600_000);
});
