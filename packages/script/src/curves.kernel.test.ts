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
  const r = await runScript(code, h);
  return { r, vol: async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume };
}

describe('function-driven curves', () => {
  it('s.polar draws a wavy disc: valid, and its area matches the integral of r^2 / 2', async () => {
    const { r, vol } = await run("part('Wavy').sketch('front', (s) => s.polar((a) => 30 + 1.5 * Math.cos(12 * a), { count: 120 })).extrude(5).expectValid();");
    expect(r.errors).toEqual([]);
    const area = 0.5 * (900 * 2 * Math.PI + 2.25 * Math.PI);   // integral of (30 + 1.5 cos 12a)^2 / 2 over a full turn
    expect(Math.abs((await vol()) / 5 - area) / area).toBeLessThan(2e-3);
  }, 120000);
  it('s.curve with closed: true is a loft section and the loft is a valid solid', async () => {
    const { r, vol } = await run(`const ring = (rad) => (s) => s.curve((a) => [rad * Math.cos(a), rad * Math.sin(a)], { from: 0, to: 2 * Math.PI, count: 48, closed: true });
part('Cone').loft([{ on: at('top', 0), draw: ring(20) }, { on: at('top', 30), draw: ring(10) }], { newBody: 'Cone' }).expectValid();`);
    expect(r.errors).toEqual([]);
    const frustum = Math.PI * 30 / 3 * (400 + 200 + 100);
    expect(Math.abs((await vol()) - frustum) / frustum).toBeLessThan(0.01);
  }, 120000);
  it('the documented wave loft (polar sections at two sizes) is a valid solid', async () => {
    const { r, vol } = await run(`const wave = (r) => (s) => s.polar((a) => r * (1 - 0.1 * (1 - Math.cos(8 * a)) / 2), { count: 96 });
part('Taper').loft([{ on: at('top', 0), draw: wave(30) }, { on: at('top', 20), draw: wave(18) }], { newBody: 'Taper' }).expectValid();`);
    expect(r.errors).toEqual([]);
    const v = await vol();
    expect(v).toBeGreaterThan(20 * Math.PI * 18 * 18 * 0.9); expect(v).toBeLessThan(20 * Math.PI * 30 * 30);
  }, 120000);
});
