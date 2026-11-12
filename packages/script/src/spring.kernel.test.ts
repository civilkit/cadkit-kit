import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, type ScriptHost } from './index';

const sessions: Session[] = [];
afterEach(async () => { await Promise.all(sessions.splice(0).map((s) => s.close().catch(() => {}))); });

interface Out { vol: number; ok: boolean; bbox: { min: number[]; max: number[]; size: number[] } }
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
  return JSON.parse(e.message.slice(2)) as Out;
}
const near = (v: number, want: number, tol = 0.002) => { expect(v).toBeGreaterThan(want * (1 - tol)); expect(v).toBeLessThan(want * (1 + tol)); };

describe('spring()', () => {
  // closed form: wire section area x the length of the helix's centre line is how the kernel counts a section carried in the axial plane (A x 2 pi R x turns)
  const A = Math.PI, R = 9, N = 10;
  it('a compression spring fills its length along z from the origin and has the right volume', async () => {
    const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 42, coils: 10 });`);
    expect(o.ok).toBe(true);
    near(o.vol, A * 2 * Math.PI * R * N);
    near(o.bbox.size[2], 42, 0.001); expect(o.bbox.min[2]).toBeCloseTo(0, 1);   // the wire's end section is square to the wire, tilted by the pitch angle: about 0.01 mm in
    near(o.bbox.size[0], 20, 0.002);
  });
  it('puts the spring where origin and axis say, on each axis and either way', async () => {
    const origin = [2, 5, 3];
    for (const axis of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 42, coils: 10, origin: [2, 5, 3], axis: ${JSON.stringify(axis)} });`);
      expect(o.ok, `${axis}`).toBe(true);
      near(o.vol, A * 2 * Math.PI * R * N);
      for (let i = 0; i < 3; i++) {
        const lo = axis[i] === 0 ? origin[i] - 10 : Math.min(origin[i], origin[i] + 42 * axis[i]), hi = axis[i] === 0 ? origin[i] + 10 : Math.max(origin[i], origin[i] + 42 * axis[i]);
        expect(o.bbox.min[i], `${axis} min ${i}`).toBeCloseTo(lo, 0); expect(o.bbox.max[i], `${axis} max ${i}`).toBeCloseTo(hi, 0);
      }
    }
  }, 120000);
  it('a left-hand spring has the same size and volume and winds the other way', async () => {
    const r = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 42, coils: 0.25 });`);
    const l = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 42, coils: 0.25, hand: 'left' });`);
    expect(r.ok && l.ok).toBe(true);
    near(l.vol, r.vol);
    // a quarter turn from +x: right-hand about +z goes to +y, left-hand to -y
    expect(r.bbox.max[1]).toBeGreaterThan(5); expect(r.bbox.min[1]).toBeGreaterThan(-1.5);
    expect(l.bbox.min[1]).toBeLessThan(-5); expect(l.bbox.max[1]).toBeLessThan(1.5);
  });
  it('refuses numbers that cannot make a spring, with the reason', async () => {
    const bad = (opts: string) => build(`const p = part('S').spring(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad('{ outer: 3, wire: 2, length: 20, coils: 5 }')).toMatch(/twice the wire/);
    expect(await bad('{ outer: 20, wire: 2, length: 20, coils: 20 }')).toMatch(/pitch/);
    expect(await bad('{ outer: 20, wire: 2, length: 20, coils: 5, axis: [1, 1, 0] }')).toMatch(/along x, y or z/);
  });
});
