import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

// The PET bottle sample with its threaded neck and screw cap (THREAD = 1): a swept helical ridge on the neck, a matching one inside the cap.
const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

const script = () => readFileSync(resolve(process.cwd(), 'docs/examples/pet-bottle-shell.script.ts'), 'utf8');
const sampleFile = () => resolve(process.cwd(), 'apps/cad/public/samples/pet-bottle.ckpart');
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
  return { r, controller, s: sessions.at(-1)! };
}
const vol = async (s: Session) => { const m = await s.massProps({ bodies: true }); return { total: m.volume!, bodies: (m.bodies ?? []).map((b) => b.volume) }; };

describe('PET bottle: threaded neck and screw cap', () => {
  it('plain neck and cap (THREAD = 0): two bodies, the plain volumes', async () => {
    const { r, s } = await run(script().replace('THREAD: 1', 'THREAD: 0') + `\nP.expectValid();\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const v = await vol(s);
    expect(v.bodies[0]).toBeCloseTo(14559.6, 0);
    expect(v.bodies[1]).toBeCloseTo(2738.9, 0);
  }, 300_000);

  it('threaded: valid, two bodies, thread and grip volumes, no contact between neck and cap', async () => {
    const { r, s, controller } = await run(script() + `\nP.expectValid().expectBBox({ min: [-33, -33, 0], max: [33, 33, 207.4] }, { tol: 0.05 });\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    const v = await vol(s);
    expect(v.bodies).toHaveLength(2);
    expect(v.total).toBeCloseTo(v.bodies[0] + v.bodies[1], 3);                 // no overlap counted twice
    expect(v.bodies[0]).toBeGreaterThan(14560 + 150); expect(v.bodies[0]).toBeLessThan(14560 + 260);   // neck ridge about 200 mm3
    expect(v.bodies[1]).toBeGreaterThan(2739 + 250); expect(v.bodies[1]).toBeLessThan(2739 + 450);     // cap ridge about 350 mm3 less the grip grooves (about 60)
    // every non-adjacent pair of faces closer than 0.1 mm would be a contact between neck and cap (the neck and cap walls are 0.35 and 1.4 mm apart from nothing else)
    const c = await s.clearance({ min: 0.1, include: 'gap', limit: 20 } as never);
    expect(c.pairs.map((p) => `${p.a} ${p.b} ${p.distance}`)).toEqual([]);
    const v2 = await s.verify();
    expect(v2.regen.errors).toEqual([]);
    const step = String(await controller.exportStep());
    expect(step.match(/MANIFOLD_SOLID_BREP/g)?.length).toBe(2);
  }, 300_000);

  it('fewer turns, a finer pitch, no grip and a thicker wall still build valid solids', async () => {
    const { r, s } = await run(script().replace('TURNS: 2', 'TURNS: 1.5').replace('PITCH: 2.7', 'PITCH: 2.5').replace('GRIP: 30', 'GRIP: 0').replace('WALL: 0.35', 'WALL: 0.5') + `\nP.expectValid();\n`);
    expect(r.errors.map((e) => e.message)).toEqual([]);
    expect((await vol(s)).bodies).toHaveLength(2);
  }, 300_000);

  it('the bundled sample is the script as it stands now and opens without errors', async () => {
    const doc = JSON.parse(readFileSync(sampleFile(), 'utf8')) as PartDoc & { script: string; bodyNames?: Record<string, string> };
    expect(doc.script).toBe(script());
    const { r } = await run(script());
    expect(JSON.stringify((r.document as unknown as { features: unknown }).features)).toBe(JSON.stringify(doc.features));
    const controller = await mk();
    await controller.load(doc);
    const s = sessions.at(-1)!;
    expect((await s.verify()).regen.errors).toEqual([]);
    expect((await vol(s)).bodies).toHaveLength(2);
    expect(doc.features.find((f) => f.id === 'F3')).toMatchObject({ op: 'newBody', body: 'Bottle' });
  }, 300_000);
});
