import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '@ck/session';
import { emptyPart, type PartDoc } from '@ck/part-model';
import { createStore } from '@kit/store';
import { Controller, type KernelFactory } from '../../../apps/cad/src/controller';
import { runScript, extensionPath, torsionPath, type ScriptHost } from './index';

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

describe('spring() with closed and ground ends', () => {
  const A = Math.PI, R = 9, N = 8;
  it('closed ends: tight turns at both ends, still one valid solid of the right length and volume', async () => {
    const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 40, coils: 8, ends: 'closed' });`);
    expect(o.ok).toBe(true);
    near(o.vol, A * 2 * Math.PI * R * N, 0.005);
    near(o.bbox.size[2], 40, 0.005); expect(o.bbox.min[2]).toBeCloseTo(0, 1);
  }, 120000);
  it('ground ends: both ends are flat at exactly 0 and the free length', async () => {
    const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 40, coils: 8, ends: 'ground', name: 'Coil' });`);
    expect(o.ok).toBe(true);
    expect(Math.abs(o.bbox.min[2])).toBeLessThan(0.01); expect(Math.abs(o.bbox.max[2] - 40)).toBeLessThan(0.01);   // the box is the tessellation's: a few micrometres of slack
    expect(o.vol).toBeLessThan(A * 2 * Math.PI * R * N); expect(o.vol).toBeGreaterThan(A * 2 * Math.PI * R * N * 0.95);
  }, 180000);
  it('a left-hand ground spring pointing along -x from an offset origin has flat ends at the origin and the free length', async () => {
    const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 40, coils: 8, ends: 'ground', hand: 'left', name: 'Coil', origin: [2, 5, 3], axis: [-1, 0, 0] });`);
    expect(o.ok).toBe(true);
    expect(Math.abs(o.bbox.max[0] - 2)).toBeLessThan(0.01); expect(Math.abs(o.bbox.min[0] - (2 - 40))).toBeLessThan(0.01);
    near(o.bbox.size[1], 20, 0.01); near(o.bbox.size[2], 20, 0.01);
  }, 180000);
  it('refuses closed turns that leave no body', async () => {
    const bad = (opts: string) => build(`const p = part('S').spring(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad("{ outer: 20, wire: 2, length: 40, coils: 2.5, ends: 'closed' }")).toMatch(/at least 1/);
    expect(await bad("{ outer: 20, wire: 2, length: 40, coils: 8, ends: 'spiky' }")).toMatch(/ends must be/);
  });
});

describe('spring() cones and progressive pitch', () => {
  const A = Math.PI;
  it('a cone: 30 mm at the first end to 14 mm at the far end, one valid solid with the volume of the wire', async () => {
    const o = await build(`const p = part('S').spring({ outer: 30, wire: 2, length: 40, coils: 8, topOuter: 14 });`);
    expect(o.ok).toBe(true);
    near(o.vol, A * 2 * Math.PI * 8 * ((14 + 6) / 2), 0.01);
    const wide = Math.max(o.bbox.size[0], o.bbox.size[1]);
    expect(wide).toBeGreaterThan(28.5); expect(wide).toBeLessThan(30.1);   // the first turn is the widest, but a cone's turn is a little narrower than its diameter along each axis
    near(o.bbox.size[2], 40, 0.005);
  }, 180000);
  it('a progressive spring: the turns close up towards the far end, the length and volume stay right', async () => {
    const o = await build(`const p = part('S').spring({ outer: 20, wire: 2, length: 60, coils: 8, progression: 0.5 });`);
    expect(o.ok).toBe(true);
    near(o.vol, A * 2 * Math.PI * 9 * 8, 0.01);
    near(o.bbox.size[2], 60, 0.005);
  }, 180000);
  it('a conical progressive spring with ground ends has flat ends at 0 and the length', async () => {
    const o = await build(`const p = part('S').spring({ outer: 30, wire: 2, length: 60, coils: 9, topOuter: 16, progression: 0.6, ends: 'ground', name: 'Cone' });`);
    expect(o.ok).toBe(true);
    expect(Math.abs(o.bbox.min[2])).toBeLessThan(0.01); expect(Math.abs(o.bbox.max[2] - 60)).toBeLessThan(0.01);
  }, 240000);
  it('refuses a progression that would close the turns onto each other, with the tightest pitch', async () => {
    const bad = (opts: string) => build(`const p = part('S').spring(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad('{ outer: 20, wire: 2, length: 40, coils: 8, progression: 0.2 }')).toMatch(/tightest pitch/);
    expect(await bad('{ outer: 20, wire: 2, length: 40, coils: 8, topOuter: 3 }')).toMatch(/topOuter/);
  });
});

describe('extensionSpring()', () => {
  const pathLength = (o: { outer: number; wire: number; coils: number; spin?: 1 | -1 }) => {
    const { pts } = extensionPath({ ...o, spin: o.spin ?? 1 });
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    return L;
  };
  it('a tight coil with a hook at each end is one valid solid, as long as the path says, with the volume of the wire', async () => {
    const o = await build(`const p = part('E').extensionSpring({ outer: 12, wire: 1, coils: 15 });`);
    const want = extensionPath({ outer: 12, wire: 1, coils: 15, spin: 1 });
    expect(o.ok).toBe(true);
    near(o.vol, Math.PI * 0.25 * pathLength({ outer: 12, wire: 1, coils: 15 }), 0.02);
    near(o.bbox.size[2], want.length, 0.01);
    expect(o.bbox.min[2]).toBeCloseTo(0, 1);
  }, 240000);
});

describe('torsionSpring()', () => {
  it('a close-wound coil with a leg at each end is one valid solid with the volume of the wire', async () => {
    const o = await build(`const p = part('T').torsionSpring({ outer: 14, wire: 1.2, coils: 5.25 });`);
    const { pts, length } = torsionPath({ outer: 14, wire: 1.2, coils: 5.25, leg1: 21, leg2: 21, spin: 1 });
    let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]);
    expect(o.ok).toBe(true);
    near(o.vol, Math.PI * 0.36 * L, 0.02);
    near(o.bbox.size[2], length, 0.01);
  }, 180000);
  it('legs of different length, left hand, along -y from an offset origin: valid, and the coil is where it should be', async () => {
    const o = await build(`const p = part('T').torsionSpring({ outer: 14, wire: 1.2, coils: 5.5, leg1: 10, leg2: 25, hand: 'left', origin: [2, 5, 3], axis: [0, -1, 0] });`);
    expect(o.ok).toBe(true);
    near(o.bbox.size[1], 5.5 * 1.2 * 1.05 + 1.2, 0.01);
    expect(o.bbox.max[1]).toBeCloseTo(5, 1);
  }, 180000);
  it('refuses a coil too thin for its wire and fewer than one turn', async () => {
    const bad = (opts: string) => build(`const p = part('T').torsionSpring(${opts});`).then(() => 'built', (e: Error) => e.message);
    expect(await bad('{ outer: 2, wire: 1.2, coils: 5 }')).toMatch(/twice the wire/);
    expect(await bad('{ outer: 14, wire: 1.2, coils: 0.5 }')).toMatch(/at least 1/);
  });
});

