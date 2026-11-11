import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });
async function run(code: string) {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  return runScript(code, h);
}
const msgs = (r: { errors: Array<{ message: string }> }) => r.errors.map((e) => e.message);

describe('script expectations', () => {
  it('expectVolume: relative tolerance by default, absolute with abs, message in the documented form', async () => {
    const block = "const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);\n";
    expect(msgs(await run(block + 'p.expectVolume(24000, { tolerance: 1e-6 }).expectVolume(24010, { tolerance: 1e-3 }).expectVolume(24500, { abs: 600 });'))).toEqual([]);
    const bad = await run(block + 'p.expectVolume(25000, { tolerance: 1e-6 });\np.expectVolume(25000, { abs: 10 });');
    expect(msgs(bad)).toEqual(['expected volume 25000, got 24000 (tolerance 1e-6 relative)', 'expected volume 25000, got 24000 (tolerance 10 mm3 absolute)']);
    expect(bad.errors.map((e) => e.line)).toEqual([2, 3]);
  }, 120000);

  it('expectBBox: absolute tolerance, size, and a message that names the key', async () => {
    const block = "const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);\n";
    expect(msgs(await run(block + 'p.expectBBox({ min: [-20, -15, 0], max: [20, 15, 20], size: [40, 30, 20] }, { tolerance: 1e-3 });'))).toEqual([]);
    expect(msgs(await run(block + 'p.expectBBox({ max: [20, 15, 21] });'))).toEqual(['expected bbox max [20, 15, 21], got [20, 15, 20] (tolerance 0.001)']);
  }, 120000);

  it('expectBBox reads true extents of round and free-form bodies to a few 1e-3 mm', async () => {
    expect(msgs(await run("part('p').sketch('front', (s) => s.spline([[0, 0], [20, 10], [30, 30], [10, 40], [-10, 20]], { closed: true })).extrude(6).expectBBox({ min: [-10.041, -0.426, 0], max: [30.426, 40.041, 6] }, { tolerance: 1e-2 });"))).toEqual([]);
    expect(msgs(await run("part('c').sketch('front', (s) => s.circle(5, [100, 0])).extrude(10).expectBBox({ size: [10, 10, 10], min: [95, -5, 0] });"))).toEqual([]);
  }, 120000);

  it('expectMinFaceArea finds a sliver face and names it', async () => {
    const plate = "const p = part('Plate').sketch('front', (s) => s.rect(20, 20)).extrude(0.02);\n";
    expect(msgs(await run(plate + 'p.expectMinFaceArea(0.3);'))).toEqual([]);   // the side faces are 20 x 0.02 = 0.4 mm2
    const bad = await run(plate + 'p.expectMinFaceArea(1);');
    expect(msgs(bad)).toHaveLength(1);
    expect(msgs(bad)[0]).toMatch(/^expected every face to be at least 1 mm2, the smallest is face F\d+\S* with 0\.4/);
  }, 120000);

  it('{ body } measures one named body; an unknown name lists the bodies', async () => {
    const two = `const p = part('Two').sketch('front', (s) => s.rect(40, 30)).extrude(20, { newBody: 'Block' });
p.sketch('front', (s) => s.circle(5, [100, 0])).extrude(10, { newBody: 'Pin' });
`;
    const ok = await run(two + `p.expectVolume(24000, { body: 'Block', tolerance: 1e-6 }).expectVolume(Math.PI * 25 * 10, { body: 'Pin', tolerance: 1e-3 });
p.expectBBox({ min: [-20, -15, 0], max: [20, 15, 20] }, { body: 'Block' }).expectBBox({ min: [95, -5, 0], max: [105, 5, 10] }, { body: 'Pin', tolerance: 0.06 });
p.expectMinFaceArea(100, { body: 'Block' });
p.expectBBox({ min: [-20, -15, 0], max: [105, 15, 20] });`);
    expect(msgs(ok)).toEqual([]);
    const bad = await run(two + "p.expectVolume(24000, { body: 'Pin' });\np.expectVolume(1, { body: 'Nope' });\np.expectMinFaceArea(100, { body: 'Pin' });");
    expect(msgs(bad)[0]).toMatch(/^expected volume of body 'Pin' 24000, got 785\.39/);
    expect(msgs(bad)[1]).toBe("no body named 'Nope': the part has 'Block', 'Pin'");
  }, 120000);

  it('reports one row per check: passing rows with what was checked, failing rows with the message (also in errors)', async () => {
    const r = await run("const p = part('Block').sketch('front', (s) => s.rect(40, 30)).extrude(20);\np.expectVolume(24000, { tolerance: 1e-6 }).expectMinFaceArea(100).expectBBox({ size: [40, 30, 20] });\np.expectVolume(25000, { tolerance: 1e-6 });");
    expect(r.checks?.map((c) => [c.line, c.ok])).toEqual([[2, true], [2, true], [2, true], [3, false]]);
    expect(r.checks?.[0].message).toBe('volume 24000 (1e-6)');
    expect(r.checks?.[3].message).toBe('expected volume 25000, got 24000 (tolerance 1e-6 relative)');
    expect(r.errors).toHaveLength(1);
  }, 120000);
});
