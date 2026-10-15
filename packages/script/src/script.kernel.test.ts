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
  const volume = async () => ((await sessions.at(-1)!.massProps()) as { volume: number }).volume;
  return { h, volume, controller };
}
const byId = (id: string) => EXAMPLES.find((e) => e.id === id)!.code;

describe('script examples on the kernel', () => {
  it('bracket: plate, two holes, rounded edges', async () => {
    const { h, volume } = await host();
    const r = await runScript(byId('bracket'), h);
    expect(r.errors).toEqual([]);
    const plate = 60 * 40 * 12, holes = 2 * Math.PI * 16 * 12, corners = 4 * (16 - Math.PI * 16 / 4) * 12;
    expect(await volume()).toBeCloseTo(plate - holes - corners, -1);
    expect((r.document as { script: string }).script).toContain('Bracket');
  }, 60000);
  it('flange: revolved profile', async () => {
    const { h, volume } = await host();
    const r = await runScript(byId('flange'), h);
    expect(r.errors).toEqual([]);
    const v = Math.PI * ((25 ** 2 - 10 ** 2) * 6 + (15 ** 2 - 10 ** 2) * 24);
    expect(await volume()).toBeCloseTo(v, -1);
  }, 60000);
  it('thin box: shell with the top open', async () => {
    const { h, volume } = await host();
    const r = await runScript(byId('box'), h);
    expect(r.errors).toEqual([]);
    const v = 50 * 30 * 20 - 46 * 26 * 18;
    expect(await volume()).toBeCloseTo(v, -1);
  }, 60000);
  it('reports the script line of a thrown error and of an unsupported selector', async () => {
    const { h } = await host();
    let r = await runScript(`part('A')\n  .sketch('front', (s) => s.rect(10, 10))\n  .extrude(5);\nthrow new Error('boom');`, h);
    expect(r.errors[0]).toMatchObject({ line: 4, message: 'boom' });
    r = await runScript(`part('A')\n  .sketch('front', (s) => s.rect(10, 10))\n  .extrude(5)\n  .fillet(edges('~Q'), 1);`, h);
    expect(r.errors[0].line).toBe(4);
    expect(r.errors[0].message).toContain("unsupported selector");
  }, 60000);
  it('cannot reach the page', async () => {
    const { h } = await host();
    const r = await runScript(`part('A'); document.title = 'x';`, h);
    expect(r.errors.length).toBe(1);
  }, 60000);
  it('sketch on a face, cut through, patterns, thin extrude, chamfer', async () => {
    const { h, volume } = await host();
    let r = await runScript(`part('P').sketch('front', (s) => s.rect(60, 40)).extrude(10)
  .sketch(face('>Z'), (s) => s.circle(3, [-20, 0])).cut(through())
  .linearPattern({ count: 3, spacing: 20, axis: 'x' })
  .chamfer(edges('>Z'), 1);`, h);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeLessThan(60 * 40 * 10 - 3 * Math.PI * 9 * 10 + 1);
    r = await runScript(`part('T').sketch('front', (s) => s.rect(30, 20)).extrude(15, { thin: 2 });`, h);
    expect(r.errors).toEqual([]);
    expect(await volume()).toBeCloseTo((32 * 22 - 28 * 18) * 15, -1);
    r = await runScript(`part('C').sketch('front', (s) => s.rect(30, 20)).extrude(5)
  .sketch(face('>Z'), (s) => s.circle(2, [10, 5])).cut(2).circularPattern({ count: 4, axis: 'z' });`, h);
    expect(r.errors).toEqual([]);
  }, 60000);
  it('rrect, arc3 (either direction) and offset planes', async () => {
    const { h, volume, controller } = await host();
    // rounded rectangle ring on a plane moved 100 along +z, and a separate half disc by three points (drawn clockwise)
    const r = await runScript(`part('R')
  .sketch(at('front', 100), (s) => { s.rrect(60, 40, 8); s.rrect(56, 36, 6); }).extrude(5)
  .sketch('top', (s) => s.arc3([10, 0], [5, 5], [0, 0]).line([0, 0], [10, 0])).extrude(2);`, h);
    expect(r.errors).toEqual([]);
    const ring = (60 * 40 - (4 - Math.PI) * 64) - (56 * 36 - (4 - Math.PI) * 36);
    expect(await volume()).toBeCloseTo(ring * 5 + Math.PI * 25 / 2 * 2, 0);
    const b = controller.bodyBox() as { min: number[]; max: number[] };
    expect(b.max[2]).toBeCloseTo(105, 5);
  }, 60000);
});
