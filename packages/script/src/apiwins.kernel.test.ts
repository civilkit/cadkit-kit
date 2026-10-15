import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, resolveEdges, face, edges, type ScriptHost } from './index';

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
  const mp = async () => (await sessions.at(-1)!.massProps()) as { volume: number };
  return { h, mp, controller };
}
const BASE = `part('B').sketch('front', (s) => s.rect(40, 30)).extrude(20)`;

describe('api wins on the kernel', () => {
  it('edge rules select the right edges of a box', async () => {
    const { h } = await host();
    const r = await runScript(BASE + ';', h);
    expect(r.errors).toEqual([]);
    const g = h.geometry();
    const n = (sel: Parameters<typeof resolveEdges>[0]) => resolveEdges(sel, g).length;
    const zs = edges('|Z');
    expect(n('all')).toBe(12);
    expect(n({ parallel: 'Z' })).toBe(4);
    expect(n({ not: zs })).toBe(8);
    expect(n({ onFace: face('>Z') })).toBe(4);
    expect(n({ lengthGreater: 25 })).toBe(8);            // 40 and 30 mm edges
    expect(n({ lengthLess: 25 })).toBe(4);
    expect(n({ near: [20, 15, 10], within: 1 })).toBe(1);
    expect(n({ parallel: 'Z', outside: [[-100, -100, -100], [0, 100, 100]] })).toBe(2);
    expect(n({ union: [zs, edges({ onFace: face('>Z') })] })).toBe(8);
    expect(n({ intersect: [zs, edges({ near: [20, 15, 10], within: 1 })] })).toBe(1);
    expect(n({ difference: [edges('all'), zs, edges({ onFace: face('>Z') })] })).toBe(4);
  }, 60000);
  it('fillets only the vertical edges outside a box', async () => {
    const { h, mp } = await host();
    const r = await runScript(BASE + `.fillet(edges({ parallel: 'Z', outside: [[-100, -100, -100], [0, 100, 100]] }), 2);`, h);
    expect(r.errors).toEqual([]);
    expect((await mp()).volume).toBeCloseTo(40 * 30 * 20 - 2 * (1 - Math.PI / 4) * 4 * 20, 1);
  }, 60000);
  it('revolves about an offset axis (cone)', async () => {
    const { h, mp } = await host();
    // right triangle: base radius 6 at height 0, apex at height 10, axis at x=10 (parallel to Y)
    const r = await runScript(`part('C').sketch('front', (s) => s.polygon([[10, 0], [16, 0], [10, 10]])).revolve(360, { axis: { from: [10, 0], to: [10, 10] } });`, h);
    expect(r.errors).toEqual([]);
    expect((await mp()).volume).toBeCloseTo(Math.PI * 36 * 10 / 3, 1);
  }, 60000);
  it('polar and grid hole arrays make one feature each', async () => {
    const { h, mp } = await host();
    let r = await runScript(`part('P').sketch('front', (s) => s.rect(80, 80)).extrude(10).holes.polar(face('>Z'), { center: [0, 0], radius: 25, count: 6, startAngle: 15 }, { diameter: 6 });`, h);
    expect(r.errors).toEqual([]);
    expect((await mp()).volume).toBeCloseTo(80 * 80 * 10 - 6 * Math.PI * 9 * 10, 0);
    const g = await host();
    r = await runScript(`part('G').sketch('front', (s) => s.rect(80, 60)).extrude(10).holes.grid(face('>Z'), { origin: [-20, -10], pitch: [20, 20], count: [3, 2] }, { diameter: 4, depth: 5 });`, g.h);
    expect(r.errors).toEqual([]);
    expect((await g.mp()).volume).toBeCloseTo(80 * 60 * 10 - 6 * Math.PI * 4 * 5, 0);
    const sketchOnly = await host();
    r = await runScript(`part('S').sketch('front', (s) => s.rect(80, 60)).extrude(10).sketch('top', (s) => s.polarPoints([0,0], 10, 3).grid([0,0],[5,5],[2,2]).points([[1,1]]));`, sketchOnly.h);
    expect(r.errors).toEqual([]);
  }, 120000);
});
