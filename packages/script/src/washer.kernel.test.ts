import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; bbox: { min: number[]; max: number[]; size: number[] }; newBodies: number }
async function build(body: string): Promise<Out> {
  const kernel: KernelFactory = { async open(d) { const s = await Session.open(d); sessions.push(s); return s; } };
  const controller = new Controller({ store: createStore(), view: { setBody() {}, setHighlight() {}, setSketchEdit() {} }, kernel });
  await controller.load(emptyPart('x') as never);
  const h: ScriptHost = {
    load: (d) => controller.load({ ...emptyPart('x'), ...d } as unknown as PartDoc),
    edit: (ops, why) => controller.edit(ops, why) as never,
    geometry: () => ({ mesh: controller.bodyFaces(), edges: controller.bodyEdges(), box: controller.bodyBox() }),
    build: (d, v) => controller.scratchBuild(d as never, v) as never, release: () => controller.scratchRelease(), facts: (n) => controller.scratchFacts(n),
  };
  const code = body + `
const vol = await p.volume(); const ok = await p.isValid(); const bb = await p.bbox();
throw new Error('KN' + JSON.stringify({ vol, ok, bbox: bb }));
`;
  const r = await runScript(code, h);
  const e = r.errors.find((x) => x.message.startsWith('KN'));
  if (!e) throw new Error('script failed: ' + r.errors.map((x) => x.message).join(' | '));
  const newBodies = ((controller.document()?.features ?? []) as unknown as Array<{ type: string; op?: string }>).filter((f) => f.type === 'extrude' && f.op === 'newBody').length;
  return { ...(JSON.parse(e.message.slice(2)) as Out), newBodies };
}
const near = (v: number, want: number, tol = 0.002) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };

describe('washer()', () => {
  it('a flat washer is the annulus times the thickness, hanging down from the origin', async () => {
    const o = await build(`const p = part('W').washer({ inner: 8.4, outer: 16, thickness: 1.6 });`);
    near(o.vol, Math.PI * (8 * 8 - 4.2 * 4.2) * 1.6);
    expect(o.ok).toBe(true);
    near(o.bbox.size[0], 16); near(o.bbox.size[2], 1.6);
    expect(o.bbox.max[2]).toBeLessThan(1e-6); expect(o.bbox.min[2]).toBeCloseTo(-1.6, 5);
  });
  it('a spring washer is the ring less the gap, and the axis moves it', async () => {
    const ring = Math.PI * (7.4 * 7.4 - 4.05 * 4.05) * 2;
    const o = await build(`const p = part('W').washer({ kind: 'spring', inner: 8.1, outer: 14.8, thickness: 2, gap: 2, origin: [0, 0, 5], axis: [0, 0, 1] });`);
    expect(o.ok).toBe(true);
    expect(o.vol).toBeLessThan(ring); expect(o.vol).toBeGreaterThan(ring * 0.9);
    near(o.bbox.min[2], 5, 0.001); near(o.bbox.max[2], 7, 0.001);
  });
  it('puts the washer where origin and axis say, on each axis', async () => {
    const origin = [2, 5, 3];
    for (const axis of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const o = await build(`const p = part('W').washer({ inner: 8.4, outer: 16, thickness: 1.6, origin: [2, 5, 3], axis: ${JSON.stringify(axis)} });`);
      expect(o.ok).toBe(true);
      near(o.vol, Math.PI * (64 - 4.2 * 4.2) * 1.6);
      for (let i = 0; i < 3; i++) {
        const lo = axis[i] === 0 ? origin[i] - 8 : Math.min(origin[i], origin[i] + 1.6 * axis[i]), hi = axis[i] === 0 ? origin[i] + 8 : Math.max(origin[i], origin[i] + 1.6 * axis[i]);
        expect(o.bbox.min[i], `${axis} min ${i}`).toBeCloseTo(lo, 1); expect(o.bbox.max[i], `${axis} max ${i}`).toBeCloseTo(hi, 1);
      }
    }
  });
  it('is its own body (newBody) next to what it touches', async () => {
    const o = await build(`const p = part('W').sketch('front', (s) => s.rect(30, 30)).extrude(4).washer({ inner: 8.4, outer: 16, thickness: 1.6, origin: [0, 0, 4], axis: [0, 0, 1] });`);
    expect(o.newBodies).toBe(1);   // the washer is a new body, the plate is not
  });
  it('refuses bad numbers with a washer() message', async () => {
    await expect(build(`const p = part('W').washer({ inner: 10, outer: 8, thickness: 1 });`)).rejects.toThrow(/washer\(\): outer/);
  });
});
